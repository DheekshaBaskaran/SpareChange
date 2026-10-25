# Relay Market Intelligence — Shared Interface

**Owner:** Duo 1 / Person A (Marketplace & Financial Intelligence)
**Consumers:** Person B (clearing, CREAO, Hyphenate-aligned finance, Elastic Agent Builder), Duo 2 (execution/payments/frontend)
**Status:** Stable v1 contract for the `feat/market-data` branch
**Base URL (local):** `http://127.0.0.1:8080`
**Service:** `services/market-intelligence`

This document is the contract between the Market Intelligence subsystem and every other
Relay component. Consumers must use this API rather than reading provider pages, the Apify
dataset, or market tables directly.

---

## 1. Trust model (read this before using a price)

Relay distinguishes three kinds of value. They must never be conflated in the UI or in a deal.

| Kind | Where it comes from | API marker |
|---|---|---|
| **Reference price** | Public provider listings collected by Apify or a provider pricing API | `executable=false`, `trust_tier=apify_actor` or `provider_api` |
| **Executable capacity** | Authorized worker/provider reservation recorded by the execution backend | `executable=true` (never produced by a public listing) |
| **Measured execution** | Worker/Vultr/Docker telemetry and verified completion | Execution events, not market offers |

A reference price is evidence for comparison. It is **not** a promise that the listed machine
can be rented at that price when Relay needs it. The Market Intelligence service never claims
otherwise.

### Source provenance

Every observation stores:

- `provider` — canonical provider key: `vastai`, `runpod`, `akash`, `lambda`, `tensordock`.
- `source` — concrete collection channel, e.g. `vastai_api`, `runpod_graphql`, `akash_console_api`,
  `apify_actor`.
- `source_url` — human-inspectable URL for the listing/pricing page.
- `source_record_id` — provider identifier when one exists.
- `observed_at` — when the source reported the state (UTC).
- `ingested_at` — when Relay persisted it (UTC).
- `raw_hash` — SHA-256 of the normalized source record, used to detect unchanged data.
- `trust_tier` — `provider_api` or `apify_actor`.

### Collection completeness

Provider snapshots are not all equal. `apify_actor` reports `complete` per provider:

- **Vast.ai** public search returns a capped, rotating sample of about 64 offers and exposes no
  pagination. It is always `complete=false`. Vast observations are valid reference prices, but
  they cannot establish a disappearance or a first-seen listing.
- **RunPod** and **Akash** return their full advertised set unless a limit truncates it; those
  snapshots can be `complete=true`.
- Incomplete snapshots retain unseen previous offers and never emit `disappeared`. A `new` event
  is only emitted when an earlier snapshot actually covered the provider.
- **Akash** capacity is `pricing_model=bid`, `price_available=false`, and `price_per_hour=0` is a
  sentinel, not a price. Exclude unpriced capacity from price comparisons.

### Freshness

`freshness` is derived, never stored as a stale boolean:

- `fresh` — age ≤ provider TTL (default 15 min for live inventory, 6 h for advertised prices).
- `stale` — age > TTL but ≤ 4 × TTL. Returned by default with a warning; excluded from
  "current executable" comparisons.
- `expired` — older than 4 × TTL. Only returned with `include_stale=true`; never used for a deal.

`GET /v1/market/offers` returns `fresh` and `stale` records by default. Consumers that require
live data must filter on `freshness=fresh` and `executable=true`.

### Deduplication

Observation identity is `(provider, provider_offer_id, five_minute_bucket)`. A per-run content
hash suppresses unchanged records inside the re-observation window. `market_offer_state` keeps
exactly one winning row per `(provider, provider_offer_id)`, updated in the ingestion transaction;
the `market_offers_current` view reads that table. Newest observation wins; when timestamps tie,
`provider_api` outranks `apify_actor`. This keeps offer reads proportional to the number of live
offers rather than the full observation history.

Provider offer IDs are stable where the provider exposes one (Vast.ai `id`, TensorDock
`hostnode/gpu`, Lambda `instance_type:region`). RunPod pricing is advertised per GPU type and
cloud tier, so its synthetic ID is `runpod:<gpu-type-id>:<secure|community>`.

---

## 2. Canonical objects

All money is an integer in minor units (USD cents) in the API. Micro-unit fields are integers
too and exist only for analytics precision. All timestamps are ISO 8601 UTC with `Z`. IDs are
UUID strings. `null` means unknown; consumers must not invent a value.

### MarketOffer

