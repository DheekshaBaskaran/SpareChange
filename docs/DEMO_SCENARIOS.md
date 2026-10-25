# Reproducible transaction scenarios

These are the three scenarios that were verified on 2026-10-25 on
`integration/duo1-duo2`. They run against the real Relay API, a real Duo 2
server, a real Docker/local worker, Tiger Data, and the testnet payment rails.
They are not mock-only tests.

| # | Script | What it proves |
| --- | --- | --- |
| A | `npm run e2e` | A clean direct deal: search → approvals → contract → execution → usage → invoice → human-approved x402 payment → Solana provider payout → balanced ledger |
| B | `npm run e2e:exception` | A deliberate overbill is blocked and corrected through the CREAO work queue, findings, and a human approval; settlement happens only after resolution |
| C | `npm run e2e:multiparty` | A genuinely interdependent four-party exchange becomes two contracts, two executions, two invoices, and two x402 payments |

**Reset between every scenario.** Each run reserves capacity and completes a
deal; a second run against the same state correctly reports no feasible deal.
Reset is destructive by design and re-seeds the demo fixtures.

---

## 1. Prerequisites

The scripts read the root `.env`:

```dotenv
RELAY_API_KEY=              # agent role
DUO1_FINANCE_API_KEY=       # finance role
DUO2_WORKER_API_KEY=        # worker role (settlement)
RELAY_HUMAN_API_KEY=        # Acme human
HUMAN_VERTEX_API_KEY=       # Vertex human
HUMAN_NORTHSTAR_API_KEY=    # Northstar human
HUMAN_BRIGHTLANE_API_KEY=   # Brightlane human
DUO2_INTERNAL_TOKEN=        # optional, but required if the deployed Duo 2 sets it
```

For a real payment run, also set:

```dotenv
PAYMENT_MODE=x402
X402_BUYER_PRIVATE_KEY=...
X402_PROVIDER_PRIVATE_KEY=...
X402_PROVIDER_WALLET_ADDRESS=...
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_NETWORK=solana-devnet
SOLANA_PAYER_SECRET_KEY=[...]
SOLANA_PAYOUT_ADDRESS=...
SOLANA_PAYOUT_LAMPORTS=10000000
```

The Solana payer must hold at least `SOLANA_PAYOUT_LAMPORTS + 10,000` lamports
for every payout. If it is unfunded, the clean script records an explicitly
labelled simulated payout instead of failing; the exception and multi-party
scripts require real x402 and do not silently fall back.

The four human keys must be bound to the seeded human users:
`ffffffff-ffff-4fff-8fff-fffffffff001` … `f004` for Acme, Vertex, Northstar,
and Brightlane. `deploy/vultr/README.md` has the exact `create-api-key`
commands.

## 2. Local run

Start both services first (see the root README). Then:

```bash
set -a; source .env; set +a

# A. clean transaction
npm run db:reset-demo -- --confirm
npm run e2e -- http://127.0.0.1:4000 http://127.0.0.1:3402

# B. financial exception
npm run db:reset-demo -- --confirm
npm run e2e:exception -- http://127.0.0.1:4000 http://127.0.0.1:3402

# C. four-party exchange
npm run db:reset-demo -- --confirm
npm run e2e:multiparty -- http://127.0.0.1:4000 http://127.0.0.1:3402
```

`db:reset-demo` needs `MIGRATION_DATABASE_URL` (or a DDL-capable
`DATABASE_URL`) because it runs pending migrations before truncating. The
running server itself uses the DML-only URL.

## 3. Deployed run

Use the public hostnames and the same scripts. The only difference is the reset
command, which runs inside the Relay container:

```bash
set -a; source .env; set +a
export DUO1_BASE_URL="https://${DUO1_DOMAIN}"
export DUO2_BASE_URL="https://${DUO2_DOMAIN}"

reset_demo() {
  docker compose --env-file ../../.env run --rm \
    -e MIGRATION_DATABASE_URL \
    duo1 node dist/cli/reset-demo.js --confirm
}

(cd deploy/vultr && reset_demo)
npm run e2e -- "$DUO1_BASE_URL" "$DUO2_BASE_URL"

(cd deploy/vultr && reset_demo)
npm run e2e:exception -- "$DUO1_BASE_URL" "$DUO2_BASE_URL"

(cd deploy/vultr && reset_demo)
npm run e2e:multiparty -- "$DUO1_BASE_URL" "$DUO2_BASE_URL"
```

Run from the repository root so `npm run` and the root `.env` are consistent.
If `DUO2_INTERNAL_TOKEN` is set, the scripts send it automatically. Do not expose
the token, finance key, or human keys to a browser.

## 4. Evidence to capture

Every script ends with a machine-readable `SUMMARY { … }` block followed by a
non-zero exit code on failure. Keep the full log and the summary; both are
evidence, and neither contains a private key.

For each run record:

1. **Run and job ids** from `SUMMARY` (`run`, `job_id`, `contract_id`,
   `invoice_id`).
2. **Buyer settlement** — `settlement_transaction`, `settlement_network`,
   `settlement_onchain_amount`. Confirm it on Base Sepolia, not from the app log.
