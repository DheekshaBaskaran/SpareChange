# Partner integration handoff

**Branch:** `Makayla`
**Contract:** `relay-duo1.v1`
**Scope:** Relay Duo 1 backend. This document is the interface boundary for Tiger Data, Apify, Elastic, Duo 2, and the frontend. It does not claim any live integration.

## 1. Common wire contract

- Base URL is the host root, for example `https://api.example.com`; do **not** append `/v1`.
- Every request except `GET /v1/health` sends:
  - `X-Relay-Contract: relay-duo1.v1`
  - `Authorization: Bearer <server-side API key>`
- Every `POST` also sends a non-empty `Idempotency-Key`. Reusing a key with a different body returns `409 idempotency_conflict`.
- Money is integer minor units in `*_minor` fields. Timestamps are ISO 8601 UTC.
- Errors are `{ code, detail, retryable, violations }`. Retry only `429` or `5xx`; do not retry `4xx` validation or authorization failures.
- Browser clients must not receive API keys. Use a server-side proxy or server actions.

### Credential roles

| Role | Use |
|---|---|
| `agent` | Hosted CREAO Deal Coordinator; search, negotiate within mandates, approvals requests, handoff, execution authorization, usage, investigation |
| `human` | Real participant or finance approver; bound to `human_user_id`, optionally a party |
| `finance` | Invoice/payout preparation, reconciliation, investigation |
| `admin` | Operational access and settlement confirmation; still cannot satisfy a human approval |
| `worker` | Duo 2 usage and settlement calls only |

Create keys with:

```bash
npm run key:create -- --name "Duo 2 Worker" --role worker
npm run key:create -- --name "Partner Finance" --role finance
npm run key:create -- --name "Acme Approver" --role human \
  --party-id <party_uuid> --human-user-id <human_uuid>
```

The plaintext key is printed once. Store it in the partner's secret manager, never in the repository or chat.

## 2. Tiger Data

### Dependency

The partner owns the Tiger Data/TimescaleDB service. Relay does not provision a second database.

Required from the partner:

- A PostgreSQL connection string with TLS, exposed as `DATABASE_URL`.
- Permission to create tables and, for the optional time-series step, the `timescaledb` extension.
- Confirmation of backup/retention policy and the maintenance window for migrations.

### Migration order

The backend applies migrations in filename order:

1. `0001_core.sql` — parties, providers, offers, workloads, deals, approvals, handoffs, API keys, audit, idempotency, market observations.
2. `0002_finance.sql` — contracts, usage, billing, invoices, obligations, payments, ledger, exceptions, approvals.
3. `0003_timescale.sql` — `timescaledb` extension and `market_observations` hypertable; only with the Timescale flag.
4. `0004_p1_p5.sql` — allocations, execution authorizations, mandates, spending limits, provider payables, adjustments, P1–P5 indexes.
5. `0005_provider_payouts.sql` — provider payout instructions, payout confirmations, partial payment state, AP reconciliation match types.

Commands:

```bash
# On the partner-owned database
DATABASE_URL='postgres://...' npm run db:migrate
# Optional; requires TimescaleDB
DATABASE_URL='postgres://...' npm run db:migrate:timescale
```

Do **not** run `db:seed` against production data. The seed creates the labelled `relay-demo` fixture used for local/UI/agent testing.

### Verification queries

Run these without printing the connection string:

```sql
SELECT filename, applied_at FROM schema_migrations ORDER BY filename;
SELECT count(*) FROM ledger_accounts;                 -- expect 8
SELECT count(*) FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN
 ('provider_payables','provider_payout_instructions','provider_payouts'); -- expect 3
SELECT hypertable_name FROM timescaledb_information.hypertables
 WHERE hypertable_name = 'market_observations';        -- only with Timescale
```

### Market observation shape

Apify/partner ingestion ultimately populates `market_observations`:

| Column | Type | Meaning |
|---|---|---|
| `observed_at` | `timestamptz` | Source observation time |
| `offer_id` | `uuid`, nullable | Executable offer when the source is a connected worker |
| `provider_id` | `uuid`, nullable | Provider/party when known |
| `gpu_model` | `text` | Normalized model, e.g. `H100` |
| `rate_minor_per_gpu_hour` | `bigint` | Advertised price in minor units |
| `source` | `text` | `apify`, `worker`, or another provenance label |
| `currency` | `char(3)` | ISO currency, default `USD` |
| `metadata` | `jsonb` | Provenance, URL/Actor run, location, raw price, freshness |

Public listings are **never** executable inventory. The backend's `GET /v1/offers` returns `source: "external_reference"` and `executable: false` for public references. Only `source: "worker"` offers with an active provider authorization can clear a deal.

