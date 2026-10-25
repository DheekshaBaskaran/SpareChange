-- Current-offer state.
--
-- market_observations is append-only and grows forever (subject to retention).
-- Ranking it on every read is fine for a demo but becomes a full scan as history
-- accumulates. Keep one row per provider offer here, updated in the ingestion
-- transaction, and let the existing view read this small table.

BEGIN;

CREATE TABLE IF NOT EXISTS market_offer_state (
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
    price_available boolean NOT NULL DEFAULT true,
    pricing_model text NOT NULL DEFAULT 'fixed',
    currency char(3) NOT NULL DEFAULT 'USD',
    billing_scope text NOT NULL,
    availability_scope text NOT NULL,
    executable boolean NOT NULL DEFAULT false,
    available_gpu_count integer,
    capacity_scope text NOT NULL DEFAULT 'offer',
    reliability numeric(6, 4),
    source text NOT NULL,
    source_url text,
    source_record_id text,
    trust_tier text NOT NULL,
    content_hash text NOT NULL,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_at timestamptz NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    run_id uuid REFERENCES ingestion_runs(id) ON DELETE SET NULL,
    PRIMARY KEY (provider, provider_offer_id)
);

CREATE INDEX IF NOT EXISTS market_offer_state_gpu_price_idx
    ON market_offer_state (gpu_model_normalized, price_per_hour);

CREATE INDEX IF NOT EXISTS market_offer_state_provider_time_idx
    ON market_offer_state (provider, observed_at DESC);

CREATE INDEX IF NOT EXISTS market_offer_state_price_idx
    ON market_offer_state (price_per_hour);

CREATE INDEX IF NOT EXISTS market_offer_state_country_idx
    ON market_offer_state (country);

CREATE INDEX IF NOT EXISTS market_offer_state_availability_idx
    ON market_offer_state (availability_scope, executable);

-- Backfill the winning observation per offer. Provider API observations win a
-- same-timestamp tie, matching the previous view's ranking rule.
INSERT INTO market_offer_state (
    id, provider, provider_offer_id, gpu_model, gpu_model_normalized,
    gpu_count, vram_gb, cpu_cores, ram_gb, disk_gb, region, country,
    price_per_hour, price_available, pricing_model, currency,
    billing_scope, availability_scope, executable, available_gpu_count,
    capacity_scope, reliability, source, source_url, source_record_id,
    trust_tier, content_hash, raw_payload, metadata, observed_at,
    ingested_at, run_id
)
SELECT
    id, provider, provider_offer_id, gpu_model, gpu_model_normalized,
    gpu_count, vram_gb, cpu_cores, ram_gb, disk_gb, region, country,
    price_per_hour, price_available, pricing_model, currency,
    billing_scope, availability_scope, executable, available_gpu_count,
    capacity_scope, reliability, source, source_url, source_record_id,
    trust_tier, content_hash, raw_payload, metadata, observed_at,
    ingested_at, run_id
FROM (
    SELECT
        o.*,
        ROW_NUMBER() OVER (
            PARTITION BY o.provider, o.provider_offer_id
            ORDER BY o.observed_at DESC,
                     (o.trust_tier = 'provider_api') DESC,
                     o.ingested_at DESC
        ) AS rn
    FROM market_observations o
) ranked
WHERE rn = 1
ON CONFLICT (provider, provider_offer_id) DO UPDATE SET
    id = EXCLUDED.id,
    gpu_model = EXCLUDED.gpu_model,
    gpu_model_normalized = EXCLUDED.gpu_model_normalized,
    gpu_count = EXCLUDED.gpu_count,
    vram_gb = EXCLUDED.vram_gb,
    cpu_cores = EXCLUDED.cpu_cores,
    ram_gb = EXCLUDED.ram_gb,
    disk_gb = EXCLUDED.disk_gb,
    region = EXCLUDED.region,
    country = EXCLUDED.country,
    price_per_hour = EXCLUDED.price_per_hour,
    price_available = EXCLUDED.price_available,
    pricing_model = EXCLUDED.pricing_model,
    currency = EXCLUDED.currency,
    billing_scope = EXCLUDED.billing_scope,
    availability_scope = EXCLUDED.availability_scope,
    executable = EXCLUDED.executable,
    available_gpu_count = EXCLUDED.available_gpu_count,
    capacity_scope = EXCLUDED.capacity_scope,
    reliability = EXCLUDED.reliability,
    source = EXCLUDED.source,
    source_url = EXCLUDED.source_url,
    source_record_id = EXCLUDED.source_record_id,
    trust_tier = EXCLUDED.trust_tier,
    content_hash = EXCLUDED.content_hash,
    raw_payload = EXCLUDED.raw_payload,
    metadata = EXCLUDED.metadata,
    observed_at = EXCLUDED.observed_at,
    ingested_at = EXCLUDED.ingested_at,
    run_id = EXCLUDED.run_id
WHERE (
    EXCLUDED.observed_at,
    (EXCLUDED.trust_tier = 'provider_api'),
    EXCLUDED.ingested_at
) > (
    market_offer_state.observed_at,
    (market_offer_state.trust_tier = 'provider_api'),
    market_offer_state.ingested_at
);

DROP VIEW IF EXISTS market_offers_current;

CREATE VIEW market_offers_current AS
SELECT
    o.id,
    o.provider,
    o.provider_offer_id,
    o.gpu_model,
    o.gpu_model_normalized,
    o.gpu_count,
    o.vram_gb,
    o.cpu_cores,
    o.ram_gb,
    o.disk_gb,
    o.region,
    o.country,
    o.price_per_hour,
    o.price_available,
    o.pricing_model,
    o.currency,
    o.billing_scope,
    o.availability_scope,
    o.executable,
    o.available_gpu_count,
    o.capacity_scope,
    o.reliability,
    o.source,
    o.source_url,
    o.source_record_id,
    o.trust_tier,
    o.content_hash AS raw_hash,
    o.raw_payload,
    o.metadata,
    o.observed_at,
    o.ingested_at,
    o.run_id,
    s.display_name,
    CASE
        WHEN o.availability_scope = 'advertised' THEN s.advertised_ttl_seconds
        ELSE s.freshness_ttl_seconds
    END AS effective_ttl_seconds,
    ROUND(o.price_per_hour * 100)::bigint AS price_per_hour_minor,
    ROUND(o.price_per_hour * 1000000)::bigint AS price_per_hour_micros,
    ROUND(o.price_per_hour * 100 / o.gpu_count)::bigint AS price_per_gpu_hour_minor,
    ROUND(o.price_per_hour * 1000000 / o.gpu_count)::bigint AS price_per_gpu_hour_micros,
    o.observed_at + make_interval(secs => CASE
        WHEN o.availability_scope = 'advertised' THEN s.advertised_ttl_seconds
        ELSE s.freshness_ttl_seconds
    END) AS expires_at,
    CASE
        WHEN o.observed_at > now() - make_interval(secs => CASE
            WHEN o.availability_scope = 'advertised' THEN s.advertised_ttl_seconds
            ELSE s.freshness_ttl_seconds
        END) THEN 'fresh'
        WHEN o.observed_at > now() - make_interval(secs => 4 * CASE
            WHEN o.availability_scope = 'advertised' THEN s.advertised_ttl_seconds
            ELSE s.freshness_ttl_seconds
        END) THEN 'stale'
        ELSE 'expired'
    END AS freshness
FROM market_offer_state o
JOIN market_sources s ON s.provider = o.provider
WHERE s.enabled;

INSERT INTO schema_migrations (version) VALUES ('005_market_offer_state')
ON CONFLICT (version) DO NOTHING;

COMMIT;
