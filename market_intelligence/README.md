# Relay Market Intelligence

Duo 1 / Person A subsystem for Relay's GPU marketplace.

This service is the **only writer to Relay market tables** and the **only supported source of
normalized market offers**. Person B (clearing, CREAO, Hyphenate-aligned finance, Elastic
investigator) and Duo 2 consume its read API; they do not scrape providers or write market data.

The shared contract lives in [docs/MARKET_INTELLIGENCE_INTERFACE.md](../docs/MARKET_INTELLIGENCE_INTERFACE.md)
and [contracts/market-intelligence.openapi.json](../contracts/market-intelligence.openapi.json).

## What is implemented

- **Apify Actor** (`apify/gpu-market-intelligence`) collecting live public listings from Vast.ai
  and RunPod, with credential-gated Lambda and TensorDock collectors. Emits normalized records
  with source URL, observation timestamp, raw payload, and trust tier.
- **Provider adapters** for Vast.ai (public bundle search), RunPod (public GraphQL pricing),
  Lambda (keyed instance-types API), and TensorDock (keyed v2 hostnodes API).
- **Normalization** of GPU families, VRAM, CPU/RAM/disk, region/country, per-instance and
  per-GPU pricing, and validation of every record.
- **Tiger Data schema** with an append-only hypertable, dedupe ledger, continuous hourly
  aggregate, retention and refresh policies, one-row-per-offer current state, ingestion runs,
  provider health, and idempotent market events.
- **Current-offer read model** (`market_offer_state`) updated in the ingestion transaction, so
  offer reads no longer rank the entire observation history.
- **Ingestion pipeline** with per-provider failure isolation, retries with backoff, run
  idempotency keys, five-minute observation buckets, content hashes, and partial-run accounting.
- **Historical analytics** (min/p25/median/p75/max/avg buckets, trend) and a current-market
  summary with freshness and provider health.
- **FastAPI read API** with keyset pagination and stable error envelopes.

## Layout

```
market_intelligence/
  main.py                 FastAPI app, lifespan, errors, CORS, request IDs
  runtime.py              selector-event-loop launcher (needed by psycopg on Windows)
  config.py               env-backed settings
  repository.py           all Tiger Data reads/writes
  api/                    market, admin ingestion, health routes
  core/                   normalization, freshness, ingestion, analytics
  providers/              Vast.ai, RunPod, Lambda, TensorDock, Apify actor client
  scripts/                migrate, bootstrap role, run ingestion, export OpenAPI
migrations/market_intelligence/
  001_market_schema.sql
  002_market_aggregates.sql
  003_provider_policy_capacity.sql
  004_market_events.sql
  005_market_offer_state.sql
tests/                    unit + live-database integration tests
apify/gpu-market-intelligence/   deployable Actor
```

## Local setup

```bash
py -3 -m venv .venv
./.venv/Scripts/python.exe -m pip install -e ".[dev]"
cp .env.example .env        # then fill DATABASE_URL / MARKET_ADMIN_TOKEN
```

Do not commit `.env`. Provider keys are optional except Lambda and TensorDock, whose adapters
report `source_credentials_missing` and skip until configured.

### Run the API

```bash
./.venv/Scripts/python.exe -m market_intelligence.runtime --host 127.0.0.1 --port 8099
```

On Windows, this launcher is required: psycopg's async pool cannot use uvicorn's default
ProactorEventLoop. `market_intelligence/runtime.py` creates a selector loop explicitly. On Linux
the same command works.

Check readiness, then browse `/docs`:

```bash
curl http://127.0.0.1:8099/readyz
```

### Apply Tiger Data migrations

Migrations need an owner URL, not the least-privilege app role.

```bash
MIGRATION_DATABASE_URL="$TIGER_OWNER_URL" \
  ./.venv/Scripts/python.exe -m market_intelligence.scripts.migrate

MIGRATION_DATABASE_URL="$TIGER_OWNER_URL" \
RELAY_DB_PASSWORD="$APP_DB_PASSWORD" \
  ./.venv/Scripts/python.exe -m market_intelligence.scripts.bootstrap_role
```

Then set `DATABASE_URL` to the app role, e.g.
`postgresql://relay_market_app:...@SERVICE.tsdb.cloud.timescale.com:PORT/tsdb?sslmode=require`.

The schema is safe to apply to Tiger Cloud: `CREATE EXTENSION IF NOT EXISTS timescaledb`,
hypertable creation with `if_not_exists`, continuous aggregate, refresh/retention policies, and a
pruning job. The migration runner records applied files in `schema_migrations`.

