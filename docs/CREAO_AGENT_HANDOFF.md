# Relay Deal Coordinator — technical handoff for Freebuff integration

> **Preserved reference.** This is the existing hosted agent's specification. It is not a claim that the live agent has been connected. Current Relay-side status is in [CREAO_INTEGRATION_STATUS.md](CREAO_INTEGRATION_STATUS.md).

**Status:** documentation only. No implementation changes were made to produce this document.
Everything below was read from the shipped code (`relay_deal_coordinator_v1.2.0.zip`), the hosted
agent config, and the last audit report. Where something is simulated or unverified it says so.

---

## 1. Role and governing instructions

**Role.** The agent is a *deal coordinator*, not a solver, broker or custodian. Given a buyer workload
and a deal mandate it: retrieves offers/workload/party context, asks the deterministic engine to search,
audits the returned proposal against the mandate, relays terms, runs a bounded counteroffer loop,
requests and collects participant approvals, re-validates inventory, and prepares a handoff package.

**Governing instruction set** is the agent's parent skill (`SKILL.md`, ~6 KB, mounted at
`/home/user/workspaces/apps/93f296bc-583e-4245-8eb2-cd2ad9974832/SKILL.md`). Its non-negotiables:

1. The deterministic engine owns feasibility, allocation, compensation and surplus. The agent audits and
   relays; it never computes or proposes a price.
2. No price, allocation, reservation or payment call. The only number it sends is an *ask* (a price
   ceiling) inside the engine re-solve request.
3. Public listings are context. Any transfer referencing a non-executable or non-`worker` offer is a
   blocking failure.
4. Approvals require human attestation. The agent never records an approval on a participant's behalf.
5. A changed terms version invalidates earlier approvals; no handoff unless
   `approval_integrity.handoff_permitted` is true for the current version.
6. `settlement_authorized` is backend-owned and always reported as `false`.
7. Stay inside the mandate; escalate rather than exceed.
8. Backend binding fails closed: no host means `status: error`, never a silent mock fallback.

Platform-level instructions (how the CREAO runtime schedules and sandboxes a run) are not part of this
agent and are not portable to your process; they only determine *when* the agent executes.

---

## 2. Tools, actions and workflows

**Connectors:** none (`connectors: []`). The agent has no Gmail/Slack/Drive/DB tools and no MCP
connectors configured. All I/O is HTTP through its bundled client, or in-process Python in mock mode.

| Capability | Mechanism | Verified |
|---|---|---|
| Run a coordination pass | `coordinator.run(inputs, backend=None)` / CLI `--backend mock\|http` | yes (mock, and http against the bundled reference server) |
| Market/workload/party reads | 6 GET endpoints via `HttpRelayBackend` | only against the reference server |
| Deal search | `POST /v1/deals/search` | only against the reference server |
| Counteroffer | `POST /v1/deals/{id}/counteroffers` with retry/backoff | reference server + fault injection |
| Negotiation audit | `POST /v1/deals/{id}/negotiation-events` | reference server |
| Approval request / collect | `POST /approval-requests`, `GET/POST /approvals` | reference server |
| Handoff | `POST /v1/deals/{id}/handoff` | reference server (provisional, no funds) |
| Escalation | `POST /v1/deals/{id}/escalations` | reference server |
| Conformance probe | `contract_probe.py` (read-only or `--full`) | only against the reference server |
| Build gate / audit | `tools/build_package.py`, `audit/run_audit.py` | yes, local |

There are no background workers, no cron inside the agent, and no inbound listener. Work happens only
during an invocation.

---

## 3. Connected backends and external services

**Currently connected: none.** At the time of the last audit, `RELAY_API_BASE_URL` and `RELAY_API_KEY`
were unset and no staging host appeared anywhere in the environment. No request has ever reached a real
Freebuff endpoint.