3. **Provider payout** — `payout_signature`, `payout_lamports`,
   `payout_simulated`. Confirm it through Solana RPC/explorer; `payout_simulated:
   true` is not a real payout.
4. **Accounting** — `balanced: true` and the amounts in `SUMMARY`.
5. **Audit** — `GET /v1/audit?limit=400` with the agent key contains
   `payment.settled` and the transaction id. The scripts assert this.
6. **Exception run only** — `exception_id`, `work_item_id`,
   `investigation_status` (`503` is the expected degraded Elastic result), and
   `hosted_creao: "not_verified"`. Do not present this as a hosted CREAO run.

Last verified references (2026-10-25):

| Scenario | Evidence |
| --- | --- |
| Clean | run `e2e-mvnmilwh-ff6b4c`, job `job_26bf50964d`, Base Sepolia tx `0x01ce7ac645bed3208577aeee2ee759574ef96c65430ef03c26ff398f519cda62` (block 49992857), Solana sig `5eMrwJhZmpWjjUDUMjCvSbE64vzRfZ3Kz17sQSmfXXoXkJWhTcHto7FYF2pwh1MFe98aAk1doJ3h9mA37tZnkXVr` (slot 514924684) |
| Exception | run `exc-mvnmebta`, Base Sepolia tx `0x98eff470bb48aa41f5c7a379d86137dd927b853297faae1e9ccef628f88c0e50` |
| Multi-party | run `mp-mvnmgn7z`, two x402 payments (`0x948b1ce9108f06e51ba3d587835b800d38cf4f7b885990f1ed4072bf0fedcf33`, `0x7d83f63375442f6d219c6cfb123fc909078654b3acc5200899fb7f822e225d97`), ledger $949.00 |

These are historical references. Re-run and capture fresh ids before a live
demo; never cite these as a new run.

## 5. Expected shape and tolerances

- **Clean:** one deal, $159.20 baseline → $128.00 cost, $21.20 net saving after
  the $10 coordination fee; one contract; one invoice; one x402 payment; one
  Solana payout; balanced ledger.
- **Exception:** a $10.00 (1,000 minor) unsupported surcharge; reconciliation
  opens `invoice_overbilled`; payment returns `409 payment_blocked`; the CREAO
  work item is claimed; evidence is read from persisted records; findings move
  the exception to `investigating`; the Elastic investigation returns `503` and
  changes nothing; finance self-approval returns `403`; a human approval restores
  $128.00 and resolves the exception; payment then succeeds.
- **Multi-party:** four approvals, two contracts (`Acme→Northstar $128`,
  `Brightlane→Vertex $180`), two real executions, two invoices ($143.00 and
  $180.00), two x402 payments, balanced ledger $949.00.

GPU runtime, block times, slots, and transaction hashes vary. Contract,
invoice, and ledger amounts should match exactly; a mismatch is a failure, not
noise.

## 6. Common failures

| Symptom | Cause | Action |
| --- | --- | --- |
| `no feasible deal` | previous run reserved capacity | reset, then rerun |
| `401 Unauthorized` from `/api/relay/pay` or `/api/relay/pay-out` | the running Duo 2 process was started with a different `DUO2_INTERNAL_TOKEN` (or none) than the `.env` used by the script | restart Duo 2 after any token change; confirm `/api/system` and the script read the same `.env` |
| `duo2 system` says Relay is not configured | Duo 2 was started without `DUO1_API_URL` / `DUO1_AGENT_API_KEY` | use `duo2/.env.local` or export the three Relay aliases before `npm start` |
| `duo2 accepted the deal` returns 409/403 | Relay has no execution authorization, or the contract selector is missing/wrong for a leg | check `relay.contractId`; do not bypass authorization |
| `payment blocked` on the clean run | an open financial exception from an earlier run | reset the transactional state |
| `x402 settlement failed` | buyer wallet unfunded, facilitator unavailable, or invalid key | check `/api/system`, fund the Base Sepolia buyer wallet |
| `payer_unfunded` | Solana payer has less than the payout + fee buffer | fund the Devnet payer; do not lower the amount to fake success |
| `solana payout rail is not configured` | payer secret or allowlisted address missing/invalid | fix `.env`; `/api/system` reports the exact reason |
| `elastic investigation degrades safely` is a PASS | Elastic is deprecated/disabled | expected; the exception must remain open |
| `job failed at …` | worker failure/restart | read `job.failure`; retry only after the cause is fixed |

## 7. What these runs do not prove

- Hosted CREAO is **not** exercised. The exception script deliberately says
  `hosted_creao: "not_verified"` and only proves the Relay-side APIs.
- The invoice amount is accounting value. The on-chain amounts are demo-scale:
  0.01 USDC on Base Sepolia and 0.01 SOL on Solana Devnet.
- The Solana leg is a direct native-SOL payout, not the buyer's USDC arriving on
  Solana. There is no bridge and no shared balance.
- Contracted GPU-seconds are `8 × 10 h = 288,000`; the worker's measured runtime
  is recorded separately (`measured_gpu_seconds`) and is not billing basis.