**Current integration gap:** this repository does not expose an Apify write/ingestion endpoint. Apify ingestion is partner-owned. Until a write API is agreed, the partner ingestion job must write normalized observations directly into Tiger Data using the table above, or provide a separate ingestion service. The Relay read APIs are `GET /v1/offers?source=external_reference` and `GET /v1/market/history?gpu_model=H100&window_hours=24`.

## 3. Apify

### Dependency

- The partner owns the Actor, schedule, proxy policy, and permitted-source review.
- Relay does not run the Actor and does not duplicate the collector.
- Each observation must carry provenance in `metadata` (source URL, Actor run ID, observed timestamp, location, raw advertised price) so a public reference cannot be mistaken for executable capacity.

### Normalization contract

```json
{
  "observed_at": "2026-10-24T12:00:00Z",
  "provider_id": null,
  "gpu_model": "H100",
  "rate_minor_per_gpu_hour": 28000,
  "source": "apify",
  "currency": "USD",
  "metadata": {
    "external_ref": "apify:run:123:item:7",
    "listing_url": "https://example.invalid/listing/7",
    "location": "us-east",
    "gpu_count": 8,
    "expires_at": "2026-10-24T18:00:00Z",
    "provenance": "public_advertised_price"
  }
}
```

If an observation is later promoted to a real executable offer, it must be created as a `market_offers` row with `source: "worker"`, `executable: true`, and a valid `authorization_id`. Do not set those fields from public listings.

## 4. CREAO Deal Coordinator

The preserved 14 operations are listed in [contracts/README.md](../contracts/README.md). The agent specification is [CREAO_AGENT_HANDOFF.md](CREAO_AGENT_HANDOFF.md).

### Agent configuration

- `RELAY_API_BASE_URL`: host root, no `/v1`, no trailing slash.
- `RELAY_API_KEY`: server-side agent key, stored as a CREAO secret.
- Contract header and idempotency behavior are mandatory.
- The agent must keep human approvals human-attested, reject stale versions, and report `settlement_authorized: false` from handoff.

### Search response compatibility

`POST /v1/deals/search` returns:

```json
{
  "status": "feasible",
  "proposal": { "deal_id": "...", "terms_version": 1, "parties": [], "required_commitments": [], "compensation": [], "conditional_chain": null, "settlement_authorized": false },
  "recommended": { "strategy": "exchange" },
  "proposals": [],
  "rejected": [],
  "infeasible_options": [],
  "engine": { "name": "relay-deterministic-solver", "version": "1.1.0" },
  "deal": { "deal_id": "...", "terms_version": 1, "deal": { "status": "awaiting_human_approval" } }
}
```

`proposal` is the persisted proposal used by the agent. `recommended`/`proposals`/`rejected` are additive aliases used by the Relay API. A counteroffer that is economically infeasible returns `409 counteroffer_infeasible` with `violations`; a stale version returns `409 terms_version_stale`.

## 5. Elastic investigator

Elasticsearch Serverless is an investigation projection, not a system of record. The partner-owned Elastic project runs the deployed `Relay Financial Investigator` Agent Builder agent; Relay owns the index, sync, API, and evidence validation. Full setup and response examples are in [ELASTIC_INTEGRATION.md](ELASTIC_INTEGRATION.md).

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `POST` | `/v1/creao/investigations/{exception_id}/run` | Run the investigator, optionally with `question` and `follow_up_of` | `exception:investigate` |
| `GET` | `/v1/creao/investigations/{exception_id}/runs` | Investigation history and current exception status | `finance:read` |
| `GET` | `/v1/finance/investigations/{investigation_id}` | Findings, citations, agent steps, warnings | `finance:read` |

```http
POST /v1/creao/investigations/{exception_id}/run
Authorization: Bearer <agent key>
Idempotency-Key: <unique>

{ "question": "Does the invoice match the approved rate and verified usage?" }
```

The response contains `investigation.findings` with `issue_code`, `title`, `summary`, `severity`, `confidence`, `uncertainty`, `recommended_actions`, and evidence citations. Each citation includes `index`, `document_id`, `entity_type`, `entity_id`, `field`, and `value`. Relay re-reads those documents and rejects citations whose entity, field, value, or relationship does not match. A finding with no valid citation is dropped.

Statuses are `running`, `completed`, `completed_with_warnings`, `insufficient_evidence`, and `failed`. A successful run moves an `open` exception to `investigating`; it never resolves, corrects, approves, or pays. A failed or unconfigured investigation returns `503` and leaves the exception open. CREAO must escalate unresolved investigations rather than treating silence as approval.

