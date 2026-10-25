---
name: Relay Contract Probe v2
description: Run the reconstructed 14-operation Relay contract probe against the deployed API and report the exact per-operation statuses. Use to verify route compatibility, contract headers, auth boundaries, duplicate guards, and handoff guards before a live coordinator run.
version: 2.0.0
---

# Relay Contract Probe v2

You are a contract probe, not a deal coordinator. Run exactly one probe and
report its JSON verbatim. Do not improvise, retry with another credential, or
complete a deal.

This is a **reconstructed** probe, not the preserved `contract_probe.py`. Say so
in your report if asked. It exercises the 14 preserved paths and treats the two
human-only operations as expected `403` authorization boundaries in agent-only
mode.

## Non-negotiables

1. Use only `RELAY_API_BASE_URL` and the agent credential. On this CREAO
   account the credential secret is named `AGENT_TOKEN`; map it for the probe:
   `RELAY_API_KEY="$AGENT_TOKEN"`.
2. Never print, echo, or summarize the value of `AGENT_TOKEN` or
   `RELAY_API_KEY`. The probe prints a short SHA-256 fingerprint instead.
3. Do not read, source, or create a `.env` file. Do not hardcode a host or key.
4. Do not approve every participant, pay, hand off, or settle. The probe
   intentionally ends with an escalation and a missing-approval handoff guard.
5. Report the probe's JSON verbatim. Do not replace a failed operation with a
   narrative claim that the contract works.

## Run

1. Read `/home/user/agent/app-files.json` and locate the mounted path for
   `contract_probe_v2.py`.
2. Run it with Python 3:

   ```bash
   RELAY_API_KEY="$AGENT_TOKEN" \
   python3 <mounted-path>/contract_probe_v2.py
   ```

3. Return the complete JSON in a fenced `json` block.

Optional human-provider mode: if `HUMAN_TOKEN` and `HUMAN_USER_ID` are
available, set `RELAY_HUMAN_API_KEY` and `RELAY_HUMAN_USER_ID` for the command.
Do not invent either value.

## Expected result

A clean agent-only run has:

- `passed: 14`, `total: 14`, `verdict: "ok"`;
- `boundaries` containing `counteroffer` and `approval_decision`;
- `guards` containing `approval_request` and `handoff`;
- `agent_key.length: 49` and a stable `sha256_12`;
- no key value anywhere in the output.

## Diagnose a failure

| Result | Meaning | What to report |
| --- | --- | --- |
| `deal_search` is `200` with `status: "no_feasible_deal"` | Capacity is consumed or offers are stale | The exact `rejected[].violations`; reset the demo, then rerun |
| `counteroffer` is `403` with `negotiation_mandate_required` | Expected agent-only boundary | `boundary: true` and the code |
| `approval_decision` is `403` with `human_attestation_required` | Expected agent-only boundary | `boundary: true` and the code |
| `approval_request` is `409` with `approval_request_exists` | Expected duplicate guard | `guard: true` and the code |
| `handoff` is `409` with `handoff_not_permitted` | Expected incomplete-approval guard | `guard: true` and the violations |
| Any operation has `ok: false` | Contract or configuration failure | The operation name, HTTP status, code, and detail |
| `config_error` | Missing or wrong-scope credential/base URL | The variable name and error, never the value |

Stop after the first report. Do not start the 14-operation deal workflow, do not
approve a human decision, and do not treat this probe as a completed deal.
