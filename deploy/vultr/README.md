# Deploying Relay + Market Intelligence + SpareChange on Vultr

This is the production-shaped deployment for the combined branch
`integration/duo1-duo2`. One Vultr instance runs four containers behind Caddy:
the Market Intelligence API, Relay (Duo 1), SpareChange (Duo 2), and Caddy
itself. Tiger Data stays the canonical database for Relay and market data.
Duo 2 keeps its job and payout records on a named Docker volume.

```
                          TLS (80/443/udp)
 Internet ──▶ Caddy ──▶ market-api.<domain> ──▶ api:8000    (Market Intelligence)
                 │
                 ├────▶ api.<domain>        ──▶ duo1:4000   (Relay finance/CREAO)
                 │                                   │
                 │                                   └─ MARKET_API_URL=http://api:8000
                 │
                 └────▶ app.<domain>        ──▶ duo2:3402   (SpareChange console)
                                                     │
                                                     ├─ DUO1_API_URL=http://duo1:4000
                                                     └─ volume duo2_data:/app/.data
```

Only Caddy publishes host ports. `api`, `duo1`, and `duo2` are reachable only on
the private Compose network. Each service receives an explicit environment
allowlist: Duo 2 never receives `DATABASE_URL`, human credentials, or the market
and Apify keys; the market API never receives Relay, x402, or Solana credentials.

> **Status.** The images, Compose file, health checks, cross-container reads, and
> the full payment flow were validated locally (see
> [../../docs/INTEGRATION_STATUS.md](../../docs/INTEGRATION_STATUS.md)). A real
> Vultr run with public DNS/TLS has **not** been performed yet, and this branch
> has **not** been deployed. Treat the checklist at the end as the deployment
> gate, not as completed evidence.

---

## 1. Instance, DNS, and firewall

1. Create an Ubuntu 24.04 instance with a public IPv4 and enough disk for
   Docker images (2 vCPU / 4 GB is enough for the demo stack).
2. Create three `A` records pointing at that IP:
   - `market-api.<domain>` → Market Intelligence
   - `api.<domain>` → Relay (the URL CREAO will use)
   - `app.<domain>` → SpareChange console
3. Install Docker Engine and the Compose plugin.
4. Open **80/tcp**, **443/tcp**, and **443/udp** (HTTP/3) in the Vultr firewall.
   Do not expose 4000, 3402, or 8000.

Caddy obtains and renews TLS certificates automatically. The public Relay host
must not sit behind a request-password page or a tunnel: CREAO's sandbox makes
outbound HTTPS requests only.

## 2. Repository and environment

Copy the repository to `/opt/relay` and create `/opt/relay/.env` from
[`.env.example`](../../.env.example). The Compose file reads it through
`--env-file ../../.env` from `deploy/vultr`.

### Required for every deployment

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | api, duo1 | Tiger Data application role (DML only) |
| `MARKET_ADMIN_TOKEN` | api | Ingestion/sync admin bearer token |
| `RELAY_API_KEY` | duo1, duo2 | Agent credential used for deal reads/handoff and Duo 2 → Relay |
| `DUO2_WORKER_API_KEY` | duo1 (DB auth), duo2 | Worker credential for usage/payment/payout settlement |
| `DUO1_FINANCE_API_KEY` | scenario scripts | Finance credential for invoices, reconciliation, payment requests |
| `RELAY_HUMAN_API_KEY` | duo1 seed, scenarios | Acme participant human approval key |
| `HUMAN_VERTEX_API_KEY`, `HUMAN_NORTHSTAR_API_KEY`, `HUMAN_BRIGHTLANE_API_KEY` | scenarios | The other three participant approvals |
| `MARKET_DOMAIN`, `DUO1_DOMAIN`, `DUO2_DOMAIN` | caddy, duo2 | Public hostnames |
| `DUO2_INTERNAL_TOKEN` | duo1, duo2 | **Required.** Shared secret protecting `/api/relay/pay` and `/api/relay/pay-out`; generate a long random value. Compose refuses to start without it. |

