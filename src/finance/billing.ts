import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { requireActiveContract } from "./contracts.js";
import { ApiError } from "../errors.js";
import { asObject, iso, minor } from "../db/values.js";

export type BillingBasis = "measured_gpu_seconds" | "contracted_capacity_window";

export interface VerifiedUsageInput {
  contractId: string;
  authorizationId: string;
  gpuSeconds: number;
  /**
   * What the reported GPU-seconds actually represent. `measured_gpu_seconds`
   * means worker-measured hardware time; `contracted_capacity_window` means the
   * contracted GPU count × reserved hours, not hardware telemetry.
   */
  billingBasis?: BillingBasis;
  startedAt: string;
  endedAt: string;
  jobId?: string | null;
  workerId?: string | null;
  proofReference?: string | null;
  evidence?: unknown;
  executionEventId?: string;
  actorId: string;
  actorRole: string;
  idempotencyKey: string | null;
}

export interface VerifiedUsageView {
  id: string;
  execution_event_id: string;
  workload_id: string;
  contract_id: string;
  gpu_model: string;
  gpu_count: number;
  gpu_seconds: number;
  billing_basis: string;
  verified_at: string | null;
  evidence: unknown;
  billing: {
    id: string;
    amount_minor: number;
    currency: string;
    basis: string;
    calculation_version: string;
    breakdown: unknown;
  };
}

function roundUp(value: number): number {
  return Math.max(0, Math.ceil(value));
}

export function computeUsageAmountMinor(
  gpuSeconds: number,
  rateMinorPerGpuHour: number,
  minimumChargeMinor = 0,
): number {
  const amount = roundUp((gpuSeconds / 3600) * rateMinorPerGpuHour);
  return Math.max(amount, minimumChargeMinor);
}

