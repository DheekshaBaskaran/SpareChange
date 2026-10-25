#!/usr/bin/env python3
"""Minimal, read-only Relay connectivity probe for a hosted CREAO sandbox.

This script exists to answer one question before any workflow migration:

    Did this sandbox reach the intended Relay host with the intended credential,
    and what exact HTTP status did Relay return?

It deliberately does not read a `.env` file, does not ship a default API key, and
does not call any write, approval, payment, or settlement endpoint. Configuration
comes only from the two environment values CREAO injects:

    RELAY_API_BASE_URL   host root, https, no /v1, no trailing slash
    RELAY_API_KEY        Relay agent credential (Bearer)

The output includes a short SHA-256 fingerprint of the key so a stale secret can
be distinguished from a missing or malformed one without printing the key.
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
from datetime import datetime, timezone
from typing import Any

CONTRACT = "relay-duo1.v1"
CONTRACT_HEADER = "X-Relay-Contract"
DEFAULT_WORKLOAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
WORK_ITEMS_PATH = "/v1/creao/work-items?status=pending&kind=financial_exception"
USER_AGENT = "relay-read-probe/1.0"


class ConfigError(RuntimeError):
    """Configuration is missing or unsafe; the probe must not guess."""


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
        raise ConfigError(
            "RELAY_API_BASE_URL must be the host root; remove any path, /v1, or trailing slash"
        )
    if parsed.query or parsed.fragment:
        raise ConfigError("RELAY_API_BASE_URL must not contain a query or fragment")
    if parsed.hostname in {"localhost", "127.0.0.1", "::1"} or parsed.hostname.endswith(".loca.lt"):
        raise ConfigError("RELAY_API_BASE_URL is a local/tunnel host, not a public Relay host")

    return f"{parsed.scheme}://{parsed.netloc}"


def api_key() -> str:
    key = os.environ.get("RELAY_API_KEY", "").strip()
    if not key:
        raise ConfigError("RELAY_API_KEY is not set")
    if len(key) < 8 or len(key) > 512:
        raise ConfigError("RELAY_API_KEY has an implausible length")
    return key


def key_description(key: str) -> dict[str, Any]:
    prefix = f"{key.split('_', 1)[0]}_" if "_" in key else "(no underscore prefix)"
    return {
        "present": True,
        "length": len(key),
        "prefix": prefix,
        "sha256_12": hashlib.sha256(key.encode("utf-8")).hexdigest()[:12],
    }


def call(base: str, path: str, key: str | None, *, contract: bool) -> dict[str, Any]:
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    if contract:
        headers[CONTRACT_HEADER] = CONTRACT

    request = urllib.request.Request(f"{base}{path}", headers=headers, method="GET")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read(64_000)
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read(64_000)
        status = error.code
    except Exception as error:  # noqa: BLE001 - the report needs the real cause
        return {
            "path": path,
            "http_status": None,
            "ok": False,
            "error": f"{type(error).__name__}: {error}",
            "elapsed_ms": round((time.monotonic() - started) * 1000),
        }

    text = raw.decode("utf-8", errors="replace")
    try:
        body: Any = json.loads(text) if text else None
    except json.JSONDecodeError:
        body = text[:500]

    return {
        "path": path,
        "http_status": status,
        "ok": 200 <= status < 300,
        "elapsed_ms": round((time.monotonic() - started) * 1000),
        "body": body,
    }


def health_summary(result: dict[str, Any]) -> dict[str, Any]:
    body = result.get("body") if isinstance(result.get("body"), dict) else {}
    return {
        **{k: v for k, v in result.items() if k != "body"},
        "reported_status": body.get("status"),
        "contract": body.get("contract"),
        "database": body.get("database"),
    }


def work_items_summary(result: dict[str, Any]) -> dict[str, Any]:
    body = result.get("body") if isinstance(result.get("body"), dict) else {}
    items = body.get("work_items")
    return {
        **{k: v for k, v in result.items() if k != "body"},
        "work_item_count": len(items) if isinstance(items, list) else None,
        "code": body.get("code"),
        "detail": body.get("detail"),
    }


def workload_summary(result: dict[str, Any]) -> dict[str, Any]:
    body = result.get("body") if isinstance(result.get("body"), dict) else {}
    workload = body.get("workload") if isinstance(body.get("workload"), dict) else {}
    return {
        **{k: v for k, v in result.items() if k != "body"},
        "workload_id": workload.get("id"),
        "workload_type": workload.get("type"),
        "gpu_model": workload.get("gpu_model"),
        "code": body.get("code"),
        "detail": body.get("detail"),
    }


def classify(health: dict[str, Any], authenticated: dict[str, Any]) -> str:
    if health.get("http_status") is None:
        return "unreachable"
    if health.get("http_status") != 200:
        return "health_failed"
    if health.get("reported_status") != "ok":
        return "health_not_ok"
    if authenticated.get("http_status") == 401:
        return "auth_failed"
    if authenticated.get("http_status") == 403:
        return "role_or_permission_failed"
    if authenticated.get("http_status") == 400:
        return "contract_header_rejected"
    if authenticated.get("http_status") is None:
        return "unreachable"
    if not 200 <= int(authenticated.get("http_status") or 0) < 300:
        return "read_failed"
    return "ok"


def main() -> int:
    report: dict[str, Any] = {
        "probe": USER_AGENT,
        "generated_at": utc_now(),
    }

    try:
        base = base_url()
        key = api_key()
    except ConfigError as error:
        report["verdict"] = "config_error"
        report["error"] = str(error)
        print(json.dumps(report, indent=2))
        return 2

    report["base_url"] = base
    report["contract"] = CONTRACT
    report["key"] = key_description(key)

    health = health_summary(call(base, "/v1/health", None, contract=False))
    authenticated = work_items_summary(call(base, WORK_ITEMS_PATH, key, contract=True))

    report["health"] = health
    report["authenticated_read"] = authenticated

    workload_id = os.environ.get("WORKLOAD_ID", DEFAULT_WORKLOAD_ID).strip()
    if workload_id:
        report["workload_read"] = workload_summary(
            call(base, f"/v1/workloads/{urllib.parse.quote(workload_id)}", key, contract=True)
        )

    report["verdict"] = classify(health, authenticated)
    print(json.dumps(report, indent=2))

    if report["verdict"] == "ok":
        return 0
    if report["verdict"] in {"auth_failed", "role_or_permission_failed"}:
        return 3
    return 1


if __name__ == "__main__":
    sys.exit(main())
