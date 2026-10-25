-- Provider policy and honest capacity modeling.
--
-- Akash publishes GPU inventory without a price. Its observations therefore
-- carry price_available=false, pricing_model='bid', and a zero price sentinel.
-- Price analytics must filter price_available=true so a capacity record can
-- never masquerade as a free offer.
--
-- Lambda and TensorDock remain in market_sources for provenance, but are
-- disabled: their account creation requires payment details or vendor contact.

BEGIN;

ALTER TABLE market_observations
    ADD COLUMN IF NOT EXISTS price_available boolean NOT NULL DEFAULT true;

ALTER TABLE market_observations
    ADD COLUMN IF NOT EXISTS pricing_model text NOT NULL DEFAULT 'fixed';

ALTER TABLE market_observations
    ADD COLUMN IF NOT EXISTS available_gpu_count integer;

ALTER TABLE market_observations
    ADD COLUMN IF NOT EXISTS capacity_scope text NOT NULL DEFAULT 'offer';

-- Repair any historical zero-price rows before adding the check constraint.
UPDATE market_observations
SET price_available = (price_per_hour > 0),
    pricing_model = CASE WHEN price_per_hour > 0 THEN 'fixed' ELSE 'unknown' END
WHERE price_available IS DISTINCT FROM (price_per_hour > 0);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'market_observations_price_semantics'
    ) THEN
        ALTER TABLE market_observations
            ADD CONSTRAINT market_observations_price_semantics CHECK (
                (price_available AND price_per_hour > 0)
                OR (NOT price_available AND price_per_hour = 0)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'market_observations_pricing_model'
    ) THEN
        ALTER TABLE market_observations
            ADD CONSTRAINT market_observations_pricing_model
            CHECK (pricing_model IN ('fixed', 'bid', 'unknown'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'market_observations_capacity_scope'
    ) THEN
        ALTER TABLE market_observations
            ADD CONSTRAINT market_observations_capacity_scope
            CHECK (capacity_scope IN ('offer', 'provider'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'market_observations_available_gpus'
    ) THEN
        ALTER TABLE market_observations
            ADD CONSTRAINT market_observations_available_gpus
            CHECK (available_gpu_count IS NULL OR available_gpu_count >= 0);
    END IF;
END $$;

INSERT INTO market_sources (
    provider, display_name, collection_mode, trust_tier, base_url,
    freshness_ttl_seconds, advertised_ttl_seconds, enabled
) VALUES
    ('akash', 'Akash Network', 'provider_api+apify_actor', 'provider_api',
     'https://console-api.akash.network/v1/providers', 900, 21600, true)
ON CONFLICT (provider) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    collection_mode = EXCLUDED.collection_mode,
    base_url = EXCLUDED.base_url,
    enabled = true,
    updated_at = now();

UPDATE market_sources
SET enabled = false,
    collection_mode = 'provider_api (deferred)',
    updated_at = now()
WHERE provider IN ('lambda', 'tensordock');

DROP VIEW IF EXISTS market_offers_current;

CREATE VIEW market_offers_current AS
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
    WHERE s.enabled
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
    price_available,
    pricing_model,
    currency,
    billing_scope,
    availability_scope,
    executable,
    available_gpu_count,
    capacity_scope,
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

-- The old aggregate mixed every non-executable observation, including the new
-- unpriced Akash capacity. Recreate it with an explicit price filter. Dropping
-- the aggregate cascades its refresh policy; the policy is re-added below.
DROP MATERIALIZED VIEW IF EXISTS market_price_hourly CASCADE;

CREATE MATERIALIZED VIEW market_price_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 hour', observed_at) AS bucket_start,
    provider,
    gpu_model_normalized,
    currency,
    count(*)::bigint AS sample_count,
    min(price_per_hour) AS min_price,
    max(price_per_hour) AS max_price,
    avg(price_per_hour) AS avg_price,
    sum(price_per_hour) AS sum_price
FROM market_observations
WHERE executable = false
  AND price_available = true
GROUP BY 1, 2, 3, 4
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'market_price_hourly',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '30 minutes',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE
);

INSERT INTO schema_migrations (version) VALUES ('003_provider_policy_capacity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
