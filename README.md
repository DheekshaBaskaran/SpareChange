# SpareChange

**Dynamic AI compute marketplace.** SpareChange turns idle, already-paid-for GPU commitments into compute for teams that need it now. It finds the deal, then executes it: real compute runs, the output is verified, and payment settles automatically between machines with Coinbase x402.

```
market intelligence → deal discovery → agreement → execution → verification → settlement
        (Duo 1)            (Duo 1)        (Duo 1)     (Duo 2)       (Duo 2)        (Duo 2)
```

Example multi-party deal: **Atlas Compute** has 6 idle A100s it already reserved. **Acme AI** needs 6 A100s urgently (market: $3.50/GPU-hr with a ~3-day wait). **Nova Cloud** has cheaper capacity. SpareChange routes Atlas's GPUs to Acme at $2.10 and backfills Atlas from Nova at $1.42. Acme saves $8.40/hr, Atlas earns $4.08/hr on idle hardware, and Nova sells spare capacity.

## What Duo 2 built (this repo)

- **The product UI**: market dashboard, multi-party deal graph, deal detail, live execution screen, completion/settlement screen.
- **Deal execution API**: Duo 1 sends an approved deal to `POST /api/deals/execute` ([contract](docs/API_CONTRACT.md)).
- **Job manager**: `APPROVED → PROVISIONING → RUNNING → VERIFYING → PAYMENT_PENDING → COMPLETE` (or `FAILED`).
- **Compute executors** with automatic fallback: remote worker → local Docker → local process → simulated.
- **A real workload** (`worker/workload.mjs`): trains a small neural network (~10–14 billion floating-point ops), and reports progress and a result bound to the job ID.
- **Verification**: exit code, log markers, job ID binding, loss drop, held-out accuracy ≥ 85%. No verification, no payment.
- **Payments** with fallback: Coinbase **x402** (buyer agent pays the provider's paywalled endpoint on Base Sepolia) → mock settlement.

## Architecture

```
Browser UI ──▶ /api/deals/execute ──▶ Job Manager ──▶ Executor ──▶ worker (Docker / process / remote)
     ▲                                     │
     └──── polls /api/jobs/[id] ◀──────────┤──▶ Verification ──▶ settlePayment()
                                                                     ├─ x402: buyer agent ──402──▶ provider /api/provider/settle
                                                                     │        signs USDC ──▶ x402 facilitator ──▶ Base Sepolia
                                                                     └─ mock fallback
```

| Folder | What's inside |
|---|---|
| `src/app` | Pages (`/`, `/deals/[id]`, `/jobs/[id]`, `/executions`, `/system`) and API routes |
| `src/components` | UI components (deal graph, market table, execution panels…) |
| `src/lib/types.ts` | Deal, Job, ExecutionResult, PaymentResult… |
| `src/lib/demo-data.ts` | Seeded demo market and deals |
| `src/lib/server` | Job runner, executors, verification, payments, config |
| `worker/` | The workload, its Dockerfile, and the remote worker server |
| `docs/` | API contract and demo script |

## Setup

Requirements: **Node.js 20+** (Docker is optional).

```bash
git clone https://github.com/DheekshaBaskaran/SpareChange.git
cd SpareChange
git checkout duo2
npm install
npm run dev
```

Open **http://localhost:3402** (we use port 3402 to avoid clashing with other apps on 3000).

With no configuration, everything works in **demo-safe mode**: demo deals, real compute in a local worker process, and mock payment.

## Configuration

```bash
cp .env.example .env.local   # then edit .env.local, never commit it
```

Restart `npm run dev` after changing env files.

### Mock mode (everything simulated)
```
EXECUTION_MODE=mock
PAYMENT_MODE=mock
```

### Docker mode
1. Install Docker Desktop (macOS): `brew install --cask docker-desktop`, or download it from docker.com.
2. Open **Docker Desktop** from Applications once. Accept the license, allow the privileged helper if macOS asks, and skip sign-in (an account is not needed).
3. Wait until the whale icon in the menu bar says Docker is running, then check:
```bash
docker info --format '{{.ServerVersion}}'   # prints a version number when the daemon is running
npm run docker:build                        # builds sparechange-worker:latest (SpareChange also builds it on first use)
docker run --rm -e JOB_ID=manual-test sparechange-worker:latest   # run one workload by hand
```
4. With `EXECUTION_MODE=auto` (the default), SpareChange now uses Docker automatically. To require Docker, set `EXECUTION_MODE=local-docker` (it still falls back to a local process if Docker stops).

Each job runs in its own container (`--cpus 2 --memory 512m`, unprivileged user). SpareChange records the container ID, start/end time, runtime, exit code and logs, and the execution screen shows **"Real Docker container"**. If the `docker` command isn't on your PATH, SpareChange also looks inside `/Applications/Docker.app`, or you can set `DOCKER_BIN`.

### Remote worker mode
On the remote machine (any VM with Node 20+, ideally Docker):
```bash
git clone … && cd SpareChange
REMOTE_WORKER_TOKEN=choose-a-secret npm run worker:remote   # listens on :8402
```
In `.env.local` on the SpareChange machine:
```
EXECUTION_MODE=auto
REMOTE_WORKER_URL=http://<remote-ip>:8402
REMOTE_WORKER_TOKEN=choose-a-secret
```
If the remote worker is unreachable, SpareChange falls back to local execution and records why.

### x402 mode (Coinbase, Base Sepolia testnet)
1. Create a **testnet-only** buyer wallet. Any EVM private key works (e.g. `node -e "console.log(require('viem/accounts').generatePrivateKey())"`). Never use a wallet that holds real funds.
2. Fund the buyer address with free test USDC from the Circle faucet: https://faucet.circle.com. Pick **Base Sepolia** in the network dropdown (the faucet may default to Arc testnet, which the public x402.org facilitator does not support). No ETH is needed: the facilitator pays gas. Each settlement costs 0.01 test USDC.
3. Put a provider wallet address (any address you control) in `.env.local`:
```
PAYMENT_MODE=x402
X402_BUYER_PRIVATE_KEY=0x...            # testnet only, server-side only
X402_PROVIDER_WALLET_ADDRESS=0x...
X402_NETWORK=eip155:84532
X402_SETTLEMENT_PRICE=0.01              # no "$" in .env files
```
4. Check http://localhost:3402/system: payment should read "Coinbase x402".

If x402 is not configured, or the payment fails (e.g. the wallet is empty), the job still completes using mock settlement, and the job page says exactly why.

### Duo 1 live data
```
DUO1_DEALS_URL=https://…/approved-deals    # returns Deal[] (see docs/API_CONTRACT.md)
DUO1_MARKET_URL=https://…/gpu-listings     # returns GpuListing[]
```
Or Duo 1 can simply `POST` deals to `/api/deals/execute`.

## How Duo 1 calls us

```bash
curl -s -X POST http://localhost:3402/api/deals/execute \
  -H "Content-Type: application/json" \
  -d '{"dealId":"deal_123","buyer":{"id":"buyer_1","name":"Acme AI"},"provider":{"id":"provider_1","name":"Atlas Compute"},"workload":{"gpuModel":"NVIDIA A100","gpuCount":4,"durationMinutes":5},"price":{"amount":12,"currency":"USDC"}}'
# → {"success":true,"jobId":"job_…","status":"PROVISIONING"}

curl -s http://localhost:3402/api/jobs/job_…
```
Full details: [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

## Running the demo

See [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). Short version: open http://localhost:3402, then click **EXECUTE DEAL** on the featured deal. The run takes about 10 seconds.

Test failure handling at http://localhost:3402/system → *Failure scenarios*.

## Checks

```bash
npm run lint
npm run typecheck
npm run build      # stop `npm run dev` first: both use the .next/ folder
```

If pages get stuck on a loading state in dev: stop the server, run `rm -rf .next`, and start `npm run dev` again.

## Notes

- Jobs are stored in memory: restarting the server clears them (demo data always reloads).
- The demo workload runs on CPU; the GPU model/count shown is the contracted allocation from the deal. The UI labels the actual executor (`local-process`, `local-docker`, `remote`, or `simulated`).
