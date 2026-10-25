# Submission status — verified locally, hosted coordinator still open

**Date:** 2026-10-25
**Branch:** `backend-verified`
**Scope:** Relay + Duo 2 backend, CREAO contract probe, and the hosted coordinator.

## What is verified

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | **51/51 pass** |
| `npm run build` | pass |
| Local full transaction (`npm run e2e`) | **pass** |
| Local workflow smoke (`npm run smoke`) | **pass** |
| Hosted reconstructed contract probe | **14/14**, attached ZIP copy |
| Remote CREAO app execution | **fails: all runs return empty output** |

### Local full transaction

Run `e2e-mvnycxvq-c417c8` against `http://127.0.0.1:4000` and
`http://127.0.0.1:3402`:

- deal `6a1e92db-e903-4ad2-9355-cd77373fe017`
- Duo 2 job `job_20b6dbf777`, executor `local-docker`, runtime 7,277 ms
- contract `51659f16-ed9a-4b30-a35e-3393a278c620`
- invoice `cd03012b-ed67-471e-bf27-ac3ca5120b52`, $128.00
- Base Sepolia x402 settlement
  `0x529f2d1a8588e5e2e6ece7cde4b57b8ecc06b0e4eb048b1afe19f89c9a0fa62f`
- Solana Devnet payout
  `3LaDnmgfaKvyRSXiigQcmms5Eztfwvhpmmd16qt9y1yBrkngZdCDmSf6FbNPPQm7zLBGZnf6wskWie1yrurAeSca`
  (slot 515007992, 10,000,000 lamports)
- final ledger balanced: debit $492.00 = credit $492.00
- audit trail: 400 events, settlement transaction named

The local smoke run `smoke-mvny8twt-046c1df2` also passed the exception path,
including `invoice_overbilled`, `409 payment_blocked`, the expected Elastic 503,
human correction approval, and a balanced $532.00 ledger.

Raw logs: [`e2e-local-2026-10-25.txt`](evidence/e2e-local-2026-10-25.txt) and
[`verify-local-2026-10-25.txt`](evidence/verify-local-2026-10-25.txt).

### Hosted CREAO

The reconstructed probe produced the saved 14/14 result at
[`docs/evidence/contract-probe-v2-creao-2026-10-25.json`](evidence/contract-probe-v2-creao-2026-10-25.json).
That run executed an attached ZIP copy because the app-files manifest did not
list `contract_probe_v2.py`.

**Remote app check:** `GET
https://agent.creao.ai/api/v1/apps/93f296bc-583e-4245-8eb2-cd2ad9974832/runs`
returns `200`, but all seven recorded runs are `completed` with
`result.text: ""`. The app-scoped trigger is reachable; the coordinator runtime
is still not producing output. The app list endpoint returns `403` with the
app-scoped key, so a new agent cannot be created or inspected from this
workspace. The raw run listing is saved at
[`creao-app-runs-2026-10-25.json`](evidence/creao-app-runs-2026-10-25.json).

Do **not** claim that the hosted Relay Deal Coordinator completed a workflow.
The hosted evidence proves the contract probe reached Relay; it does not prove
the coordinator executed.

## Submission recommendation

Use the **local full transaction** as the live demo: it exercises search,
human approvals, handoff, real Docker execution, verified usage, invoice,
reconciliation, human-approved x402 settlement, Solana payout, balanced ledger,
and audit. Show the **hosted 14/14 probe** as the contract/connectivity proof.
Be explicit that the hosted coordinator's own run is still empty.

## Reproduce

```bash
npm run typecheck
npm test
npm run build

npm run db:reset-demo -- --confirm
npm run e2e -- http://127.0.0.1:4000 http://127.0.0.1:3402
```

The demo reset is destructive to demo transactions only and preserves parties,
API keys, ledger accounts, and market offers.
