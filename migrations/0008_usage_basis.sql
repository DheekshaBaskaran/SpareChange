-- Distinguish contracted capacity from measured hardware time.
--
-- `contracted_capacity_window` means GPU-seconds were derived from the
-- contracted GPU count and reserved hours, not from worker telemetry. Existing
-- `contracted_allocation` rows remain valid; new writes use the precise name.

ALTER TABLE verified_usage
  DROP CONSTRAINT IF EXISTS verified_usage_billing_basis_check;

ALTER TABLE verified_usage
  ADD CONSTRAINT verified_usage_billing_basis_check
  CHECK (billing_basis IN (
    'measured_gpu_seconds',
    'contracted_allocation',
    'contracted_capacity_window'
  ));

COMMENT ON COLUMN verified_usage.billing_basis IS
  'measured_gpu_seconds = worker-measured hardware time; contracted_capacity_window = contracted GPU count x reserved hours (not telemetry).';