```json
{
  "id": "8c6f0c3e-6f31-4f8b-9d3b-2b7e7d9a1c11",
  "provider": "vastai",
  "provider_offer_id": "54550274",
  "gpu_model": "GTX 1650",
  "gpu_model_normalized": "GTX 1650",
  "gpu_count": 1,
  "vram_gb": 4.0,
  "cpu_cores": 8.0,
  "ram_gb": 12.03,
  "disk_gb": 91.65,
  "region": "Oregon, US",
  "country": "US",
  "price_per_hour_minor": 5,
  "price_per_hour_micros": 47778,
  "price_per_gpu_hour_minor": 5,
  "price_per_gpu_hour_micros": 47778,
  "currency": "USD",
  "billing_scope": "per_instance_hour",
  "availability_scope": "live_inventory",
  "executable": false,
  "source": "vastai_api",
  "source_url": "https://console.vast.ai/api/v0/bundles/",
  "source_record_id": "54550274",
  "trust_tier": "provider_api",
  "freshness": "fresh",
  "observed_at": "2026-10-24T23:20:00Z",
  "expires_at": "2026-10-24T23:35:00Z",
  "ingested_at": "2026-10-24T23:21:04Z",
  "reliability": 0.9851,
  "raw_hash": "sha256:4f5d…",
  "metadata": {
    "gpu_price_per_hour_usd": 0.046667,
    "disk_price_per_hour_usd": 0.001111,
    "verification": "verified"
  }
}
```

Field rules:

- `price_per_hour_*` is the **total offer price** for the whole instance, not per GPU.
- `price_per_gpu_hour_*` is `price_per_hour_* / gpu_count`, the comparable cross-provider unit.
- `billing_scope` ∈ `per_instance_hour`, `per_gpu_hour`, `per_hour`.
- `availability_scope` ∈ `live_inventory`, `advertised`.
- `executable` is always `false` for public market data. Only authorized inventory produces `true`.
- `vram_gb` is total VRAM across the offer when the provider reports it that way.
- `metadata` is provider-specific and non-contractual. Never parse financial meaning from it.

### MarketOfferPage

```json
{
  "items": [MarketOffer],
  "next_cursor": "eyJvYnNlcnZlZF9hdCI6…",
  "generated_at": "2026-10-24T23:25:00Z",
  "filters": {"provider": "vastai", "gpu_model": "H100", "freshness": "fresh"}
}
```

Cursors are opaque and keyset-based. Never construct one; pass `next_cursor` back as `cursor`.

### PriceHistory

```json
{
  "gpu_model": "H100",
  "gpu_model_normalized": "H100",
  "provider": "vastai",
  "currency": "USD",
  "bucket": "1h",
  "from": "2026-10-18T00:00:00Z",
  "to": "2026-10-24T23:00:00Z",
  "points": [
    {
      "bucket_start": "2026-10-24T22:00:00Z",
      "sample_count": 12,
      "min_price_per_hour_micros": 1890000,
      "p25_price_per_hour_micros": 2010000,
      "median_price_per_hour_micros": 2150000,
      "p75_price_per_hour_micros": 2390000,
      "max_price_per_hour_micros": 2600000,
      "avg_price_per_hour_micros": 2183333
    }
  ],
  "trend": {
    "direction": "down",
    "change_micros": -120000,
    "change_percent": -5.29,
    "first_median_micros": 2270000,
    "last_median_micros": 2150000
  }
}
```

`bucket` ∈ `15m`, `1h`, `6h`, `1d`. Buckets are aligned to UTC. Points with no observations are
omitted, not zero-filled.

### MarketSummary

```json
{
  "generated_at": "2026-10-24T23:25:00Z",
  "window": "24h",
  "currency": "USD",
  "offers": {"total": 412, "fresh": 380, "providers": 3, "executable": 0},
  "gpus": [
    {
      "gpu_model_normalized": "H100",
      "provider_count": 2,
      "fresh_offer_count": 19,
      "median_price_per_gpu_hour_micros": 2150000,
      "min_price_per_gpu_hour_micros": 1890000,
      "change_24h_percent": -5.29
    }
  ]
}
```

### ProviderFreshness

```json
{
  "providers": [
    {
      "provider": "vastai",
      "display_name": "Vast.ai",
      "enabled": true,
      "last_attempt_at": "2026-10-24T23:21:00Z",
      "last_success_at": "2026-10-24T23:21:04Z",
      "last_error_at": null,
      "consecutive_failures": 0,
      "fresh_offer_count": 120,
      "stale_offer_count": 4,
      "oldest_fresh_observed_at": "2026-10-24T23:20:00Z",
      "last_run_id": "0b03a7c6-…",
      "state": "healthy"
    }
  ],
  "generated_at": "2026-10-24T23:25:00Z"
}
```

