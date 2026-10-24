# SpareChange API Contract: Duo 1 → Duo 2

This is the shared interface between **Duo 1** (market data, matching, negotiation → *"what deal should happen?"*) and **Duo 2** (execution, verification, settlement, UI → *"make the deal happen"*).

Duo 1 only needs to **send an approved deal** and **read back a job status**. It does not need to know about Docker, workers, x402, or any other Duo 2 internals.

- Base URL (local): `http://localhost:3402`
- All bodies are JSON. All money amounts are numbers (not strings).
- TypeScript source of truth: [`src/lib/types.ts`](../src/lib/types.ts)

---

## 1. `POST /api/deals/execute`

Send an approved deal. Duo 2 validates it, creates a job, and immediately starts the lifecycle in the background.

### Minimal request (required fields only)

```json
{
  "dealId": "deal_123",
  "buyer": { "id": "buyer_1", "name": "Acme AI" },
  "provider": { "id": "provider_1", "name": "Atlas Compute" },
  "workload": { "gpuModel": "NVIDIA A100", "gpuCount": 4, "durationMinutes": 5 },
  "price": { "amount": 12, "currency": "USDC" }
}
```

### Full request (multi-party deal with all optional fields)

```json
{
  "dealId": "deal_7f3a21",
  "type": "multi_party",
  "title": "Idle A100 reservation → urgent fine-tuning run",
  "buyer": {
    "id": "acme_ai", "name": "Acme AI", "role": "buyer", "region": "US West",
    "situation": "Needs 6 A100s now for a fine-tuning run."
  },
  "provider": {
    "id": "atlas_compute", "name": "Atlas Compute", "role": "capacity_holder",
    "situation": "Reserved 8 A100s but is only using 2."
  },
  "replacementProvider": {
    "id": "nova_cloud", "name": "Nova Cloud", "role": "replacement_provider",
    "situation": "Has unsold A100 capacity at a lower rate."
  },
  "workload": { "gpuModel": "NVIDIA A100 80GB", "gpuCount": 6, "durationMinutes": 60, "region": "US West" },
  "price": { "amount": 12.6, "currency": "USDC" },
  "flows": [
    { "from": "atlas_compute", "to": "acme_ai", "kind": "compute", "label": "6× A100 released", "gpuCount": 6 },
    { "from": "nova_cloud", "to": "atlas_compute", "kind": "compute", "label": "6× A100 backfill", "gpuCount": 6 },
    { "from": "acme_ai", "to": "atlas_compute", "kind": "payment", "label": "$2.10/GPU-hr", "amount": 12.6 },
    { "from": "atlas_compute", "to": "nova_cloud", "kind": "payment", "label": "$1.42/GPU-hr", "amount": 8.52 }
  ],
  "impact": {
    "marketPricePerGpuHour": 3.5,
    "dealPricePerGpuHour": 2.1,
    "replacementPricePerGpuHour": 1.42,
    "buyerSavingsPerHour": 8.4,
    "providerNetGainPerHour": 4.08,
    "idleGpusReused": 6,
    "utilizationBeforePercent": 25,
    "utilizationAfterPercent": 100,
    "timeToComputeMinutes": 2,
    "marketWaitMinutes": 4320
  },
  "approvedAt": "2026-10-24T17:42:00.000Z"
}
```

### Deal fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `dealId` | ✅ | string | Unique deal ID from Duo 1 |
| `buyer.id`, `buyer.name` | ✅ | string | Party receiving compute |
| `provider.id`, `provider.name` | ✅ | string | Party whose compute the buyer receives |
| `workload.gpuModel` | ✅ | string | e.g. `"NVIDIA A100"` |
| `workload.gpuCount` | ✅ | integer > 0 | |
| `workload.durationMinutes` | ✅ | number > 0 | |
| `price.amount` | ✅ | number > 0 | Total the buyer pays for the deal |
| `price.currency` | ✅ | `"USDC"` \| `"USD"` | |
| `replacementProvider` | – | `{ id, name, ... }` | Present → deal is multi-party |
| `type` | – | `"direct"` \| `"multi_party"` | Inferred if missing |
| `title` | – | string | Short headline for the UI |
| `*.role` | – | `"buyer"` \| `"capacity_holder"` \| `"replacement_provider"` | |
| `*.situation`, `*.region` | – | string | One-line context shown on the deal graph |
| `workload.region`, `workload.description` | – | string | |
| `flows[]` | – | `DealFlow[]` | Arrows on the deal graph. Defaults are generated if missing |
| `impact` | – | `DealImpact` | Savings / utilization numbers. All sub-fields optional |
| `approvedAt` | – | ISO date string | Defaults to now |

### Success response: `201`

```json
{ "success": true, "jobId": "job_8d3af11fa2", "status": "PROVISIONING" }
```

### Error response: `400`

```json
{ "success": false, "error": "Invalid deal: workload.gpuCount must be a positive whole number" }
```

### Testing failure paths (optional query parameter)

`POST /api/deals/execute?simulateFailure=workload|verification|payment`

---

## 2. `GET /api/jobs/[id]`

Current state of a job. Poll it (e.g. every 1s) until `status` is `COMPLETE` or `FAILED`.

### Response: `200`

