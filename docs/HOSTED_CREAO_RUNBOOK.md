# Hosted CREAO runbook

This is the exact setup for connecting the existing hosted **Relay Deal
Coordinator** to the deployed Relay. It does not rebuild the agent. The agent
specification is in [`CREAO_AGENT_HANDOFF.md`](CREAO_AGENT_HANDOFF.md); the
Relay-side contract status is in
[`CREAO_INTEGRATION_STATUS.md`](CREAO_INTEGRATION_STATUS.md).

**Current state:** the Relay half is implemented and locally tested, including
the 14 preserved operations. **No hosted CREAO run has ever reached a public
Relay** from this workspace. A local `e2e:exception` run is not hosted evidence.

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

## 3. Prove the wire contract (read-only)

From the CREAO runtime package, run the preserved read probe:

```bash
RELAY_API_BASE_URL="https://api.<domain>" \
RELAY_API_KEY="<agent key>" \
python3 runtime/contract_probe.py --workload-id aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
```

Required result: **14/14**. The 14 operations are:

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

Then run the full probe:

```bash
RELAY_API_BASE_URL="https://api.<domain>" \
RELAY_API_KEY="<agent key>" \
python3 runtime/contract_probe.py --full --yes
```

Required result: **31/31**. The full probe creates a deal and pending approval
requests only; it does not approve, pay, or hand off.

Save both raw outputs. Include the timestamp and the public host in the evidence
file.

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
2. `contract_probe.py` read output: **14/14**, with timestamp.
3. `contract_probe.py --full --yes` output: **31/31**.
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
| `401 unauthorized` | missing/wrong bearer key, or key not `agent` | re-issue an agent key and update the CREAO secret |
| `400 contract_version_mismatch` / missing header | client not sending `relay-duo1.v1` | use the shipped client; do not strip headers at a proxy |
| `404` on a preserved path | wrong base URL (includes `/v1`) or frontend proxy path | set the host root only |
| `409 handoff_not_permitted` | approvals incomplete/stale | re-run with current-version human decisions |
| `409 terms_version_stale` | approval predates a counteroffer | collect fresh approvals for the new version |
| `429`/`5xx` | rate limit or transient backend | client retries 3×; keep `Idempotency-Key` stable |
| `503` on investigation | Elastic disabled/deprecated | expected; exception stays open, do not approve from silence |
| probe 14/14 but full 31/31 fails on search | no free capacity from a prior run | reset demo state, then re-probe |
| clock skew warnings | host/agent clocks differ > 60 s | enable NTP on Vultr and the agent runtime |

## 8. Go-live checklist

- [ ] `https://api.<domain>/v1/health` returns `database: "ok"` from outside Vultr.
- [ ] `RELAY_API_BASE_URL` has no `/v1` and no trailing slash.
- [ ] `RELAY_API_KEY` is a CREAO secret and has role `agent`.
- [ ] Read probe 14/14 and full probe 31/31 are saved with timestamps.
- [ ] A live run reports `backend.is_mock: false`.
- [ ] Caddy/audit evidence matches the run's time and principal.
- [ ] Human approvals use human credentials; agent approval returns 403.
- [ ] Handoff reports `settlement_authorized: false`.
- [ ] Exception run is recorded separately from local orchestration.
- [ ] Elastic is `ELASTIC_ENABLED=0` and its 503 is documented, not hidden.
- [ ] No key appears in the evidence bundle.
