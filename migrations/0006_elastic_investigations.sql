-- Elasticsearch is an investigation/search projection, not a system of record.
-- Tiger Data remains authoritative. These tables only queue projection changes,
-- record sync runs, and persist evidence-backed investigations.

CREATE TABLE IF NOT EXISTS elastic_outbox (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text
);

CREATE INDEX IF NOT EXISTS elastic_outbox_pending_idx
  ON elastic_outbox (id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS elastic_outbox_entity_idx
  ON elastic_outbox (entity_type, entity_id, id DESC);

-- Queue a projection change for any table that has an id column. The queue
-- stores identifiers only; the sync worker reads the authoritative row again.
CREATE OR REPLACE FUNCTION relay_elastic_outbox_enqueue()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  record_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    record_id := OLD.id::text;
  ELSE
    record_id := NEW.id::text;
  END IF;
  INSERT INTO elastic_outbox (entity_type, entity_id, operation)
  VALUES (TG_TABLE_NAME, record_id, lower(TG_OP));
  RETURN NULL;
END;
$$;

-- Parties, workloads, agreements, invoices, usage, execution evidence,
-- transaction events, settlements, controls, accounting, and audit logs.
DROP TRIGGER IF EXISTS elastic_outbox_parties ON parties;
CREATE TRIGGER elastic_outbox_parties
  AFTER INSERT OR UPDATE OR DELETE ON parties
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_workloads ON workloads;
CREATE TRIGGER elastic_outbox_workloads
  AFTER INSERT OR UPDATE OR DELETE ON workloads
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_deals ON deals;
CREATE TRIGGER elastic_outbox_deals
  AFTER INSERT OR UPDATE OR DELETE ON deals
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_contracts ON contracts;
CREATE TRIGGER elastic_outbox_contracts
  AFTER INSERT OR UPDATE OR DELETE ON contracts
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_contract_rate_lines ON contract_rate_lines;
CREATE TRIGGER elastic_outbox_contract_rate_lines
  AFTER INSERT OR UPDATE OR DELETE ON contract_rate_lines
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_invoices ON invoices;
CREATE TRIGGER elastic_outbox_invoices
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_invoice_lines ON invoice_lines;
CREATE TRIGGER elastic_outbox_invoice_lines
  AFTER INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_invoice_adjustments ON invoice_adjustments;
CREATE TRIGGER elastic_outbox_invoice_adjustments
  AFTER INSERT OR UPDATE OR DELETE ON invoice_adjustments
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_payment_obligations ON payment_obligations;
CREATE TRIGGER elastic_outbox_payment_obligations
  AFTER INSERT OR UPDATE OR DELETE ON payment_obligations
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_billing_calculations ON billing_calculations;
CREATE TRIGGER elastic_outbox_billing_calculations
  AFTER INSERT OR UPDATE OR DELETE ON billing_calculations
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_verified_usage ON verified_usage;
CREATE TRIGGER elastic_outbox_verified_usage
  AFTER INSERT OR UPDATE OR DELETE ON verified_usage
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_execution_events ON execution_events;
CREATE TRIGGER elastic_outbox_execution_events
  AFTER INSERT OR UPDATE OR DELETE ON execution_events
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_execution_authorizations ON execution_authorizations;
CREATE TRIGGER elastic_outbox_execution_authorizations
  AFTER INSERT OR UPDATE OR DELETE ON execution_authorizations
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_payments ON payments;
CREATE TRIGGER elastic_outbox_payments
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_payment_instructions ON payment_instructions;
CREATE TRIGGER elastic_outbox_payment_instructions
  AFTER INSERT OR UPDATE OR DELETE ON payment_instructions
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_provider_payables ON provider_payables;
CREATE TRIGGER elastic_outbox_provider_payables
  AFTER INSERT OR UPDATE OR DELETE ON provider_payables
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_provider_payout_instructions ON provider_payout_instructions;
CREATE TRIGGER elastic_outbox_provider_payout_instructions
  AFTER INSERT OR UPDATE OR DELETE ON provider_payout_instructions
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_provider_payouts ON provider_payouts;
CREATE TRIGGER elastic_outbox_provider_payouts
  AFTER INSERT OR UPDATE OR DELETE ON provider_payouts
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_financial_exceptions ON financial_exceptions;
CREATE TRIGGER elastic_outbox_financial_exceptions
  AFTER INSERT OR UPDATE OR DELETE ON financial_exceptions
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_exception_actions ON exception_actions;
CREATE TRIGGER elastic_outbox_exception_actions
  AFTER INSERT OR UPDATE OR DELETE ON exception_actions
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_financial_approvals ON financial_approvals;
CREATE TRIGGER elastic_outbox_financial_approvals
  AFTER INSERT OR UPDATE OR DELETE ON financial_approvals
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_journal_entries ON journal_entries;
CREATE TRIGGER elastic_outbox_journal_entries
  AFTER INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_journal_lines ON journal_lines;
CREATE TRIGGER elastic_outbox_journal_lines
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

DROP TRIGGER IF EXISTS elastic_outbox_audit_events ON audit_events;
CREATE TRIGGER elastic_outbox_audit_events
  AFTER INSERT OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION relay_elastic_outbox_enqueue();

CREATE TABLE IF NOT EXISTS elastic_sync_runs (
  id uuid PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('incremental', 'backfill')),
  status text NOT NULL CHECK (status IN ('completed', 'failed')),
  documents_indexed integer NOT NULL DEFAULT 0 CHECK (documents_indexed >= 0),
  documents_deleted integer NOT NULL DEFAULT 0 CHECK (documents_deleted >= 0),
  documents_failed integer NOT NULL DEFAULT 0 CHECK (documents_failed >= 0),
  pending_after integer NOT NULL DEFAULT 0 CHECK (pending_after >= 0),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS elastic_sync_runs_started_idx
  ON elastic_sync_runs (started_at DESC);

-- One row per investigator invocation. The agent never changes finance state;
-- this table records what it was asked, what tools it used, and what it found.
CREATE TABLE IF NOT EXISTS elastic_investigations (
  id uuid PRIMARY KEY,
  exception_id uuid NOT NULL REFERENCES financial_exceptions(id),
  parent_investigation_id uuid REFERENCES elastic_investigations(id),
  status text NOT NULL CHECK (
    status IN ('running', 'completed', 'completed_with_warnings', 'insufficient_evidence', 'failed')
  ),
  initiated_by text NOT NULL CHECK (initiated_by IN ('creao', 'manual', 'follow_up', 'system')),
  requested_by text NOT NULL,
  question text,
  agent_id text NOT NULL,
  conversation_id text,
  round_id text,
  summary text,
  missing_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_usage jsonb,
  agent_steps jsonb,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS elastic_investigations_exception_idx
  ON elastic_investigations (exception_id, created_at DESC);
CREATE INDEX IF NOT EXISTS elastic_investigations_status_idx
  ON elastic_investigations (status, created_at DESC);

CREATE TABLE IF NOT EXISTS elastic_investigation_findings (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES elastic_investigations(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  issue_code text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  confidence numeric(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  uncertainty text,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, position)
);

CREATE INDEX IF NOT EXISTS elastic_investigation_findings_investigation_idx
  ON elastic_investigation_findings (investigation_id, position);

-- Normalized citations let the frontend link directly to the indexed record
-- and prevent a model-generated record id from being presented as evidence.
CREATE TABLE IF NOT EXISTS elastic_investigation_evidence (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES elastic_investigations(id) ON DELETE CASCADE,
  index_name text NOT NULL,
  document_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  field text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, index_name, document_id, field)
);

CREATE INDEX IF NOT EXISTS elastic_investigation_evidence_investigation_idx
  ON elastic_investigation_evidence (investigation_id);