```json
{
  "success": true,
  "job": {
    "jobId": "job_8d3af11fa2",
    "dealId": "deal_7f3a21",
    "deal": { "...": "the deal you sent" },
    "status": "COMPLETE",
    "createdAt": "2026-10-24T18:39:06.585Z",
    "startedAt": "2026-10-24T18:39:08.087Z",
    "completedAt": "2026-10-24T18:39:16.480Z",
    "executionMode": "local-docker",
    "paymentMode": "x402",
    "fallbackNotes": [],
    "timeline": [
      { "status": "APPROVED", "at": "...", "note": "Approved deal received" },
      { "status": "PROVISIONING", "at": "..." },
      { "status": "RUNNING", "at": "..." },
      { "status": "VERIFYING", "at": "..." },
      { "status": "PAYMENT_PENDING", "at": "..." },
      { "status": "COMPLETE", "at": "..." }
    ],
    "execution": {
      "executionMode": "local-docker",
      "workerId": "docker-worker-01",
      "containerId": "52fd84a1c0e3...",
      "startedAt": "...", "endedAt": "...", "runtimeMs": 6104,
      "exitCode": 0,
      "progressPercent": 100,
      "logs": ["SpareChange workload started", "...", "SpareChange workload completed"],
      "output": {
        "jobId": "job_8d3af11fa2", "task": "mlp-classifier", "samples": 6000, "epochs": 166,
        "initialLoss": 1.4594, "finalLoss": 0.0716, "accuracy": 0.981,
        "operations": 13800000000, "weightsChecksum": "c422c030cef8ef22"
      }
    },
    "verification": {
      "status": "VERIFIED",
      "checks": [{ "name": "Container exited cleanly", "passed": true, "detail": "exit code 0" }],
      "verifiedAt": "..."
    },
    "payment": {
      "status": "SUCCESS",
      "paymentMode": "x402",
      "transactionId": "0x9b1f...",
      "amount": 12.6,
      "currency": "USDC",
      "timestamp": "...",
      "network": "eip155:84532",
      "explorerUrl": "https://sepolia.basescan.org/tx/0x9b1f...",
      "legs": [
        { "from": "Acme AI", "to": "Atlas Compute", "amount": 12.6, "currency": "USDC", "mode": "x402", "status": "SUCCESS", "transactionId": "0x9b1f..." }
      ],
      "steps": ["Provider responded 402 Payment Required ...", "..."]
    }
  }
}
```

`404` → `{ "success": false, "error": "Job not found" }`

### Job statuses

| Status | Meaning |
|---|---|
| `APPROVED` | Deal received (instant) |
| `PROVISIONING` | Choosing and preparing a worker |
| `RUNNING` | Workload executing |
| `VERIFYING` | Checking the output before any payment |
| `PAYMENT_PENDING` | Settling payment between participants |
| `COMPLETE` | Delivered, verified, paid |
| `FAILED` | See `job.failure = { step, message }` for which step failed and why |

### Mode fields (honesty labels)

| Field | Values |
|---|---|
| `executionMode` | `mock`, `local-process`, `local-docker`, `remote` |
| `paymentMode` | `mock`, `x402` |
| `deal.source` | `mock` (demo data), `duo1-live` |

`fallbackNotes[]` explains in plain English whenever Duo 2 fell back to a simpler mode.

---

## 3. Other endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/jobs` | Recent jobs (summaries) |
| `POST` | `/api/jobs/[id]/retry` | Start a new job for the same deal |
| `GET` | `/api/deals` | Approved deals for the UI (Duo 1 feed → pushed deals → demo deals) |
| `GET` | `/api/deals/[id]` | One deal |
| `GET` | `/api/market` | GPU listings (Duo 1 feed → demo listings) |
| `GET` | `/api/system` | Which executors / payment providers are live (no secrets) |
| `GET` | `/api/provider/settle?jobId=` | The compute provider's x402-protected endpoint (used internally by the buyer agent) |

### Optional: Duo 1 feeds that Duo 2 can pull

If Duo 1 exposes these, set them in `.env.local` and the UI uses live data automatically:

- `DUO1_DEALS_URL` → returns `Deal[]` or `{ "deals": Deal[] }`
- `DUO1_MARKET_URL` → returns `GpuListing[]` or `{ "listings": GpuListing[] }` (see `GpuListing` in `src/lib/types.ts`)

If either is unreachable (2.5s timeout), Duo 2 falls back to demo data.

---

## 4. Agent actions (CREAO / Hyphenate / any orchestrator)

| Conceptual action | HTTP call |
|---|---|
| `executeApprovedDeal(deal)` | `POST /api/deals/execute` |
| `getJobStatus(jobId)` | `GET /api/jobs/[id]` → `job.status` |
| `verifyExecution(jobId)` | `GET /api/jobs/[id]` → `job.verification` (runs automatically) |
| `settlePayment(jobId)` | `GET /api/jobs/[id]` → `job.payment` (runs automatically after verification) |

---

## 5. Quick test (copy/paste)

```bash
curl -s -X POST http://localhost:3402/api/deals/execute \
  -H "Content-Type: application/json" \
  -d '{"dealId":"deal_123","buyer":{"id":"buyer_1","name":"Acme AI"},"provider":{"id":"provider_1","name":"Atlas Compute"},"workload":{"gpuModel":"NVIDIA A100","gpuCount":4,"durationMinutes":5},"price":{"amount":12,"currency":"USDC"}}'

# then, with the jobId from the response:
curl -s http://localhost:3402/api/jobs/<jobId>
```

The deal also appears in the UI at `http://localhost:3402/deals/deal_123`, and the job at `http://localhost:3402/jobs/<jobId>`.
