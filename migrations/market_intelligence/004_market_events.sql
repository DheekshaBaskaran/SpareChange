-- Structured market change events.
--
-- The Actor computes events against persistent state and pushes them here.
-- event_id is deterministic for (provider, offer, event type, actor run), so
-- webhook retries and direct pushes are idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS market_events (
    event_id text PRIMARY KEY,
    event_type text NOT NULL CHECK (event_type IN ('new', 'updated', 'disappeared')),
    provider text NOT NULL REFERENCES market_sources(provider),
    provider_offer_id text NOT NULL,
    gpu_model text NOT NULL,
    gpu_model_normalized text NOT NULL,
    price_available boolean NOT NULL DEFAULT true,
    previous_price_per_hour numeric(20, 6),
    current_price_per_hour numeric(20, 6),
    price_change_percent numeric(12, 4),
    previous_available_gpu_count integer,
    current_available_gpu_count integer,
    availability_change text,
    reason text NOT NULL,
    observed_at timestamptz NOT NULL,
    actor_run_id text,
    source text NOT NULL DEFAULT 'apify_actor',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_events_time_idx
    ON market_events (observed_at DESC);

CREATE INDEX IF NOT EXISTS market_events_provider_time_idx
    ON market_events (provider, observed_at DESC);

CREATE INDEX IF NOT EXISTS market_events_offer_time_idx
    ON market_events (provider, provider_offer_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS market_events_type_time_idx
    ON market_events (event_type, observed_at DESC);

CREATE INDEX IF NOT EXISTS market_events_run_idx
    ON market_events (actor_run_id);

INSERT INTO schema_migrations (version) VALUES ('004_market_events')
ON CONFLICT (version) DO NOTHING;

COMMIT;