Provider `state` ∈ `healthy`, `degraded`, `failed`, `disabled`, `never_ingested`.

### MarketEvent

```json
{
  "event_id": "evt_...",
  "event_type": "new",
  "provider": "runpod",
  "provider_offer_id": "runpod:NVIDIA H100 PCIe:secure_cloud",
  "gpu_model": "NVIDIA H100 PCIe",
  "gpu_model_normalized": "H100",
  "price_available": true,
  "previous_price_per_hour_micros": null,
  "current_price_per_hour_micros": 2150000,
  "price_change_percent": null,
  "previous_available_gpu_count": null,
  "current_available_gpu_count": null,
  "availability_change": "appeared",
  "reason": "new_offer",
  "observed_at": "2026-10-24T23:30:00Z",
  "actor_run_id": "d7SPzmNXqN8KwweM4",
  "metadata": {"complete": true, "baseline": false, "actor_run_id": "d7SPzmNXqN8KwweM4"}
}
```

`event_type` ∈ `new`, `updated`, `disappeared`. Events are append-only and idempotent by
`event_id`. Treat `metadata.complete=false` as evidence that the provider snapshot was partial;
do not present it as proof that the whole market changed.

---

## 3. Public read endpoints

All read endpoints are unauthenticated on the local demo network and return
`Cache-Control: no-store` (market data is time-sensitive). Production should put them behind
the normal API gateway.

### `GET /v1/market/offers`

Query parameters:

| Param | Type | Default | Notes |
|---|---|---|---|
| `provider` | string | — | one of the canonical provider keys |
| `gpu_model` | string | — | normalized match, e.g. `H100` |
| `gpu_match` | enum | `exact` | `exact` or `contains` |
| `min_vram_gb` | number | — | total VRAM lower bound |
| `max_price_per_gpu_hour_minor` | int | — | budget ceiling in cents/GPU-hour |
| `region` | string | — | case-insensitive contains |
| `country` | string | — | two-letter country code |
| `include_unpriced` | bool | `false` | include Akash bid capacity and other records without a comparable price |
| `availability_scope` | enum | — | `live_inventory` or `advertised` |
| `executable` | bool | — | public market data is `false` |
| `freshness` | enum | `fresh,stale` | comma-separated |
| `include_stale` | bool | `false` | include `stale` and `expired` observations |
| `sort` | enum | `price` | `price`, `observed_at`, `reliability` |
| `limit` | int | 50 | 1–200 |
| `cursor` | string | — | opaque keyset cursor |

### `GET /v1/market/offers/{id}`

Returns one current offer or `404 offer_not_found`.

### `GET /v1/market/history`

Query parameters: `gpu_model` (required), `provider` (optional), `bucket` (`15m` default),
`from` (default `to - 24h`), `to` (default now), `currency` (`USD`). Maximum range is 90 days.

### `GET /v1/market/summary`

Query parameters: `window` ∈ `1h`, `24h`, `7d`, `30d` (default `24h`), `limit` (number of GPUs,
default 20, max 100), `provider` (optional).

### `GET /v1/market/providers`

Returns the provider registry with collection mode and current freshness state.

### `GET /v1/market/freshness`

Provider health plus counts. Person B should call this before presenting a deal that depends on
market prices.

### `GET /v1/market/events`

Returns the most recent cross-run change events, newest first.

| Param | Type | Default | Notes |
|---|---|---|---|
| `provider` | string | — | canonical provider key |
| `event_type` | enum | — | `new`, `updated`, `disappeared` |
| `gpu_model` | string | — | normalized contains match |
| `since` | ISO 8601 | — | only events observed at or after this time |
| `limit` | int | 100 | 1–200 |

Response is `{items: [MarketEvent], generated_at}`. Vast.ai never produces disappearance events
because its public snapshot is sampled; see the completeness rules above.

---

## 4. Admin ingestion endpoints (Person A only)

Admin routes require `Authorization: Bearer <MARKET_ADMIN_TOKEN>`. They are not part of the
consumer contract but are documented so scheduling and Apify can be wired up.

### `POST /v1/admin/ingestion/runs`

Request:

```json
{
  "provider": "vastai",
  "mode": "direct",
  "limit_per_provider": 200,
  "idempotency_key": "nightly-2026-10-24T23:00Z",
  "apify_actor_id": "optional-actor-id",
  "apify_input": {}
}
```