### Ingest live market data

```bash
# One provider
./.venv/Scripts/python.exe -m market_intelligence.scripts.run_ingestion --provider vastai --limit 200

# Every configured provider (Lambda/TensorDock skip without keys)
./.venv/Scripts/python.exe -m market_intelligence.scripts.run_ingestion --provider all --limit 200

# Apify Actor mode (requires APIFY_TOKEN and APIFY_ACTOR_ID)
./.venv/Scripts/python.exe -m market_intelligence.scripts.run_ingestion --provider vastai --mode apify
```

Direct adapters do not require Apify. The Actor is an additional collection channel and is
verified end-to-end against the same ingestion contract.

## API

Read endpoints (no auth, `Cache-Control: no-store`):

- `GET /v1/market/offers` — filters: `provider`, `gpu_model`, `gpu_match`, `min_vram_gb`,
  `max_price_per_gpu_hour_minor`, `region`, `country`, `availability_scope`, `executable`,
  `freshness`, `include_stale`, `sort`, `limit`, `cursor`
- `GET /v1/market/offers/{id}`
- `GET /v1/market/history?gpu_model=H100&bucket=1h&from=...&to=...`
- `GET /v1/market/summary?window=24h`
- `GET /v1/market/providers`
- `GET /v1/market/freshness`
- `GET /v1/market/events` — filters: `provider`, `event_type`, `gpu_model`, `since`, `limit`
- `GET /healthz`, `GET /readyz` — readiness includes `checks.current_offer_state`, which is
  `missing` until migration 005 is applied.

Admin ingestion (`Authorization: Bearer $MARKET_ADMIN_TOKEN`):

- `POST /v1/admin/ingestion/runs` with `provider`, `mode` (`direct` | `apify` | `items`),
  `limit_per_provider`, optional `items`, `idempotency_key`, `apify_actor_id`, `apify_input`.
- `POST /v1/admin/ingestion/apify-webhook` with `eventData.actorRunId`; replays offers and events
  from a completed run and is safe to call repeatedly.
- `POST /v1/admin/market/events` for Actor event batches.
- `GET /v1/admin/ingestion/runs/{run_id}`

`provider=all` fans out into one isolated run per provider and returns a `runs` array.
`mode=items` is how an Actor dataset is pushed through the same validator and dedupe pipeline.

## Data semantics

- Public listings are **reference prices** with `executable=false`. Only authorized inventory can
  create executable capacity.
- Every observation carries provider, source channel, source URL, source record ID, observed and
  ingested timestamps, raw hash, and trust tier.
- Dedupe identity is `(provider, provider_offer_id, 5-minute bucket)`. An unchanged content hash
  inside `MARKET_REOBSERVE_SECONDS` is recorded as a duplicate instead of a new observation.
- `market_offer_state` holds exactly one winning row per `(provider, provider_offer_id)` and is
  updated in the same transaction as the observations. The `market_offers_current` view reads that
  table, with provider API winning equal-timestamp ties.
- Freshness is computed from provider TTL: `fresh`, `stale`, `expired`. Consumers that need live
  prices must filter `freshness=fresh`; history intentionally includes older observations.
- Price fields: total offer price (`price_per_hour_*`) and normalized comparable price
  (`price_per_gpu_hour_*`), both in integer minor units/micros, plus a six-decimal DB value.

## Verification status

