# One-shot CREAO prompt: fresh Relay Read Probe

Copy the block below into CREAO. It assumes the Relay host and the `relay_…`
agent key already exist. It does not contain a secret and does not modify the
original agent.

```text
Create exactly one new hosted CREAO agent named "Relay Read Probe v1". Do not
modify, rename, delete, or replace the existing "Relay Deal Coordinator"
(93f296bc-583e-4245-8eb2-cd2ad9974832); it is the fallback. Stop after the new
agent's first read-only run and report the evidence. Do not start the 14-operation
deal workflow.

GOAL
Prove that this hosted CREAO sandbox can reach the deployed Relay API with the
correct Relay credential and receive HTTP 200. This is a connectivity and
authentication probe, not a deal coordinator.

HARD CONSTRAINTS
- Relay base URL must be exactly https://api.bitsthat.fit, with no /v1, no path,
  and no trailing slash.
- Use the existing CREAO account secret RELAY_API_KEY. It must be a Relay agent
  key with prefix relay_. If it is missing, or starts with capi_ or cr_sk_, stop
  immediately with CONFIG_ERROR and report only its prefix and length. Those are
  CREAO keys, not Relay keys. Never print, echo, log, or summarize the key value.
- The new agent is read-only. It may call only:
  GET /v1/health
  GET /v1/creao/work-items?status=pending&kind=financial_exception
  It must not call deal search, counteroffers, approvals, payments, handoffs,
  escalations, settlements, or any other write endpoint.
- Do not use backend_mode=mock, auto_simulate, a localtunnel URL, or a .env file.
- Do not hardcode a key, token, password, or tunnel host anywhere.
- If the probe fails, stop and report the exact HTTP status, error code, and key
  prefix/length/fingerprint. Do not retry with another credential.

STEP 1 — CREATE THE AGENT
Name: Relay Read Probe v1
Output format: JSON
Description: One authenticated, read-only connectivity check for the deployed
Relay API. Proves the hosted sandbox reaches Relay and accepts its credential.

STEP 2 — ADD THE PROBE FILE
Attach a reference file named relay_read_probe.py. If the file is already
available in the workspace, use it exactly. Otherwise create it with exactly this
content:

#!/usr/bin/env python3
"""Read-only Relay connectivity probe for a hosted CREAO sandbox."""
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

CONTRACT = "relay-duo1.v1"
CONTRACT_HEADER = "X-Relay-Contract"
WORK_ITEMS_PATH = "/v1/creao/work-items?status=pending&kind=financial_exception"
DEFAULT_WORKLOAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


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


def api_key() -> str:
    key = os.environ.get("RELAY_API_KEY", "").strip()
    if not key:
        raise ConfigError("RELAY_API_KEY is not set")
    if len(key) < 8 or len(key) > 512:
        raise ConfigError("RELAY_API_KEY has an implausible length")
    if not key.startswith("relay_"):
        prefix = key.split("_", 1)[0] + "_" if "_" in key else "(no prefix)"
        raise ConfigError(f"RELAY_API_KEY has the wrong scope (prefix {prefix}); expected relay_")
    return key


def key_description(key: str) -> dict:
    return {
        "present": True,
        "length": len(key),
        "prefix": "relay_",
        "sha256_12": hashlib.sha256(key.encode("utf-8")).hexdigest()[:12],
    }


def call(base: str, path: str, key: str | None, *, contract: bool) -> dict:
    headers = {"Accept": "application/json", "User-Agent": "relay-read-probe/1.0"}
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
    except Exception as error:
        return {
            "path": path,
            "http_status": None,
            "ok": False,
            "error": f"{type(error).__name__}: {error}",
            "elapsed_ms": round((time.monotonic() - started) * 1000),
        }
    text = raw.decode("utf-8", errors="replace")
    try:
        body = json.loads(text) if text else None
    except json.JSONDecodeError:
        body = text[:500]
    return {
        "path": path,
        "http_status": status,
        "ok": 200 <= status < 300,
        "elapsed_ms": round((time.monotonic() - started) * 1000),
        "body": body,
    }


def health_summary(result: dict) -> dict:
    body = result.get("body") if isinstance(result.get("body"), dict) else {}
    return {
        **{k: v for k, v in result.items() if k != "body"},
        "reported_status": body.get("status"),
        "contract": body.get("contract"),
        "database": body.get("database"),
    }


def work_items_summary(result: dict) -> dict:
    body = result.get("body") if isinstance(result.get("body"), dict) else {}
    items = body.get("work_items")
    return {
        **{k: v for k, v in result.items() if k != "body"},
        "work_item_count": len(items) if isinstance(items, list) else None,
        "code": body.get("code"),
        "detail": body.get("detail"),
    }


def main() -> int:
    report = {"probe": "relay-read-probe/1.0", "generated_at": utc_now()}
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
        result = call(base, f"/v1/workloads/{urllib.parse.quote(workload_id)}", key, contract=True)
        body = result.get("body") if isinstance(result.get("body"), dict) else {}
        workload = body.get("workload") if isinstance(body.get("workload"), dict) else {}
        report["workload_read"] = {
            **{k: v for k, v in result.items() if k != "body"},
            "workload_id": workload.get("id"),
            "workload_type": workload.get("type"),
            "gpu_model": workload.get("gpu_model"),
            "code": body.get("code"),
            "detail": body.get("detail"),
        }

    if health.get("http_status") is None:
        verdict = "unreachable"
    elif health.get("http_status") != 200:
        verdict = "health_failed"
    elif health.get("reported_status") != "ok":
        verdict = "health_not_ok"
    elif authenticated.get("http_status") == 401:
        verdict = "auth_failed"
    elif authenticated.get("http_status") == 403:
        verdict = "role_or_permission_failed"
    elif authenticated.get("http_status") == 400:
        verdict = "contract_header_rejected"
    elif authenticated.get("http_status") is None:
        verdict = "unreachable"
    elif not 200 <= int(authenticated.get("http_status") or 0) < 300:
        verdict = "read_failed"
    else:
        verdict = "ok"

    report["verdict"] = verdict
    print(json.dumps(report, indent=2))
    if verdict == "ok":
        return 0
    if verdict in {"auth_failed", "role_or_permission_failed"}:
        return 3
    return 1


if __name__ == "__main__":
    sys.exit(main())

STEP 3 — AGENT INSTRUCTIONS
Use this skill/procedure:
1. Read /home/user/agent/app-files.json and locate the mounted path for
   relay_read_probe.py.
2. Run: python3 <mounted-path>/relay_read_probe.py
3. Return the complete JSON output verbatim in a fenced json block.
4. Do not read or source a .env file. Do not print the key.
5. Do not call any endpoint other than the two GETs in the probe.
6. If verdict is not "ok", stop and report the exact HTTP status, code, detail,
   key prefix, key length, and key fingerprint. Do not retry with another key.
7. If verdict is "ok", stop. Do not start the 14-operation workflow. Report
   "READ PROBE GREEN" and the Relay host.

STEP 4 — RUN ONCE
Run the new agent once with no inputs. Do not run the original agent.
Do not approve, pay, hand off, or create a deal.

STEP 5 — REPORT
Return:
- the CREAO run id and status;
- the complete probe JSON;
- whether health was 200 with database "ok";
- whether the authenticated read was 200;
- the key prefix, length, and sha256_12 (never the key);
- the final verdict.

If the probe is not green, stop and report the blocker. The original agent must
remain untouched and available as the fallback.
```
