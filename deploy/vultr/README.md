# Deploying Duo 1 + Market Intelligence on Vultr

Both services are stateless containers behind one Caddy reverse proxy. Tiger Data
stays the canonical database for both; Vultr only runs the APIs.

```
                 TLS (80/443)
  Internet ──────▶ Caddy ──▶ market-api.<domain> ──▶ api:8000   (Duo 2)
                     │
                     └────▶ api.<domain>         ──▶ duo1:4000  (Duo 1)
                                                        │
                                          MARKET_API_URL=http://api:8000
                                          (market mirror → relay.market_offers)
```

Duo 1 reaches the market API over the private Compose network. Caddy is the only
service that publishes host ports, so neither API is directly reachable.

## Option A: one Vultr instance (demo / low traffic)

### 1. Instance and DNS

1. Create an Ubuntu 24.04 instance with a public IPv4.
2. Create two `A` records pointing at it, for example
   `market-api.relay.example` and `api.relay.example`.
3. Install Docker Engine and the Compose plugin.
4. Open ports 80 and 443 (and 443/udp for HTTP/3) in the Vultr firewall.

### 2. Configuration

Copy the repository to the instance and create `/opt/relay/.env` from
`.env.example`. At minimum set:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Tiger Data application role used by both APIs |
| `MIGRATION_DATABASE_URL` | Owner role; only needed for the migration step |
| `MARKET_DOMAIN` | Public hostname for the market API |
| `DUO1_DOMAIN` | Public hostname for the Duo 1 API |
| `MARKET_ADMIN_TOKEN` | Admin token for ingestion and market sync |
| `APIFY_TOKEN`, `APIFY_ACTOR_ID` | Apify collection |
| `RELAY_API_KEY` | CREAO agent credential (created in step 5, or seed it) |
| `DUO2_WORKER_API_KEY` | Worker credential used for usage/settlement calls |

Production defaults to keep:

```dotenv
RELAY_ALLOW_SIMULATED_APPROVALS=0
ELASTIC_ENABLED=1        # only after the bootstrap below succeeds
```

Never commit `.env`; the Compose file reads it at runtime and it is excluded from
both Docker build contexts.

### 3. Build and start

From `deploy/vultr`:

```bash
docker compose --env-file ../../.env up -d --build
docker compose --env-file ../../.env ps
```

Both services must report `healthy` before Caddy starts. Verify from the host:

```bash
curl -fsS "https://${MARKET_DOMAIN}/readyz"
# {"status":"ready", ...}

curl -fsS "https://${DUO1_DOMAIN}/v1/health"
# {"status":"ok","contract":"relay-duo1.v1","database":"ok", ...}
```

`/v1/health` is intentionally unauthenticated and exempt from the
`x-relay-contract` header so container health checks work without credentials.
It still performs a real database round trip.

Caddy obtains and renews certificates automatically. Logs are capped per service
at 5 × 20 MB.

### 4. Apply database migrations once

The application roles cannot run DDL. Use the Tiger Data owner URL:

```bash
# Market Intelligence (public schema)
MIGRATION_DATABASE_URL='postgresql://...' \
  docker compose --env-file ../../.env run --rm \
  -e MIGRATION_DATABASE_URL \
  api python -m market_intelligence.scripts.migrate

# Duo 1 (relay schema, plus optional Timescale hypertables)
docker compose --env-file ../../.env run --rm \
  duo1 node dist/db/migrate.js
```

`dist/db/migrate.js` also honours `MIGRATION_DATABASE_URL`; it falls back to
`DATABASE_URL` only when the owner URL is absent. Set `RELAY_TIMESCALE=1` before
running it if the plan supports TimescaleDB hypertables.

Market migration `005_market_offer_state` backfills the current-offer table and
replaces the old full-history ranking view. Verify:

```sql
SELECT count(*) FROM market_offer_state;
SELECT count(*) FROM market_offers_current;
```

After migrating, you may remove `MIGRATION_DATABASE_URL` from the runtime `.env`
and recreate the containers; the APIs never need DDL rights.

