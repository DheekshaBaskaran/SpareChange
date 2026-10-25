-- Relay Market Intelligence schema (Duo 1 / Person A)
-- Canonical relational + time-series store: Tiger Data (TimescaleDB).
-- Apply as the database owner. The application role is intentionally not granted DDL.

BEGIN;

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_sources (
    provider text PRIMARY KEY,
    display_name text NOT NULL,
    collection_mode text NOT NULL,
    trust_tier text NOT NULL CHECK (trust_tier IN ('provider_api', 'apify_actor', 'manual')),
    base_url text NOT NULL,
    freshness_ttl_seconds integer NOT NULL CHECK (freshness_ttl_seconds > 0),
    advertised_ttl_seconds integer NOT NULL CHECK (advertised_ttl_seconds > 0),
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO market_sources (
    provider, display_name, collection_mode, trust_tier, base_url,
    freshness_ttl_seconds, advertised_ttl_seconds
) VALUES
    ('vastai', 'Vast.ai', 'provider_api+apify_actor', 'provider_api',
     'https://console.vast.ai/api/v0/bundles/', 900, 21600),
    ('runpod', 'RunPod', 'provider_api+apify_actor', 'provider_api',
     'https://api.runpod.io/graphql', 900, 21600),
    ('lambda', 'Lambda', 'provider_api', 'provider_api',
     'https://cloud.lambdalabs.com/api/v1/instance-types', 900, 21600),
    ('tensordock', 'TensorDock', 'provider_api', 'provider_api',
     'https://dashboard.tensordock.com/api/v2/hostnodes', 900, 21600)
ON CONFLICT (provider) DO NOTHING;

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id uuid PRIMARY KEY,
    provider text NOT NULL REFERENCES market_sources(provider),
    adapter text NOT NULL,
    trigger text NOT NULL DEFAULT 'api',
    mode text NOT NULL DEFAULT 'direct',
    status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped')),
    idempotency_key text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    fetched_count integer NOT NULL DEFAULT 0,
    inserted_count integer NOT NULL DEFAULT 0,
    duplicate_count integer NOT NULL DEFAULT 0,
    rejected_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    request_id text,
    diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (provider, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ingestion_runs_started_at_idx
    ON ingestion_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS market_observations (
    id uuid NOT NULL,
    provider text NOT NULL REFERENCES market_sources(provider),
    provider_offer_id text NOT NULL,
    gpu_model text NOT NULL,
    gpu_model_normalized text NOT NULL,
    gpu_count smallint NOT NULL CHECK (gpu_count > 0),
    vram_gb numeric(10, 2),
    cpu_cores numeric(10, 2),
    ram_gb numeric(12, 2),
    disk_gb numeric(12, 2),
    region text,
    country char(2),
    price_per_hour numeric(20, 6) NOT NULL CHECK (price_per_hour >= 0),
    currency char(3) NOT NULL DEFAULT 'USD',
    billing_scope text NOT NULL CHECK (billing_scope IN ('per_instance_hour', 'per_gpu_hour', 'per_hour')),
    availability_scope text NOT NULL CHECK (availability_scope IN ('live_inventory', 'advertised')),
    executable boolean NOT NULL DEFAULT false,
    reliability numeric(6, 4),
    source text NOT NULL,
    source_url text,
    source_record_id text,
    trust_tier text NOT NULL CHECK (trust_tier IN ('provider_api', 'apify_actor', 'manual')),
    content_hash text NOT NULL,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_at timestamptz NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    run_id uuid REFERENCES ingestion_runs(id) ON DELETE SET NULL,
    PRIMARY KEY (id, observed_at)
);

SELECT create_hypertable(
    'market_observations',
    'observed_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

CREATE INDEX IF NOT EXISTS market_observations_gpu_time_idx
    ON market_observations (gpu_model_normalized, observed_at DESC);

CREATE INDEX IF NOT EXISTS market_observations_provider_time_idx
    ON market_observations (provider, observed_at DESC);

CREATE INDEX IF NOT EXISTS market_observations_offer_idx
    ON market_observations (provider, provider_offer_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS market_observations_run_idx
    ON market_observations (run_id);

-- Deduplication ledger. Kept separate because Timescale unique indexes must
-- include the hypertable time dimension, and we want to retain the exact
-- source timestamp in market_observations rather than truncating it.
CREATE TABLE IF NOT EXISTS market_observation_keys (
    provider text NOT NULL,
    provider_offer_id text NOT NULL,
    bucket_start timestamptz NOT NULL,
    observation_id uuid NOT NULL,
    content_hash text NOT NULL,
    run_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_offer_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS market_observation_keys_created_idx
    ON market_observation_keys (created_at);

CREATE TABLE IF NOT EXISTS provider_health (
    provider text PRIMARY KEY REFERENCES market_sources(provider),
    last_attempt_at timestamptz,
    last_success_at timestamptz,
    last_error_at timestamptz,
    last_error text,
    consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    last_run_id uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One current row per provider offer. Provider API observations outrank the
-- Apify actor when both observed the same offer in the same window.
CREATE OR REPLACE VIEW market_offers_current AS
WITH ranked AS (
    SELECT
        o.*,
        s.display_name,
        s.freshness_ttl_seconds,
        s.advertised_ttl_seconds,
        ROW_NUMBER() OVER (
            PARTITION BY o.provider, o.provider_offer_id
            ORDER BY o.observed_at DESC,
                     (o.trust_tier = 'provider_api') DESC,
                     o.ingested_at DESC
        ) AS rn
    FROM market_observations o
    JOIN market_sources s ON s.provider = o.provider
)
SELECT
    id,
    provider,
    provider_offer_id,
    gpu_model,
    gpu_model_normalized,
    gpu_count,
    vram_gb,
    cpu_cores,
    ram_gb,
    disk_gb,
    region,
    country,
    price_per_hour,
    currency,
    billing_scope,
    availability_scope,
    executable,
    reliability,
    source,
    source_url,
    source_record_id,
    trust_tier,
    content_hash AS raw_hash,
    raw_payload,
    metadata,
    observed_at,
    ingested_at,
    run_id,
    display_name,
    CASE
        WHEN availability_scope = 'advertised' THEN advertised_ttl_seconds
        ELSE freshness_ttl_seconds
    END AS effective_ttl_seconds,
    ROUND(price_per_hour * 100)::bigint AS price_per_hour_minor,
    ROUND(price_per_hour * 1000000)::bigint AS price_per_hour_micros,
    ROUND(price_per_hour * 100 / gpu_count)::bigint AS price_per_gpu_hour_minor,
    ROUND(price_per_hour * 1000000 / gpu_count)::bigint AS price_per_gpu_hour_micros,
    observed_at + make_interval(secs => CASE
        WHEN availability_scope = 'advertised' THEN advertised_ttl_seconds
        ELSE freshness_ttl_seconds
    END) AS expires_at,
    CASE
        WHEN observed_at > now() - make_interval(secs => CASE
            WHEN availability_scope = 'advertised' THEN advertised_ttl_seconds
            ELSE freshness_ttl_seconds
        END) THEN 'fresh'
        WHEN observed_at > now() - make_interval(secs => 4 * CASE
            WHEN availability_scope = 'advertised' THEN advertised_ttl_seconds
            ELSE freshness_ttl_seconds
        END) THEN 'stale'
        ELSE 'expired'
    END AS freshness
FROM ranked
WHERE rn = 1;

INSERT INTO schema_migrations (version) VALUES ('001_market_schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
