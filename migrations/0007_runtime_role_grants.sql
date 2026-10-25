-- Grant the Duo 1 runtime role access to its own schema.
--
-- Migrations run as the database owner, while the API runs as a DML-only role
-- (`relay_market_app` in .env.example). A schema created after that role was
-- provisioned is not automatically usable by it, so grant exactly what the
-- runtime needs: DML on tables and sequence usage. No DDL, no foreign schema
-- access, so the market tables in `public` stay read-only to the owner tooling
-- and unreachable to the API role by accident.
--
-- The block is a no-op on databases without that role (for example the PGlite
-- test harness) and is safe to re-run.
DO $$
DECLARE
  runtime_role text := 'relay_market_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
    RAISE NOTICE 'role % does not exist; skipping Duo 1 runtime grants', runtime_role;
    RETURN;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA relay TO %I', runtime_role);
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA relay TO %I',
    runtime_role
  );
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA relay TO %I', runtime_role);

  -- Future migrations create tables as the owner; keep the runtime role working
  -- without a manual grant after every deploy.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA relay GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    runtime_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA relay GRANT USAGE, SELECT ON SEQUENCES TO %I',
    runtime_role
  );
END $$;
