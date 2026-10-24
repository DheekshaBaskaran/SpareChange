-- Relay Market Intelligence aggregates and policies.
-- Apply after 001_market_schema.sql as the database owner.

BEGIN;

CREATE MATERIALIZED VIEW IF NOT EXISTS market_price_hourly
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
GROUP BY 1, 2, 3, 4
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'market_price_hourly',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '30 minutes',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE
);

SELECT add_retention_policy(
    'market_observations',
    INTERVAL '365 days',
    if_not_exists => TRUE
);

CREATE OR REPLACE FUNCTION prune_market_observation_keys(retention_days integer DEFAULT 30)
RETURNS void
LANGUAGE sql
AS $$
    DELETE FROM market_observation_keys
    WHERE created_at < now() - make_interval(days => retention_days);
$$;

SELECT add_job(
    'prune_market_observation_keys'::regproc,
    INTERVAL '1 day',
    job_name => 'relay_prune_market_observation_keys'
);

INSERT INTO schema_migrations (version) VALUES ('002_market_aggregates')
ON CONFLICT (version) DO NOTHING;

COMMIT;
