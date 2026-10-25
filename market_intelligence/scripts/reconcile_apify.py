"""Replay recent successful Apify runs into the market service.

The Actor delivers directly when it can, but a relay outage should not lose a
collection. Run this from cron (for example every five minutes) to ingest any
recent run that the webhook did not receive. Both offers and events are
idempotent, so replaying an already-ingested run is a no-op.

    APIFY_TOKEN=... APIFY_ACTOR_ID=... MARKET_ADMIN_TOKEN=... \
    RELAY_API_URL=https://market-api.example \
    python -m market_intelligence.scripts.reconcile_apify --limit 10
"""

from __future__ import annotations

import argparse
import os

import httpx

APIFY_API = "https://api.apify.com/v2"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=10, help="recent runs to inspect")
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.environ.get("RELAY_REPLAY_TIMEOUT_SECONDS", "300")),
        help="per-request timeout in seconds; a full run can exceed two minutes",
    )
    parser.add_argument(
        "--api-url",
        default=os.environ.get("RELAY_API_URL", "http://127.0.0.1:8099"),
        help="Relay market service base URL",
    )
    args = parser.parse_args()

    token = os.environ.get("APIFY_TOKEN")
    actor_id = os.environ.get("APIFY_ACTOR_ID")
    admin_token = os.environ.get("MARKET_ADMIN_TOKEN")
    if not token or not actor_id:
        raise SystemExit("APIFY_TOKEN and APIFY_ACTOR_ID are required")
    if not admin_token:
        raise SystemExit("MARKET_ADMIN_TOKEN is required")

    with httpx.Client(timeout=args.timeout) as client:
        runs_response = client.get(
            f"{APIFY_API}/acts/{actor_id}/runs",
            params={"limit": max(1, min(args.limit, 50)), "desc": "1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        runs_response.raise_for_status()
        runs = runs_response.json().get("data", {}).get("items", [])

        replayed = 0
        skipped = 0
        failed = 0
        for run in runs:
            run_id = run.get("id")
            status = run.get("status")
            if not run_id or status != "SUCCEEDED":
                skipped += 1
                continue
            try:
                response = client.post(
                    f"{args.api_url.rstrip('/')}/v1/admin/ingestion/apify-webhook",
                    json={"eventData": {"actorRunId": run_id}},
                    headers={"Authorization": f"Bearer {admin_token}"},
                )
                response.raise_for_status()
                payload = response.json()
                event_result = payload.get("events") or {}
                print(
                    f"replayed {run_id}: items={payload.get('items', 0)} "
                    f"events={event_result.get('inserted', 0)} "
                    f"duplicate_events={event_result.get('duplicate', 0)}"
                )
                replayed += 1
            except Exception as exc:  # keep processing the remaining runs
                failed += 1
                print(f"failed {run_id}: {type(exc).__name__}: {exc}")

    print(f"reconcile complete: replayed={replayed} skipped={skipped} failed={failed}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