### 5. Provision credentials

Keys are stored as hashes and printed exactly once. Run the compiled CLI in the
Duo 1 container:

```bash
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "CREAO Deal Coordinator" --role agent

docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "Duo 1 Finance" --role finance

docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "Duo 2 Worker" --role worker
```

For a human approver, create the party/human user first (or run the demo seed on
a non-production database) and pass both identifiers:

```bash
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/create-api-key.js --name "Acme Approver" --role human \
  --party-id <party-uuid> --human-user-id <human-uuid>
```

Copy the printed keys into `.env` as `RELAY_API_KEY`, `DUO1_FINANCE_API_KEY`,
`DUO2_WORKER_API_KEY`, and the `HUMAN_*` values used by the smoke test, then
restart `duo1`.

### 6. Verify the market bridge

The bridge mirrors live market offers into `relay.market_offers`, where the
solver consumes them as public reference prices:

```bash
curl -fsS "https://${DUO1_DOMAIN}/v1/market/bridge" \
  -H "x-relay-contract: relay-duo1.v1" \
  -H "authorization: Bearer $RELAY_API_KEY"

curl -fsS -X POST "https://${DUO1_DOMAIN}/v1/market/bridge/sync" \
  -H "x-relay-contract: relay-duo1.v1" \
  -H "authorization: Bearer $ADMIN_API_KEY" \
  -H "idempotency-key: bootstrap-sync-1"
```

The status payload reports the last run, mirrored offer counts, and any error.
Boot-time failures are logged and never fatal; finance keeps serving locally
persisted offers.

### 7. Run the end-to-end smoke test

From a workstation with the same `.env`:

```bash
set -a; source .env; set +a
npm run smoke -- "https://${DUO1_DOMAIN}"
```

It exercises deal creation, four-party approvals, handoff, execution
authorization, contracts, usage, invoicing, payables, a clean reconciliation, a
deliberate overbill, the Elastic investigation, correction approval, buyer
payment, provider payout, and the final ledger check. Run it once against a
freshly seeded demo database: a completed or handoff-ready deal keeps its
capacity window reserved, so a second run correctly reports
`no_feasible_deal` until the demo data is rebuilt.

A `503 elastic_rate_limited` response is a quota condition, not a finance
failure: the exception stays open and nothing is mutated. Retry after the
provider window refills, or raise the Elastic trial limit.

To run the smoke test again, reset the demo state first. This clears only the
transactional `relay` tables (deals, contracts, invoices, payments, exceptions,
investigations); identity, API keys, ledger accounts, spending limits, and the
mirrored market offers survive:

```bash
docker compose --env-file ../../.env run --rm duo1 \
  node dist/cli/reset-demo.js --confirm --purge-elastic
```

It refuses to run without `--confirm`, and refuses any target that looks like
production. Audit events are kept as the historical evidence trail.
`--purge-elastic` clears the Elastic projection index and rebuilds it from the
seeded data (truncation bypasses the outbox, so stale documents would otherwise
keep appearing in investigations); drop the flag and run
`node dist/cli/elastic-reindex.js` later if you prefer to rebuild separately.

### 8. Elastic bootstrap (once)

Follow `docs/ELASTIC_INTEGRATION.md` to create the index, the investigator agent,
and least-privilege API keys. Then run:

```bash
docker compose --env-file ../../.env run --rm \
  duo1 node dist/cli/elastic-bootstrap.js
```

Bootstrap is idempotent. The runtime only needs index read/write and Agent
Builder read; keep the broader bootstrap key out of the running container.

### 9. Cut the Apify Actor over from the tunnel

Read the scheduled task input, replace `relayIngestUrl` with the public HTTPS
origin, and clear `pushToRelay` only if you want dataset-only collection:

```bash
curl -fsS "https://api.apify.com/v2/actor-tasks/YmcKuNwTaAJeejha6?token=$APIFY_TOKEN"
```

Set:

```json
{
  "pushToRelay": true,
  "relayIngestUrl": "https://market-api.relay.example"
}
```

