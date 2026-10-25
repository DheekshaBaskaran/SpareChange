# Hosted CREAO 401 — diagnosis and repair

**Date:** 2026-10-25
**Relay host:** `https://api.bitsthat.fit`
**Symptom:** the existing hosted **Relay Deal Coordinator**
(`93f296bc-583e-4245-8eb2-cd2ad9974832`) returns `401`, while an authenticated
request from this workspace returns `200`.

This document records what is confirmed, what is not, and the smallest safe
repair. It does not change the Relay financial backend or weaken authentication.

---

## 1. Confirmed on the deployed Relay

| Check | Result |
| --- | --- |
| `GET /v1/health` from outside Vultr | `200`, `status: ok`, `contract: relay-duo1.v1`, `database: ok` |
| `GET /v1/creao/work-items?status=pending` with the workspace Relay agent key | `200` |
| `GET /v1/workloads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` with that key | `200` |
| Old Relay agent key from `.env.bak.pre-creao-fix` | still `200` |
| Fresh Relay agent key `CREAO Hosted Agent v2` (`relay_…`) | `200` on health, work-items, workload |

Relay is healthy and the route/auth contract is working. The failure is not in
the public host, Caddy, or the database.

## 2. Confirmed on the CREAO side

The local `.env` value that was being used as `RELAY_API_KEY` is a
**CREAO app-scoped API Trigger key** (`capi_…`, 69 characters), not a Relay
agent key (Relay agent keys are `relay_…`, 49 characters).

| Endpoint | Key used | Result |
| --- | --- | --- |
| `POST https://agent.creao.ai/api/v1/apps/93f296bc-…/runs` | `capi_…` | `202` accepted |
| `GET https://agent.creao.ai/api/v1/apps/93f296bc-…/runs` | `capi_…` | `200`, runs listed |
| `GET https://api.bitsthat.fit/v1/creao/work-items` | `capi_…` | `401 authentication_required` |
| `GET https://developer.creao.ai/v1/secrets` | `capi_…` | `401` (wrong scope; account API needs `cr_sk_…`) |

The two credentials are different products:

| Credential | Prefix | Audience | Correct use |
| --- | --- | --- | --- |
| Relay agent key | `relay_…` | Relay `/v1/*` | `RELAY_API_KEY` in the CREAO sandbox secret |
| CREAO app API Trigger key | `capi_…` | `agent.creao.ai/api/v1/apps/{appId}/runs` | Operator/backend trigger only; never the Relay bearer |
| CREAO Account API key | `cr_sk_…` | `developer.creao.ai/v1/*` | Agent management, secrets, runs, version download |

**Root cause:** the hosted app's `RELAY_API_KEY` secret is the CREAO
`capi_…` trigger key (or an older non-Relay value). Relay correctly rejects it
with `401`. Updating the CREAO connection form without replacing the secret
cannot fix that.

Earlier API Trigger runs for the existing deal coordinator completed with
empty output and no Relay key use. That diagnosis applied to that coordinator
path at the time; it does not negate the later successful hosted execution of
the separately attached reconstructed contract probe (14/14). The coordinator
still needs its own end-to-end run with `backend_mode=http`, observable
non-empty output, and matching Relay audit/access-log evidence before the full
application workflow is considered verified.

The old tunnel `https://relay-duo1-rj.loca.lt` still answers
`503 Tunnel Unavailable`, so it would not produce a Relay `401`; it would produce
`503`. The 14/14 hosted probe proves the attached script could reach the public
Relay with the agent credential; it does not establish that the existing
coordinator's runtime path is healthy.

## 3. Smallest safe repair

1. In CREAO, open the existing **Relay Deal Coordinator** → Secrets.
2. Replace the value of `RELAY_API_KEY` with the Relay agent key from
   `.tmp/creao/relay-agent.key` (name `CREAO Hosted Agent v2`, role `agent`,
   prefix `relay_`). Do not paste the `capi_…` trigger key here.
3. Set `RELAY_API_BASE_URL` to `https://api.bitsthat.fit` — host root, no `/v1`,
   no trailing slash.
4. Keep the `capi_…` key only in the operator/trigger configuration
   (`CREAO_API_KEY`), never in the agent's Relay secret.
5. Do not delete or replace the original agent. The old Relay key remains active
   as a fallback, and the original agent stays available.

## 4. Verification sequence

1. **Stage the reconstructed script** `contract_probe_v2.py` in the CREAO app
   files/manifest. The hosted run used an attached ZIP copy, and the CREAO result explicitly
   reported that the manifest did not list the script.
2. **Repeat the probe from the staged app file** (or confirm CREAO's manifest
   now resolves it) and require `passed: 14`, `total: 14`, `verdict: "ok"`.
   The previous hosted result is recorded at
   [`docs/evidence/contract-probe-v2-creao-2026-10-25.json`](evidence/contract-probe-v2-creao-2026-10-25.json).
3. **Run the actual Relay Deal Coordinator**, not the probe agent/script, with
   `backend_mode=http`, `approval_mode=stop_for_human`, and
   `auto_handoff=true`. Require non-empty output with a CREAO run id and
   `backend.is_mock: false`; a successful script run does not prove the
   coordinator itself invoked Relay.
4. Match that coordinator run to Relay evidence (Caddy access log or `audit_events`)
   by timestamp, endpoint, and principal. Confirm it created a deal and pending
   approval requests, with `settlement_authorized: false` and no completed
   handoff/payment.
5. Supply **real human decisions** through the supported input path. Verify the
   corresponding human principal in Relay, then confirm the current-version
   approvals permit handoff. Only proceed to handoff if the business process
   authorizes it; never fabricate participant approvals.
6. Test negative cases: agent approval returns `403 human_attestation_required`,
   stale approval returns `409 terms_version_stale`, and incomplete approvals
   keep handoff blocked with `409 handoff_not_permitted`.
7. Separately exercise the financial-exception workflow and its finance/human
   approval controls. Do not conflate that workflow with the 14-operation probe.

A hosted run with empty coordinator output or no corresponding Relay request is
not evidence that the coordinator works. The successful hosted probe proves
connectivity and the reconstructed route/status contract only. The preserved
original probe and 31-operation probe remain unavailable unless recovered from
the original CREAO package.

## 5. What must not be done

- Do not add a fallback key or anonymous path to Relay to make the agent pass.
- Do not put a Relay key in a prompt, document, screenshot, or chat.
- Do not use a CREAO `capi_`/`cr_sk_` key as the Relay bearer.
- Do not delete the original agent or revoke the old Relay key before the fresh
  path is verified.
- Do not treat an accepted CREAO run (`202`) as a successful Relay request.
