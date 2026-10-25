# Combined integration status (Relay + SpareChange)

**Branch:** `integration/duo1-duo2`
**Last verified:** 2026-10-25
**Scope:** Duo 1 (Relay clearing/finance/CREAO/Elastic) and Duo 2 (SpareChange console,
execution, payment rail) in one repository. `integration/duo1` and `origin/duo2`
remain untouched; nothing is merged to `main`.

---

## 1. What is connected

| Stage | Owner | Implementation | Evidence |
|---|---|---|---|
| Market observation (Apify → Tiger Data) | Duo 1 | existing ingestion + binary market bridge | observations persisted; `marketDataMode: duo1-live` |
| Deal search / clearing | Duo 1 | deterministic solver (`/v1/deals/search`) | direct deal $159.20 baseline → $128.00, $21.20 savings |
| Participant approvals | Duo 1 | per-party approval requests + human credentials | 2 approvals (direct), 4 approvals (multi-party) |
| Handoff + contracts | Duo 1 | `/handoff`, `/execution-authorizations` | 1 contract (direct), 2 contracts (multi-party) |
| Execution authorization | Duo 1 | authorization must exist before compute | Duo 2 blocks execution without it |
| Compute execution | Duo 2 | `local-docker` worker, real container | exit 0, ~6.8–8.0 s, 5 verification checks |
| Verified usage | Duo 1 | `/internal/v1/duo2/usage` | 288,000 contracted GPU-seconds + 56 measured |
| Invoice | Duo 1 | `/v1/contracts/{id}/invoices` | $128.00 direct; $143.00 + $180.00 multi-party |
| Reconciliation | Duo 1 | `/v1/finance/reconciliations` | clean on golden path; detects deliberate overbill |
| Payment authorization | Duo 1 | financial approval by a human | finance self-approval rejected (403) |
| Buyer settlement (Base Sepolia) | Duo 2 | x402, real testnet USDC | confirmed on-chain, independently read via RPC |
| Provider payout (Solana Devnet) | Duo 2 | direct native SOL transfer | confirmed on-chain, independently read via RPC |
| Ledger + audit | Duo 1 | double-entry + `audit_events` | balanced; settlement tx named in audit |

The only cross-duo credentials are Relay API keys (`agent` for reads/handoff,
`worker` for usage/payment/payouts) and two independent testnet blockchain
credentials. Duo 2 never approves an amount and never creates an instruction.

---

## 2. Verified runs

### A. Clean transaction (reproducible)
`npm run e2e -- http://127.0.0.1:4000 http://127.0.0.1:3402`

Exact reset/run commands, expected output, tolerance, and evidence fields are in
[DEMO_SCENARIOS.md](DEMO_SCENARIOS.md).

Verified stages: health → search → approvals → Duo 2 handoff/authorization →
real Docker execution → verification → usage → invoice → reconciliation →
human-approved payment instruction → **real Base Sepolia x402** → provider
payable → **real Solana Devnet payout** → final reconciliation → trial balance
→ audit.

Latest confirmed chain evidence (independent RPC reads, not application logs):

| Leg | Network / asset | Amount | Reference |
|---|---|---|---|
| Buyer → provider | Base Sepolia, USDC (`eip155:84532`) | 0.01 USDC | tx `0x01ce7ac645bed3208577aeee2ee759574ef96c65430ef03c26ff398f519cda62` |
| Provider payout | Solana Devnet, native SOL | 0.01 SOL (10,000,000 lamports) | sig `5eMrwJhZmpWjjUDUMjCvSbE64vzRfZ3Kz17sQSmfXXoXkJWhTcHto7FYF2pwh1MFe98aAk1doJ3h9mA37tZnkXVr` |

Independent confirmation on 2026-10-25: Base receipt `status 0x1`, block
`49992857`; Solana slot `514924684`, `meta.err = null`, fee 5,000 lamports,
payer delta −10,005,000, recipient delta +10,000,000, instruction
`system transfer`. Run `e2e-mvnmilwh-ff6b4c`, job `job_26bf50964d`, contract
`ae109b96-164e-4587-ab14-b1c6b876f24f`.