The Actor's `RELAY_INGEST_TOKEN` must equal `MARKET_ADMIN_TOKEN`. Stop the
localtunnel process after the first successful scheduled run.

### 10. Replay missed runs

The Actor no longer fails a collection when Relay is unavailable. It keeps the
dataset and leaves change-detection state unchanged. Run the reconciler from
cron so a missed push is ingested later:

```cron
*/5 * * * * cd /opt/relay && docker compose --env-file .env -f deploy/vultr/docker-compose.yml run --rm \
  -e RELAY_API_URL=https://market-api.relay.example api \
  python -m market_intelligence.scripts.reconcile_apify --limit 10 >> /var/log/relay-reconcile.log 2>&1
```

`mode=items` and event insertion are both idempotent; replaying a run that was
already delivered is a no-op.

## Option B: Vultr Kubernetes Engine (scale)

1. Create a VKE cluster and a Vultr Container Registry repository.
2. Build and push both images:

   ```bash
   TAG=$(git rev-parse --short HEAD)
   docker build -t registry.example.com/relay/market-api:$TAG .
   docker build -f Dockerfile.duo1 -t registry.example.com/relay/duo1:$TAG .
   docker push registry.example.com/relay/market-api:$TAG
   docker push registry.example.com/relay/duo1:$TAG
   ```

3. Create the namespace and secret:

   ```bash
   kubectl create namespace relay
   kubectl -n relay create secret generic relay-market-secrets \
     --from-env-file=.env
   kubectl -n relay create secret tls market-api-tls \
     --cert=fullchain.pem --key=privkey.pem
   ```

4. Update the image tags in `k8s.yaml`, apply it, and point DNS at the load
   balancer address:

   ```bash
   kubectl apply -f k8s.yaml
   kubectl -n relay get svc relay-market-api
   ```

The manifest currently runs the market API with two replicas, `/readyz` and
`/healthz` probes, an HPA from 2 to 6 pods, and a Vultr HTTPS load balancer. Add
Duo 1 as a second Deployment/Service using `Dockerfile.duo1`, exposing port
4000, with a `/v1/health` readiness probe and the same secret. Keep
`MARKET_API_URL` pointed at the market API Service DNS name.

## Database choice

Keep Tiger Data for now. Vultr Managed PostgreSQL may expose the TimescaleDB
extension depending on the cluster version, but it is not consistently listed as
a supported extension. Do not migrate the canonical store without testing
`CREATE EXTENSION timescaledb`, hypertables, continuous aggregates, and retention
policies on the exact cluster. Running TimescaleDB yourself on Vultr is possible
but adds backup, upgrade, and failover work that Tiger Data already handles.

## Operational checklist

- [ ] Both `A` records resolve; Caddy certificates are valid
- [ ] `docker compose ps` shows `api`, `duo1`, and `caddy` healthy
- [ ] `https://${MARKET_DOMAIN}/readyz` returns `ready` and `checks.current_offer_state` is `ok`
- [ ] `https://${DUO1_DOMAIN}/v1/health` returns `database: "ok"`
- [ ] Market migration 005 applied; `market_offer_state` is populated
- [ ] Duo 1 relay migrations applied as owner (`dist/db/migrate.js`)
- [ ] `RELAY_ALLOW_SIMULATED_APPROVALS=0`
- [ ] Agent, finance, worker, and human credentials created; keys stored in `.env` only
- [ ] `POST /v1/market/bridge/sync` succeeds and mirrored offers appear in `relay.market_offers`
- [ ] `npm run smoke -- https://${DUO1_DOMAIN}` passes end to end
- [ ] Elastic bootstrap succeeded and the investigator returns findings (or quota is documented)
- [ ] Apify task points at the public origin, no tunnel
- [ ] Scheduled Apify run succeeds and `relay_push.ok=true`
- [ ] Reconcile cron runs and reports duplicates, not new rows, for delivered runs
- [ ] Database connection pool stays within the Tiger plan limit across replicas