### Payment rails (testnet only)

| Variable | Purpose |
| --- | --- |
| `PAYMENT_MODE=x402` | Real Base Sepolia buyer settlement; `mock` runs without wallets |
| `X402_BUYER_PRIVATE_KEY` | Buyer agent key (Base Sepolia) |
| `X402_PROVIDER_PRIVATE_KEY`, `X402_PROVIDER_WALLET_ADDRESS` | Capacity-holder agent and receiving wallet |
| `X402_REPLACEMENT_WALLET_ADDRESS` | Optional backfill recipient |
| `X402_NETWORK=eip155:84532` | Base Sepolia |
| `X402_SETTLEMENT_PRICE=0.01` | Demo-scale on-chain amount, no `$` |
| `SOLANA_RPC_URL`, `SOLANA_NETWORK=solana-devnet` | Solana Devnet endpoint |
| `SOLANA_PAYER_SECRET_KEY` | 64-byte JSON array of the funded Devnet payer keypair |
| `SOLANA_PAYOUT_ADDRESS` | The only allowed payout recipient (allowlist) |
| `SOLANA_PAYOUT_LAMPORTS=10000000` | 0.01 SOL demo transfer |

### Optional integrations

- `MARKET_API_TOKEN` — bearer for admin calls from Relay's market bridge.
- `APIFY_TOKEN`, `APIFY_ACTOR_ID` — scheduled collection.
- Provider keys (`VASTAI_API_KEY`, `RUNPOD_API_KEY`, …) — optional; public
  endpoints work without them.
- `ELASTIC_ENABLED=0` is the supported default. Elastic is deprecated for this
  event: leave it disabled so investigations return `503` without changing any
  accounting state. Do not make Elastic a deployment dependency.

Production values to keep:

```dotenv
RELAY_ALLOW_SIMULATED_APPROVALS=0
RELAY_TIMESCALE=0          # set to 1 only when the Tiger plan supports it
ELASTIC_ENABLED=0
PAYMENT_MODE=x402
```

`MIGRATION_DATABASE_URL` must exist in the operator's environment for the two
migration commands below, but it is deliberately **not** passed to any running
container.

## 3. Build and start

From `deploy/vultr`:

```bash
docker compose --env-file ../../.env build
docker compose --env-file ../../.env up -d
docker compose --env-file ../../.env ps
```

Caddy starts only after all three backends report healthy. Duo 2's health check
is `/api/health`, a liveness endpoint that never calls Solana or x402, so a
payment-provider outage cannot block startup. Configuration and funding truth
for the UI stays on `GET /api/system`.

Verify from the host:

```bash
curl -fsS "https://${MARKET_DOMAIN}/readyz"
curl -fsS "https://${DUO1_DOMAIN}/v1/health"
curl -fsS "https://${DUO2_DOMAIN}/api/health"
curl -fsS "https://${DUO2_DOMAIN}/api/system" | jq '{relay: .duo1, payments: .payments}'
```

Expected: market `ready`; Relay `status: "ok"` with `database: "ok"`; Duo 2
`{"ok":true}`; and `/api/system` reporting
`relayConfigured: true`, `paymentMode: "x402"`, a funded Solana payer, and the
allowlisted payout address. No secret is returned by any of these endpoints.

## 4. Apply migrations once

Both services share one database. Use the owner URL for DDL; the runtime roles
cannot create tables.

```bash
# Market Intelligence (public schema)
docker compose --env-file ../../.env run --rm \
  -e MIGRATION_DATABASE_URL \
  api python -m market_intelligence.scripts.migrate

# Relay (relay schema, including 0008_usage_basis)
docker compose --env-file ../../.env run --rm \
  -e MIGRATION_DATABASE_URL \
  duo1 node dist/db/migrate.js
```