This is the dataset currently left in the demo database.

### B. Financial exception + CREAO workflow (local orchestration)
`npm run e2e:exception -- http://127.0.0.1:4000 http://127.0.0.1:3402`

Verified: real executed contract → deliberate $10 overbill → reconciliation
opens `invoice_overbilled` → payment blocked (409 `payment_blocked`) → CREAO
work item claimed → persisted evidence read → findings recorded → Elastic
investigation returns **503** and the exception stays `investigating` (no
correction, no approval, no payment) → correction proposed → finance
self-approval rejected (403) → human approves → invoice restored to $128.00 →
exception `resolved` → payment now allowed → real x402 settlement → clean
reconciliation → balanced ledger → audit names the settlement.

**Hosted CREAO was not exercised.** This run proves the Relay-side workflow and
the agent-facing APIs; it is not evidence that the hosted agent called Relay.
See §5.

### C. Multi-party clearing (genuine interdependent exchange)
`npm run e2e:multiparty -- http://127.0.0.1:4000 http://127.0.0.1:3402`

The seeded exchange moves Acme off Vertex's 8×H100 window onto Northstar and
reassigns the released Vertex window to Brightlane. It is conditional: the
Vertex commitment names the allocation it releases
(`release_allocation_id`), and the two compensation flows become two separate
contracts.

