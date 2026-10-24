"""Run a market ingestion batch from the command line."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging

import httpx

from market_intelligence.config import Settings
from market_intelligence.core.ingestion import run_ingestion_batch
from market_intelligence.database import Database
from market_intelligence.providers.registry import PROVIDER_KEYS


async def _main(args: argparse.Namespace) -> int:
    settings = Settings()
    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO))
    providers = list(PROVIDER_KEYS) if args.provider == "all" else [args.provider]
    db = Database(settings)
    await db.connect()
    client = httpx.AsyncClient(
        timeout=settings.market_http_timeout_seconds,
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    )
    try:
        results = await run_ingestion_batch(
            settings=settings,
            db=db,
            client=client,
            providers=providers,
            mode=args.mode,
            limit=args.limit,
            trigger="cli",
            idempotency_key=args.idempotency_key,
        )
    finally:
        await client.aclose()
        await db.close()

    print(
        json.dumps(
            [result.model_dump(mode="json") for result in results],
            indent=2,
        )
    )
    return 0 if all(result.status in {"succeeded", "partial", "skipped"} for result in results) else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Relay market ingestion")
    parser.add_argument(
        "--provider", choices=[*PROVIDER_KEYS, "all"], default="all", help="provider to collect"
    )
    parser.add_argument("--mode", choices=["direct", "apify"], default="direct")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--idempotency-key", default=None)
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(args)))


if __name__ == "__main__":
    main()