- `provider` is one canonical key or `all`. `all` fans out into one isolated run per provider.
- `mode=direct` calls provider APIs from the service.
- `mode=apify` starts the configured Apify Actor, waits up to `apify_timeout_seconds`, downloads
  the dataset, and ingests it. Requires `APIFY_TOKEN` and `APIFY_ACTOR_ID` (or `apify_actor_id`).
- `mode=items` ingests a caller-supplied `items` array through the same validator. This is how an
  Actor dataset can be pushed directly; each item must match `MarketOffer` source fields.

The call is synchronous for direct/items runs. Apify runs are capped by `apify_timeout_seconds`.

Response `200`:

```json
{
  "runs": [
    {"run_id": "…", "provider": "vastai", "status": "succeeded", "inserted": 42}
  ],
  "idempotency_key": "nightly-2026-10-24T23:00Z"
}
```

`idempotency_key` is unique per provider. Repeating it returns the existing run instead of
re-fetching.

### `GET /v1/admin/ingestion/runs/{id}`

Returns counts (`fetched`, `inserted`, `duplicate`, `rejected`, `errors`), adapter diagnostics,
start/finish times, and status (`running`, `succeeded`, `partial`, `failed`, `skipped`). A
`skipped` run means a credential-gated source was not configured; it is not a failure.

### Additional Actor contract

`mode=items` is the supported push path and uses the same observation-level dedupe ledger. The
Apify Actor's dataset item keys are documented in `apify/gpu-market-intelligence/README.md`.
There is no separate per-run item endpoint.

---

## 5. Errors

```json
{
  "error": {
    "code": "invalid_gpu_model",
    "message": "gpu_model is required",
    "details": {"field": "gpu_model"},
    "request_id": "req_01J…"
  }
}
```

Stable codes: `invalid_request`, `invalid_cursor`, `invalid_gpu_model`, `invalid_time_range`,
`offer_not_found`, `provider_not_found`, `run_not_found`, `unauthorized`, `forbidden`,
`rate_limited`, `source_unavailable`, `source_credentials_missing`, `database_unavailable`,
`internal_error`.

Provider failures never leak API keys or full upstream response bodies. Diagnostics contain the
provider, HTTP status, a short message, and the run ID.

---

## 6. Integration rules for consumers

**Person B (clearing / CREAO / Hyphenate / Elastic):**
1. Read offers from `/v1/market/offers` and history from `/v1/market/history` only.
2. Treat `executable=false` offers as reference prices; never allocate against them as if the
   capacity were reserved.
3. Persist the `offer_id` and `observed_at` used in a decision so the decision is reproducible.
4. Do not write to market tables, run market migrations, or call provider adapters.
5. The Elastic investigator may index these API responses, but canonical IDs and authoritative
   amounts stay in Tiger Data.

**Duo 2 (execution/payments/frontend):**
1. Use the same read API for price display and baseline comparisons.
2. Mark reference prices in the UI with their `source`, `observed_at`, and `freshness`.
3. Send verified execution evidence to the execution backend, not to the market service.
4. Do not expose admin ingestion routes through the public frontend.

**Person A:**
1. Own the market schema, adapters, ingestion, and analytics.
2. Never write to deals, ledger entries, invoices, approvals, or settlement tables.
3. Publish OpenAPI at `/openapi.json` and keep `contracts/market-intelligence.openapi.json` current.
4. Keep every observation append-only; corrections are new observations with a new source timestamp.

---

## 7. Configuration

Environment variables (see `services/market-intelligence/.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Tiger Data PostgreSQL URL (`sslmode=require`) |
| `MARKET_ADMIN_TOKEN` | yes | Bearer token for admin ingestion routes |
| `APIFY_TOKEN` | for actor mode | Apify API token |
| `APIFY_ACTOR_ID` | for actor mode | Actor ID or `username~actor-name` |
| `VASTAI_API_KEY` | no | Optional; public bundle search works without it |
| `RUNPOD_API_KEY` | no | Optional; raises GraphQL rate limits |
| `LAMBDA_API_KEY` | for Lambda | Lambda Cloud API key |
| `TENSORDOCK_API_KEY` | for TensorDock | TensorDock v2 Bearer token |
| `MARKET_FRESH_TTL_SECONDS` | no | Default 900 (live) / 21600 (advertised) |
| `MARKET_HTTP_TIMEOUT_SECONDS` | no | Default 20 |
| `MARKET_MAX_INGEST_ITEMS` | no | Default 1000 per provider/run |

Credentials are read from the environment only. They are never returned by the API, logged, or
committed.
