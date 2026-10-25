# Hosted CREAO runbook

This is the exact setup for connecting the existing hosted **Relay Deal
Coordinator** to the deployed Relay. It does not rebuild the agent. The agent
specification is in [`CREAO_AGENT_HANDOFF.md`](CREAO_AGENT_HANDOFF.md); the
Relay-side contract status is in
[`CREAO_INTEGRATION_STATUS.md`](CREAO_INTEGRATION_STATUS.md).

**Current state (2026-10-25):** Relay is live at `https://api.bitsthat.fit`;
`/v1/health` returns `200` with `database: "ok"` and direct authenticated reads
return `200`. A hosted CREAO run of the reconstructed 14-operation probe has
now passed `14/14`
([hosted result](evidence/contract-probe-v2-creao-2026-10-25.json)). The
agent ran the attached ZIP copy because `contract_probe_v2.py` was missing from
`/home/user/agent/app-files.json`; the manifest listed only `relay_read_probe.py`
and `SKILL.md`. Stage the probe in app files before the next run. The preserved
`contract_probe.py` remains absent from this repository and from both deployed
CREAO bundles, and the 31-operation full probe remains unavailable. Local
`e2e:exception` output is separate evidence and does not substitute for a hosted
run.

---

## 1. What Relay must provide first

1. A public HTTPS origin reachable from CREAO egress:
   `https://api.<domain>` (the `DUO1_DOMAIN` Caddy site).
2. No request-password page, basic auth, or interactive challenge. A localtunnel
   URL that returns `503 Tunnel Unavailable` is not a host.
3. `GET /v1/health` returns HTTP 200 with:

   ```json
   { "status": "ok", "contract": "relay-duo1.v1", "database": "ok" }
   ```

   This route is intentionally unauthenticated and exempt from
   `x-relay-contract` so probes and container health checks work.
4. Migrations through `0007`/`0008` applied, and the demo dataset seeded.
5. Caddy access logs available (`docker compose logs caddy`) for request-time
   correlation.

Verify from a network outside Vultr, not from the host itself:

```bash
curl -i "https://${DUO1_DOMAIN}/v1/health"
```

The URL stored in CREAO is the **host root**:

```text
https://api.example.com        ✅
https://api.example.com/v1     ❌
https://api.example.com/       ❌ (no trailing slash)
```

## 2. CREAO platform configuration

The existing app record is:

| Setting | Value |
| --- | --- |
| Agent ID | `93f296bc-583e-4245-8eb2-cd2ad9974832` |
| Agent | Relay Deal Coordinator (agent v1.1.0, runtime package v1.2.0) |
| Contract | `relay-duo1.v1` |
| Skill path (runtime) | `/home/user/workspaces/apps/93f296bc-583e-4245-8eb2-cd2ad9974832/SKILL.md` |
| Runtime files | `/home/user/workspaces/apps/93f296bc-583e-4245-8eb2-cd2ad9974832/` |
| File manifest | `/home/user/agent/app-files.json` |

Configure exactly two environment values on the CREAO app:

| Variable | Value | Storage |
| --- | --- | --- |
| `RELAY_API_BASE_URL` | `https://api.<domain>` (host root, no `/v1`, no trailing slash) | Plain env |
| `RELAY_API_KEY` | A Relay **agent** credential (`role=agent`) | CREAO secret; never a document, prompt, screenshot, or chat |

The agent sends `Authorization: Bearer <key>` and
`X-Relay-Contract: relay-duo1.v1` on every request. It refuses to start a live
run without a key. Do not use a human, finance, admin, or worker key.

### 2.1 Credential scopes are not interchangeable

| Credential | Prefix | Audience | Where it belongs |
| --- | --- | --- | --- |
| Relay agent key | `relay_…` | Relay `/v1/*` | CREAO **secret** `RELAY_API_KEY` |
| CREAO app API Trigger key | `capi_…` | `agent.creao.ai/api/v1/apps/{appId}/runs` | Operator trigger only; `CREAO_API_KEY` |
| CREAO Account API key | `cr_sk_…` | `developer.creao.ai/v1/*` | Agent/secret management only |

A `capi_…` key can create and list CREAO runs (`202`/`200`) and is still
rejected by Relay (`401`). Do not infer Relay access from a successful CREAO
run request. The reverse is also true: a Relay `relay_…` key cannot manage
CREAO agents or secrets.

Run input for the first live run:

| Field | Value |
| --- | --- |
| `backend_mode` | `http` |
| `api_base_url` | empty (so `RELAY_API_BASE_URL` is used) |
| `workload_id` | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` (seeded Acme workload) |
| `approval_mode` | `stop_for_human` |
| `auto_handoff` | `true` |
| `approvals` | empty for the first pass |

Do not use `backend_mode=mock` or `auto_simulate`. A run whose
`backend.is_mock` is not `false` is not evidence.

## 3. Probe the wire contract (state-changing demo probe)

The reconstructed probe performs writes: it searches and creates a deal,
records a negotiation event, and marks the probe deal escalated. It is not
read-only and must run only against the demo dataset. The preserved
`contract_probe.py` is **not available**. It is absent from this repository and
from both deployed CREAO agent bundles. The stand-in is
[`../creao/relay-contract-probe/`](../creao/relay-contract-probe/README.md). It
is **reconstructed** from the OpenAPI contract and the Relay route tests; label
it as reconstructed in every report. It covers the 14 preserved operations
only. There is no 31-operation full probe in this workspace.

From the CREAO runtime package, run the reconstructed probe:

```bash
RELAY_API_BASE_URL="https://api.<domain>" \
RELAY_API_KEY="<agent key>" \
python3 <mounted-path>/contract_probe_v2.py
```

Required result: **`passed: 14`, `total: 14`, `verdict: "ok"`**. The 14
operations are:

| # | Method | Path |
| --- | --- | --- |
| 1 | `GET` | `/v1/health` |
| 2 | `GET` | `/v1/workloads/{workload_id}` |
| 3 | `GET` | `/v1/parties/{party_id}` |
| 4 | `GET` | `/v1/offers` |
| 5 | `GET` | `/v1/market/history` |
| 6 | `POST` | `/v1/deals/search` |
| 7 | `GET` | `/v1/deals/{deal_id}` |
| 8 | `POST` | `/v1/deals/{deal_id}/counteroffers` |
| 9 | `POST` | `/v1/deals/{deal_id}/negotiation-events` |
| 10 | `POST` | `/v1/approval-requests` |
| 11 | `GET` | `/v1/approvals` |
| 12 | `POST` | `/v1/approvals` |
| 13 | `POST` | `/v1/deals/{deal_id}/handoff` |
| 14 | `POST` | `/v1/deals/{deal_id}/escalations` |

Do not run a `--full` mode: the reconstructed probe does not implement one. The
31-operation surface is **unproven**, not passed. The agent-only probe records
two expected `403` authorization boundaries (counteroffer and approval decision)
and two expected `409` guards (duplicate approval request and incomplete-approval
handoff). Those are contract evidence, not a completed deal.

Save the raw output. Include the timestamp, the public host, the mode, and the
key fingerprint (`sha256_12`, never the key) in the evidence file.

### 3.1 Minimal fresh-agent probe (read-only; use if auth/connectivity is uncertain)

If the existing agent still returns `401`, create a separate **Relay Read Probe**
agent and leave the original untouched. The package is in
[`../creao/relay-read-probe/`](../creao/relay-read-probe/README.md). It makes
only `GET /v1/health` and one authenticated `GET
/v1/creao/work-items?kind=financial_exception`, and reports:

- the host it actually used;
- whether a key was present, its length, prefix, and a short SHA-256 fingerprint;
- the exact HTTP status and error code from Relay;
- `verdict: "ok"` only when both reads are `200`.

```bash
RELAY_API_BASE_URL="https://api.bitsthat.fit" \
RELAY_API_KEY="<relay_ agent key>" \
python3 creao/relay-read-probe/relay_read_probe.py
```

Required hosted result: `verdict: "ok"`. A `401` with a `capi_…` prefix in
`key.prefix` means the CREAO secret is still the wrong credential; a different
`sha256_12` from the local Relay key means the secret is stale. Because the
14-operation probe creates and escalates a deal, first confirm that the target
is the demo environment and that you are willing to create that test record.

## 4. First live agent run (human approvals)

Start a run with `backend_mode=http`, `approval_mode=stop_for_human`, and
`auto_handoff=true`. Expected outcome: `awaiting_human_approval`, with one
request per obligated participant and `settlement_authorized: false`.

Verify on Relay:

```bash
curl -fsS "https://${DUO1_DOMAIN}/v1/deals/<deal_id>" \
  -H "x-relay-contract: relay-duo1.v1" \
  -H "authorization: Bearer $RELAY_API_KEY"
