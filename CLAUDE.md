# SpareChange: project guide

@AGENTS.md

## Concept

SpareChange is a dynamic AI/GPU compute marketplace. Companies reserve GPU capacity they don't fully use; others urgently need GPUs and face high spot prices, shortages and long waits. SpareChange lets existing compute commitments change hands, including **multi-party exchanges**:

> Atlas Compute releases 6 idle A100s to Acme AI, while Nova Cloud backfills Atlas with cheaper capacity. Everyone comes out ahead.

Full vision: market intelligence → deal discovery → agreement → **compute execution → verification → settlement**.

## Team split

- **Duo 1** ("what deal should happen?"): live GPU market data (Apify, Tiger Data), utilization analytics, financial optimization, multi-party matching, negotiation (Hyphenate, CREAO), producing an **approved deal**.
- **Duo 2** ("make the deal happen"), this codebase's main owner: receiving approved deals, the frontend, job management, Docker/remote workers, verification, payment settlement (Coinbase x402), and showing the whole lifecycle.

The interface between the two is [docs/API_CONTRACT.md](docs/API_CONTRACT.md). Don't change it without telling Duo 1.

## Architecture

```
Frontend (src/app, src/components)
  ↓ POST /api/deals/execute, GET /api/jobs/[id]
Duo 2 API (src/app/api)
  ↓
Job Manager (src/lib/server/job-runner.ts)
  ↓ chooseExecutor() + executor.execute()
Executors (src/lib/server/executors): remote → local-docker → local-process → mock
  ↓ worker/workload.mjs (real MLP training; same script everywhere)
Verification (src/lib/server/verification.ts)
  ↓ settlePayment()
Payments (src/lib/server/payments): x402 → mock
  ↓
Job state in memory (src/lib/server/job-store.ts) → UI polls it
```

- Types: `src/lib/types.ts`. Seed data: `src/lib/demo-data.ts`. Env config: `src/lib/server/config.ts`.
- The x402 *provider* side is `src/app/api/provider/settle/route.ts` (protected with `withX402`); the *buyer agent* side is `src/lib/server/payments/x402.ts` (`@x402/fetch`).
- Remote worker: `worker/server.mjs` (plain Node HTTP server; runs Docker if available).

## Execution lifecycle

`APPROVED → PROVISIONING → RUNNING → VERIFYING → PAYMENT_PENDING → COMPLETE`, or `FAILED` at any step (with `job.failure = { step, message }`). Use these exact names everywhere.

## Integration priorities

1. Working end-to-end demo 2. UI quality 3. Real Docker execution 4. Coinbase x402 5. Microsoft "real world impact" story 6. Clean Duo 1 integration 7. Apify (via Duo 1) 8. Hyphenate 9. CREAO 10. Visa 11. Figma 12. Convex only if it genuinely helps.

Never sacrifice the working demo for another sponsor integration.

## Mock fallback rule

Every external integration must have a fallback, so the demo keeps working offline:
- Duo 1 feed → demo deals/listings
- Remote worker → local Docker → local process → mock executor
- x402 → mock payment

Always record what really happened: `executionMode`, `paymentMode`, `deal.source`, and `fallbackNotes`. **Never label mocked execution or payments as real.** Mock transaction IDs start with `mock_tx_`.

## Security rules

- Never commit `.env*` files (only `.env.example`, which has placeholders only), private keys, seed phrases, API keys or tokens.
- Payment keys are read only in `src/lib/server/*`. Never import server modules into `"use client"` files, and never expose keys to the browser.
- x402 wallets are **testnet only** (Base Sepolia).
- Check `git diff --cached` for secrets before every commit/push.

## UI quality expectations

Dark, high-contrast "infrastructure console" look. One accent for value/money (`value`, green), one for compute (`compute`, blue), status colors for pending/danger. Tokens live in `src/app/globals.css`; shared primitives in `src/components/ui.tsx` (`Panel`, `Badge`, `Metric`, `ModeTag`…). Reuse them; don't invent new one-off styles. Keep text short, numbers in tabular mono, status never shown by color alone, and animations quick. The demo must make sense to a judge in seconds.

## Next.js notes (v16)

- Cache Components is on: anything that reads request data, `params`, `Date.now()`, or uncached I/O must be inside `<Suspense>` or call `await connection()`. `npm run build` will tell you.
- Read `node_modules/next/dist/docs/` before using unfamiliar Next.js APIs.

## Don't over-engineer

Beginner-friendly code: descriptive names, small functions, comments where useful, no dependency injection frameworks, no microservices, no database (in-memory store is fine for the demo). Add an abstraction only if it removes real duplication or enables a fallback.

## Commands

```bash
npm run dev        # http://localhost:3402
npm run build      # production build (also catches caching/prerender errors)
npm run lint
npm run typecheck
npm run worker:remote   # remote worker on :8402
```
