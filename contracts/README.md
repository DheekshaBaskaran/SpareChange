# `relay-duo1.v1` contract

The machine-readable specification is [relay-duo1.v1.openapi.json](relay-duo1.v1.openapi.json). It declares 68 operations under `/v1` and `/internal/v1`, including the preserved 14 operations used by the hosted CREAO Deal Coordinator.

## Wire rules

- Send `X-Relay-Contract: relay-duo1.v1` on every request except `/v1/health`.
- Send `Authorization: Bearer <key>` on every request except `/v1/health`.
- Send a non-empty `Idempotency-Key` on every write. Keys are scoped to the caller and retained for 24 hours.
- Money is always an integer in minor units (`*_minor`); never send a floating-point amount.
- Timestamps are ISO 8601 UTC.
- Errors use `{ code, detail, retryable, violations }`.
- Unknown contract versions return `400 unsupported_contract`. Missing headers return `400 contract_header_required`.
- Identical replay returns the original HTTP status and body with `Idempotency-Replayed: true`.
- `POST /v1/deals/search` returns the persisted deal proposal as `proposal` for the hosted agent, and also returns `recommended`, `proposals`, `rejected`, and `infeasible_options` as additive aliases.
- A counteroffer that would exceed the buyer budget or remove the surplus returns `409 counteroffer_infeasible` with machine-readable `violations`.

## Preserved hosted-agent operations

These 14 operations are the interface used by the existing CREAO Deal Coordinator. They stay path- and method-compatible; new operations are additive.

| Method | Path |
|---|---|
| GET | `/v1/health` |
| GET | `/v1/workloads/{workload_id}` |
| GET | `/v1/parties/{party_id}` |
| GET | `/v1/offers` |
| GET | `/v1/market/history` |
| POST | `/v1/deals/search` |
| GET | `/v1/deals/{deal_id}` |
| POST | `/v1/deals/{deal_id}/counteroffers` |
| POST | `/v1/deals/{deal_id}/negotiation-events` |
| POST | `/v1/approval-requests` |
| GET | `/v1/approvals` |
| POST | `/v1/approvals` |
| POST | `/v1/deals/{deal_id}/handoff` |
| POST | `/v1/deals/{deal_id}/escalations` |

`test/creao-contract.test.ts` asserts the operation IDs and exercises the preserved workflow against embedded Postgres. Live CREAO evidence is still required; a local test is not a live probe.

## Deal and approval behavior

- `POST /v1/deals/search` runs the deterministic solver over persisted executable offers, provider authorizations, active allocations, workloads, and the optional mandate.
- The solver supports direct rentals, one-for-one release-and-replace exchanges, bounded chains, and closed cycles. `max_chain_depth` defaults to 4 and is clamped to 2–6.
- A proposal persists versioned terms and one approval request per obligated party.
- A counteroffer creates a new terms version and supersedes earlier pending requests. Stale approvals are rejected with `409 terms_version_stale`.
- Human approvals require a human credential and matching `attested_by`. Agent and service credentials receive `403 human_attestation_required`.
- `POST /v1/deals/{deal_id}/handoff` re-validates approvals, offer executability, provider authorization, and budgets in one transaction. It returns `reservation_status` and `settlement_authorized: false`; execution authorization is separate.

## Finance and settlement behavior

The following writes are persisted:

- contracts from approved, authorized deals;
- measured usage and billing calculations;
- buyer invoices, invoice lines, payment obligations, and buyer payment instructions;
- provider payables and provider payout instructions;
- human financial approvals and decisions;
- reconciliation runs, matches, exceptions, and corrections;
- provider payout confirmations and failures;
- audit events for every financial state change.

Buyer receivables and provider payables are separate. A confirmed buyer payment credits accounts receivable; a confirmed provider payout debits accounts payable and credits cash. Provider payouts support partial settlement and are reconciled against confirmed payout records and the AP ledger.

`POST /v1/finance/reconciliations` checks contract, invoice, usage, buyer payment, receivable, provider payable, payout, and AP ledger records. Open exceptions block the corresponding buyer payment or provider payout as appropriate.

## Duo 2 boundary

Relay never calls Solana or x402. Duo 2 uses a `worker` key and the `/internal/v1/duo2` operations:

- execution authorization and contract/usage reads;
- verified usage ingestion;
- buyer payment instruction submission and settlement confirmation;
- provider payout instruction submission and settlement confirmation.

Settlements must be submitted before confirmation and must match the instruction amount. Provider references are unique. A failed settlement creates an exception and does not post a ledger entry; recovery creates a replacement instruction.

## Conformance probe

The hosted agent's `contract_probe.py --workload-id <id>` should reach 14/14 read checks once `RELAY_API_BASE_URL` and `RELAY_API_KEY` point at a running instance seeded with the P0 fixture. The full probe exercises the solver and receives persisted proposals.

The demo fixture IDs are exported from `src/db/seed-demo.ts`; the OpenAPI examples intentionally avoid embedding environment-specific URLs or credentials.

## Validation

```bash
npm run typecheck
npm test
```

`test/openapi.test.ts` validates the operation count, unique operation IDs, contract headers, and idempotency-key declarations. `test/creao-contract.test.ts` validates the 14 preserved operations and the live HTTP workflow.

## Versioning

`relay-duo1.v1` is additive-only. New optional fields and new response objects may be added. Removing a field, changing a type, changing an endpoint's meaning, or making optional input required needs `relay-duo1.v2` and a new header value. The hosted agent must be updated before the backend starts rejecting v1.