`0008_usage_basis.sql` widens the usage-basis constraint so contracted capacity
can be distinguished from measured hardware time. Apply it **before** starting
the new Relay image; otherwise usage writes are rejected.

Check:

```sql
SELECT filename FROM relay.schema_migrations ORDER BY filename;
SELECT count(*) FROM market_offer_state;
SELECT count(*) FROM market_offers_current;
```

## 5. Seed demo identities and provision credentials

The seed creates parties, humans, workloads, capacity, offers, ledger accounts,
and spending limits. It is safe to re-run.

```bash
docker compose --env-file ../../.env run --rm \
  -e RELAY_HUMAN_API_KEY \
  duo1 node dist/db/seed.js
```

Create the remaining credentials inside the container. Keys are printed once and
stored only as hashes; copy them into `.env` and restart `duo1` and `duo2`.

```bash
# CREAO agent (must equal RELAY_API_KEY)
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "CREAO Deal Coordinator" --role agent

# Finance operator (must equal DUO1_FINANCE_API_KEY)
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "Duo 1 Finance" --role finance

# Duo 2 worker (must equal DUO2_WORKER_API_KEY)
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "Duo 2 Worker" --role worker

# Participant humans used by the reproducible scenarios
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "Acme Approver" --role human \
  --party-id 11111111-1111-4111-8111-111111111111 \
  --human-user-id ffffffff-ffff-4fff-8fff-fffffffff001
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "Vertex Approver" --role human \
  --party-id 22222222-2222-4222-8222-222222222222 \
  --human-user-id ffffffff-ffff-4fff-8fff-fffffffff002
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "Northstar Approver" --role human \
  --party-id 33333333-3333-4333-8333-333333333333 \
  --human-user-id ffffffff-ffff-4fff-8fff-fffffffff003
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "Brightlane Approver" --role human \
  --party-id 44444444-4444-4444-8444-444444444444 \
  --human-user-id ffffffff-ffff-4fff-8fff-fffffffff004
```

If `RELAY_HUMAN_API_KEY` is already in `.env` before seeding, the Acme key is
seeded automatically; creating a second Acme key is harmless but only the key in
`.env` is used by the scripts.

## 6. Verify the market bridge

```bash
curl -fsS "https://${DUO1_DOMAIN}/v1/market/bridge" \
  -H "x-relay-contract: relay-duo1.v1" \
  -H "authorization: Bearer $RELAY_API_KEY"

curl -fsS -X POST "https://${DUO1_DOMAIN}/v1/market/bridge/sync" \
  -H "x-relay-contract: relay-duo1.v1" \
  -H "authorization: Bearer $MARKET_ADMIN_TOKEN" \
  -H "idempotency-key: bootstrap-sync-1"
```

Bridge failures are logged and non-fatal: finance keeps serving persisted
offers. Confirm `marketDataMode: duo1-live` from
`https://${DUO2_DOMAIN}/api/market`.

## 7. Run the three reproducible scenarios

Run these from a workstation with the same `.env`. Reset the transactional state
between scenarios; each run reserves capacity and completes a deal.

```bash
set -a; source .env; set +a
export DUO1_BASE_URL="https://${DUO1_DOMAIN}"
export DUO2_BASE_URL="https://${DUO2_DOMAIN}"

npm run e2e -- "$DUO1_BASE_URL" "$DUO2_BASE_URL" | tee /tmp/e2e-clean.log
# reset, then:
npm run e2e:exception -- "$DUO1_BASE_URL" "$DUO2_BASE_URL" | tee /tmp/e2e-exception.log
# reset, then:
npm run e2e:multiparty -- "$DUO1_BASE_URL" "$DUO2_BASE_URL" | tee /tmp/e2e-multiparty.log
```

Reset command (destructive, confirmed, and requires the owner URL):

```bash
docker compose --env-file ../../.env run --rm \
  -e MIGRATION_DATABASE_URL \
  duo1 node dist/cli/reset-demo.js --confirm
```

