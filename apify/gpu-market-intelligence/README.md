# Relay GPU Market Intelligence Actor

Apify Actor that collects permitted public GPU listings and emits records in Relay's canonical
market-observation shape.

- **Vast.ai** — public bundle search (`verified`, `rentable`, sorted by all-in hourly price).
- **RunPod** — public GraphQL GPU types, one advertised offer per cloud tier.
- **Lambda** — instance-types API; requires `LAMBDA_API_KEY` as an Actor environment variable.
- **TensorDock** — v2 hostnodes API; requires `TENSORDOCK_API_KEY` as an Actor environment variable.

Public listings are **reference prices**, not executable capacity. Every item has
`executable=false`, a source URL, an observation timestamp, and a trust tier.

Vast.ai's public search returns a capped, rotating sample of about 64 offers and exposes no
pagination; two identical requests seconds apart return different IDs. The collector therefore
marks every Vast snapshot `complete=false`. Its observations are valid sampled reference prices,
but the Actor never infers a Vast disappearance or a first-seen "new" listing from them.
RunPod and Akash snapshots can be complete, so their real changes still emit events.

## Input

```json
{
  "providers": ["vastai", "runpod"],
  "maxItemsPerProvider": 200,
  "minGpuMemoryGb": 0,
  "includeRawPayload": true
}
```

`providers` accepts `vastai`, `runpod`, `lambda`, `tensordock`. Unknown providers are ignored.
A provider whose key is missing is reported as `skipped` in the `SUMMARY` key-value store; it does
not fail the whole run.

## Output

One dataset item per normalized offer:

```json
{
  "provider": "vastai",
  "provider_offer_id": "54550274",
  "gpu_model": "GTX 1650",
  "gpu_model_normalized": "GTX 1650",
  "gpu_count": 1,
  "vram_gb": 4,
  "cpu_cores": 8,
  "ram_gb": 11.75,
  "disk_gb": 91.65,
  "region": "Oregon, US",
  "country": "US",
  "price_per_hour_usd": "0.047778",
  "currency": "USD",
  "billing_scope": "per_instance_hour",
  "availability_scope": "live_inventory",
  "executable": false,
  "reliability": 0.9851,
  "source": "vastai_api",
  "source_url": "https://console.vast.ai/api/v0/bundles/",
  "source_record_id": "54550274",
  "trust_tier": "apify_actor",
  "observed_at": "2026-10-24T23:28:28.307Z",
  "raw_payload": {},
  "metadata": {}
}
```

The backend's `actor_item_to_observation` validates this shape, forces
`trust_tier=apify_actor`, and ingests it through the same dedupe pipeline as direct adapters.

## Run locally

```bash
npm install
APIFY_LOCAL_STORAGE_DIR=./storage node src/main.js
```

Local runs read `storage/key_value_stores/default/INPUT.json` and write the dataset under
`storage/datasets/default/`.

## Deploy

```bash
npx apify-cli push --force
npx apify-cli call SyLVZKpczziqmvvqF \
  --input-file input.json --output-dataset
```

Deployment requires an authenticated Apify CLI session. The current deployed build is `1.0.7`
(Actor `SyLVZKpczziqmvvqF`); see the service README verification table. A failed relay push now
produces a `partial` summary and leaves state unchanged instead of failing the collection.

## Change detection

The Actor keeps the previous per-provider offer state in the named key-value store `market-state`
under `MARKET_STATE` (configurable with `stateKey`). It emits `new`, `updated`, and `disappeared`
records to the `events` dataset only when the comparison is trustworthy:

- `updated` is emitted for a previously seen offer whose price or capacity changed beyond
  `priceChangeThresholdPercent`.
- `disappeared` requires a complete current snapshot and a non-empty result.
- `new` requires evidence that an earlier snapshot covered the provider. A source that has never
  produced a complete snapshot cannot assert that an unseen ID is a new listing.

With `detectChanges=false` the Actor skips state and events. `emitBaselineEvents=true` emits one
`new` event per item on the first run.

## Ingestion

Three supported paths:

1. **Direct push:** set `pushToRelay=true`, `relayIngestUrl`, and the `RELAY_INGEST_TOKEN`
   environment variable. The Actor POSTs each provider's offers to `/v1/admin/ingestion/runs`
   (`mode=items`) and its events to `/v1/admin/market/events`, using
   `apify:<runId>:<provider>` as the idempotency key.
2. **Webhook / replay:** `POST /v1/admin/ingestion/apify-webhook` downloads the run's offers and
   its named `events` dataset, then inserts both idempotently. A relay outage therefore does not
   lose the collection: the Actor keeps its dataset and the backend can replay the run later.
   `python -m market_intelligence.scripts.reconcile_apify` replays recent successful runs and is
   intended for cron.
3. **Apify API mode:** the backend calls the Actor with `APIFY_TOKEN` + `APIFY_ACTOR_ID`, downloads
   the dataset, and ingests it (`mode=apify`).

A failed relay push sets the run summary to `partial` but does **not** fail the Actor or save
change-detection state. The next run can recompute undelivered events, while the stored dataset
remains available for replay.

Credentials belong in Actor environment variables or the backend environment, never in dataset
items or the repository.