```

Check `approval_requests`, `approval_integrity.handoff_permitted`,
`proposal.settlement_authorized: false`, and the agent principal in audit/logs.

Then supply three **real** attested human decisions through
`approval_mode=collect_from_inputs` with the same `deal_id`. Expected:
`completed_handoff_ready`, `settlement_authorized: false`. The agent must not
record approvals on a participant's behalf. A `POST /v1/approvals` made with the
agent key must return `403 human_attestation_required`.

For the error paths, confirm:

- a stale version decision returns `409 terms_version_stale`;
- an incomplete approval set keeps `handoff_permitted: false`;
- `POST /v1/deals/{id}/handoff` returns `409 handoff_not_permitted` with
  `violations[]`;
- `settlement_authorized` is `false` in the handoff response.

## 5. Financial-exception workflow (additive)

The existing deal coordinator must be updated to use the CREAO work queue before
it can prove the exception path. The 14 preserved operations do not change; this
is additional work:

1. `GET /v1/creao/work-items?status=pending&kind=financial_exception`
2. `POST /v1/creao/work-items/{id}/claim`
3. `GET /v1/creao/investigations/{exception_id}` — persisted evidence, never
   narrated by the model
4. `POST /v1/creao/investigations/{exception_id}/findings`
5. Optionally `POST /v1/creao/investigations/{exception_id}/run` with a **120 s**
   timeout. Elastic is deprecated; `503` is expected and must leave the
   exception open.
6. `POST /v1/finance/exceptions/{exception_id}/propose-correction` (finance
   credential, not the agent)
7. Human approval via `POST /v1/financial-approvals/{id}/decision` with a human
   credential
8. Settlement evidence only after resolution

Use the local `npm run e2e:exception` output as the expected shape, but label
the hosted run with its own CREAO run id and Relay evidence. A local run never
satisfies this gate.

## 6. Evidence that makes the integration "verified"

Record all of the following:

1. Public host and `GET /v1/health` output with `database: "ok"`.
2. Reconstructed `contract_probe_v2.py` output: **14/14**, with timestamp and
   the explicit label "reconstructed". A hosted CREAO result now exists at
   [the saved evidence file](evidence/contract-probe-v2-creao-2026-10-25.json);
   note that it was run from an attached ZIP copy because the app-files manifest
   did not stage the probe.
3. The preserved `contract_probe.py` and the 31-operation full probe are
   **unavailable**; record them as gaps, never as passes.
4. CREAO run id and `backend.is_mock: false` from the agent's output.
5. Relay evidence of the same run: a Caddy access-log line or an
   `audit_events` row whose time, endpoint, and principal match the agent run.
   `GET /v1/audit` is the query surface.
6. A real human approval recorded with a human credential, plus the negative
   agent-approval `403`.
7. Handoff response with `settlement_authorized: false`.
8. For the exception path, the work-item id, evidence packet, findings,
   correction approval, and settlement transaction id.
9. For Elastic: either a successful investigation with validated citations, or
   the documented `503` plus proof that the exception stayed open and no payment
   moved. Do not claim Elastic is deployed from a local test.

Store the evidence with the run date and public URL. Do not include keys.

## 7. Common blockers and exact meaning

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `503 Tunnel Unavailable` | old localtunnel URL | use the Caddy HTTPS host, not a tunnel |
| `401 unauthorized` | missing/wrong bearer key, a CREAO `capi_`/`cr_sk_` key in `RELAY_API_KEY`, or key not `agent` | replace the CREAO secret with a Relay `relay_…` agent key; see [CREAO_AUTH_DIAGNOSIS.md](CREAO_AUTH_DIAGNOSIS.md) |
| `400 contract_version_mismatch` / missing header | client not sending `relay-duo1.v1` | use the shipped client; do not strip headers at a proxy |
| `404` on a preserved path | wrong base URL (includes `/v1`) or frontend proxy path | set the host root only |
| `409 handoff_not_permitted` | approvals incomplete/stale | re-run with current-version human decisions |
| `409 terms_version_stale` | approval predates a counteroffer | collect fresh approvals for the new version |
| `429`/`5xx` | rate limit or transient backend | client retries 3×; keep `Idempotency-Key` stable |
| `503` on investigation | Elastic disabled/deprecated | expected; exception stays open, do not approve from silence |
| probe 14/14 but a later deal search fails | no free capacity from a prior run | reset demo state, then re-probe |
| clock skew warnings | host/agent clocks differ > 60 s | enable NTP on Vultr and the agent runtime |

## 8. Go-live checklist

- [ ] `https://api.<domain>/v1/health` returns `database: "ok"` from outside Vultr.
- [ ] `RELAY_API_BASE_URL` has no `/v1` and no trailing slash.
- [ ] `RELAY_API_KEY` is a CREAO secret and has role `agent`.
- [x] Reconstructed 14-operation probe is 14/14 in CREAO (attached ZIP copy);
      stage `contract_probe_v2.py` in the app-files manifest for repeatability.
- [ ] Preserved `contract_probe.py` and the 31-operation full probe are recovered
      or explicitly left unavailable.
- [ ] A live run reports `backend.is_mock: false`.
- [ ] Caddy/audit evidence matches the run's time and principal.
- [ ] Human approvals use human credentials; agent approval returns 403.
- [ ] Handoff reports `settlement_authorized: false`.
- [ ] Exception run is recorded separately from local orchestration.
- [ ] Elastic is `ELASTIC_ENABLED=0` and its 503 is documented, not hidden.
- [ ] No key appears in the evidence bundle.
