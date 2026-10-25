# Frontend API contract (stable surface for the redesign)

The current SpareChange console is temporary. This document is the boundary the
redesigned client should build against. It is not a UI specification and it does
not authorize changing backend paths, response shapes, or financial rules.

Canonical specifications:

- Relay: [`contracts/relay-duo1.v1.openapi.json`](../contracts/relay-duo1.v1.openapi.json)
  (73 operations; the hosted CREAO agent's 14 are preserved).
- Duo 2: [`duo2/docs/API_CONTRACT.md`](../duo2/docs/API_CONTRACT.md) and
  [`duo2/src/lib/types.ts`](../duo2/src/lib/types.ts).
- Verified behavior and caveats: [`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md).

---

## 1. Trust boundary (read this first)

Relay credentials are server-side only. The browser must **never** receive
`RELAY_API_KEY`, `DUO1_FINANCE_API_KEY`, `DUO2_WORKER_API_KEY`, a human API key,
an x402 private key, or the Solana payer secret.

Today the console is same-origin with Duo 2 and calls only Duo 2 routes. Relay
calls happen inside Duo 2's server code. The redesign needs one of:

1. **Recommended:** a Duo 2 BFF that maps the signed-in user's session to a
   participant-scoped human credential on the server, then calls Relay.
2. A Relay-side session service with the same property.

Do not put Relay keys in `NEXT_PUBLIC_*` variables, browser storage, or client
bundles. A user-facing login/session model does not exist yet; adding it is part
of the redesign, not a backend API change.

Human approval endpoints must be called with a credential bound to that human
user and party. Agent and finance credentials are rejected for participant
approvals (`403 human_attestation_required`). Finance cannot approve its own
request (`403 separation_of_duties_violation`).

## 2. Browser-safe Duo 2 endpoints

All are same-origin on the console (`https://app.<domain>`).

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Liveness | No external calls; use for probes, not UI |
| `GET` | `/api/system` | Executor, payment, Relay, x402, Solana status | No secrets; includes payer **public** key and funding state |
| `GET` | `/api/market` | GPU listings | `marketDataMode` distinguishes `duo1-live` from demo |
| `GET` | `/api/deals` | Executable single-leg deals | Multi-party exchanges are intentionally omitted |
| `GET` | `/api/deals/{id}` | One deal | |
| `POST` | `/api/deals/execute` | Start a job | Body in `duo2/docs/API_CONTRACT.md`; optional `relay.contractId` selects a leg |
| `GET` | `/api/jobs` | Recent jobs | Summaries |
| `GET` | `/api/jobs/{id}` | Job detail | Poll until `COMPLETE`/`FAILED` |
| `POST` | `/api/jobs/{id}/retry` | New job for the same deal | |

Server-only (never expose to the browser):

| Method | Path | Why |
| --- | --- | --- |
| `POST` | `/api/relay/pay` | Moves testnet funds; guarded by `DUO2_INTERNAL_TOKEN` when set |
| `POST` | `/api/relay/pay-out` | Signs a Solana transfer; guarded the same way |
| `GET` | `/api/provider/settle`, `/api/provider/backfill` | x402-protected provider endpoints |

`/api/relay/pay` and `/api/relay/pay-out` are idempotent: repeating a request
returns the original transaction/signature (`already_settled: true`) and never
broadens a second transfer.

## 3. Relay read surface (via the BFF)

Every Relay request needs `x-relay-contract: relay-duo1.v1` and a bearer
credential. `/v1/health` is the only unauthenticated, header-exempt route.

### Market and workloads

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/v1/offers` | Normalized offers and freshness |
| `GET` | `/v1/market/history` | Price history (`gpu_model`, `window_hours`) |
| `GET` | `/v1/workloads/{id}` | One buyer workload |
| `GET` | `/v1/parties/{id}` | One party |
| `GET` | `/v1/market/bridge` | Last bridge run, mirrored counts, error |

There is no `GET /v1/workloads` collection and no `/v1/market/offers` alias in
the shipped API. Use `/v1/offers`; the market API has the full listing surface.

### Deals, approvals, execution

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/deals/search` | Deterministic proposal (`proposal`, `rejected`, `engine`) |
| `GET` | `/v1/deals` | Deal list (`status`, `limit`) |
| `GET` | `/v1/deals/{id}` | Deal + proposal + approval requests + integrity |
| `POST` | `/v1/deals/{id}/counteroffers` | Human provider counteroffer |
| `POST` | `/v1/deals/{id}/negotiation-events` | Terms/negotiation audit events |
| `POST` | `/v1/approval-requests` | Create a request for the current version |
| `GET` | `/v1/approvals` | Requests for a deal |
| `POST` | `/v1/approvals` | Human decision (`request_id`, `decision`, `attested_by`) |
| `POST` | `/v1/deals/{id}/handoff` | Provisional handoff; never authorizes settlement |
| `POST` | `/v1/deals/{id}/execution-authorizations` | Explicit contract creation |
| `GET` | `/v1/deals/{id}/execution-authorizations` | Authorization state |
| `GET` | `/v1/execution-authorizations/{id}` | One authorization |
| `POST` | `/v1/deals/{id}/escalations` | Escalate a blocked deal |

### Finance and settlement evidence

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/contracts`, `/v1/contracts/{id}` | Terms, usage, assignments |
| `POST` | `/v1/contracts/{id}/invoices` | Issue invoice (finance) |
| `GET` | `/v1/invoices`, `/v1/invoices/{id}` | Totals, lines, status |
| `POST` | `/v1/invoices/{id}/lines` | Add a line (finance) |
| `POST` | `/v1/finance/reconciliations` | Run reconciliation |
| `GET` | `/v1/finance/reconciliations/{id}` | Reconciliation result |
| `GET` | `/v1/finance/exceptions` | Open/resolved exceptions |
| `GET` | `/v1/finance/exceptions/{id}` | One exception |
| `GET` | `/v1/finance/exceptions/{id}/evidence` | Persisted evidence packet |
| `POST` | `/v1/finance/exceptions/{id}/propose-correction` | Correction proposal (finance) |
| `POST` | `/v1/financial-approvals/{id}/decision` | Human approval/rejection |
| `POST` | `/v1/invoices/{id}/payment-instruction` | Request buyer payment |
| `GET` | `/v1/payment-instructions` | Buyer instructions |
| `POST` | `/v1/payment-instructions/{id}/submit`, `…/retry` | Settlement lifecycle |
| `GET` | `/v1/provider-payables`, `/v1/provider-payables/{id}` | Provider amounts due |
| `POST` | `/v1/provider-payables/{id}/payout-instruction` | Request Solana payout |
| `GET` | `/v1/provider-payout-instructions` | Payout instructions |
| `POST` | `/v1/provider-payout-instructions/{id}/retry` | Recovery only |
| `GET` | `/v1/provider-payouts` | Confirmed/failed payouts |
| `GET` | `/v1/ledger/trial-balance`, `/v1/ledger/entries` | Accounting |

### CREAO activity

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/creao/work-items` | Queue (`status`, `kind`) |
| `GET` | `/v1/creao/work-items/{id}` | One work item |
| `POST` | `/v1/creao/work-items/{id}/claim` | Atomic claim |
| `POST` | `/v1/creao/work-items/{id}/complete` | Complete with outcome |
| `GET` | `/v1/creao/queue-summary` | Counts by status/kind |
| `GET` | `/v1/creao/investigations/{exceptionId}` | Evidence packet |
| `POST` | `/v1/creao/investigations/{exceptionId}/findings` | Record findings |
| `POST` | `/v1/creao/investigations/{exceptionId}/run` | Elastic investigator (may return 503) |
| `GET` | `/v1/creao/investigations/{exceptionId}/runs` | Investigation history |
| `GET` | `/v1/finance/investigations/{id}` | Persisted investigation |

### Audit

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/audit` | Audit events (`limit`), including `payment.settled` |

## 4. Data and display invariants

Do not change these in the redesign:

- **Money** is integer **minor units** everywhere (`*_minor`). Convert only for
  display. Never sum floats.
- **Timestamps** are ISO 8601 UTC strings.
- **Job status** is one of `APPROVED`, `PROVISIONING`, `RUNNING`, `VERIFYING`,
  `PAYMENT_PENDING`, `COMPLETE`, `FAILED`. `job.failure = {step, message}`
  explains a failure; there is no implicit success.
- **Rails** are explicit: `rail: "mock"` / `mock_tx_…` means no funds moved;
  `rail: "x402"` and `rail: "solana"` are real testnet transactions.
- **Demo scale:** `settledOnChainAmount` / `solana` amount is not the invoice
  value. The invoice amount is accounting value. Show both rather than implying
  the invoice total moved on-chain.
- **Usage basis:** `billing_basis: "contracted_capacity_window"` means GPU
  seconds are contracted capacity (GPU count × reserved hours), not measured
  hardware time. Show `measured_gpu_seconds` separately when present.
- **Settlement authorization:** handoff always returns
  `settlement_authorized: false`. Execution authorization is a separate explicit
  step. Never infer payment permission from a completed handoff.
- **Approvals** are version-scoped. A terms-version bump invalidates earlier
  approvals; a stale decision returns `409 terms_version_stale`.
- **Idempotency:** every financial write needs `Idempotency-Key`. A replay
  returns the original response with `Idempotency-Replayed: true`; the same key
  with a different body returns `409 idempotency_conflict`.

Relay errors use `{code, detail, retryable, violations}`. Duo 2 errors use
`{success: false, error}` with an HTTP status. Treat `409` as a business-state
conflict (not retryable), `403` as an authority problem, and `503` on the
investigation endpoint as the documented degraded Elastic mode.

## 5. Suggested UI data flow

1. **Market** → Duo 2 `/api/market`; drill-down to `/v1/offers` and
   `/v1/market/history` through the BFF.
2. **Deal** → `/api/deals`; detail from Relay `/v1/deals/{id}` so approval
   requests, versions, and integrity are visible.
3. **Approvals** → Relay `/v1/approvals` with the signed-in human's credential;
   display obligations, amounts, and the current version. Never auto-approve.
4. **Execution** → `POST /api/deals/execute`, then poll
   `/api/jobs/{id}`. Show `executionMode`, `verification.checks`, and payment
   rail truth from the job, not a static label.
5. **Finance** → invoices, reconciliation, exceptions, and ledger through the
   BFF. A blocked payment (`409 payment_blocked`) should link to the open
   exception, not offer a retry.
6. **CREAO activity** → work items, evidence, findings, and investigation
   history. Render `503` from `/run` as "investigation unavailable; exception
   remains open", never as a resolved exception.
7. **Settlement evidence** → invoice, x402 transaction, Solana signature,
   explorer URLs, and audit events on one timeline. Distinguish Base Sepolia from
   Solana Devnet and label testnet/demo scale.

## 6. What the redesign must not do

- Do not call Relay directly from a browser bundle with a privileged key.
- Do not add a "pay" or "approve" button that uses an agent/finance credential.
- Do not flatten a multi-party exchange into one job. It has multiple contracts
  and must select an explicit `relay.contractId` per leg.
- Do not relabel contracted capacity as measured GPU time, or an invoice total as
  an on-chain amount.
- Do not treat a `503` investigation, a mock settlement, or a handoff as
  approval or payment.