| Capability | Status | Evidence |
|---|---|---|
| Vast.ai live collection | Verified | 64-offer sampled snapshots; 150 fresh + 99 stale Vast offers in Tiger Cloud |
| RunPod live collection | Verified | 61 current advertised offers across GPU types |
| Akash capacity | Verified | 27 fresh unpriced bid-capacity records |
| Apify Actor build + deploy | Verified | Actor `relay-gpu-market-intelligence` (`SyLVZKpczziqmvvqF`) built `1.0.8` with retry/backoff on 5xx |
| Apify scheduled run | Verified | Schedule `relay-gpu-market-every-30m` (`*/30 * * * *` UTC) fired at 02:00Z; run `xqRyiSh8bWOy1zW94` succeeded with 137 offers, 17 events, `relay_push.ok=true`, no warnings |
| Relay push resilience | Verified | A loca.lt `503 Tunnel Unavailable` failed three runs (00:47-01:00Z); 1.0.8 retries 5xx with backoff and records an incomplete push as `partial` instead of failing the run, leaving state unsaved so the next run recomputes undelivered events |
| Actor push resilience + webhook replay | Verified | Offers + named events dataset replayed idempotently; duplicate replay inserted 0 observations/events |
| Apify API mode (`mode=apify`) | Implemented | Token is configured; dataset replay was verified through the webhook path |
| Dedupe / freshness / history / summary / events | Verified | Integration tests and live API queries on Tiger Cloud |
| Tiger Cloud (`relay-market-data`) | Verified | PostgreSQL 18.6 + TimescaleDB, migrations 001-005 applied; 611 current offers across Vast (519), RunPod (64) and Akash (28) |
| Current-offer state table | Verified live | Migration 005 applied as `tsdbadmin` and backfilled 564 rows; `market_offers_current` now reads state. Plan time dropped from 2.48 ms / 121 buffers to 0.35 ms / 55 buffers on the same data |
| Un-migrated deployment safety | Verified | Before 005 was applied, ingestion succeeded and recorded `current_offer_state=skipped` (64 Vast, 44 RunPod, 28 Akash) instead of failing, and `/readyz` reported the missing migration; after applying it, `/readyz` flips to `ok` without a restart |
| Missed-run replay | Verified | Run `A9FKHWPJJ0fCTwziX` failed to push (tunnel 503) and was replayed: 136 items, 8 duplicate events, 0 failures |
| Local TimescaleDB migrations | Verified | All five migrations on `timescaledb:latest-pg17`; 51 Python tests pass |
| Vultr deployment assets | Implemented, not deployed | `Dockerfile`, Compose + Caddy, and VKE/Kubernetes manifest; requires Vultr account and DNS |
| Lambda adapter | Implemented, blocked | Requires `LAMBDA_API_KEY` |
| TensorDock adapter | Implemented, blocked | Requires `TENSORDOCK_API_KEY` |

The Tiger Cloud service `relay-market-data` is the canonical target. The local container remains a
test harness for offline work; `.env` selects whichever database the service should use.

## Tests

```bash
./.venv/Scripts/python.exe -m pytest
```

Unit tests cover normalization, pricing, freshness, and all provider mappings. Integration tests
exercise the real Tiger/Timescale connection, dedupe, history, summary, freshness, admin auth, and
readiness. Tests skip or fail clearly if `DATABASE_URL` is not configured.

## Deployment

A single Vultr instance with Docker Compose + Caddy is documented in
[deploy/vultr/README.md](../deploy/vultr/README.md), along with the VKE/Kubernetes
manifest. Tiger Data remains the canonical database.  Migration `005_market_offer_state`
must be applied with an owner URL before the new read model is available; it is applied on
  Tiger Cloud, so a fresh environment is the only place it can regress. Until it runs the
  service stays up: ingestion skips state upserts, `/readyz` reports
  `current_offer_state: missing`, and reads fall back to the legacy view.

## Relay outages

While the API is reachable only through a localhost tunnel, the tunnel is the single
point of failure for Actor pushes. `loca.lt` answers `503 Tunnel Unavailable` when the
tunnel client is down or reconnecting, which is what failed the 00:47-01:00Z runs.
Two mechanisms keep that from losing data:

- The Actor retries 5xx/429 responses with exponential backoff, then records the push
  as `partial` and leaves change-detection state unsaved, so the next run recomputes any
  event that was not delivered.
- `python -m market_intelligence.scripts.reconcile_apify` replays recent successful runs
  through `/v1/admin/ingestion/apify-webhook`. Both offers and events are idempotent, so
  re-running it only reports duplicates. A full run can take more than two minutes over a
  tunnel, so raise `--timeout` (default 300s) rather than retrying blindly:

  ```bash
  APIFY_TOKEN=... APIFY_ACTOR_ID=SyLVZKpczziqmvvqF MARKET_ADMIN_TOKEN=... \
    RELAY_API_URL=https://relay-market-rj.loca.lt \
    ./.venv/Scripts/python.exe -m market_intelligence.scripts.reconcile_apify --limit 5 --timeout 420
  ```

Run it after any failed push. Pointing the task at the Vultr deployment removes the
tunnel from the path entirely.

## Boundaries

- Own: market schema, adapters, ingestion, analytics, `/v1/market/*`.
- Do not touch: deals, ledger entries, invoices, approvals, CREAO workflows, Elastic agent,
  execution workers, Solana/x402 settlement, frontend.
- Elastic indexes selected records read-only; Tiger Data stays canonical.
