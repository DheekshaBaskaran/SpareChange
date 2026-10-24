-- Duo 1 / Hyphenate financial operations schema.
-- P0 does not expose these routes yet; the schema is created now so later phases
-- do not have to alter core market tables. Every amount is integer minor units.
-- Journal entries are immutable; the imbalance view is the P0 safety check and a
-- deferred balance trigger will be added with the ledger service.

CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES deals(id),
  deal_version integer NOT NULL,
  buyer_id uuid NOT NULL REFERENCES parties(id),
  provider_id uuid NOT NULL REFERENCES parties(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'active', 'suspended', 'completed', 'cancelled')),
  currency char(3) NOT NULL DEFAULT 'USD',
  terms jsonb NOT NULL,
  approved_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, deal_version, buyer_id, provider_id)
);

CREATE INDEX IF NOT EXISTS contracts_deal_idx ON contracts (deal_id);

CREATE TABLE IF NOT EXISTS contract_rate_lines (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  description text NOT NULL,
  gpu_model text NOT NULL,
  gpu_count integer NOT NULL CHECK (gpu_count > 0),
  rate_minor_per_gpu_hour bigint NOT NULL CHECK (rate_minor_per_gpu_hour >= 0),
  minimum_charge_minor bigint NOT NULL DEFAULT 0 CHECK (minimum_charge_minor >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verified_usage (
  id uuid PRIMARY KEY,
  execution_event_id uuid NOT NULL REFERENCES execution_events(id),
  workload_id uuid NOT NULL REFERENCES workloads(id),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  gpu_model text NOT NULL,
  gpu_count integer NOT NULL CHECK (gpu_count > 0),
  gpu_seconds numeric(18, 3) NOT NULL CHECK (gpu_seconds > 0),
  billing_basis text NOT NULL DEFAULT 'measured_gpu_seconds'
    CHECK (billing_basis IN ('measured_gpu_seconds', 'contracted_allocation')),
  verified_at timestamptz NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execution_event_id)
);

CREATE INDEX IF NOT EXISTS verified_usage_contract_idx ON verified_usage (contract_id, verified_at);

CREATE TABLE IF NOT EXISTS billing_calculations (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES contracts(id),
  usage_id uuid NOT NULL REFERENCES verified_usage(id),
  calculation_version text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  basis text NOT NULL,
  breakdown jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usage_id, calculation_version)
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES contracts(id),
  invoice_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'void', 'disputed')),
  issued_at timestamptz,
  due_at timestamptz,
  currency char(3) NOT NULL DEFAULT 'USD',
  subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'manual', 'external')),
  duplicate_of uuid REFERENCES invoices(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_contract_idx ON invoices (contract_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(18, 3) NOT NULL CHECK (quantity > 0),
  unit_rate_minor bigint NOT NULL CHECK (unit_rate_minor >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  usage_id uuid REFERENCES verified_usage(id),
  billing_calculation_id uuid REFERENCES billing_calculations(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_obligations (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authorized', 'submitted', 'paid', 'failed', 'cancelled')),
  authorized_at timestamptz,
  authorization_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id)
);

CREATE TABLE IF NOT EXISTS payment_instructions (
  id uuid PRIMARY KEY,
  obligation_id uuid NOT NULL REFERENCES payment_obligations(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  chain text,
  destination text,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'submitted', 'confirmed', 'failed', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failure_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  instruction_id uuid REFERENCES payment_instructions(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'failed', 'reversed')),
  provider_reference text,
  confirmed_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments (invoice_id);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS reconciliation_matches (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  match_type text NOT NULL CHECK (match_type IN ('contract_invoice', 'invoice_usage', 'invoice_payment', 'ledger_payment')),
  object_a_type text NOT NULL,
  object_a_id uuid NOT NULL,
  object_b_type text NOT NULL,
  object_b_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('matched', 'mismatched', 'unmatched')),
  difference_minor bigint NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  code text PRIMARY KEY,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY,
  entry_number text NOT NULL UNIQUE,
  entry_date date NOT NULL,
  description text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'reversed')),
  reverses_entry_id uuid REFERENCES journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz
);

CREATE INDEX IF NOT EXISTS journal_entries_source_idx ON journal_entries (source_type, source_id);
CREATE INDEX IF NOT EXISTS journal_entries_date_idx ON journal_entries (entry_date DESC);

CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code text NOT NULL REFERENCES ledger_accounts(code),
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  party_id uuid REFERENCES parties(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);

CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines (account_code);

CREATE OR REPLACE VIEW journal_entry_balances AS
SELECT
  entry_id,
  sum(debit_minor)::bigint AS total_debit_minor,
  sum(credit_minor)::bigint AS total_credit_minor,
  (sum(debit_minor) - sum(credit_minor))::bigint AS imbalance_minor
FROM journal_lines
GROUP BY entry_id;

CREATE TABLE IF NOT EXISTS financial_exceptions (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'correction_proposed', 'awaiting_approval', 'resolved', 'dismissed')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  deal_id uuid REFERENCES deals(id),
  contract_id uuid REFERENCES contracts(id),
  invoice_id uuid REFERENCES invoices(id),
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_correction jsonb,
  assigned_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS financial_exceptions_status_idx ON financial_exceptions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS financial_exceptions_invoice_idx ON financial_exceptions (invoice_id);

CREATE TABLE IF NOT EXISTS exception_actions (
  id uuid PRIMARY KEY,
  exception_id uuid NOT NULL REFERENCES financial_exceptions(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS financial_approvals (
  id uuid PRIMARY KEY,
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  object_version integer NOT NULL DEFAULT 1,
  action text NOT NULL,
  requested_by text NOT NULL,
  approved_by text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE INDEX IF NOT EXISTS financial_approvals_object_idx ON financial_approvals (object_type, object_id);

INSERT INTO ledger_accounts (code, name, account_type, normal_balance) VALUES
  ('1000', 'Cash and cash equivalents', 'asset', 'debit'),
  ('1100', 'Accounts receivable', 'asset', 'debit'),
  ('2000', 'Accounts payable', 'liability', 'credit'),
  ('2100', 'Customer deposits', 'liability', 'credit'),
  ('3000', 'Retained earnings', 'equity', 'credit'),
  ('4000', 'Compute revenue', 'revenue', 'credit'),
  ('5000', 'Compute cost', 'expense', 'debit'),
  ('5100', 'Coordination and migration expense', 'expense', 'debit')
ON CONFLICT (code) DO NOTHING;
