# Relay Duo 1 — clearing, CREAO, Hyphenate finance, and Elastic investigation

This branch is Person B's backend for Relay: deterministic multi-party clearing, CREAO coordination APIs, Hyphenate autonomous finance, financial controls, the Relay-side Duo 2 interface, and the Elastic Agent Builder investigation layer.

It does **not** implement partner-owned Apify ingestion, Tiger Data provisioning, GPU workers, Solana/x402 execution, or the frontend, and it does not provision an Elastic Cloud project. The `elastic:bootstrap` script configures an existing Elasticsearch Serverless project and Agent Builder. The existing hosted CREAO agent is integrated through APIs, not rebuilt here.

## Current status

- **49/49 local tests pass** against embedded Postgres (PGlite), including generalized conditional chains, two- and three-move cycles, uneconomic chain/cycle refusals, the full approval → execution → verified usage → invoice discrepancy → CREAO investigation → blocked payment → correction → test settlement → ledger reconciliation workflow, provider payouts, payout failure recovery, Elastic outbox projection, evidence-citation validation, Agent Builder bootstrap, the Elastic HTTP wire contract, and the Market Intelligence bridge.
- Typecheck and production build are clean.
- The machine-readable contract has **73 operations**; the 14 operations used by the existing hosted CREAO Deal Coordinator remain preserved.
- Live Tiger Data, public hosting, hosted CREAO access, an Elasticsearch Serverless project, real workers, and Duo 2 settlement credentials are external integration dependencies. Missing credentials do not block local development; the finance backend remains operational without Elastic.

## Quick start

Requirements: Node 20.11+, Postgres/Tiger Data for the running server.

```bash
npm install
cp .env.example .env
# Set DATABASE_URL, MIGRATION_DATABASE_URL, and RELAY_API_KEY in .env

npm run db:migrate           # core + finance + P1-P5 + provider payouts + runtime grants
npm run db:migrate:timescale # optional: Timescale hypertable on Tiger Data
npm run db:seed              # demo parties, offers, allocation, fixture deal
npm run db:reset-demo -- --confirm --purge-elastic  # clear demo transactions, re-seed, rebuild the index
npm run dev                  # http://localhost:4000
```

`db:reset-demo` truncates only the transactional `relay` tables (deals, contracts, invoices, payments, exceptions, investigations) and keeps parties, API keys, ledger accounts, spending limits, and the mirrored market offers. It refuses to run without `--confirm` and never runs against a production target. `db:seed` alone is idempotent and also restores the role spending limits that migration 0004 only seeds once. Because truncation bypasses the outbox, `--purge-elastic` clears the Elastic projection index and rebuilds it from the seeded data, so the investigation layer never cites deleted records.

Duo 1 and Market Intelligence can share one Tiger Data database. Duo 1 keeps its tables in the `relay` schema and reads Market Intelligence's `public` tables only through the market API, so `DATABASE_URL` is the same value for both services while `MIGRATION_DATABASE_URL` stays with the owner role. When the Python market API is already listening on `:8099`, set `MARKET_API_URL=http://127.0.0.1:8099` and Duo 1 mirrors fresh public offers for solver baselines (see [docs/MARKET_INTELLIGENCE_INTERFACE.md](docs/MARKET_INTELLIGENCE_INTERFACE.md#8-duo-1-bridge)).

Optional Elasticsearch investigation layer:

```bash
# Set the Elastic variables from docs/ELASTIC_INTEGRATION.md first.
npm run elastic:bootstrap   # index, eight tools, Relay Financial Investigator
npm run elastic:reindex     # initial projection from Tiger Data
```

Production:

```bash
npm run build
npm start
```

Container deployment for Duo 1 and Market Intelligence behind Caddy, including
health checks, migrations, credential bootstrap, and the full startup sequence,
is documented in [deploy/vultr/README.md](deploy/vultr/README.md).

Tests do not need a live database:

```bash
npm run typecheck
npm test
npm run build
```

Every request except `/v1/health` needs:

```text
X-Relay-Contract: relay-duo1.v1
Authorization: Bearer <key>
```

Every write also needs `Idempotency-Key`. Replays return the original response with `Idempotency-Replayed: true`; reusing a key with a different request returns `409 idempotency_conflict`.

## Implemented capabilities

| Area | What works |
|---|---|
| Clearing | Exact search over executable offers and active allocations; direct rentals, one-for-one release-and-replace, and bounded conditional chains/cycles (default depth 4, configurable 2–6); GPU/CPU/memory, time, deadline, authorization, transferability, restart, budget, switching-cost, fee, and minimum-savings constraints; structured refusals; deterministic tie-breaking |
| Deal lifecycle | Persisted `deals`, `deal_versions`, participant approvals, negotiation events, escalations, handoff, and counteroffers; stale versions rejected |
| Negotiation | Human provider counteroffers and hosted-agent counteroffers constrained by participant-issued mandates (rate bounds, maximum delta, expiry) |
| CREAO | Persisted work queue for opportunities, financial exceptions, and approval follow-ups; atomic claim/complete; evidence packets; findings; correction proposals; preserved 14-operation deal-coordinator contract |
| Finance | Contract creation from authorized deals; measured GPU-second billing; buyer invoices and receivables; provider payables and payouts; payment obligations; immutable balanced double-entry journal; trial balance |
| Provider payouts | Finance-requested, human-approved provider payout instructions; Duo 2 submission and confirmed/failed settlements; partial payouts; AP ledger postings; failure exceptions and controlled retry |
| Reconciliation | Contract ↔ invoice ↔ verified usage ↔ buyer payment ↔ receivable checks; provider payable ↔ payout ↔ AP ledger checks; overbilling, underbilling, duplicate invoice, missing payment, ledger mismatch, payout mismatch, overpayment, and failed payment exceptions |
| Controls | RBAC, participant-scoped human approvals, separation of duties, spending limits, payment blocking on open exceptions, idempotent decisions, full audit |
| Duo 2 boundary | Execution authorization; contract scopes; verified usage ingestion; buyer payment instructions; provider payout instructions; submit/confirm/fail settlement; retry after recovery. Relay never calls Solana or x402 itself. |
| Elastic investigation | Serverless search projection with incremental outbox sync; eight scoped Agent Builder tools; autonomous `Relay Financial Investigator`; persisted findings; strict citation re-validation against indexed records; follow-ups; degraded mode when Elastic is unavailable. Tiger Data remains authoritative. |

### Conditional chains and cycles

The solver can build a bounded path across multiple held allocations:

- **Chain:** the target buyer takes a held slot, each displaced workload moves to the next held slot, and the final displaced workload moves to fresh executable capacity.
- **Cycle:** the target buyer already holds an anchor allocation for the same workload; the target moves to another held slot and the final displaced workload takes the released anchor. This closes the rotation without creating new capacity.

Every move is checked against provider authorization/transferability, compatibility, capacity, deadlines, budgets, restartability, switching cost, and aggregate economic surplus. The proposal includes `conditional_chain` with `kind`, `depth`, `closed`, and per-move baselines/costs.

### Provider payout lifecycle

1. Finance requests a payout against an outstanding provider payable.
2. A human approves the payout instruction; finance cannot approve its own request. The default finance/admin auto-approval threshold is zero, so this is a human gate unless an operator explicitly configures a policy threshold.
3. Duo 2 submits the instruction and reports a confirmed or failed settlement after submission.
4. A confirmed payout debits accounts payable `2000` and credits cash `1000`; partial payouts update the payable to `partially_paid`.
5. A failed payout creates a `provider_payout_failed` exception, blocks another instruction, and requires dismissal/recovery before a retry.
6. Reconciliation compares the payable's `paid_minor`, confirmed provider payouts, and the AP ledger balance per contract/invoice.

## Main API groups

The authoritative machine-readable contract is [contracts/relay-duo1.v1.openapi.json](contracts/relay-duo1.v1.openapi.json) (73 operations). Key paths:

- Clearing: `POST /v1/deals/search`, `GET /v1/deals/{id}`, `POST /v1/deals/{id}/counteroffers`, `POST /v1/deals/{id}/handoff`
- Negotiation mandates: `GET|POST /v1/negotiation-mandates`
- Execution: `POST|GET /v1/deals/{id}/execution-authorizations`, `GET /v1/execution-authorizations/{id}`
- Finance: `POST /v1/contracts/{id}/invoices`, `GET /v1/invoices`, `POST /v1/invoices/{id}/lines`, `GET /v1/provider-payables`
- Buyer payments: `POST /v1/invoices/{id}/payment-instruction`, `GET /v1/payment-instructions`, `POST /v1/payment-instructions/{id}/submit`, `POST /v1/payment-instructions/{id}/retry`
- Provider payouts: `POST /v1/provider-payables/{id}/payout-instruction`, `GET /v1/provider-payout-instructions`, `POST /v1/provider-payout-instructions/{id}/retry`, `GET /v1/provider-payouts`
- Approvals: `GET /v1/financial-approvals`, `POST /v1/financial-approvals/{id}/decision`
- Reconciliation and exceptions: `POST /v1/finance/reconciliations`, `GET /v1/finance/exceptions`, `GET /v1/finance/exceptions/{id}/evidence`, `POST /v1/finance/exceptions/{id}/propose-correction`
- Ledger: `GET /v1/ledger/trial-balance`, `GET /v1/ledger/entries`
- CREAO: `GET /v1/creao/work-items`, `POST /v1/creao/work-items/{id}/claim`, `POST /v1/creao/work-items/{id}/complete`, `GET /v1/creao/investigations/{exceptionId}`, `POST /v1/creao/investigations/{exceptionId}/findings`
- Elastic investigator: `POST /v1/creao/investigations/{exceptionId}/run`, `GET /v1/creao/investigations/{exceptionId}/runs`, `GET /v1/finance/investigations/{investigationId}`
- Duo 2: `POST /internal/v1/duo2/usage`, `GET /internal/v1/duo2/contracts/{id}`, `POST /internal/v1/duo2/payment-instructions/{id}/submit`, `POST /internal/v1/duo2/settlements`
- Duo 2 provider payouts: `GET /internal/v1/duo2/provider-payables`, `GET /internal/v1/duo2/provider-payout-instructions`, `POST /internal/v1/duo2/provider-payout-instructions/{id}/submit`, `POST /internal/v1/duo2/provider-settlements`
- Audit: `GET /v1/audit`

## Roles

| Role | Authority |
|---|---|
| `agent` | Search, negotiate within mandates, request approvals/handoff, authorize execution, ingest usage, investigate, propose corrections. Cannot approve or request payments. |
| `human` | Participant decisions, payment/correction approvals, deal/finance/ledger/audit reads. Bound to a `human_user_id` and optionally a party. |
| `finance` | Generate/adjust invoices, request buyer payments and provider payouts, reconcile, investigate, read ledger/audit. Cannot approve its own request. |
| `admin` | Operational access, including execution and settlement confirmation. Still cannot satisfy a human approval requirement. |
| `worker` | Duo 2 usage and settlement interface only. |

Rules enforced server-side:

- Agents and service credentials cannot record participant approvals (`403 human_attestation_required`).
- Human approval requires a human credential bound to a human user.
- A requester cannot approve their own restricted action (`403 separation_of_duties_violation`).
- Missing spending limits deny by default; per-transaction and daily caps are enforced.
- An invoice with an open financial exception cannot produce a buyer payment instruction (`409 payment_blocked`).
- An outstanding provider payable with an open payout exception cannot produce another payout instruction (`409 provider_payout_blocked`).
- A failed settlement creates an exception; retry remains blocked until recovery, then creates a new instruction.
- Duo 2 must submit an instruction before confirming it; otherwise buyer settlement returns `409 settlement_not_submitted` and provider payout settlement returns `409 provider_payout_not_submitted`.
- Every write is idempotent where it changes money, approvals, or settlement state.

