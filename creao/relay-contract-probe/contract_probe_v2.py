#!/usr/bin/env python3
"""Reconstructed 14-operation Relay contract probe (v2).

This is a new artifact, not the preserved `contract_probe.py` from the original
coordinator package. It exercises the 14 preserved paths and reports whether each
returned an expected status.

Two modes:

* agent-only (default): uses RELAY_API_KEY. The two human-only operations
  (counteroffer and approval decision) are expected to return 403; they are
  reported as authorization boundaries, not failures.
* human-provider (optional): set RELAY_HUMAN_API_KEY and RELAY_HUMAN_USER_ID
  (plus RELAY_HUMAN_PARTY_ID if the proposal has more than one provider). The
  probe then performs a real provider counteroffer and a real human approval for
  that provider, leaving the other approvals missing so handoff still returns
  the expected 409 guard.

Environment:
  RELAY_API_BASE_URL       required, https host root, no /v1, no trailing slash
  RELAY_API_KEY            required, Relay agent key (relay_...)
  RELAY_HUMAN_API_KEY      optional, human key for the provider participant
  RELAY_HUMAN_USER_ID      required when RELAY_HUMAN_API_KEY is set
  RELAY_HUMAN_PARTY_ID     optional, provider party to counter/approve
  RELAY_WORKLOAD_ID        optional, defaults to the seeded Brightlane workload

The probe never approves every participant, never pays, never hands off, and
never prints a key. It creates a demo deal, a negotiation event, an approval
request, and an escalation. Run it against the demo dataset, not production.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

CONTRACT = "relay-duo1.v1"
CONTRACT_HEADER = "X-Relay-Contract"
DEFAULT_WORKLOAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab"  # Brightlane AI
DEFAULT_PARTY_ID = "22222222-2222-4222-8222-222222222222"  # Vertex Labs
DEFAULT_TIMEOUT_SECONDS = 30
SEARCH_TIMEOUT_SECONDS = 90


class ConfigError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def base_url() -> str:
    raw = os.environ.get("RELAY_API_BASE_URL", "").strip()
    if not raw:
        raise ConfigError("RELAY_API_BASE_URL is not set")
    parsed = urllib.parse.urlsplit(raw)
    if parsed.scheme != "https":
        raise ConfigError("RELAY_API_BASE_URL must use https")
    if not parsed.hostname:
        raise ConfigError("RELAY_API_BASE_URL has no host")
    if parsed.path not in ("", "/"):
        raise ConfigError("RELAY_API_BASE_URL must be the host root, no path or trailing slash")
    if parsed.query or parsed.fragment:
        raise ConfigError("RELAY_API_BASE_URL must not contain a query or fragment")
    if parsed.hostname in {"localhost", "127.0.0.1", "::1"} or parsed.hostname.endswith(".loca.lt"):
        raise ConfigError("RELAY_API_BASE_URL is a local/tunnel host, not public Relay")
    return f"{parsed.scheme}://{parsed.netloc}"


def relay_key(name: str, required: bool) -> str | None:
    value = os.environ.get(name, "").strip()
    if not value:
        if required:
            raise ConfigError(f"{name} is not set")
        return None
    if len(value) < 8 or len(value) > 512:
        raise ConfigError(f"{name} has an implausible length")
    if not value.startswith("relay_"):
        prefix = value.split("_", 1)[0] + "_" if "_" in value else "(no prefix)"
        raise ConfigError(f"{name} has the wrong scope (prefix {prefix}); expected relay_")
    return value


def key_description(key: str) -> dict[str, Any]:
    return {
        "present": True,
        "length": len(key),
        "prefix": "relay_",
        "sha256_12": hashlib.sha256(key.encode("utf-8")).hexdigest()[:12],
    }


def call(
    base: str,
    method: str,
    path: str,
    key: str | None,
    *,
    body: Any = None,
    contract: bool = True,
    idempotent: bool = False,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "User-Agent": "relay-contract-probe/2.0",
    }
    if key:
        headers["Authorization"] = f"Bearer {key}"
    if contract:
        headers[CONTRACT_HEADER] = CONTRACT
    if idempotent:
        headers["Idempotency-Key"] = str(uuid.uuid4())

    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(f"{base}{path}", data=data, headers=headers, method=method)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(128_000)
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read(128_000)
        status = error.code
    except Exception as error:
        return {
            "status": None,
            "ok": False,
            "error": f"{type(error).__name__}: {error}",
            "elapsed_ms": round((time.monotonic() - started) * 1000),
        }

    text = raw.decode("utf-8", errors="replace")
    try:
        parsed: Any = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = text[:1_000]
    return {
        "status": status,
        "ok": 200 <= status < 300,
        "body": parsed,
        "elapsed_ms": round((time.monotonic() - started) * 1000),
    }


def code_of(result: dict[str, Any]) -> str | None:
    body = result.get("body")
    if isinstance(body, dict):
        value = body.get("code")
        return str(value) if value is not None else None
    return None


def detail_of(result: dict[str, Any]) -> str | None:
    body = result.get("body")
    if isinstance(body, dict):
        value = body.get("detail")
        return str(value) if value is not None else None
    return None


def entry(
    name: str,
    method: str,
    path: str,
    result: dict[str, Any],
    expected: list[int],
    *,
    note: str | None = None,
    boundary: bool = False,
    guard: bool = False,
) -> dict[str, Any]:
    status = result.get("status")
    return {
        "operation": name,
        "method": method,
        "path": path,
        "http_status": status,
        "expected": expected,
        "code": code_of(result),
        "detail": detail_of(result),
        "elapsed_ms": result.get("elapsed_ms"),
        "ok": status in expected,
        "boundary": boundary,
        "guard": guard,
        "note": note,
    }


def skipped(name: str, method: str, path: str, note: str) -> dict[str, Any]:
    return {
        "operation": name,
        "method": method,
        "path": path,
        "http_status": None,
        "expected": [],
        "code": None,
        "detail": None,
        "elapsed_ms": None,
        "ok": False,
        "boundary": False,
        "guard": False,
        "note": note,
    }


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def choose_provider(proposal: dict[str, Any], preferred_party_id: str | None) -> str | None:
    parties = [as_dict(item) for item in as_list(proposal.get("parties"))]
    commitments = [as_dict(item) for item in as_list(proposal.get("required_commitments"))]
    provider_ids = {
        str(commitment.get("provider_id"))
        for commitment in commitments
        if commitment.get("provider_id")
    }
    candidates = [
        party
        for party in parties
        if party.get("role") == "provider" and str(party.get("id")) in provider_ids
    ]
    if preferred_party_id:
        for party in candidates:
            if str(party.get("id")) == preferred_party_id:
                return preferred_party_id
        return None
    if not candidates:
        return None
    return str(candidates[0].get("id"))


def provider_rate(proposal: dict[str, Any], provider_id: str) -> int | None:
    commitments = [as_dict(item) for item in as_list(proposal.get("required_commitments"))]
    commitment = next(
        (item for item in commitments if str(item.get("provider_id")) == provider_id),
        None,
    )
    if not commitment:
        return None
    compensation = [as_dict(item) for item in as_list(proposal.get("compensation"))]
    line = next(
        (item for item in compensation if str(item.get("to_party_id")) == provider_id),
        None,
    )
    if not line:
        return None
    try:
        gpu_count = int(commitment.get("gpu_count") or 0)
        start = datetime.fromisoformat(str(commitment.get("window_start")).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(commitment.get("window_end")).replace("Z", "+00:00"))
        hours = max(1, round((end - start).total_seconds() / 3600))
        amount = int(line.get("amount_minor") or 0)
    except Exception:
        return None
    if gpu_count <= 0 or hours <= 0:
        return None
    return max(1, round(amount / (gpu_count * hours)))


def main() -> int:
    report: dict[str, Any] = {
        "probe": "relay-contract-probe/2.0",
        "kind": "reconstructed",
        "generated_at": utc_now(),
    }
    try:
        base = base_url()
        agent_key = relay_key("RELAY_API_KEY", required=True)
        human_key = relay_key("RELAY_HUMAN_API_KEY", required=False)
        human_user_id = os.environ.get("RELAY_HUMAN_USER_ID", "").strip() or None
        human_party_id = os.environ.get("RELAY_HUMAN_PARTY_ID", "").strip() or None
        workload_id = os.environ.get("RELAY_WORKLOAD_ID", "").strip() or DEFAULT_WORKLOAD_ID
        if human_key and not human_user_id:
            raise ConfigError("RELAY_HUMAN_USER_ID is required when RELAY_HUMAN_API_KEY is set")
    except ConfigError as error:
        report["verdict"] = "config_error"
        report["error"] = str(error)
        print(json.dumps(report, indent=2))
        return 2

    assert agent_key is not None
    mode = "human-provider" if human_key else "agent-only"
    report.update(
        {
            "base_url": base,
            "contract": CONTRACT,
            "mode": mode,
            "workload_id": workload_id,
            "agent_key": key_description(agent_key),
            "human_key": key_description(human_key) if human_key else {"present": False},
        }
    )

    operations: list[dict[str, Any]] = []

    health = call(base, "GET", "/v1/health", None, contract=False)
    health_body = as_dict(health.get("body"))
    health_ok = (
        health.get("status") == 200
        and health_body.get("status") == "ok"
        and health_body.get("database") == "ok"
    )
    item = entry("health", "GET", "/v1/health", health, [200], note="database must be ok")
    item["ok"] = health_ok
    operations.append(item)

    workload_path = f"/v1/workloads/{urllib.parse.quote(workload_id)}"
    workload = call(base, "GET", workload_path, agent_key)
    workload_body = as_dict(workload.get("body"))
    item = entry("workload_read", "GET", workload_path, workload, [200])
    item["ok"] = item["ok"] and str(as_dict(workload_body.get("workload")).get("id")) == workload_id
    operations.append(item)

    party_path = f"/v1/parties/{urllib.parse.quote(DEFAULT_PARTY_ID)}"
    party = call(base, "GET", party_path, agent_key)
    party_body = as_dict(party.get("body"))
    item = entry("party_read", "GET", party_path, party, [200])
    item["ok"] = item["ok"] and str(as_dict(party_body.get("party")).get("id")) == DEFAULT_PARTY_ID
    operations.append(item)

    offers_path = f"/v1/offers?workload_id={urllib.parse.quote(workload_id)}&limit=20"
    offers = call(base, "GET", offers_path, agent_key)
    offers_body = as_dict(offers.get("body"))
    item = entry("offers_read", "GET", offers_path, offers, [200])
    item["ok"] = item["ok"] and isinstance(offers_body.get("offers"), list)
    operations.append(item)

    history_path = "/v1/market/history?gpu_model=H100&window_hours=24"
    history = call(base, "GET", history_path, agent_key)
    history_body = as_dict(history.get("body"))
    item = entry("market_history_read", "GET", history_path, history, [200])
    item["ok"] = item["ok"] and isinstance(history_body.get("history"), list)
    operations.append(item)

    search = call(
        base,
        "POST",
        "/v1/deals/search",
        agent_key,
        body={"workload_id": workload_id},
        idempotent=True,
        timeout=SEARCH_TIMEOUT_SECONDS,
    )
    search_body = as_dict(search.get("body"))
    deal_view = as_dict(search_body.get("deal"))
    proposal = as_dict(search_body.get("proposal"))
    deal_id = str(deal_view.get("deal_id") or as_dict(deal_view.get("deal")).get("id") or "")
    search_ok = search.get("status") in (200, 201) and bool(deal_id) and bool(proposal)
    item = entry("deal_search", "POST", "/v1/deals/search", search, [200, 201])
    item["ok"] = search_ok
    if not search_ok:
        item["note"] = "search did not return a persisted deal with a proposal"
    operations.append(item)

    if not deal_id:
        for name, method, path in [
            ("deal_read", "GET", "/v1/deals/{deal_id}"),
            ("counteroffer", "POST", "/v1/deals/{deal_id}/counteroffers"),
            ("negotiation_event", "POST", "/v1/deals/{deal_id}/negotiation-events"),
            ("approval_request", "POST", "/v1/approval-requests"),
            ("approvals_list", "GET", "/v1/approvals"),
            ("approval_decision", "POST", "/v1/approvals"),
            ("handoff", "POST", "/v1/deals/{deal_id}/handoff"),
            ("escalation", "POST", "/v1/deals/{deal_id}/escalations"),
        ]:
            operations.append(skipped(name, method, path, "skipped: search produced no deal_id"))
    else:
        deal_path = f"/v1/deals/{urllib.parse.quote(deal_id)}"
        deal = call(base, "GET", deal_path, agent_key)
        deal_body = as_dict(deal.get("body"))
        item = entry("deal_read", "GET", deal_path, deal, [200])
        item["ok"] = item["ok"] and str(deal_body.get("deal_id")) == deal_id
        operations.append(item)

        provider_id = choose_provider(proposal, human_party_id)
        version = 1
        counter_succeeded = False

        if human_key and provider_id:
            rate = provider_rate(proposal, provider_id)
            ask = (rate + 1) if rate else 165
            counter = call(
                base,
                "POST",
                f"/v1/deals/{urllib.parse.quote(deal_id)}/counteroffers",
                human_key,
                body={
                    "terms_version": 1,
                    "ask_price_minor_per_gpu_hour": ask,
                    "participant_id": provider_id,
                    "rationale": "contract_probe_v2 human provider counter",
                },
                idempotent=True,
            )
            counter_body = as_dict(counter.get("body"))
            counter_deal = as_dict(counter_body.get("deal"))
            new_version = as_dict(counter_deal.get("deal")).get("current_version")
            item = entry(
                "counteroffer",
                "POST",
                f"/v1/deals/{deal_id}/counteroffers",
                counter,
                [201],
                note=f"human provider {provider_id} at {ask} minor/GPU-hour",
            )
            item["ok"] = item["ok"] and new_version == 2
            operations.append(item)
            if item["ok"]:
                counter_succeeded = True
                version = 2
        elif provider_id:
            rate = provider_rate(proposal, provider_id)
            ask = (rate + 1) if rate else 165
            counter = call(
                base,
                "POST",
                f"/v1/deals/{urllib.parse.quote(deal_id)}/counteroffers",
                agent_key,
                body={
                    "terms_version": 1,
                    "ask_price_minor_per_gpu_hour": ask,
                    "participant_id": provider_id,
                    "rationale": "contract_probe_v2 agent counter boundary",
                },
                idempotent=True,
            )
            expected_code = code_of(counter) in {
                "negotiation_mandate_required",
                "negotiation_mandate_invalid",
                "counteroffer_forbidden",
                "participant_forbidden",
            }
            item = entry(
                "counteroffer",
                "POST",
                f"/v1/deals/{deal_id}/counteroffers",
                counter,
                [201, 403],
                note="agent-only: 403 is the expected mandate/authorization boundary",
                boundary=counter.get("status") == 403,
            )
            item["ok"] = (counter.get("status") == 201) or (
                counter.get("status") == 403 and expected_code
            )
            operations.append(item)
            if counter.get("status") == 201:
                counter_succeeded = True
                version = 2
        else:
            operations.append(
                skipped(
                    "counteroffer",
                    "POST",
                    f"/v1/deals/{deal_id}/counteroffers",
                    "skipped: no provider participant found in the proposal",
                )
            )

        negotiation = call(
            base,
            "POST",
            f"/v1/deals/{urllib.parse.quote(deal_id)}/negotiation-events",
            agent_key,
            body={
                "version": version,
                "round": 1,
                "event_type": "terms_conveyed",
                "payload": {"channel": "contract_probe_v2", "probe": True},
            },
            idempotent=True,
        )
        operations.append(
            entry(
                "negotiation_event",
                "POST",
                f"/v1/deals/{deal_id}/negotiation-events",
                negotiation,
                [201],
                note=f"terms version {version}",
            )
        )

        approval_request_id: str | None = None
        if provider_id:
            approval_request = call(
                base,
                "POST",
                "/v1/approval-requests",
                agent_key,
                body={
                    "deal_id": deal_id,
                    "version": version,
                    "participant_id": provider_id,
                    "obligation": "Contract probe: acknowledge the preserved approval-request path.",
                    "amount_minor": 0,
                    "currency": "USD",
                    "channel": "contract_probe_v2",
                },
                idempotent=True,
            )
            approval_request_body = as_dict(approval_request.get("body"))
            approval_request_id = str(
                as_dict(approval_request_body.get("approval_request")).get("id") or ""
            ) or None
            duplicate = (
                approval_request.get("status") == 409
                and code_of(approval_request) == "approval_request_exists"
            )
            item = entry(
                "approval_request",
                "POST",
                "/v1/approval-requests",
                approval_request,
                [201, 409],
                note="409 approval_request_exists is the expected duplicate guard"
                if duplicate
                else f"terms version {version}",
                guard=duplicate,
            )
            item["ok"] = (approval_request.get("status") == 201) or duplicate
            operations.append(item)
        else:
            operations.append(
                skipped(
                    "approval_request",
                    "POST",
                    "/v1/approval-requests",
                    "skipped: no provider participant found in the proposal",
                )
            )

        approvals_path = (
            f"/v1/approvals?deal_id={urllib.parse.quote(deal_id)}&version={version}"
        )
        approvals = call(base, "GET", approvals_path, agent_key)
        approvals_body = as_dict(approvals.get("body"))
        requests = [
            as_dict(item)
            for item in as_list(approvals_body.get("approval_requests"))
        ]
        item = entry("approvals_list", "GET", approvals_path, approvals, [200])
        item["ok"] = item["ok"] and isinstance(approvals_body.get("approval_requests"), list)
        operations.append(item)

        target_request = next(
            (
                request
                for request in requests
                if provider_id and str(as_dict(request.get("participant")).get("id")) == provider_id
            ),
            requests[0] if requests else None,
        )
        target_request_id = (
            str(target_request.get("id"))
            if target_request and target_request.get("id")
            else approval_request_id
        )

        if not target_request_id:
            operations.append(
                skipped(
                    "approval_decision",
                    "POST",
                    "/v1/approvals",
                    "skipped: no approval request id available",
                )
            )
        elif human_key and human_user_id:
            decision = call(
                base,
                "POST",
                "/v1/approvals",
                human_key,
                body={
                    "request_id": target_request_id,
                    "decision": "approved",
                    "attested_by": human_user_id,
                    "channel": "contract_probe_v2",
                },
                idempotent=True,
            )
            operations.append(
                entry(
                    "approval_decision",
                    "POST",
                    "/v1/approvals",
                    decision,
                    [201],
                    note="human provider approval; other participants remain pending",
                )
            )
        else:
            decision = call(
                base,
                "POST",
                "/v1/approvals",
                agent_key,
                body={
                    "request_id": target_request_id,
                    "decision": "approved",
                    "attested_by": "contract-probe-agent",
                    "channel": "contract_probe_v2",
                },
                idempotent=True,
            )
            human_boundary = (
                decision.get("status") == 403
                and code_of(decision) == "human_attestation_required"
            )
            item = entry(
                "approval_decision",
                "POST",
                "/v1/approvals",
                decision,
                [403],
                note="agent-only: 403 human_attestation_required is the expected boundary",
                boundary=human_boundary,
            )
            item["ok"] = human_boundary
            operations.append(item)

        handoff = call(
            base,
            "POST",
            f"/v1/deals/{urllib.parse.quote(deal_id)}/handoff",
            agent_key,
            idempotent=True,
        )
        handoff_body = as_dict(handoff.get("body"))
        handoff_guard = (
            handoff.get("status") == 409 and code_of(handoff) == "handoff_not_permitted"
        )
        handoff_success = (
            handoff.get("status") == 200 and handoff_body.get("settlement_authorized") is False
        )
        item = entry(
            "handoff",
            "POST",
            f"/v1/deals/{deal_id}/handoff",
            handoff,
            [200, 409],
            note="409 handoff_not_permitted is the expected incomplete-approval guard"
            if handoff_guard
            else "settlement_authorized must be false",
            guard=handoff_guard,
        )
        item["ok"] = handoff_guard or handoff_success
        operations.append(item)

        escalation = call(
            base,
            "POST",
            f"/v1/deals/{urllib.parse.quote(deal_id)}/escalations",
            agent_key,
            body={
                "version": version,
                "reason": "contract_probe_v2 completed; approval set intentionally incomplete",
                "details": {"contract_probe": True, "mode": mode},
            },
            idempotent=True,
        )
        operations.append(
            entry(
                "escalation",
                "POST",
                f"/v1/deals/{deal_id}/escalations",
                escalation,
                [201],
                note="deal is marked escalated after the probe",
            )
        )

    passed = sum(1 for item in operations if item.get("ok"))
    total = len(operations)
    boundaries = [item["operation"] for item in operations if item.get("boundary") and item.get("ok")]
    guards = [item["operation"] for item in operations if item.get("guard") and item.get("ok")]
    report["deal_id"] = deal_id or None
    report["operations"] = operations
    report["passed"] = passed
    report["total"] = total
    report["boundaries"] = boundaries
    report["guards"] = guards
    report["verdict"] = "ok" if passed == total and total == 14 else "failed"
    print(json.dumps(report, indent=2))
    return 0 if report["verdict"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