The reset keeps identities, API keys, ledger accounts, spending limits, market
offers, and audit events; it re-seeds the demo fixtures. It refuses to run
without `--confirm` or against a host labelled `prod`/`production`. The exact
expected output and evidence fields are in
[../../docs/DEMO_SCENARIOS.md](../../docs/DEMO_SCENARIOS.md).

## 8. Persistent state and backups

- **Relay/market data:** Tiger Data. Use its backups and retention policy; the
  Vultr host holds no canonical relational state.
- **Duo 2 jobs, received deals, and Solana payout records:** the `duo2_data`
  volume mounted at `/app/.data` (`jobs.json`, `payouts.json`). Back it up with
  the rest of `/var/lib/docker/volumes`, or copy the two files while the
  container is stopped. The payout record is written before Relay is notified, so
  losing it would remove the fast idempotent-replay path.
- **TLS state:** `caddy_data` and `caddy_config`. Losing them only forces
  certificate re-issuance.

Do not mount host paths for these volumes on a shared machine; use named volumes
or an explicit encrypted backup.

## 9. Secret management

- `.env` is gitignored and excluded from both Docker build contexts. Never bake
  secrets into an image or commit a populated `.env`.
- Compose passes an explicit allowlist per service. Rotating a key means editing
  `.env` and recreating the affected service, not rebuilding the image.
- `MIGRATION_DATABASE_URL` stays on the operator's machine. The running
  containers never receive DDL rights.
- x402 and Solana keys are **testnet-only**. If these become real funds, move
  them to a dedicated signer/KMS and do not place them in a Compose environment.
- Rotate the four human keys after the demo. They are credentials, not demo
  labels.

## 10. Update and rollback

```bash
git fetch --all
git checkout integration/duo1-duo2
git pull --ff-only
docker compose --env-file ../../.env build
docker compose --env-file ../../.env up -d
docker compose --env-file ../../.env ps
```

Migrations are forward-only. Take a Tiger Data snapshot before applying one; to
roll back, redeploy the previous image and restore the database snapshot if the
new migration is not backward-compatible. `duo2_data` survives image changes.

## 11. Deployment gate

- [ ] Three `A` records resolve; Caddy certificates are valid.
- [ ] `docker compose ps` shows `api`, `duo1`, `duo2`, and `caddy` healthy.
- [ ] `https://${MARKET_DOMAIN}/readyz` returns `ready`.
- [ ] `https://${DUO1_DOMAIN}/v1/health` returns `database: "ok"`.
- [ ] `https://${DUO2_DOMAIN}/api/health` returns `{"ok":true}`.
- [ ] `https://${DUO2_DOMAIN}/api/system` reports `relayConfigured: true`,
      `paymentMode: "x402"`, and a funded Solana payout wallet.
- [ ] Migrations through `0008_usage_basis.sql` are applied.
- [ ] Agent, finance, worker, and four human credentials exist; keys are only in
      `.env`.
- [ ] `RELAY_ALLOW_SIMULATED_APPROVALS=0`, `ELASTIC_ENABLED=0`.
- [ ] Clean, exception, and multi-party scenarios pass against the public URLs.
- [ ] A Base Sepolia transaction and a Solana Devnet signature from the latest
      run are independently confirmed through their explorers/RPC.
- [ ] `duo2_data` backup and restore have been tested.
- [ ] Hosted CREAO setup is complete per
      [../../docs/HOSTED_CREAO_RUNBOOK.md](../../docs/HOSTED_CREAO_RUNBOOK.md).

## 12. Known deployment gaps

- No real Vultr/TLS run has been performed from this workspace.
- Tiger Data's network policy must allow the Vultr egress address.
- CREAO egress must reach `https://${DUO1_DOMAIN}`; a tunnel or password page is
  not acceptable.
- The browser UI has no end-user authentication yet. Until the redesign adds a
  session layer, do not expose human approval credentials or finance keys to the
  browser; use a server-side BFF.
- Elastic is intentionally disabled and is not part of the deployment gate.
