# SpareChange Handoff

One page to understand what SpareChange does today, how it works, how to run it, what is real and what is demo data, and how to plug into it.

**Quick links:** [API contract](API_CONTRACT.md) · [Demo script](DEMO_SCRIPT.md) · [README](../README.md) · [Project guide (CLAUDE.md)](../CLAUDE.md)

---

## 1. What SpareChange currently does

SpareChange **receives an approved GPU deal, creates a job, runs a compute workload, verifies that it really succeeded, handles payment, and shows the full lifecycle in the UI.**

Every job moves through these states:

```
APPROVED → PROVISIONING → RUNNING → VERIFYING → PAYMENT_PENDING → COMPLETE
```

If anything goes wrong at any step, the job becomes **`FAILED`**, and the job records which step failed and why.

The frontend also includes the **marketplace and deal views**: GPU listings, the featured multi-party deal, and the deal terms. That way the whole story, from "here is the market" to "the deal was executed and paid", can be demoed in one place.

---

## 2. Main user flow

1. The user opens the **Market** page.
2. They see **GPU listings** and a **featured multi-party deal** (Atlas Compute → Acme AI, backfilled by Nova Cloud).
3. They open the deal to see its terms.
4. They click **EXECUTE DEAL**.
5. SpareChange **creates a job**.
6. **Compute starts**: a worker is selected and prepared.
7. A **real workload runs**, with live logs and progress.
8. SpareChange **verifies the result**.
9. **Payments** are attempted.
10. The UI shows **COMPLETE**, or **FAILED** with a reason.

A normal full demo takes roughly **15 seconds** from click to COMPLETE.

---

## 3. Frontend

| Screen | Where | What it shows |
|---|---|---|
| **Market dashboard** | `/` | Market stats (GPUs available, idle reserved GPUs, A100 price spread, busy providers) |
| **GPU listings** | `/` | Provider, GPU model, region, availability, price per GPU-hour, fleet utilization |
| **Featured multi-party deal** | `/` | The deal graph, impact numbers (savings, idle GPUs reused, time to compute), and an **EXECUTE DEAL** button |
| **Deal detail page** | `/deals/[id]` | Who gives what, why every party benefits, the full terms, and the **EXECUTE DEAL** button |
| **Live execution screen** | `/jobs/[id]` | Lifecycle steps with timestamps, worker/container details, progress bar, **worker logs**, and a live **model accuracy chart** |
| **Completion / failure screen** | `/jobs/[id]` | **DEAL COMPLETE** summary (runtime, container, cost, savings, payment, transaction ID), or the failed step with a plain-English reason and a **Retry** button |
| **Executions list** | `/executions` | Every job run, newest first |
| **System / debug page** | `/system` | Which compute and payment paths are available right now, buttons to trigger each failure scenario, and API endpoints |

**The deal graph** shows the multi-party exchange at a glance:
- **Blue lines (top):** compute moving between participants: Nova → Atlas (backfill), Atlas → Acme (released GPUs).
- **Green lines (bottom):** money flowing back the other way: Acme → Atlas, Atlas → Nova.
- On the execution screen these lines animate while that step is happening and get a ✓ when it's done.

**Honesty labels:** the UI always says whether compute and payment were real or simulated:
- A banner on the execution screen says exactly where the workload ran, for example **"Real Docker container · sparechange-worker:latest · container 7f3bd148d79e"** or **"Simulated execution — no compute ran"**.
- Tags like `LIVE · LOCAL-DOCKER`, `LIVE · X402` or `SIMULATED · MOCK` appear on every job.
- A **"What ran for real"** panel lists execution mode, payment mode and deal source, plus a note whenever a fallback happened.

---

## 4. Compute execution

SpareChange runs a **real sample workload inside a Docker container**.

The sample workload **trains a small neural network** (a 32→64→4 classifier on synthetic data, roughly 10–14 billion arithmetic operations in about 6 seconds).

> **The neural network is not the product.** It is just the demo workload, used to prove that real compute actually ran and that its output can be checked. In production this would be the buyer's own job.

For every run, SpareChange records:

| Field | Example |
|---|---|
| Container ID | `7f3bd148d79e…` |
| Start time / end time | `13:05:11` / `13:05:17` |
| Runtime | `6.4 s` |
| Exit code | `0` |
| Logs | Every line the worker printed (start marker, progress, result, completion marker) |
| Final accuracy | `98.1%` |

Typical successful runs reach around **97–98% accuracy** (starting from about 25%, which is random guessing between 4 classes).

The container is locked down:
- runs as the unprivileged **`node`** user (not root)
- limited to **2 CPUs**
- limited to **512 MB** of memory
- removed automatically after the run

