-- P1-P5: deterministic clearing, execution boundary, finance controls, and
-- settlement reconciliation. Money remains integer minor units.

-- Existing capacity held by a buyer. The solver must release/move this capacity
-- before another buyer can use it, which is what makes an exchange conditional.
-- Reconciliation can compare a UUID object with a non-UUID ledger account code.
-- Store both sides as text and retain the type discriminator.
ALTER TABLE reconciliation_matches
  ALTER COLUMN object_a_id TYPE text USING object_a_id::text,
  ALTER COLUMN object_b_id TYPE text USING object_b_id::text;

CREATE TABLE IF NOT EXISTS capacity_allocations (
  id uuid PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES market_offers(id),
  buyer_id uuid NOT NULL REFERENCES parties(id),
  workload_id uuid NOT NULL REFERENCES workloads(id),
  gpu_count integer NOT NULL CHECK (gpu_count > 0),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released', 'expired', 'failed')),
  transferable boolean NOT NULL DEFAULT false,
  switch_cost_minor bigint NOT NULL DEFAULT 0 CHECK (switch_cost_minor >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end > window_start)
);

CREATE INDEX IF NOT EXISTS capacity_allocations_offer_idx
  ON capacity_allocations (offer_id, status, window_start, window_end);
CREATE INDEX IF NOT EXISTS capacity_allocations_workload_idx
  ON capacity_allocations (workload_id, status);

-- The approved handoff is not executable by Duo 2 by itself. This record is the
-- explicit authorization boundary and is created only after handoff integrity
-- has been checked.
CREATE TABLE IF NOT EXISTS execution_authorizations (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES deals(id),
  handoff_id uuid NOT NULL REFERENCES handoffs(id),
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired', 'completed')),
  authorized_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, version)
);

CREATE INDEX IF NOT EXISTS execution_authorizations_status_idx
  ON execution_authorizations (status, expires_at);

-- A hosted CREAO agent may negotiate only inside a participant-issued mandate.
-- Human participants do not need a mandate because their credential is bound to
-- the party. This table is not an LLM prompt store; it is an enforceable limit.
CREATE TABLE IF NOT EXISTS negotiation_mandates (
  id uuid PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES parties(id),
  agent_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('buyer', 'provider')),
  min_rate_minor_per_gpu_hour bigint CHECK (min_rate_minor_per_gpu_hour >= 0),
  max_rate_minor_per_gpu_hour bigint CHECK (max_rate_minor_per_gpu_hour >= 0),
  max_delta_minor bigint NOT NULL DEFAULT 0 CHECK (max_delta_minor >= 0),
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    min_rate_minor_per_gpu_hour IS NULL OR
    max_rate_minor_per_gpu_hour IS NULL OR
    max_rate_minor_per_gpu_hour >= min_rate_minor_per_gpu_hour
  )
);

CREATE INDEX IF NOT EXISTS negotiation_mandates_agent_idx
  ON negotiation_mandates (agent_id, party_id, active);

-- Role/party spending controls. A missing row means zero authority, never an
-- implicit unlimited budget.
CREATE TABLE IF NOT EXISTS spending_limits (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('role', 'party', 'human')),
  subject_id text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  per_transaction_minor bigint NOT NULL DEFAULT 0 CHECK (per_transaction_minor >= 0),
  daily_minor bigint NOT NULL DEFAULT 0 CHECK (daily_minor >= 0),
  auto_approve_minor bigint NOT NULL DEFAULT 0 CHECK (auto_approve_minor >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, currency)
);

-- Finance-side payables to providers. Customer invoices and provider payables
-- are deliberately separate so a procurement payment cannot be mistaken for an
-- amount owed to the compute provider.
CREATE TABLE IF NOT EXISTS provider_payables (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES contracts(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  provider_id uuid NOT NULL REFERENCES parties(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'accrued'
    CHECK (status IN ('accrued', 'paid', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (invoice_id, provider_id)
);

CREATE INDEX IF NOT EXISTS provider_payables_status_idx
  ON provider_payables (status, created_at DESC);

-- Corrections must be explicit, signed adjustments. A negative amount reduces
-- the invoice; a positive amount adds a charge. Both remain auditable.
CREATE TABLE IF NOT EXISTS invoice_adjustments (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount_minor bigint NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'rejected')),
  financial_approval_id uuid REFERENCES financial_approvals(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE INDEX IF NOT EXISTS invoice_adjustments_invoice_idx
  ON invoice_adjustments (invoice_id, created_at DESC);

ALTER TABLE payment_instructions
  ADD COLUMN IF NOT EXISTS requested_by text,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approval_id uuid REFERENCES financial_approvals(id),
  ADD COLUMN IF NOT EXISTS failure_message text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_unique
  ON payments (provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_usage_unique
  ON invoice_lines (usage_id)
  WHERE usage_id IS NOT NULL;

INSERT INTO spending_limits
  (id, subject_type, subject_id, currency, per_transaction_minor, daily_minor,
   auto_approve_minor, active)
VALUES
  ('99999999-9999-4999-8999-999999999901', 'role', 'finance', 'USD', 100000, 500000, 0, true),
  ('99999999-9999-4999-8999-999999999902', 'role', 'admin', 'USD', 250000, 1000000, 0, true),
  ('99999999-9999-4999-8999-999999999903', 'role', 'agent', 'USD', 0, 0, 0, true),
  ('99999999-9999-4999-8999-999999999904', 'role', 'worker', 'USD', 0, 0, 0, true)
ON CONFLICT (subject_type, subject_id, currency) DO NOTHING;