## The local demo workflow

`test/finance.test.ts` runs this through HTTP routes and persisted records:

1. Brightlane needs H100 capacity held by Acme; Northstar has a cheaper compatible offer.
2. The solver compares independent rental with a release-and-replace exchange, calculates compensation and savings, and persists a four-party proposal.
3. All four participants approve; handoff and execution authorization create contracts and capacity assignments.
4. Duo 2 reports verified GPU-seconds; billing produces invoices and provider payables.
5. A deliberate 1,000-minor overbilling line is added. Reconciliation detects it and creates an exception.
6. Payment is blocked. The CREAO work item is claimed, evidence is read, findings are recorded, and a correction is proposed.
7. A human approves the correction; the invoice and ledger adjust, and the exception resolves.
8. A finance operator requests payment; a human approves; the Duo 2 worker submits and confirms a test settlement.
9. The ledger remains balanced, the invoice is paid, reconciliation is clean, and the audit trail contains the full sequence.

`test/solver-general.test.ts` covers multi-hop chains, an uneconomic chain refusal, and a closed cycle. `test/recovery.test.ts` covers buyer settlement failure and recovery; the payout tests in `test/finance.test.ts` cover provider payout failure and recovery.

`test/elastic.test.ts` runs the investigation endpoint through HTTP with a fake Agent Builder and Elasticsearch: it checks outbox projection, shared identifiers, follow-ups, unrelated-record rejection, agent outage persistence, and insufficient evidence. `test/elastic-bootstrap.test.ts` verifies the index, eight tool, and agent creation requests against a local HTTP contract server. `test/elastic-http.test.ts` verifies the Elasticsearch bulk/mget/refresh/ping and Agent Builder converse wire shapes. None of these is a live Elastic deployment; [docs/ELASTIC_INTEGRATION.md](docs/ELASTIC_INTEGRATION.md) lists the live gate.

## Data and claims

- Money is integer minor units; timestamps are ISO 8601 UTC.
- Public market listings are `external_reference` records with `executable: false`; they are baselines, never executable inventory.
- The seeded deal remains a labelled fixture for UI/agent testing. Solver-driven `POST /v1/deals/search` does not use it.
- A settlement confirmation is a **test settlement** unless Duo 2 supplies a real devnet transaction. Test payments are not revenue.
- The four-party exchange is staged and recoverable, not an atomic GPU migration guarantee.
- The solver's exact search is bounded by `max_chain_depth` (default 4, maximum 6). It is not an unbounded optimal solver.
- Live Tiger Data, hosted CREAO, public hosting, and Duo 2 execution remain external evidence gates.

## Remaining integration blockers

1. Partner Tiger Data `DATABASE_URL`; apply `0001`–`0005` and verify the Timescale hypertable.
2. Shared public HTTPS host.
3. Hosted CREAO secrets and a 14/14 probe plus full workflow run.
4. Duo 2 worker/usage and provider-payout contract confirmation; Solana/x402 test credentials.
5. Elasticsearch Serverless endpoints and scoped API keys; `elastic:bootstrap`, a completed backfill, and a live Agent Builder investigation with validated citations.
6. A recorded live rehearsal on real workers.

See [docs/OWNER_CHECKLIST.md](docs/OWNER_CHECKLIST.md) for scope ownership and acceptance gates, [docs/CREAO_INTEGRATION_STATUS.md](docs/CREAO_INTEGRATION_STATUS.md) for the live-agent status, [docs/CREAO_AGENT_HANDOFF.md](docs/CREAO_AGENT_HANDOFF.md) for the preserved agent specification, [docs/ELASTIC_INTEGRATION.md](docs/ELASTIC_INTEGRATION.md) for the Elastic setup and investigation contract, and [docs/PARTNER_INTEGRATION_HANDOFF.md](docs/PARTNER_INTEGRATION_HANDOFF.md) for exact partner interfaces.