The worker code lives in [`worker/workload.mjs`](../worker/workload.mjs), with its [`Dockerfile`](../worker/Dockerfile) next to it.

---

## 5. Verification

**Payment only happens if verification succeeds.**

After the workload finishes, SpareChange checks:

| Check | What it proves |
|---|---|
| **Container exited successfully** | Exit code is `0` |
| **Expected log markers exist** | The worker printed both its start and completion markers |
| **Result belongs to the correct job** | The result contains this job's ID, so it can't be copied from another run |
| **Model actually learned** | Loss dropped to less than half of where it started |
| **Final accuracy is at least 85%** | Measured on held-out data the model never trained on |

If **any** check fails:
- the job becomes **`FAILED`**
- **no payment happens**
- the UI shows which checks failed

Failure cases that have been tested:
- **Simulated worker crash:** the container exits with code 1. The job fails at the workload step with the worker's own error message.
- **Model that did not learn enough:** the container exits normally, but verification rejects the result ("Model actually trained" and "Accuracy ≥ 85%" fail).

You can trigger both, plus a declined payment, from the **System** page under *Failure scenarios*.

---

## 6. Payments / x402

SpareChange uses **Coinbase x402** for machine-to-machine payment, on the **Base Sepolia testnet**.

How one x402 payment works:
1. The paying agent requests something from the other party, for example "release the verified result".
2. The other party answers **HTTP 402 Payment Required** with its price, network and wallet address.
3. The paying agent **signs a USDC payment automatically** and retries the request.
4. The x402 facilitator settles the payment **on-chain**, and the request succeeds.

### The two-payment flow (multi-party deal)