Verified: 4/4 approvals → handoff → 2 contracts (`Acme→Northstar $128`,
`Brightlane→Vertex $180`) → **two** real Docker executions → two invoices
($143.00 including Acme's $15 switching cost, $180.00) → two real x402
payments (`0x948b1ce9…`, `0x7d83f633…`) → balanced ledger ($949.00) → both
settlements present in the audit trail. Run `mp-mvnmgn7z`.

The exception run (`exc-mvnmebta`) settles after correction with x402 tx
`0x98eff470bb48aa41f5c7a379d86137dd927b853297faae1e9ccef628f88c0e50`.
All three were re-run on the final binaries on 2026-10-25; the clean run is the
dataset currently left in the demo database.

This is not "one rental with four approvals": each leg has its own buyer,
provider, contract, usage, invoice and payment.

---

## 3. Settlement semantics (read this before the demo)

- **Invoice value ≠ on-chain amount.** Invoices are accounting values ($128,
  $143, $180). On-chain transfers are demonstration-scale: 0.01 USDC on Base
  Sepolia and 0.01 SOL on Solana Devnet. The database and API record both; the
  audit records the invoice amount plus the transaction id; payment `raw`
  metadata records network, asset, on-chain amount and `demo_scale: true`.
- **The invoice is not "fully settled" in real value.** It is demo-completed
  and testnet-settled. Do not describe the $128 invoice as $128 of real funds.
- **Two networks, two assets.** Base Sepolia USDC pays the buyer leg; Solana
  Devnet SOL pays the provider leg. There is no bridge and no shared balance.
  The payout is not the buyer's USDC arriving on Solana.
- **Simulated vs real.** `rail: "mock"` / `mock_tx_…` means no funds moved.
  `rail: "x402"` and `rail: "solana"` are real testnet transactions with ids
  verified through independent RPC. The Solana payer must be funded; an
  unfunded payer returns `503 payer_unfunded` and never records a payout.
- **Provider payout** is genuinely on-chain on Solana Devnet when
  `SOLANA_PAYER_SECRET_KEY` + `SOLANA_PAYOUT_ADDRESS` are configured and the
  payer is funded. Otherwise the clean E2E falls back to a clearly labelled
  simulated payout (`payout_simulated: true`), never a false success.

### Usage accounting
`gpu_seconds` is the **contracted capacity window** (GPU count × reserved
hours): 8 × 10 h = 288,000 GPU-seconds. It is **not** measured hardware time.
The worker's actual runtime (~6.8–8.0 s) is recorded separately as
`measured_gpu_seconds` (≈56) in the usage evidence, the billing breakdown, the
usage API and the audit event. Invoice lines say "Contracted … capacity
window … not measured hardware time".

---

## 4. API surface to preserve for the frontend rebuild

The current Duo 2 UI is temporary. These are the endpoints the redesigned
client should use; all are server-side and keep credentials out of the browser.

### Relay (Duo 1), `x-relay-contract: relay-duo1.v1`
- `GET /v1/offers` — normalized offers, freshness.
- `GET /v1/workloads/{id}`, `GET /v1/parties/{id}` — buyer requirements and
  counterparties.
- `POST /v1/deals/search` — deterministic proposal (`proposal`, `rejected`,
  `infeasible_options`, `engine`).
- `GET /v1/deals`, `GET /v1/deals/{id}` — deal + proposal + approvals.
- `POST /v1/deals/{id}/handoff`, `POST/GET …/execution-authorizations` — contracts.
- `GET /v1/contracts`, `GET /v1/contracts/{id}` — terms + usage.
- `GET /v1/invoices`, `GET /v1/invoices/{id}` — totals, lines, status.
- `GET /v1/payment-instructions`, `GET /v1/financial-approvals`.
- `GET /v1/provider-payables`, `GET /v1/provider-payout-instructions`.
- `GET /v1/ledger/trial-balance`, `GET /v1/ledger/entries`.
- `GET /v1/finance/exceptions`, `GET …/{id}`, `GET …/{id}/evidence`.
- `GET /v1/creao/work-items`, `GET /v1/creao/investigations/{exceptionId}`,
  `GET /v1/creao/investigations/{exceptionId}/runs`.
- `GET /v1/audit`.

### Duo 2, browser-safe
- `GET /api/market` — live listings (`marketDataMode: duo1-live`).
- `GET /api/deals` — executable single-leg deals (multi-party exchanges are
  intentionally not flattened into one leg).
- `POST /api/deals/execute` — start a job; body documented in
  `duo2/docs/API_CONTRACT.md`; optional `relay.contractId` selects a leg.
- `GET /api/jobs`, `GET /api/jobs/{id}` — timeline, verification, payment,
  relay usage link.
- `POST /api/jobs/{id}/retry`.
- `GET /api/health` — liveness only; never calls Solana or x402.
- `GET /api/system` — executor availability, payment mode, Relay link, x402
  and Solana payout status (no secrets).
- `POST /api/relay/pay`, `POST /api/relay/pay-out` — internal/rail endpoints;
  keep them server-side or behind `DUO2_INTERNAL_TOKEN`.

The complete redesign-facing contract, including the browser trust boundary and
display invariants, is in [FRONTEND_API_CONTRACT.md](FRONTEND_API_CONTRACT.md).

Every financial mutation on Relay requires an idempotency key; keep that
contract in the redesign. Approval decisions must be made with human
credentials, never an agent key.

---

## 5. Hosted CREAO: what is missing

The Relay side is ready: 14 preserved operations, work queue, evidence packet,
findings, correction/escalation, audit, and a 14-operation contract test.
What has never happened is a **hosted CREAO run against a public Relay**.
Required, and not available in this workspace:

1. Public HTTPS host reachable from CREAO egress (no request password page).
2. `RELAY_API_BASE_URL` set to the host root (no `/v1`) in CREAO.
3. `RELAY_API_KEY` stored as a CREAO secret (agent role).
4. The existing agent's 14/14 `contract_probe.py` output.
5. A CREAO run id with `backend.is_mock=false`, plus matching Relay
   `audit_events` (time, endpoint, principal) and work-item id.
6. The full exception run from the hosted agent: claim → evidence → findings →
   correction request → human approval → settlement evidence.

`RELAY_API_BASE_URL` currently points at a localtunnel address that returns
`503 Tunnel Unavailable`. Any hosted proof needs the Vultr HTTPS host first. Do
not mark this integration verified from `e2e:exception`; that is local
orchestration. The exact CREAO-side configuration, probe commands, evidence
requirements, and failure meanings are in
[HOSTED_CREAO_RUNBOOK.md](HOSTED_CREAO_RUNBOOK.md).

---

## 6. Deployment readiness (Vultr)

Validated locally:

- `docker build -f Dockerfile.duo1 -t relay-duo1:integration .` ✅
- `docker build -t relay-duo2:integration duo2/` ✅
- Containers started on a private Docker network: Duo 1 healthy, Duo 2 healthy,
  `relayConfigured: true`, `x402` mode, funded Solana payout status, and a real
  cross-container deal read (`duo1-live`). ✅
- Healthchecks hit `/v1/health` (contract-header exempt) and `/api/health`
  (liveness only, no Solana/x402 dependency). The richer `/api/system` stays
  available for the UI. ✅
- Compose now passes an explicit environment allowlist per service instead of a
  shared `env_file`: Duo 2 never receives `DATABASE_URL`, human credentials, or
  market/Apify keys; the market API never receives Relay or wallet keys. ✅
- Duo 2 image smoke test: `/api/health` returned 200, a real `local-process`
  job completed with exit 0 and `VERIFIED`, and the job survived a container
  restart on the `duo2_data` volume. ✅
- `docker compose build` builds `api`, `duo1`, and `duo2` successfully. ✅
- Full Compose stack (without Caddy) started against live Tiger Data with the
  per-service allowlists: all three containers healthy; market `/readyz`
  reported `tiger_data: ok`; Duo 2 reported `relayConfigured: true`,
  `paymentMode: "x402"`, and a funded Solana payer; `/api/deals` returned 1
  deal and `/api/market` returned 4 listings with `duo1-live`. ✅
- `caddy validate` accepts the three-site Caddyfile with placeholder domains. ✅

Not validated: full Compose stack behind Caddy (needs real domains/TLS),
Tiger Data network policy for the Vultr host, and CREAO egress. The step-by-step
deployment gate is in
[deploy/vultr/README.md](../deploy/vultr/README.md); the reproducible runbook is
in [DEMO_SCENARIOS.md](DEMO_SCENARIOS.md).

Compose secrets come from `.env` / Vultr environment, never images. Keys
required: `DATABASE_URL`, `MIGRATION_DATABASE_URL` (DDL only; never passed to a
running container), `RELAY_API_KEY`, `DUO1_FINANCE_API_KEY`,
`DUO2_WORKER_API_KEY`, `DUO2_INTERNAL_TOKEN`, the four human keys, `X402_*`,
`SOLANA_*`, `DUO1_DOMAIN`, `DUO2_DOMAIN`, `MARKET_DOMAIN`. Apply migrations with
`node dist/db/migrate.js` (owner URL) before starting the new image; `0008`
widens the usage-basis constraint. Duo 2 state (`jobs.json`, `payouts.json`)
lives on the `duo2_data` volume and must be backed up.

---

## 7. Known limitations

- Hosted CREAO proof: blocked on public host + CREAO credentials.
- Elastic Agent Builder: deprecated for this hackathon and quota-blocked.
  Investigation returns 503, leaves exceptions open, and can never approve,
  correct, or pay. This is intentional and tested.
- Solana is a direct native-SOL adapter, not x402. The official x402 SDK does
  support Solana (`@x402/svm`, `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`,
  devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), but the
  working buyer rail remains Base Sepolia x402; the Solana leg is the payout.
- The live feed intentionally omits multi-party deals from single-leg
  execution; they run through the coordinated scenario with explicit contract
  selection.
- Execution ran with `local-docker` locally; the Vultr compose sets
  `EXECUTION_MODE=local-process` because Docker-in-Docker is not available in
  the container.
- The demo reset script truncates transactional tables on the Tiger Cloud
  database. It is destructive by design and requires `--confirm`.
