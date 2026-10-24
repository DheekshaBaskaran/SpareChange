-- Run only on Tiger Data / TimescaleDB.
-- `npm run db:migrate` applies core + finance; `npm run db:migrate:timescale`
-- applies this file as well.
CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable(
  'market_observations',
  'observed_at',
  if_not_exists => TRUE,
  migrate_data => TRUE
);