| # | From → To | What it pays for | Example test transaction |
|---|---|---|---|
| 1 | **Acme → Atlas** | The verified compute result | [0x79c31ae9…0aab96](https://sepolia.basescan.org/tx/0x79c31ae9b729eea3d11ef53b140f0428facec6c2600206764e6ba7f96d0aab96) |
| 2 | **Atlas → Nova** | The backfill capacity Atlas uses instead | [0xebdffdf0…92c692b](https://sepolia.basescan.org/tx/0xebdffdf015db9c91d3810638b022fbf8dec91564737bbad52274bd97792c692b) |

Atlas pays Nova **out of the money it just received from Acme**, so the money moves exactly as the deal graph shows. **Both payments have been completed successfully on-chain in testing**; the links above open them on the Base Sepolia block explorer.

**These use testnet USDC, not real money.**

### Scaled-down amounts

The on-chain amounts are **intentionally scaled down** from the deal value so the demo wallet isn't drained:

| Payment | Deal value (shown in UI) | Actually moved on-chain |
|---|---|---|
| Acme → Atlas | 12.60 USDC | 0.01 USDC |
| Atlas → Nova | 8.52 USDC | 0.0068 USDC (same proportion) |

The UI labels this clearly: each payment row shows both amounts, and the total reads *"0.0168 USDC (testnet, scaled down from the deal value)"*.

### Payment labels in the UI

| When | Header label |
|---|---|
| Before any payment has happened | **Payment: planned** |
| After a real x402 payment succeeded | **x402 · live** |
| After a payment fell back to mock (or mock mode is on) | **Mock settlement · simulated** |

The UI never shows "live" just because x402 is configured; only an actual successful payment counts.

---

## 7. Fallbacks

Every external piece has a fallback so the demo keeps working if something is down:

**Compute**
```
remote worker → Docker → local process → mock
```

**Payment**
```
x402 → mock
```
If only the second payment (Atlas → Nova) fails, the first one stays real and only the second is recorded as mock, with a note.

**Market / deal data**
```
live data from the deal API → demo data
```

**Every job records which path actually ran**: execution mode, payment mode, deal source, and a plain-English note for every fallback. This lets us be honest during the demo about what was real.

---

## 8. Job persistence

Jobs are stored in **`.data/jobs.json`**. This file is **gitignored**.

- Jobs **survive server restarts**, so links to past executions keep working.
- If a job was **interrupted by a restart**, it is marked **`FAILED`** with that reason ("The server restarted while this job was running. No funds were released.").
- To start with a clean history, stop the server and delete `.data/jobs.json`.

---

## 9. How another part of the system sends a deal

The full request and response shapes are in **[docs/API_CONTRACT.md](API_CONTRACT.md)**. This section is just the overview.

### Send an approved deal

```
POST /api/deals/execute
```

The caller sends an approved deal containing:
- deal ID
- buyer (id, name)
- provider (id, name)
- GPU model
- GPU count
- duration
- price (amount, currency)

Optional fields: a replacement provider for multi-party deals, flows for the graph, impact numbers, descriptions.

SpareChange then **creates the execution job and handles everything after that**: compute, verification, payment and UI. The response returns a `jobId` right away.

### Check job state

```
GET /api/jobs/[id]
```

Returns the current status plus execution details, verification results and payment results. Poll it (about once a second) until the status is `COMPLETE` or `FAILED`.

Deals sent this way also appear in the UI automatically, at `/deals/<dealId>`.

---

## 10. How to run the project

1. **Open Docker Desktop** and wait until the whale icon says it's running.
2. From the project folder, run:
   ```bash
   npm run dev
   ```
   (First time only: run `npm install` first.)
3. Open **http://localhost:3402**
4. Go to the **Market** page.
5. Click **EXECUTE DEAL** on the featured deal.

Notes:
- **Docker Desktop should be running** for the real container path.
- If Docker isn't available, SpareChange **falls back automatically** (to a local process, then to a simulation) and **labels the execution mode accurately** on screen.
- The app uses port **3402**, not 3000.

For what to say during the demo, see **[docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md)**.

---

## 11. Environment / secrets

- **Wallet keys and secrets are NOT committed to Git.**
- Local secrets live in **`.env.local`**, which is **gitignored**.
- **`.env.example`** lists every setting with **placeholders only**; copy it to start: `cp .env.example .env.local`
- With no `.env.local` at all, SpareChange still runs in demo-safe mode (Docker or local compute, mock payment, demo data).
- **To run real x402 payments on another machine**, that machine needs the right local environment variables. The main ones are:
  - `PAYMENT_MODE=x402`
  - `X402_BUYER_PRIVATE_KEY` (buyer agent, testnet only)
  - `X402_PROVIDER_PRIVATE_KEY` (Atlas's agent, testnet only)
  - `X402_REPLACEMENT_WALLET_ADDRESS` (Nova)
  - `X402_NETWORK=eip155:84532`

  Get the values privately from the person who set up the wallets. **Never paste keys into chat, issues, or commits.**
- The buyer wallet must hold **Base Sepolia** test USDC from https://faucet.circle.com. Pick **Base Sepolia**, not Arc testnet: the x402 facilitator doesn't support Arc.

---

## 12. What is real vs demo data

| ✅ Real | 🧪 Demo / fallback |
|---|---|
| Docker compute execution | Market listings, until live upstream data is connected |
| Workload verification | Some deal data, until the upstream deal source is connected |
| x402 payment path | Mock payment fallback |
| Both test payments (Acme → Atlas, Atlas → Nova) | Mock / local fallback paths when needed |
| Job state flow | |
| Failure handling | |

The demo workload runs on CPU inside Docker; the "6× A100" in the deal is the contracted GPU allocation, not hardware used during the demo.

---

## 13. Testing already completed

| Area | Tested |
|---|---|
| Full Docker execution, through to COMPLETE | ✅ |
| Successful verification (all 5 checks) | ✅ |
| Acme → Atlas x402 payment, on-chain | ✅ |
| Atlas → Nova x402 payment, on-chain | ✅ |
| Partial payment fallback (2nd payment mock, 1st stays real) | ✅ |
| Full mock mode (no compute, no payment, labeled simulated) | ✅ |
| Docker crash failure → FAILED, no payment | ✅ |
| Verification failure → FAILED, no payment | ✅ |
| Phone-width layout | ✅ |
| Lint | ✅ passes |
| Type check | ✅ passes |
| Production build | ✅ passes |
| Secret scan of the repo and its history | ✅ clean |

---

## 14. Known limitations

- **The remote worker was only tested locally**, not on a real Vultr VM.
- **Market data is still demo data** until the upstream marketplace side connects.
- **x402 depends on test wallet balances and testnet availability.** If the buyer wallet runs out of Base Sepolia USDC, or the testnet or facilitator is down, payment falls back to mock (and says so).
- **`npm audit` reports `zod` warnings**, because the current x402 packages still require zod 3. The risk for the demo is low; this clears once x402 moves to zod 4.
- **Docker Desktop should be open** for the strongest demo path.

---

## 15. Git / branch status

- The current working implementation is on the **`duo2`** branch.
- The branch **has been pushed** to GitHub.
- **`main` was not modified directly.**
- A **pull request from `duo2` → `main`** can be opened when the team is ready to review and merge. None exists yet.

---

## 16. Suggested next steps for the team

1. Review the `duo2` branch.
2. Read [docs/API_CONTRACT.md](API_CONTRACT.md).
3. Connect the approved-deal output to **`POST /api/deals/execute`**.
4. Run one combined end-to-end demo.
5. Open a PR from `duo2` → `main` when ready.
6. Rehearse the final demo using [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md).
