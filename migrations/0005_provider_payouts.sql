-- Provider payable settlement. Buyer receivables and provider payouts are
-- deliberately separate obligations with separate instructions and ledger
-- postings. A payout is authorized by a human approval and confirmed by Duo 2.

ALTER TABLE provider_payables
  ADD COLUMN IF NOT EXISTS paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  ADD COLUMN IF NOT EXISTS approval_id uuid REFERENCES financial_approvals(id),
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz;

ALTER TABLE provider_payables
  DROP CONSTRAINT IF EXISTS provider_payables_status_check;
ALTER TABLE provider_payables
  ADD CONSTRAINT provider_payables_status_check
  CHECK (status IN ('accrued', 'partially_paid', 'paid', 'cancelled'));

CREATE INDEX IF NOT EXISTS provider_payables_provider_idx
  ON provider_payables (provider_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_payout_instructions (
  id uuid PRIMARY KEY,
  payable_id uuid NOT NULL REFERENCES provider_payables(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  chain text,
  destination text,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'submitted', 'confirmed', 'failed', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  requested_by text NOT NULL,
  approved_by text NOT NULL,
  approval_id uuid REFERENCES financial_approvals(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failure_code text,
  failure_message text
);

CREATE INDEX IF NOT EXISTS provider_payout_instructions_payable_idx
  ON provider_payout_instructions (payable_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_payouts (
  id uuid PRIMARY KEY,
  instruction_id uuid NOT NULL UNIQUE REFERENCES provider_payout_instructions(id),
  payable_id uuid NOT NULL REFERENCES provider_payables(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL CHECK (status IN ('confirmed', 'failed')),
  transaction_id text,
  provider_reference text,
  confirmed_at timestamptz,
  failure_code text,
  failure_message text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_payouts_payable_idx
  ON provider_payouts (payable_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS provider_payouts_reference_unique
  ON provider_payouts (provider_reference)
  WHERE provider_reference IS NOT NULL;

ALTER TABLE reconciliation_matches
  DROP CONSTRAINT IF EXISTS reconciliation_matches_match_type_check;
ALTER TABLE reconciliation_matches
  ADD CONSTRAINT reconciliation_matches_match_type_check
  CHECK (match_type IN (
    'contract_invoice',
    'invoice_usage',
    'invoice_payment',
    'ledger_payment',
    'provider_payable_payout',
    'provider_payable_ledger'
  ));