| Service | Status |
|---|---|
| Duo 1 / Freebuff solver + market API | **not connected**; contract defined only |
| Tiger Data (TimescaleDB) | **not connected**; the agent only calls `GET /v1/market/history` |
| Apify | **not connected**; it does not run actors, it reads offer provenance |
| Solana / x402 settlement | out of scope; no wallet or chain code exists |
| Local mock engine | in-process `mock_backend.py` (deterministic fixture) |
| Reference HTTP server | `mock_server.py`, used to exercise the client binding |

---

## 4. Input and output formats

### Inputs (12 form fields; defaults in parentheses)

`backend_mode` (`mock`) · `api_base_url` (empty; host root, no `/v1`) · `workload_id` (`wl-b-001`) ·
`deal_id` (empty; resume) · `budget_minor` (`78000`) · `price_ceiling_minor_per_gpu_hour` (`215`) ·
`target_price_minor_per_gpu_hour` (`205`) · `min_surplus_minor` (`5000`) ·
`max_negotiation_rounds` (`2`) · `approval_mode` (`stop_for_human`) · `approvals` (JSON array) ·
`auto_handoff` (`true`).

Internal defaults not exposed: `price_floor_minor_per_gpu_hour=180`, `max_migration_cost_minor=8000`,
`max_coordination_fee_minor=2000`, `counteroffer_max_attempts=2` (1–3), retry backoff `0.05 s`.

`approvals` entries: `{participant_id, decision:"approved"|"rejected", attested_by, channel, note}`.

### Output (one JSON object)

Top level: `run_id`, `generated_at`, `agent{name,version,contract_version}`, `backend{mode,is_mock,
endpoint}`, `status`, `deal_id`, `terms_version`, `negotiation_state`, `mandate`, `workload`,
`market_context{executable_offers, public_references, price_history}`, `engine`, `infeasible_options`,
`proposal`, `negotiation{rounds[], events[]}`, `approvals{required, recorded, outstanding, stale,
expired, complete, simulated}`, `approval_integrity{approved_for_current, stale_*, problems,
handoff_permitted}`, `checks[]`, `pre_handoff_revalidation`, `handoff`, `escalation`, `warnings`,
`next_actions`.

`status` ∈ `completed_handoff_ready | awaiting_human_approval | policy_blocked |
rejected_by_participant | escalated | error`.
All money is integer minor units (`*_minor`); all timestamps ISO 8601 UTC.

---

## 5. Deal lifecycle

```
bind backend (fail closed if http without host/key)
→ GET workload, parties, offers (executable vs advertised), price history
→ POST /deals/search                 (engine returns versioned proposals + baselines + refusals)
→ select proposal                    (fresh search: max surplus; resume: latest version)
→ mandate pre-check (16 checks)      → policy_blocked on non-price violations
→ log terms_conveyed per party
→ counteroffer loop (bounded)        ask = buyer ceiling only; engine applies price
→ approvals: create one request per obligated participant for the current version
→ collect decisions                  (human attestation required; simulated refused on live backends)
→ integrity verification             (complete, version-matched, unexpired, attested)
→ re-read inventory + re-validate    (worker dropout / expiry after approval blocks handoff)
→ POST /handoff (provisional)        → completed_handoff_ready
```

**Mandate checks:** executable_inventory_only, offer_freshness, capacity_window, hardware_compatibility,
commitment_uniqueness, provider_permissions, buyer_budget, price_ceiling, price_floor,
compensation_reconciliation, surplus_floor, start_deadline, migration_cost_cap, coordination_fee_cap,
approval_coverage, participant_floors.

**Negotiation:** one idempotency key per `(terms version, round)`; retries only 429/5xx with backoff,
max 3 attempts. `409 counteroffer_infeasible`, `proposal:null` and `outcome:"infeasible"` all keep the
previous version, write no approval request, request no handoff, and escalate with
`reason:"counteroffer_infeasible"`, `constraint_violations`, `attempts`, `idempotency_key`. Exhaustion
escalates `counteroffer_retry_exhausted`. A version bump marks earlier requests `stale`/`superseded`,
rejects late decisions with `409 terms_version_stale`, and requires fresh approval from **every**
affected participant.