Configuration variables: `ELASTIC_ENABLED`, `ELASTICSEARCH_URL`, `KIBANA_URL`, `ELASTICSEARCH_API_KEY`, `KIBANA_API_KEY`, `ELASTIC_FINANCIAL_INDEX`, `ELASTIC_INVESTIGATOR_AGENT_ID`, `ELASTIC_KIBANA_SPACE`, and sync/timeout limits. Keys are server-side only.

## 6. Duo 2

Duo 2 owns workers, execution, Solana/x402, transaction signing, and on-chain confirmation. Relay owns the agreements, authorization envelope, usage ledger, payment/payout instructions, and reconciliation. Relay never signs or broadcasts a transaction.

### Buyer payment path

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/internal/v1/duo2/execution-authorizations/{authorization_id}` | Read the authorization envelope | `finance:read` |
| `GET` | `/internal/v1/duo2/contracts/{contract_id}` | Read contract and verified usage | `finance:read` |
| `GET` | `/internal/v1/duo2/contracts/{contract_id}/usage` | Read measured usage | `finance:read` |
| `POST` | `/internal/v1/duo2/usage` | Ingest verified measured usage | `usage:verify` |
| `GET` | `/internal/v1/duo2/payment-instructions` | List instruction state | `finance:read` |
| `POST` | `/internal/v1/duo2/payment-instructions/{instruction_id}/submit` | Mark submitted before broadcast | `payment:execute` |
| `POST` | `/internal/v1/duo2/settlements` | Confirm or fail the buyer settlement | `settlement:confirm` |

Usage request:

```json
{
  "contract_id": "uuid",
  "authorization_id": "uuid",
  "gpu_seconds": 288000,
  "started_at": "2026-10-24T00:00:00Z",
  "ended_at": "2026-10-24T10:00:00Z",
  "job_id": "job-123",
  "worker_id": "worker-1",
  "proof_reference": "duo2:proof:...",
  "evidence": { "measured": true, "source": "duo2_runtime" }
}
```

Settlement request:

```json
{
  "instruction_id": "uuid",
  "status": "confirmed",
  "amount_minor": 18000,
  "transaction_id": "solana-signature",
  "provider_reference": "solana:devnet:<signature>",
  "confirmed_at": "2026-10-24T10:05:00Z",
  "raw": { "cluster": "devnet" }
}
```

`status` may be `confirmed` or `failed`. For a failure, include `failure_code` and `failure_message`. The amount must be positive and cannot exceed the instruction or the outstanding obligation. `provider_reference` must be unique among confirmed payments.

### Provider payout path

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/internal/v1/duo2/provider-payables` | List outstanding provider payables | `finance:read` |
| `GET` | `/internal/v1/duo2/provider-payout-instructions` | List payout instructions | `finance:read` |
| `GET` | `/internal/v1/duo2/provider-payouts` | List confirmed/failed payouts | `finance:read` |
| `POST` | `/internal/v1/duo2/provider-payout-instructions/{payout_instruction_id}/submit` | Mark submitted before broadcast | `payment:execute` |
| `POST` | `/internal/v1/duo2/provider-settlements` | Confirm or fail the provider payout | `settlement:confirm` |

Payout instructions are requested by a `finance` credential and must fit its `spending_limits` row. Above the configured `auto_approve_minor` threshold (seeded as `0`, so human approval is required by default), Relay creates a `financial_approvals` record; only a human credential can decide it, and the requester cannot approve its own request. Duo 2 then submits the approved instruction.

```http
POST /v1/provider-payables/{payable_id}/payout-instruction
Authorization: Bearer <finance key>
Idempotency-Key: <unique>

{ "amount_minor": 9000, "chain": "solana-devnet", "destination": "provider-wallet" }
```

The response is `202` with `status: "approval_required"` and `approval.id`, or `201` with `status: "instruction_created"` when the configured policy auto-approves. The human decision is:

```http
POST /v1/financial-approvals/{approval_id}/decision
Authorization: Bearer <human key>
Idempotency-Key: <unique>

{ "decision": "approved", "note": "Verified against the signed SOW." }
```

The approved result is `{ "type": "provider_payout_instruction", "instruction": { ... } }`. The instruction is still `created`; Duo 2 must submit it before confirming settlement.

Provider settlement request uses the same fields as buyer settlement. A confirmed payout:

- debits accounts payable `2000`,
- credits cash `1000`,
- updates `provider_payables.paid_minor` and status (`partially_paid` or `paid`).

A failed payout creates a `provider_payout_failed` exception and an agent work item; it posts no ledger entry. Retry is blocked until recovery, then `POST /v1/provider-payout-instructions/{id}/retry` creates a replacement instruction using the original human approval.

