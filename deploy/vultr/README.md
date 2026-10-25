# Deploying Relay Market Intelligence on Vultr

The service is a stateless FastAPI container. Tiger Data remains the canonical
database; Vultr only runs the API (and, when needed, ingestion workers).

## Option A: one Vultr instance (demo / low traffic)

1. Create an Ubuntu 24.04 instance with a public IPv4 and a DNS record such as
   `market-api.relay.example`.
2. Point the DNS `A` record at the instance.
3. Install Docker Engine and the Compose plugin.
4. Copy the repository to the instance and create `/opt/relay/.env` from
   `.env.example`. Set at minimum:
   - `DATABASE_URL` (Tiger Data application role)
   - `MARKET_ADMIN_TOKEN`
   - `APIFY_TOKEN`
   - `APIFY_ACTOR_ID=SyLVZKpczziqmvvqF`
   - `MARKET_DOMAIN=market-api.relay.example`
5. Open ports 80 and 443 in the Vultr firewall.
6. From `deploy/vultr`, run:

   ```bash
   docker compose --env-file ../../.env up -d --build
   docker compose --env-file ../../.env ps
   curl -fsS "https://${MARKET_DOMAIN}/readyz"
   ```

Caddy obtains and renews the TLS certificate automatically. The API is never
published directly; only Caddy exposes ports 80/443.

### Apply the database migration once

The application role cannot run DDL. Use the Tiger Data owner URL:

```bash
MIGRATION_DATABASE_URL='postgresql://...' \
  docker compose --env-file ../../.env run --rm \
  -e MIGRATION_DATABASE_URL \
  api python -m market_intelligence.scripts.migrate
```

Migration `005_market_offer_state` backfills the current-offer table and replaces
the old full-history ranking view. Verify:

```sql
SELECT count(*) FROM market_offer_state;
SELECT count(*) FROM market_offers_current;
```

### Cut the Actor over from the tunnel

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

### Replay missed runs

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
2. Build and push the image:

   ```bash
   docker build -t registry.example.com/relay/market-api:$(git rev-parse --short HEAD) .
   docker push registry.example.com/relay/market-api:$(git rev-parse --short HEAD)
   ```

3. Create the namespace and secret:

   ```bash
   kubectl create namespace relay
   kubectl -n relay create secret generic relay-market-secrets \
     --from-env-file=.env
   kubectl -n relay create secret tls market-api-tls \
     --cert=fullchain.pem --key=privkey.pem
   ```

4. Update the image tag in `k8s.yaml`, apply it, and point DNS at the load
   balancer address:

   ```bash
   kubectl apply -f k8s.yaml
   kubectl -n relay get svc relay-market-api
   ```

The manifest runs two replicas, health checks `/readyz` and `/healthz`, an HPA
from 2 to 6 pods, and a Vultr HTTPS load balancer.

## Database choice

Keep Tiger Data for now. Vultr Managed PostgreSQL may expose the TimescaleDB
extension depending on the cluster version, but it is not consistently listed as
a supported extension. Do not migrate the canonical store without testing
`CREATE EXTENSION timescaledb`, hypertables, continuous aggregates, and retention
policies on the exact cluster. Running TimescaleDB yourself on Vultr is possible
but adds backup, upgrade, and failover work that Tiger Data already handles.

## Operational checklist

- [ ] `/readyz` returns `ready` through the public HTTPS endpoint and `checks.current_offer_state` is `ok`
- [ ] `MARKET_DOMAIN` resolves and Caddy/Vultr LB certificate is valid
- [ ] Migration 005 applied as owner; `market_offer_state` is populated
- [ ] Apify task points at the public origin, no tunnel
- [ ] Scheduled run succeeds and `relay_push.ok=true`
- [ ] Reconcile cron runs and reports duplicates, not new rows, for delivered runs
- [ ] Database connection pool stays within the Tiger plan limit across replicas
