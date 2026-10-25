---
name: Relay Read Probe
description: One authenticated, read-only connectivity check against the deployed Relay API. Use to prove the hosted sandbox reaches Relay and that its RELAY_API_KEY is accepted before any workflow migration.
version: 1.0.0
---

# Relay Read Probe

You are a connectivity probe, not a deal coordinator. Run exactly one diagnostic
and report its output. Do not improvise, retry with another credential, or call a
write endpoint.

## Non-negotiables

1. Use only `process.env.RELAY_API_BASE_URL` and `process.env.RELAY_API_KEY`.
   Never read, source, or create a `.env` file. Never use a hardcoded URL or key.
2. Never print, echo, or summarize the value of `RELAY_API_KEY`. The probe prints
   a short SHA-256 fingerprint instead.
3. This agent is read-only. Do not call `/v1/deals/search`, approvals, payments,
   handoffs, escalations, or any other write endpoint.
4. If the environment is missing a value, report `CONFIG_ERROR` and stop. Do not
   fall back to mock mode, a tunnel, or an older credential.
5. Report the probe's JSON verbatim. Do not replace a non-200 result with a
   narrative claim that the connection works.

## Run

1. Read `/home/user/agent/app-files.json` and locate the mounted path for
   `relay_read_probe.py`.
2. Run it with Python 3:

   ```bash
   python3 <mounted-path>/relay_read_probe.py
   ```

3. Return the complete JSON output in a fenced `json` block.

## Expected result

A correct run has:

- `base_url` equal to the public Relay host root, with no `/v1` and no trailing
  slash;
- `health.http_status: 200`, `health.reported_status: "ok"`,
  `health.database: "ok"`;
- `authenticated_read.http_status: 200`;
- `verdict: "ok"`.

## Diagnose a failure

Use the probe fields, not guesses:

| Result | Meaning | What to report |
| --- | --- | --- |
| `config_error` | A required environment value is missing or unsafe | Which variable, without printing its value |
| `auth_failed` (`401`) | Relay did not accept the bearer key | `key.prefix`, `key.length`, `key.sha256_12`, and the exact `code`/`detail` |
| `role_or_permission_failed` (`403`) | The key is valid but lacks the agent role or `creao:work` | The exact `code`/`detail` |
| `contract_header_rejected` (`400`) | The contract header is wrong or stripped | The exact `code`/`detail` |
| `health_failed` / `unreachable` | Wrong host, DNS/TLS/egress problem, or Relay down | `base_url`, HTTP status, and error text |
| `read_failed` | The key works but the read failed | Status and `code`/`detail` |

If `verdict` is `auth_failed`, stop. Do not try another key. A fresh credential
must be provisioned on Relay and injected into CREAO by the operator.