### State rules

- `created → submitted → confirmed|failed`; `failed → replacement created` only after recovery.
- Submit before settlement. An unsubmitted buyer settlement returns `409 settlement_not_submitted`; an unsubmitted provider payout settlement returns `409 provider_payout_not_submitted`.
- A failed settlement is not retried by reusing the old instruction; the replacement is a new record.
- Relay records the transaction reference; Duo 2 must independently verify the chain transaction and finality.
- `handoff` is not settlement authorization. `settlement_authorized` remains `false` until a separate execution authorization and payment approval exist.

## 7. Frontend

The frontend is teammate-owned. Relay exposes JSON APIs and does not build UI screens.

### Authentication constraint

There is no browser session, cookie, CORS, or end-user login in this backend. API keys are server credentials. The frontend must use a server-side proxy (Next.js route handler, server action, or equivalent) that:

1. holds the human/finance key server-side;
2. forwards only allowlisted reads and human decisions;
3. never exposes `Authorization`, `Idempotency-Key`, or raw keys to browser storage or client bundles.

### Read surfaces

| View | Endpoint |
|---|---|
| Market and workload context | `GET /v1/offers`, `GET /v1/workloads/{id}`, `GET /v1/parties/{id}`, `GET /v1/market/history` |
| Deal explanation and approvals | `GET /v1/deals/{id}`, `GET /v1/approvals?deal_id=...` |
| Execution and usage | `GET /v1/contracts?deal_id=...`, `GET /v1/deals/{id}/execution-authorizations`, `GET /internal/v1/duo2/contracts/{id}` |
| Buyer finance | `GET /v1/invoices`, `GET /v1/invoices/{id}`, `GET /v1/payment-instructions`, `GET /v1/financial-approvals` |
| Provider finance | `GET /v1/provider-payables`, `GET /v1/provider-payout-instructions`, `GET /v1/provider-payouts` |
| Exceptions and investigation | `GET /v1/finance/exceptions`, `GET /v1/finance/exceptions/{id}/evidence`, `GET /v1/creao/work-items`, `GET /v1/creao/investigations/{id}/runs`, `GET /v1/finance/investigations/{id}` |
| Ledger and audit | `GET /v1/ledger/trial-balance`, `GET /v1/ledger/entries`, `GET /v1/audit` |

### Write surfaces that need a human UI

- `POST /v1/approvals` with a human credential and `attested_by`.
- `POST /v1/financial-approvals/{id}/decision` for payment, payout, and correction approvals.
- `POST /v1/payment-instructions/{id}/retry` and `POST /v1/provider-payout-instructions/{id}/retry` only after recovery.

### Required frontend handling

- Display integer minor units as currency without floating-point arithmetic in the ledger path.
- Display `executable: false` public references as market context, not purchasable capacity.
- Display `settlement_authorized: false`, `reservation_status`, and test-settlement labels honestly.
- Show stale approvals after a version bump; never carry an earlier approval forward.
- Treat `409 payment_blocked`, `409 provider_payout_blocked`, and `409 terms_version_stale` as user-visible states, not generic errors.
- Treat `investigating`, `completed_with_warnings`, and `insufficient_evidence` as open/attention states, never as approval. Link citations by `document_id`; do not present model text without its evidence.
- Show provider payout and buyer settlement test labels; Elastic findings cannot be used to bypass a blocked payment.

## 8. Integration order and blockers

1. **Tiger Data:** receive `DATABASE_URL`, apply `0001`–`0005`, verify Timescale hypertable, seed only if this is the demo environment.
2. **Hosting:** deploy to a public HTTPS host; verify `/v1/health` and contract headers through the load balancer.
3. **CREAO:** set `RELAY_API_BASE_URL` and `RELAY_API_KEY`; run the existing 14/14 probe and full workflow.
4. **Apify:** agree the ingestion write path (current gap: no public ingestion endpoint); run one Actor into Tiger Data and verify `GET /v1/offers` labels the records `external_reference`/`executable: false`.
5. **Elastic:** create the Serverless project, configure scoped keys, run `npm run elastic:bootstrap` and `npm run elastic:reindex`, then run one live investigation and one failed investigation. Do not mark the agent deployed until the bootstrap output and validated citations exist.
6. **Duo 2:** confirm worker key, chain/cluster, destination policy, transaction reference format, and provider payout wallet; run one buyer settlement and one provider payout on devnet.
7. **Frontend:** provide server-side proxy contract, human approver accounts, and the read views above; do not ship keys to the browser.

Until each step has a live artifact (probe output, request/audit row, transaction reference, or screenshot with environment visible), it remains an external gate.
