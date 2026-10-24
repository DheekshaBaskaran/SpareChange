# Person B — current delivery checklist

**Purpose:** Person B's Relay scope: deterministic clearing, CREAO coordination, Hyphenate finance, financial controls, the Relay-side Duo 2 boundary, and the partner handoff. This checklist separates local implementation evidence from partner-owned services.

**Branch:** `Makayla`
**Contract:** `relay-duo1.v1`
**Status:** local implementation complete and verified; live partner integration remains external.

## Current local evidence

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | **38 passing, 0 failing** |
| OpenAPI | **68 operations**; 14 hosted-agent operations preserved |
| Solver | direct, one-for-one, bounded chains, closed cycles |
| Finance | buyer invoices/AR, provider payables/AP, payouts, balanced ledger, reconciliation |
| Duo 2 | execution authorization, usage, buyer settlement, provider payout, failure recovery |

Primary test evidence:

- `test/finance.test.ts` — full exchange → approval → execution → usage → invoice discrepancy → CREAO investigation → blocked payment → correction → buyer settlement → provider payout → reconciliation.
- `test/recovery.test.ts` — failed buyer settlement, blocked retry, recovery, replacement instruction.
- `test/solver-general.test.ts` — multi-hop chain, uneconomic chain refusal, closed cycle, no fabricated cycle.
- `test/creao-contract.test.ts` — preserved 14 operations and the hosted-agent workflow shape.
- `test/openapi.test.ts` — 68 operations, unique IDs, contract header and idempotency declarations.

## Scope ownership

| Workstream | Owner | Rule |
|---|---|---|
| Clearing solver, proposals, baselines | Person B | Deterministic engine; no LLM pricing or allocations |
| CREAO backend APIs and work queue | Person B | Preserve the existing hosted agent; do not rebuild it |
| Billing, invoices, ledger, payouts, reconciliation | Person B | Persisted records and balanced double-entry postings |
| Controls, approvals, audit, Duo 2 boundary | Person B | Relay authorizes and reconciles; Duo 2 executes |
| Apify Actor and public-listing ingestion | Partner | No collector in this repository |
| Tiger Data provisioning and credentials | Partner | Relay consumes the provided connection |
| Worker execution, Solana/x402 settlement | Duo 2 partner | Relay never signs or broadcasts |
| Frontend UI | Frontend teammate | Server-side proxy only; no browser API keys |
| Public HTTPS hosting | Shared | Must be reachable by CREAO |

## Implemented and locally verified

### P1 — clearing

- [x] Exact search over executable offers, authorizations, active allocations, and workloads.
- [x] Direct rentals, one-for-one release-and-replace, bounded conditional chains, and closed cycles.
- [x] `max_chain_depth` default 4, clamped to 2–6; deterministic tie-breaking.
- [x] GPU/CPU/memory, availability, deadline, budget, switching/restart, transferability, provider authorization, and minimum-surplus checks.
- [x] Structured refusals and baselines; no hidden loss-making proposal.
- [x] Persisted versioned proposals and approval requests.
- [x] Counteroffers create a new version; stale versions return `409 terms_version_stale`; economic refusal returns `409 counteroffer_infeasible`.
- [x] Hosted-agent-compatible `proposal` search field plus additive aliases.

### P2 — CREAO backend

- [x] Work queue for `deal_opportunity`, `financial_exception`, and `approval_followup`.
- [x] Atomic claim/complete and queue summary.
- [x] Participant-issued negotiation mandates with rate/delta bounds and expiry.
- [x] Investigation evidence from persisted contracts, invoices, usage, payments, payables, payouts, approvals, and ledger.
- [x] Findings, correction proposal, human approval, and resolution.
- [x] Preserved 14 hosted-agent operations and contract header/auth/idempotency behavior.

### P3/P4 — finance and controls

