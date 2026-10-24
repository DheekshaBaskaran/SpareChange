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
- **Tiger Data schema** with a hypertable, dedupe ledger, continuous hourly aggregate, retention
  and refresh policies, current-offer view, ingestion runs, and provider health.
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
- `GET /healthz`, `GET /readyz`

Admin ingestion (`Authorization: Bearer $MARKET_ADMIN_TOKEN`):

- `POST /v1/admin/ingestion/runs` with `provider`, `mode` (`direct` | `apify` | `items`),
  `limit_per_provider`, optional `items`, `idempotency_key`, `apify_actor_id`, `apify_input`.
- `GET /v1/admin/ingestion/runs/{run_id}`

`provider=all` fans out into one isolated run per provider and returns a `runs` array.
`mode=items` is how an Actor dataset is pushed through the same validator and dedupe pipeline.

## Data semantics

- Public listings are **reference prices** with `executable=false`. Only authorized inventory can
  create executable capacity.
- Every observation carries provider, source channel, source URL, source record ID, observed and
  ingested timestamps, raw hash, and trust tier.
- Dedupe identity is `(provider, provider_offer_id, 5-minute bucket)`. An unchanged content hash
  inside `MARKET_REOBSERVE_SECONDS` is recorded as a duplicate instead of a new observation. The
  current-offer view returns the newest observation per identity, with provider API winning ties.
- Freshness is computed from provider TTL: `fresh`, `stale`, `expired`. Consumers that need live
  prices must filter `freshness=fresh`; history intentionally includes older observations.
- Price fields: total offer price (`price_per_hour_*`) and normalized comparable price
  (`price_per_gpu_hour_*`), both in integer minor units/micros, plus a six-decimal DB value.

## Verification status

| Capability | Status | Evidence |
|---|---|---|
| Vast.ai live collection | Verified | 100+ live offers ingested into Tiger Cloud (109 current at final check) |
| RunPod live collection | Verified | 46 current advertised offers across GPU types |
| Apify Actor build + deploy | Verified | Actor `relay-gpu-market-intelligence` (`SyLVZKpczziqmvvqF`) built `0.1.3` |
| Apify Actor remote run | Verified | 60 items (Vast.ai + RunPod) plus a 4-item latest-build run, ingested through `mode=items` |
| Apify API mode (`mode=apify`) | Implemented, blocked | No `APIFY_TOKEN` available locally; the Actor itself and the dataset ingestion path are verified |
| Dedupe / freshness / history / summary | Verified | Integration tests and live API queries on Tiger Cloud |
| Tiger Cloud (`relay-market-data`) | Verified | PostgreSQL 18.6 + TimescaleDB 2.31; 203 observations, 155 current offers, 66 hourly CAGG rows, 42 tests passing |
| Local TimescaleDB migrations | Verified | Same migrations on a `timescaledb:latest-pg17` container, used as a repeatable harness |
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

## Boundaries

- Own: market schema, adapters, ingestion, analytics, `/v1/market/*`.
- Do not touch: deals, ledger entries, invoices, approvals, CREAO workflows, Elastic agent,
  execution workers, Solana/x402 settlement, frontend.
- Elastic indexes selected records read-only; Tiger Data stays canonical.
