# Relay GPU Market Intelligence Actor

Apify Actor that collects permitted public GPU listings and emits records in Relay's canonical
market-observation shape.

- **Vast.ai** — public bundle search (`verified`, `rentable`, sorted by all-in hourly price).
- **RunPod** — public GraphQL GPU types, one advertised offer per cloud tier.
- **Lambda** — instance-types API; requires `LAMBDA_API_KEY` as an Actor environment variable.
- **TensorDock** — v2 hostnodes API; requires `TENSORDOCK_API_KEY` as an Actor environment variable.

Public listings are **reference prices**, not executable capacity. Every item has
`executable=false`, a source URL, an observation timestamp, and a trust tier.

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

Deployment requires an authenticated Apify CLI session. The Actor in this repository was built as
version `0.1.3` and run remotely; see the service README verification table.

## Ingestion

Two supported paths:

1. **Apify API mode:** backend calls the Actor with `APIFY_TOKEN` + `APIFY_ACTOR_ID`, downloads the
   dataset, and ingests it (`mode=apify`).
2. **Push mode:** download the dataset and POST items to
   `/v1/admin/ingestion/runs` with `mode=items`. This is how the remote verification run was
   ingested.

Credentials belong in Actor environment variables or the backend environment, never in dataset
items or the repository.