- [x] Measured GPU-second billing with deterministic calculation records.
- [x] Buyer invoices, lines, obligations, and receivables.
- [x] Provider payables, partial/full payouts, and AP ledger postings.
- [x] Human-approved payout instructions; separation of duties; spending limits and daily caps.
- [x] Open exceptions block buyer payments or provider payouts as appropriate.
- [x] Failed buyer settlement and failed provider payout create exceptions, block retry, and support controlled recovery.
- [x] Reconciliation checks contract ↔ invoice ↔ usage ↔ buyer payment ↔ receivable and provider payable ↔ payout ↔ AP ledger.
- [x] Trial balance and journal entries; all entries balanced.
- [x] Full audit trail for financial and settlement state changes.

### P5 — local integration

- [x] End-to-end persistent workflow through HTTP routes, not a scripted UI.
- [x] Deliberate overbilling and correction path.
- [x] Test settlements are labelled as test settlements, not revenue.
- [x] Provider payout success and failure/recovery paths.
- [x] OpenAPI contract validation and preserved-agent contract check.

## External gates

A gate is not complete until there is a live artifact.

| Gate | Status | Required artifact |
|---|---|---|
| Partner Tiger Data connection | `[!]` | Partner `DATABASE_URL`; migrations `0001`–`0005`; verified hypertable |
| Public HTTPS host | `[ ]` | Reachable `/v1/health` with `database: "ok"` |
| Hosted CREAO configuration | `[!]` | `RELAY_API_BASE_URL`, secret `RELAY_API_KEY`, 14/14 probe |
| Hosted CREAO full workflow | `[!]` | Agent run with `backend.is_mock=false` and matching audit/request row |
| Real worker execution | `[!]` | Duo 2 worker key + measured usage from a real worker |
| Buyer settlement | `[!]` | Duo 2 devnet transaction reference and confirmed settlement |
| Provider payout | `[!]` | Duo 2 provider payout transaction reference and confirmed payout |
| Apify ingestion | `[!]` | Live Actor run, normalized records in Tiger Data, `external_reference` labelling |
| Frontend server proxy | `[!]` | Server-side key handling; no browser secrets |
| Human approvers/notification | `[!]` | Real approver identities and delivery channel |

### Apify note

This repository has no public Apify ingestion endpoint. The partner ingestion path must write normalized `market_observations` records into Tiger Data (or a separate agreed ingestion service). Public observations must remain `external_reference` and `executable: false`.

## Verification commands

```bash
git branch --show-current
git status --short

npm run typecheck
npm test
npm run build

node -e "const p=require('./contracts/relay-duo1.v1.openapi.json'); const ops=Object.values(p.paths).reduce((n,x)=>n+Object.keys(x).filter(k=>['get','post','put','patch','delete'].includes(k)).length,0); console.log({paths:Object.keys(p.paths).length, operations:ops})"
```

Do not claim a live gate from a local test, a reference server, a mock settlement, or a screenshot alone.

## Truthfulness rules

- Do not call the seed fixture solver output.
- Do not call public listings executable inventory.
- Do not call a reference-server CREAO run live integration.
- Do not call a test settlement revenue.
- Do not call the bounded solver globally optimal.
- Do not call a deal settled before Duo 2 confirmation and reconciliation.
- Do not put `.env` values, API keys, connection strings, or transaction secrets in documents, logs, or chat.

## Status log

| Date | Area | Claim | Status | Evidence |
|---|---|---|---|---|
| 2026-10-24 | P1 | General chains/cycles | `[x]` | `test/solver-general.test.ts` |
| 2026-10-24 | P3/P4 | Provider payouts, AP ledger, failure recovery | `[x]` | `test/finance.test.ts` |
| 2026-10-24 | P2 | Preserved 14-operation CREAO contract | `[x]` | `test/creao-contract.test.ts` |
| 2026-10-24 | P0–P5 | Full local verification | `[x]` | typecheck/build clean; 38 tests passing |
| 2026-10-24 | Live | Tiger Data, host, CREAO, Duo 2, Apify, frontend | `[!]` | External credentials/access not provided |