**Approvals:** the agent creates requests with obligations, amount, channel and expiry. It only forwards
a decision that carries `attested_by`; it rejects attestations that name itself. `auto_simulate` is
allowed only against the in-process mock and is labelled `simulated: true` end to end.
`handoff_permitted` is recomputed by the agent, not trusted from the backend's `complete` flag.

**Coordination:** escrow-free and non-custodial. It never reserves, commits, charges, refunds or
migrates anything; the backend returns `reservation_status` and keeps `settlement_authorized=false`.

---

## 6. Implemented vs simulated vs incomplete

| Area | State |
|---|---|
| Orchestration, 16 mandate checks, approval request/collection protocol, version invalidation, bounded retries, escalation, idempotent client, fail-closed binding, pre-handoff revalidation | **implemented and tested** (mock + reference server) |
| Contract client for 14 endpoints, Bearer auth, `X-Relay-Contract`, typed errors | **implemented**, exercised only against the bundled server |
| Deterministic solver, economics, surplus | **simulated** by a deterministic fixture; NOT OR-Tools |
| Tiger Data price history | **fixture** shaped like a continuous aggregate |
| Apify listings | **fixture** with plausible provenance fields |
| Reservations / provisional holds | **simulated in memory**; no DB, no locking, no concurrency |
| Settlement, funds authorization | **absent by design** |
| Approval notification delivery (email/Slack) | **not implemented**; the agent only creates the request record, delivery is a backend outbox |
| Live Freebuff integration | **not done**; no host/key available, no request ever sent |
| Real-human approval loop | **protocol implemented**, but no end-to-end run with real participants |
| `authorized_at` expiry on provider permissions | **not enforced** by the agent |

Verification evidence: 18 scenario tests, mode-selection suite (mock / per-run URL / env fallback /
fail-closed), HTTP binding smoke, three-pass end-to-end exchange, and an independent audit of 66
findings — 61 pass, 0 fail, 5 deferred backend obligations, 11 defects found and fixed during the audit.
All of it runs against mocks; nothing is evidence of a working Freebuff integration.

---

## 7. Agent identity

| | |
|---|---|
| **Agent ID** | **`93f296bc-583e-4245-8eb2-cd2ad9974832`** |
| Name / version | Relay Deal Coordinator · agent v1.1.0 (runtime package v1.2.0) |
| Contract | `relay-duo1.v1` |
| Skill path | `/home/user/workspaces/apps/93f296bc-583e-4245-8eb2-cd2ad9974832/SKILL.md` |
| Runtime files | `/home/user/workspaces/apps/93f296bc-583e-4245-8eb2-cd2ad9974832/` |
| File manifest | `/home/user/agent/app-files.json` |

The ID is the CREAO app record; it is not a service you can call. There is no public HTTP endpoint for
the agent.

---

## 8. Connecting the agent to a FastAPI/Node backend

**Network and credentials**

- The sandbox makes **outbound HTTPS only**; your backend must be reachable from CREAO's egress. No
  inbound webhook, no callback URL, no long-lived connection.
- `RELAY_API_BASE_URL` — host root, e.g. `https://api.freebuff.dev`, **no `/v1`**, no trailing slash.
- `RELAY_API_KEY` — stored as a CREAO secret; sent as `Authorization: Bearer <key>`. The client now
  refuses to start without it (`allow_anonymous` exists only for local harnesses).
- Optional per-run `api_base_url` form field overrides the env var. Precedence:
  input → env → hard error.

**Wire contract**

- 14 endpoints under `/v1` (health, workloads, parties, offers, history, deals, deal, counteroffers,
  negotiation-events, approval-requests, approvals GET/POST, handoff, escalations).
- `X-Relay-Contract: relay-duo1.v1` on every request; unknown versions should be rejected.
- `Idempotency-Key` mandatory on every write; retain ≥ 24 h and replay the original response.
- Error envelope `{code, detail, retryable, violations}`; the client retries only 429/5xx (3 attempts,
  0.5/1/2 s, `Retry-After` ignored — keep limits generous).
