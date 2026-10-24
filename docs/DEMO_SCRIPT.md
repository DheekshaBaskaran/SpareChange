# SpareChange Demo Script (60–90 seconds)

**Before judges arrive:** `npm run dev`, open **http://localhost:3402**, and use a browser window at ~1440px wide (or 90% zoom on a projector). Open **/system** once to confirm what is live (see the table below), then return to the dashboard.

---

### 1. Dashboard: "compute is fragmented" (~15s)
**Screen:** `/` (Market)

> "Companies reserve GPUs they don't fully use, while others can't get any. Look: the same A100 costs anywhere from $1.42 to $3.50 an hour, and several providers are over 90% utilized. There are 8 GPUs here that are already paid for and sitting idle."

Point at the KPI strip, then the marketplace table.

### 2. The deal: "everyone wins" (~20s)
**Screen:** the *Deal discovered* panel on the dashboard (or click **Review deal terms**).

> "Our matching engine found a three-party deal. Atlas Compute releases 6 idle A100s to Acme AI, who needs them now. Nova Cloud backfills Atlas with cheaper capacity. Blue lines show compute moving and green lines show money. Acme saves $8.40 an hour and gets GPUs in 2 minutes instead of 3 days. Atlas earns $4 an hour on hardware it was wasting."

### 3. Execute (~25s)
Click **EXECUTE DEAL**.

> "Finding the deal is half the problem. SpareChange actually executes it."

Narrate as the lifecycle moves (no need to wait in silence):
- **Provisioning → Running:** "A worker is allocated and a real workload starts: it's training a neural network. These are live logs and accuracy climbing."
- **Verifying:** "Before anyone gets paid, we verify the output: clean exit, the result is tied to this job, the model actually learned."
- **Settling:** "Now the buyer's agent pays the provider automatically with x402. The provider responds HTTP 402 Payment Required, the agent signs a USDC payment, and the result is released. That's machine-to-machine commerce."

### 4. Complete (~10s)
> "Deal complete. The buyer got verified compute, both providers got paid, and here's the transaction."

Point at: runtime, worker/container, savings, transaction ID (and **View on explorer** if x402 is live).

---

## What's real vs. fallback

Check `/system` before the demo. The job page's **"What ran for real"** panel shows the same for each run.

| Part | Real when… | Fallback |
|---|---|---|
| Workload execution | Always real compute (local process, Docker, or remote worker) | Simulated only if `EXECUTION_MODE=mock` |
| Docker | Docker Desktop is running | Local worker process |
| Remote worker | `REMOTE_WORKER_URL` reachable | Local Docker / process |
| Verification | Always real checks on real output | – |
| x402 payment | `PAYMENT_MODE=x402` + funded Base Sepolia wallet | Mock settlement (`mock_tx_…`, labeled "simulated") |
| Market & deals | Duo 1 feed configured or Duo 1 pushed a deal | Seeded demo data (labeled "Demo market data") |
| Backfill payment leg (Atlas → Nova) | – | Recorded as mock in all modes |

Be precise if asked: the demo workload runs on CPU; the "6× A100" is the contracted allocation.

## Sponsor call-outs
- **Coinbase x402:** settlement step: autonomous agent pays a 402-protected provider endpoint; on-chain tx on Base Sepolia.
- **Microsoft (real-world impact):** the impact metrics (savings, idle GPUs reused, time to compute 3 days → 2 min, utilization 25% → 100%) and real execution + verification, not just a mock marketplace.
- **Apify / Hyphenate / CREAO:** Duo 1's market data and deal decisions flow in through `POST /api/deals/execute`.

## If something breaks
- **x402 / internet down:** nothing to do; it falls back to mock settlement automatically. Say: "payment is in fallback mode right now; the x402 path is wired and the job page shows why it fell back."
- **Remote worker down:** falls back automatically to local execution.
- **Page shows "Job not found":** the server restarted; go back to `/` and execute again.
- **Want to show error handling:** `/system` → *Failure scenarios* → e.g. *Verification rejects output*, then click **Retry execution**.
- **Nuclear option:** set `EXECUTION_MODE=mock` and `PAYMENT_MODE=mock` in `.env.local` and restart.