export async function recordVerifiedUsage(
  db: Db,
  input: VerifiedUsageInput,
): Promise<VerifiedUsageView> {
  const { contract, authorizationId, terms } = await requireActiveContract(db, input.contractId);
  if (authorizationId !== input.authorizationId) {
    throw new ApiError(409, "authorization_contract_mismatch", "The authorization does not cover this contract.");
  }
  if (!Number.isFinite(input.gpuSeconds) || input.gpuSeconds <= 0) {
    throw new ApiError(422, "gpu_seconds_invalid", "gpu_seconds must be a positive number.");
  }
  const started = new Date(input.startedAt);
  const ended = new Date(input.endedAt);
  if (Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime()) || ended <= started) {
    throw new ApiError(422, "usage_window_invalid", "started_at and ended_at must define a positive window.");
  }
  const gpuModel = String(terms.gpu_model ?? "");
  const gpuCount = Number(terms.gpu_count ?? 0);
  const rate = Number(terms.rate_minor_per_gpu_hour ?? 0);
  const durationHours = Number(terms.duration_hours ?? 0);
  const currency = String(terms.currency ?? contract.currency);
  if (!gpuModel || !Number.isInteger(gpuCount) || gpuCount <= 0 || !Number.isFinite(rate) || rate < 0) {
    throw new ApiError(409, "contract_terms_invalid", "The contract does not contain a valid rate line.");
  }
  const maxGpuSeconds = durationHours * 3600 * gpuCount * 1.1 + 60;
  if (input.gpuSeconds > maxGpuSeconds) {
    throw new ApiError(409, "usage_exceeds_authorization", "Reported GPU seconds exceed the authorized window.", {
      violations: ["usage_exceeds_authorization"],
    });
  }

  const amountMinor = computeUsageAmountMinor(input.gpuSeconds, rate);
  const billingBasis: BillingBasis = input.billingBasis ?? "measured_gpu_seconds";
  const measuredGpuSeconds =
    typeof input.evidence === "object" && input.evidence !== null
      ? Number((input.evidence as Record<string, unknown>).measured_gpu_seconds)
      : NaN;
  const executionEventId = input.executionEventId ?? randomUUID();
  const usageId = randomUUID();
  const calculationId = randomUUID();
  const verifiedAt = new Date().toISOString();

  return db.transaction(async (tx) => {
    const duplicate = await tx.query<{ id: string }>(
      `SELECT id FROM verified_usage WHERE execution_event_id = $1`,
      [executionEventId],
    );
    if (duplicate.rows[0]) {
      throw new ApiError(409, "usage_already_verified", "Verified usage already exists for this execution event.");
    }
    await tx.query(
      `INSERT INTO execution_events
         (id, workload_id, job_id, worker_id, event_type, measured_at, gpu_seconds,
          proof_reference, payload)
       VALUES ($1, $2, $3, $4, 'execution_completed', $5, $6, $7, $8::jsonb)`,
      [
        executionEventId,
        terms.workload_id,
        input.jobId ?? null,
        input.workerId ?? null,
        ended.toISOString(),
        input.gpuSeconds,
        input.proofReference ?? null,
        JSON.stringify({ evidence: input.evidence ?? {}, authorization_id: input.authorizationId }),
      ],
    );
    await tx.query(
      `INSERT INTO verified_usage
         (id, execution_event_id, workload_id, contract_id, gpu_model, gpu_count,
          gpu_seconds, billing_basis, verified_at, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        usageId,
        executionEventId,
        terms.workload_id,
        input.contractId,
        gpuModel,
        gpuCount,
        input.gpuSeconds,
        billingBasis,
        verifiedAt,
        JSON.stringify({
          ...asObject(input.evidence),
          started_at: started.toISOString(),
          ended_at: ended.toISOString(),
          proof_reference: input.proofReference ?? null,
          authorization_id: input.authorizationId,
        }),
      ],
    );
    const contracted = billingBasis === "contracted_capacity_window";
    const breakdown = {
      formula: "ceil(gpu_seconds / 3600 * rate_minor_per_gpu_hour)",
      gpu_seconds: input.gpuSeconds,
      gpu_count: gpuCount,
      rate_minor_per_gpu_hour: rate,
      nominal_gpu_hours: input.gpuSeconds / 3600,
      minimum_charge_minor: 0,
      authorization_id: input.authorizationId,
      contract_id: input.contractId,
      billing_basis: billingBasis,
      measured_gpu_seconds: Number.isFinite(measuredGpuSeconds) ? measuredGpuSeconds : null,
      note: contracted
        ? "gpu_seconds is the contracted capacity window (GPU count × reserved hours), not measured hardware time. Measured worker time is recorded separately in evidence."
        : "gpu_seconds is worker-measured hardware time.",
    };
    await tx.query(
      `INSERT INTO billing_calculations
         (id, contract_id, usage_id, calculation_version, amount_minor, currency, basis, breakdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        calculationId,
        input.contractId,
        usageId,
        contracted ? "contracted-v1" : "measured-v1",
        amountMinor,
        currency,
        contracted ? "verified_contracted_capacity" : "verified_measured_gpu_seconds",
        JSON.stringify(breakdown),
      ],
    );
    await appendAudit(tx, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: "usage.verified",
      objectType: "verified_usage",
      objectId: usageId,
      dealId: contract.deal_id,
      idempotencyKey: input.idempotencyKey,
      after: {
        contract_id: input.contractId,
        execution_event_id: executionEventId,
        gpu_seconds: input.gpuSeconds,
        billing_basis: billingBasis,
        measured_gpu_seconds: Number.isFinite(measuredGpuSeconds) ? measuredGpuSeconds : null,
        amount_minor: amountMinor,
        currency,
        authorization_id: input.authorizationId,
        proof_reference: input.proofReference ?? null,
      },
    });
    return {
      id: usageId,
      execution_event_id: executionEventId,
      workload_id: String(terms.workload_id),
      contract_id: input.contractId,
      gpu_model: gpuModel,
      gpu_count: gpuCount,
      gpu_seconds: input.gpuSeconds,
      billing_basis: billingBasis,
      verified_at: verifiedAt,
      evidence: input.evidence ?? {},
      billing: {
        id: calculationId,
        amount_minor: amountMinor,
        currency,
        basis: contracted ? "verified_contracted_capacity" : "verified_measured_gpu_seconds",
        calculation_version: contracted ? "contracted-v1" : "measured-v1",
        breakdown,
      },
    };
  });
}

export async function listVerifiedUsage(
  db: Db,
  contractId: string,
): Promise<Array<{
  id: string;
  execution_event_id: string;
  gpu_model: string;
  gpu_count: number;
  gpu_seconds: number;
  billing_basis: string;
  measured_gpu_seconds: number | null;
  verified_at: string | null;
  billing_amount_minor: number | null;
  currency: string | null;
}>> {
  const result = await db.query<{
    id: string;
    execution_event_id: string;
    gpu_model: string;
    gpu_count: number;
    gpu_seconds: unknown;
    billing_basis: string;
    measured_gpu_seconds: unknown;
    verified_at: unknown;
    amount_minor: unknown;
    currency: string | null;
  }>(
    `SELECT u.id, u.execution_event_id, u.gpu_model, u.gpu_count, u.gpu_seconds,
            u.billing_basis,
            (b.breakdown->>'measured_gpu_seconds')::numeric AS measured_gpu_seconds,
            u.verified_at, b.amount_minor, b.currency
     FROM verified_usage u
     LEFT JOIN billing_calculations b ON b.usage_id = u.id
     WHERE u.contract_id = $1
     ORDER BY u.verified_at ASC`,
    [contractId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    execution_event_id: row.execution_event_id,
    gpu_model: row.gpu_model,
    gpu_count: row.gpu_count,
    gpu_seconds: Number(row.gpu_seconds),
    billing_basis: row.billing_basis,
    measured_gpu_seconds: row.measured_gpu_seconds == null ? null : Number(row.measured_gpu_seconds),
    verified_at: iso(row.verified_at),
    billing_amount_minor: row.amount_minor == null ? null : minor(row.amount_minor),
    currency: row.currency,
  }));
}