- Timeout 20 s per request. Keep backend clock within 60 s of UTC; the agent compares offer and
  approval expiry against the run clock.
- Money integer minor units; timestamps ISO 8601 UTC.

**Financial investigation add-on**

When a `financial_exception` work item is claimed, CREAO may call the Elastic investigator before
recording findings:

```http
POST /v1/creao/investigations/{exception_id}/run
Authorization: Bearer <agent key>
X-Relay-Contract: relay-duo1.v1
Idempotency-Key: <unique per run>

{ "question": "optional investigation question", "follow_up_of": "optional prior investigation id" }
```

The backend starts a fresh Agent Builder conversation, retrieves indexed evidence, and returns
`investigation.findings` with `issue_code`, `summary`, `severity`, `confidence`, `uncertainty`,
`recommended_actions`, and citations. It also returns the current `financial_exception` status.

- Use a **120 s** request timeout for this call; the default 20 s deal-coordinator timeout is too short.
- Treat `completed`, `completed_with_warnings`, and `insufficient_evidence` as investigation outcomes,
  not decisions. CREAO still coordinates the human approval/correction workflow.
- A `503` means Elastic is unavailable or the run failed; the exception stays open and the payment
  remains blocked. Escalate or retry later; do not approve from silence.
- Send `follow_up_of` after new evidence arrives. It must belong to the same exception.
- Read `GET /v1/creao/investigations/{exception_id}/runs` for history and
  `GET /v1/finance/investigations/{investigation_id}` for the persisted evidence.

The full contract and setup are in [ELASTIC_INTEGRATION.md](ELASTIC_INTEGRATION.md).

**Server-side obligations the agent depends on (it cannot enforce them for you)**

1. Reject approvals from agent credentials; resolve `attested_by` to a human authorised for that
   participant; reject `simulated: true` outside sandbox.
2. Version-scope approvals; invalidate on a version bump; reject stale decisions and stale handoff
   packages.
3. Reject non-executable or external offers in transfers and at handoff; enforce offer expiry and
   capacity windows.
4. `POST /handoff` re-validates approvals, executability, permissions and budget inside one transaction;
   returns `reservation_status` and `settlement_authorized:false`.
5. Serialise reservation conflicts (the mock now returns `409 offer_conflict`; real concurrency is yours).

**Invocation model**

- A run is started by a CREAO app run (UI/schedule). To resume after humans decide, re-run with
  `deal_id` and `approval_mode=collect_from_inputs` plus the attested decisions — a resume selects the
  latest version and does not renegotiate. There is no callback into a waiting agent, so a run that ends
  `awaiting_human_approval` is picked up by a *new* run, not a parked process.

**Recommended bring-up**

1. Implement `/v1/health` + the four read endpoints; run
   `RELAY_API_BASE_URL=… RELAY_API_KEY=… python3 runtime/contract_probe.py --workload-id <id>`
   until 14/14.
2. Add deal search; `--full --yes` until 31/31 (creates a deal and pending approval requests only).
3. Run the agent with `backend_mode=http`, `approval_mode=stop_for_human`; expect
   `awaiting_human_approval` with one request per obligated party.
4. Supply three real attested decisions via `collect_from_inputs`; expect `completed_handoff_ready`
   with `settlement_authorized:false`.

---

## 9. Known limitations to carry into the integration

- No live endpoint has ever been called by this agent; the 31/31 probe is prepared but unrun.
- Solver, market data, reservations and settlement values are fixtures; no production guarantee.
- No notification delivery, no approval UI, no concurrency control, no provider-authorization expiry.
- Migration is staged/restartable, not atomic; the proposal always declares a fallback.
- Surplus baseline uses a direct-rental price that itself misses the buyer's deadline, so reported
  surplus is conservative; C's contribution depends on an engine-declared marginal cost.
- `auto_simulate` output must never be presented as participant sign-off.
