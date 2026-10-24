import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { iso, minor } from "../db/values.js";
import { ApiError } from "../errors.js";
import type { Principal } from "../contract.js";
import { postJournalEntryTx } from "./ledger.js";
import { checkSpendingAuthority } from "./payments.js";

interface PayableRow {
  id: string;
  contract_id: string;
  invoice_id: string;
  provider_id: string;
  amount_minor: unknown;
  paid_minor: unknown;
  currency: string;
  status: string;
  approval_id: string | null;
  authorized_at: unknown;
}

interface InstructionRow {
  id: string;
  payable_id: string;
  contract_id: string;
  invoice_id: string;
  provider_id: string;
  amount_minor: unknown;
  currency: string;
  chain: string | null;
  destination: string | null;
  status: string;
  idempotency_key: string;
  requested_by: string;
  approved_by: string;
  approval_id: string | null;
  metadata: unknown;
  created_at: unknown;
  submitted_at: unknown;
  confirmed_at: unknown;
  failure_code: string | null;
  failure_message: string | null;
}

export interface ProviderPayoutInstructionView {
  id: string;
  payable_id: string;
  contract_id: string;
  invoice_id: string;
  provider_id: string;
  amount_minor: number;
  currency: string;
  chain: string | null;
  destination: string | null;
  status: string;
  idempotency_key: string;
  requested_by: string;
  approved_by: string;
  approval_id: string | null;
  metadata: unknown;
  created_at: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

export interface ProviderPayoutView {
  id: string;
  instruction_id: string;
  payable_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  transaction_id: string | null;
  provider_reference: string | null;
  confirmed_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  raw: unknown;
  created_at: string | null;
}

function mapInstruction(row: InstructionRow): ProviderPayoutInstructionView {
  return {
    id: row.id,
    payable_id: row.payable_id,
    contract_id: row.contract_id,
    invoice_id: row.invoice_id,
    provider_id: row.provider_id,
    amount_minor: minor(row.amount_minor),
    currency: row.currency,
    chain: row.chain,
    destination: row.destination,
    status: row.status,
    idempotency_key: row.idempotency_key,
    requested_by: row.requested_by,
    approved_by: row.approved_by,
    approval_id: row.approval_id,
    metadata: row.metadata,
    created_at: iso(row.created_at),
    submitted_at: iso(row.submitted_at),
    confirmed_at: iso(row.confirmed_at),
    failure_code: row.failure_code,
    failure_message: row.failure_message,
  };
}

async function instructionById(db: Db, id: string): Promise<ProviderPayoutInstructionView> {
  const result = await db.query<InstructionRow>(
    `SELECT i.id, i.payable_id, pp.contract_id, pp.invoice_id, pp.provider_id,
            i.amount_minor, i.currency, i.chain, i.destination, i.status,
            i.idempotency_key, i.requested_by, i.approved_by, i.approval_id,
            i.metadata, i.created_at, i.submitted_at, i.confirmed_at,
            i.failure_code, i.failure_message
     FROM provider_payout_instructions i
     JOIN provider_payables pp ON pp.id = i.payable_id
     WHERE i.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "provider_payout_instruction_not_found",
      "Provider payout instruction not found.",
    );
  }
  return mapInstruction(row);
}

export async function listProviderPayoutInstructions(
  db: Db,
  filters: { payableId?: string | null; status?: string | null; limit?: number } = {},
): Promise<ProviderPayoutInstructionView[]> {
  const result = await db.query<InstructionRow>(
    `SELECT i.id, i.payable_id, pp.contract_id, pp.invoice_id, pp.provider_id,
            i.amount_minor, i.currency, i.chain, i.destination, i.status,
            i.idempotency_key, i.requested_by, i.approved_by, i.approval_id,
            i.metadata, i.created_at, i.submitted_at, i.confirmed_at,
            i.failure_code, i.failure_message
     FROM provider_payout_instructions i
     JOIN provider_payables pp ON pp.id = i.payable_id
     WHERE ($1::uuid IS NULL OR i.payable_id = $1)
       AND ($2::text IS NULL OR i.status = $2)
     ORDER BY i.created_at DESC LIMIT $3`,
    [
      filters.payableId ?? null,
      filters.status ?? null,
      Math.min(Math.max(filters.limit ?? 100, 1), 500),
    ],
  );
  return result.rows.map(mapInstruction);
}

async function payableForUpdate(tx: Db, id: string): Promise<PayableRow> {
  const result = await tx.query<PayableRow>(
    `SELECT id, contract_id, invoice_id, provider_id, amount_minor, paid_minor,
            currency, status, approval_id, authorized_at
     FROM provider_payables WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "provider_payable_not_found", "Provider payable not found.");
  return row;
}

async function assertProviderPayoutNotBlocked(tx: Db, payable: PayableRow): Promise<void> {
  const blocks = await tx.query<{ id: string; kind: string; summary: string }>(
    `SELECT id, kind, summary FROM financial_exceptions
     WHERE invoice_id = $1
       AND kind LIKE 'provider_payout%'
       AND status IN ('open', 'investigating', 'correction_proposed', 'awaiting_approval')
     ORDER BY created_at DESC`,
    [payable.invoice_id],
  );
  if (blocks.rows.length > 0) {
    throw new ApiError(
      409,
      "provider_payout_blocked",
      "An open provider payout exception blocks another payout instruction.",
      { violations: blocks.rows.map((block) => `financial_exception:${block.kind}:${block.id}`) },
    );
  }
}

function outstanding(payable: PayableRow): number {
  return Math.max(0, minor(payable.amount_minor) - minor(payable.paid_minor));
}

function assertPayableOpen(payable: PayableRow): void {
  if (payable.status === "cancelled") {
    throw new ApiError(409, "provider_payable_cancelled", "The provider payable is cancelled.");
  }
  if (payable.status === "paid" || outstanding(payable) <= 0) {
    throw new ApiError(409, "provider_payable_paid", "The provider payable is already paid.");
  }
}

async function createInstructionTx(
  tx: Db,
  input: {
    payable: PayableRow;
    amountMinor: number;
    chain: string;
    destination: string;
    requestedBy: string;
    approvedBy: string;
    approvalId: string | null;
    actorRole: string;
    idempotencyKey: string | null;
    metadata?: unknown;
  },
): Promise<ProviderPayoutInstructionView> {
  assertPayableOpen(input.payable);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ApiError(422, "provider_payout_amount_invalid", "Payout amount must be a positive integer.");
  }
  if (input.amountMinor > outstanding(input.payable)) {
    throw new ApiError(409, "provider_payout_exceeds_payable", "Payout exceeds the outstanding payable.", {
      violations: [`outstanding:${outstanding(input.payable)}`],
    });
  }
  const id = randomUUID();
  const key = input.idempotencyKey
    ? `po:${input.approvalId ?? input.payable.id}:${input.idempotencyKey}`.slice(0, 255)
    : `po:${id}`;
  await tx.query(
    `INSERT INTO provider_payout_instructions
       (id, payable_id, amount_minor, currency, chain, destination, status,
        idempotency_key, requested_by, approved_by, approval_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'created', $7, $8, $9, $10, $11::jsonb)`,
    [
      id,
      input.payable.id,
      input.amountMinor,
      input.payable.currency,
      input.chain,
      input.destination,
      key,
      input.requestedBy,
      input.approvedBy,
      input.approvalId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  await tx.query(
    `UPDATE provider_payables
     SET approval_id = $2, authorized_at = now()
     WHERE id = $1`,
    [input.payable.id, input.approvalId],
  );
  await appendAudit(tx, {
    actorId: input.approvedBy,
    actorRole: input.actorRole,
    action: "provider_payout.instruction_created",
    objectType: "provider_payout_instruction",
    objectId: id,
    idempotencyKey: input.idempotencyKey,
    after: {
      payable_id: input.payable.id,
      contract_id: input.payable.contract_id,
      invoice_id: input.payable.invoice_id,
      amount_minor: input.amountMinor,
      currency: input.payable.currency,
      chain: input.chain,
      destination: input.destination,
      requested_by: input.requestedBy,
      approval_id: input.approvalId,
    },
  });
  return instructionById(tx, id);
}

export async function requestProviderPayout(
  db: Db,
  options: {
    payableId: string;
    amountMinor?: number;
    chain?: string;
    destination?: string;
    principal: Principal;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<{
  status: "instruction_created" | "approval_required";
  instruction?: ProviderPayoutInstructionView;
  approval?: Record<string, unknown>;
  payable_id: string;
}> {
  return db.transaction(async (tx) => {
    const payable = await payableForUpdate(tx, options.payableId);
    assertPayableOpen(payable);
    const invoice = await tx.query<{ status: string }>(
      `SELECT status FROM invoices WHERE id = $1`,
      [payable.invoice_id],
    );
    if (!invoice.rows[0] || invoice.rows[0].status === "void") {
      throw new ApiError(409, "provider_payable_invoice_void", "The invoice for this payable is void.");
    }
    await assertProviderPayoutNotBlocked(tx, payable);

    const amount = options.amountMinor ?? outstanding(payable);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > outstanding(payable)) {
      throw new ApiError(422, "provider_payout_amount_invalid", "Payout amount must be a positive integer within the outstanding balance.");
    }
    const chain = options.chain ?? "solana-devnet";
    const destination = options.destination ?? "duo2-provider-payout-account";
    const authority = await checkSpendingAuthority(tx, options.principal, amount, payable.currency);

    const pending = await tx.query<{ id: string; note: string | null }>(
      `SELECT id, note FROM financial_approvals
       WHERE object_type = 'provider_payable' AND object_id = $1
         AND action = 'create_payout_instruction' AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [payable.id],
    );
    if (pending.rows[0]) {
      let note: Record<string, unknown> = {};
      try {
        note = pending.rows[0].note
          ? (JSON.parse(pending.rows[0].note) as Record<string, unknown>)
          : {};
      } catch {
        note = {};
      }
      return {
        status: "approval_required",
        payable_id: payable.id,
        approval: {
          id: pending.rows[0].id,
          object_type: "provider_payable",
          object_id: payable.id,
          action: "create_payout_instruction",
          requested_by: options.actorId,
          status: "pending",
          note,
        },
      };
    }

    if (amount <= authority.autoApproveMinor) {
      const instruction = await createInstructionTx(tx, {
        payable,
        amountMinor: amount,
        chain,
        destination,
        requestedBy: options.actorId,
        approvedBy: "policy:auto",
        approvalId: null,
        actorRole: options.actorRole,
        idempotencyKey: options.idempotencyKey,
        metadata: { source: "auto_approval_policy" },
      });
      return { status: "instruction_created", instruction, payable_id: payable.id };
    }

    const approvalId = randomUUID();
    const note = JSON.stringify({
      payable_id: payable.id,
      contract_id: payable.contract_id,
      invoice_id: payable.invoice_id,
      amount_minor: amount,
      currency: payable.currency,
      chain,
      destination,
    });
    await tx.query(
      `INSERT INTO financial_approvals
         (id, object_type, object_id, object_version, action, requested_by, status, note)
       VALUES ($1, 'provider_payable', $2, 1, 'create_payout_instruction', $3, 'pending', $4)`,
      [approvalId, payable.id, options.actorId, note],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "provider_payout.approval_requested",
      objectType: "financial_approval",
      objectId: approvalId,
      idempotencyKey: options.idempotencyKey,
      after: {
        payable_id: payable.id,
        invoice_id: payable.invoice_id,
        amount_minor: amount,
        chain,
        destination,
      },
    });
    return {
      status: "approval_required",
      payable_id: payable.id,
      approval: {
        id: approvalId,
        object_type: "provider_payable",
        object_id: payable.id,
        action: "create_payout_instruction",
        requested_by: options.actorId,
        status: "pending",
        note: JSON.parse(note) as unknown,
      },
    };
  });
}

export async function issueProviderPayoutFromApproval(
  tx: Db,
  options: {
    approvalId: string;
    approver: string;
    approverRole: string;
  },
): Promise<ProviderPayoutInstructionView> {
  const approval = await tx.query<{
    object_type: string;
    object_id: string;
    status: string;
    note: string | null;
    requested_by: string;
  }>(
    `SELECT object_type, object_id, status, note, requested_by
     FROM financial_approvals WHERE id = $1 FOR UPDATE`,
    [options.approvalId],
  );
  const row = approval.rows[0];
  if (!row || row.object_type !== "provider_payable") {
    throw new ApiError(404, "provider_payout_approval_not_found", "Provider payout approval not found.");
  }
  if (row.status !== "pending") {
    throw new ApiError(409, "financial_approval_decided", `Approval is already ${row.status}.`);
  }
  let note: Record<string, unknown> = {};
  try {
    note = row.note ? (JSON.parse(row.note) as Record<string, unknown>) : {};
  } catch {
    throw new ApiError(409, "provider_payout_approval_invalid", "The payout approval note is invalid.");
  }
  const payable = await payableForUpdate(tx, row.object_id);
  await assertProviderPayoutNotBlocked(tx, payable);
  const amount = Number(note.amount_minor);
  return createInstructionTx(tx, {
    payable,
    amountMinor: amount,
    chain: typeof note.chain === "string" ? note.chain : "solana-devnet",
    destination: typeof note.destination === "string"
      ? note.destination
      : "duo2-provider-payout-account",
    requestedBy: row.requested_by,
    approvedBy: options.approver,
    approvalId: options.approvalId,
    actorRole: options.approverRole,
    idempotencyKey: null,
    metadata: { source: "human_approved_provider_payout" },
  });
}

export async function submitProviderPayout(
  db: Db,
  options: {
    instructionId: string;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<ProviderPayoutInstructionView> {
  return db.transaction(async (tx) => {
    const result = await tx.query<InstructionRow>(
      `SELECT i.id, i.payable_id, pp.contract_id, pp.invoice_id, pp.provider_id,
              i.amount_minor, i.currency, i.chain, i.destination, i.status,
              i.idempotency_key, i.requested_by, i.approved_by, i.approval_id,
              i.metadata, i.created_at, i.submitted_at, i.confirmed_at,
              i.failure_code, i.failure_message
       FROM provider_payout_instructions i
       JOIN provider_payables pp ON pp.id = i.payable_id
       WHERE i.id = $1 FOR UPDATE`,
      [options.instructionId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "provider_payout_instruction_not_found", "Provider payout instruction not found.");
    }
    if (row.status === "submitted" || row.status === "confirmed") return instructionById(tx, row.id);
    if (row.status !== "created") {
      throw new ApiError(409, "provider_payout_not_submittable", `Payout instruction is ${row.status}.`);
    }
    const payable = await payableForUpdate(tx, row.payable_id);
    await assertProviderPayoutNotBlocked(tx, payable);
    await tx.query(
      `UPDATE provider_payout_instructions SET status = 'submitted', submitted_at = now() WHERE id = $1`,
      [row.id],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "provider_payout.submitted",
      objectType: "provider_payout_instruction",
      objectId: row.id,
      idempotencyKey: options.idempotencyKey,
      after: { amount_minor: minor(row.amount_minor), chain: row.chain, destination: row.destination },
    });
    return instructionById(tx, row.id);
  });
}

function mapPayout(row: {
  id: string;
  instruction_id: string;
  payable_id: string;
  amount_minor: unknown;
  currency: string;
  status: string;
  transaction_id: string | null;
  provider_reference: string | null;
  confirmed_at: unknown;
  failure_code: string | null;
  failure_message: string | null;
  raw: unknown;
  created_at: unknown;
}): ProviderPayoutView {
  return {
    id: row.id,
    instruction_id: row.instruction_id,
    payable_id: row.payable_id,
    amount_minor: minor(row.amount_minor),
    currency: row.currency,
    status: row.status,
    transaction_id: row.transaction_id,
    provider_reference: row.provider_reference,
    confirmed_at: iso(row.confirmed_at),
    failure_code: row.failure_code,
    failure_message: row.failure_message,
    raw: row.raw,
    created_at: iso(row.created_at),
  };
}

export async function listProviderPayouts(
  db: Db,
  filters: { payableId?: string | null; status?: string | null; limit?: number } = {},
): Promise<ProviderPayoutView[]> {
  const result = await db.query<Parameters<typeof mapPayout>[0]>(
    `SELECT p.id, p.instruction_id, p.payable_id, p.amount_minor, p.currency, p.status,
            p.transaction_id, p.provider_reference, p.confirmed_at, p.failure_code,
            p.failure_message, p.raw, p.created_at
     FROM provider_payouts p
     WHERE ($1::uuid IS NULL OR p.payable_id = $1)
       AND ($2::text IS NULL OR p.status = $2)
     ORDER BY p.created_at DESC LIMIT $3`,
    [
      filters.payableId ?? null,
      filters.status ?? null,
      Math.min(Math.max(filters.limit ?? 100, 1), 500),
    ],
  );
  return result.rows.map(mapPayout);
}

export async function confirmProviderPayout(
  db: Db,
  options: {
    instructionId: string;
    status: "confirmed" | "failed";
    amountMinor: number;
    transactionId: string;
    providerReference: string;
    confirmedAt?: string;
    failureCode?: string;
    failureMessage?: string;
    raw?: unknown;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<{
  instruction: ProviderPayoutInstructionView;
  payout_id: string;
  payable_status: string;
  paid_minor: number;
  outstanding_minor: number;
}> {
  return db.transaction(async (tx) => {
    const instructionResult = await tx.query<InstructionRow>(
      `SELECT i.id, i.payable_id, pp.contract_id, pp.invoice_id, pp.provider_id,
              i.amount_minor, i.currency, i.chain, i.destination, i.status,
              i.idempotency_key, i.requested_by, i.approved_by, i.approval_id,
              i.metadata, i.created_at, i.submitted_at, i.confirmed_at,
              i.failure_code, i.failure_message
       FROM provider_payout_instructions i
       JOIN provider_payables pp ON pp.id = i.payable_id
       WHERE i.id = $1 FOR UPDATE`,
      [options.instructionId],
    );
    const instruction = instructionResult.rows[0];
    if (!instruction) {
      throw new ApiError(404, "provider_payout_instruction_not_found", "Provider payout instruction not found.");
    }
    const payable = await payableForUpdate(tx, instruction.payable_id);
    if (instruction.status === "confirmed" || instruction.status === "failed") {
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM provider_payouts WHERE instruction_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [instruction.id],
      );
      return {
        instruction: await instructionById(tx, instruction.id),
        payout_id: existing.rows[0]?.id ?? "",
        payable_status: payable.status,
        paid_minor: minor(payable.paid_minor),
        outstanding_minor: outstanding(payable),
      };
    }
    if (instruction.status !== "submitted") {
      throw new ApiError(
        409,
        "provider_payout_not_submitted",
        "Submit the provider payout instruction before confirming settlement.",
      );
    }
    const amount = options.amountMinor;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > minor(instruction.amount_minor)) {
      throw new ApiError(422, "provider_payout_amount_invalid", "Payout amount must be positive and not exceed the instruction.");
    }
    if (amount > outstanding(payable)) {
      throw new ApiError(409, "provider_payout_exceeds_payable", "Payout exceeds the outstanding payable.", {
        violations: [`outstanding:${outstanding(payable)}`],
      });
    }
    const confirmedAt = options.confirmedAt ?? new Date().toISOString();
    const payoutId = randomUUID();

    if (options.status === "failed") {
      await tx.query(
        `INSERT INTO provider_payouts
           (id, instruction_id, payable_id, amount_minor, currency, status,
            transaction_id, provider_reference, confirmed_at, failure_code,
            failure_message, raw, created_at)
         VALUES ($1, $2, $3, $4, $5, 'failed', $6, NULL, $7, $8, $9, $10::jsonb, $11)`,
        [
          payoutId,
          instruction.id,
          payable.id,
          amount,
          instruction.currency,
          options.transactionId,
          confirmedAt,
          options.failureCode ?? "provider_payout_failed",
          options.failureMessage ?? "The provider payout failed.",
          JSON.stringify({ ...(options.raw as Record<string, unknown>), provider_reference: options.providerReference }),
          confirmedAt,
        ],
      );
      await tx.query(
        `UPDATE provider_payout_instructions
         SET status = 'failed', failure_code = $2, failure_message = $3
         WHERE id = $1`,
        [
          instruction.id,
          options.failureCode ?? "provider_payout_failed",
          options.failureMessage ?? "The provider payout failed.",
        ],
      );
      const exceptionId = randomUUID();
      await tx.query(
        `INSERT INTO financial_exceptions
           (id, kind, status, severity, deal_id, contract_id, invoice_id, summary, evidence)
         VALUES ($1, 'provider_payout_failed', 'open', 'high',
                 (SELECT deal_id FROM contracts WHERE id = $2), $2, $3, $4, $5::jsonb)`,
        [
          exceptionId,
          payable.contract_id,
          payable.invoice_id,
          `Provider payout ${options.transactionId || "without a transaction id"} failed for ${amount} minor.`,
          JSON.stringify({
            payout_id: payoutId,
            payout_instruction_id: instruction.id,
            payable_id: payable.id,
            provider_id: payable.provider_id,
            transaction_id: options.transactionId,
            provider_reference: options.providerReference,
            failure_code: options.failureCode ?? "provider_payout_failed",
            failure_message: options.failureMessage ?? "The provider payout failed.",
            amount_minor: amount,
          }),
        ],
      );
      await tx.query(
        `INSERT INTO agent_work_items (id, kind, deal_id, status, payload)
         VALUES ($1, 'financial_exception',
                 (SELECT deal_id FROM contracts WHERE id = $2), 'pending', $3::jsonb)`,
        [
          randomUUID(),
          payable.contract_id,
          JSON.stringify({
            exception_id: exceptionId,
            kind: "provider_payout_failed",
            payout_id: payoutId,
            payable_id: payable.id,
            invoice_id: payable.invoice_id,
          }),
        ],
      );
      await appendAudit(tx, {
        actorId: options.actorId,
        actorRole: options.actorRole,
        action: "provider_payout.settlement_failed",
        objectType: "provider_payout",
        objectId: payoutId,
        idempotencyKey: options.idempotencyKey,
        after: {
          instruction_id: instruction.id,
          payable_id: payable.id,
          amount_minor: amount,
          transaction_id: options.transactionId,
          provider_reference: options.providerReference,
          failure_code: options.failureCode ?? "provider_payout_failed",
        },
      });
      return {
        instruction: await instructionById(tx, instruction.id),
        payout_id: payoutId,
        payable_status: payable.status,
        paid_minor: minor(payable.paid_minor),
        outstanding_minor: outstanding(payable),
      };
    }

    const duplicate = await tx.query<{ id: string }>(
      `SELECT id FROM provider_payouts WHERE provider_reference = $1`,
      [options.providerReference],
    );
    if (duplicate.rows[0]) {
      throw new ApiError(409, "provider_payout_reference_reused", "This provider payout reference was already recorded.");
    }

    const newPaid = minor(payable.paid_minor) + amount;
    const payableStatus = newPaid >= minor(payable.amount_minor) ? "paid" : "partially_paid";
    await tx.query(
      `INSERT INTO provider_payouts
         (id, instruction_id, payable_id, amount_minor, currency, status,
          transaction_id, provider_reference, confirmed_at, raw, created_at)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, $9::jsonb, $8)`,
      [
        payoutId,
        instruction.id,
        payable.id,
        amount,
        instruction.currency,
        options.transactionId,
        options.providerReference,
        confirmedAt,
        JSON.stringify(options.raw ?? {}),
      ],
    );
    await tx.query(
      `UPDATE provider_payout_instructions SET status = 'confirmed', confirmed_at = $2 WHERE id = $1`,
      [instruction.id, confirmedAt],
    );
    await tx.query(
      `UPDATE provider_payables
       SET paid_minor = paid_minor + $2,
           status = $3,
           paid_at = CASE WHEN $3 = 'paid' THEN $4::timestamptz ELSE paid_at END
       WHERE id = $1`,
      [payable.id, amount, payableStatus, confirmedAt],
    );
    await postJournalEntryTx(tx, {
      description: `Provider payout ${options.transactionId} paid for payable ${payable.id.slice(0, 8)}`,
      sourceType: "provider_payout",
      sourceId: payoutId,
      lines: [
        {
          accountCode: "2000",
          debitMinor: amount,
          partyId: payable.provider_id,
          metadata: {
            contract_id: payable.contract_id,
            invoice_id: payable.invoice_id,
            payable_id: payable.id,
            payout_id: payoutId,
            instruction_id: instruction.id,
          },
        },
        {
          accountCode: "1000",
          creditMinor: amount,
          metadata: {
            contract_id: payable.contract_id,
            invoice_id: payable.invoice_id,
            payable_id: payable.id,
            payout_id: payoutId,
            instruction_id: instruction.id,
          },
        },
      ],
      metadata: {
        contract_id: payable.contract_id,
        invoice_id: payable.invoice_id,
        payable_id: payable.id,
        payout_id: payoutId,
        provider_id: payable.provider_id,
        transaction_id: options.transactionId,
        provider_reference: options.providerReference,
      },
    });
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "provider_payout.settled",
      objectType: "provider_payout",
      objectId: payoutId,
      idempotencyKey: options.idempotencyKey,
      after: {
        instruction_id: instruction.id,
        payable_id: payable.id,
        amount_minor: amount,
        provider_reference: options.providerReference,
        transaction_id: options.transactionId,
        payable_status: payableStatus,
        paid_minor: newPaid,
      },
    });
    return {
      instruction: await instructionById(tx, instruction.id),
      payout_id: payoutId,
      payable_status: payableStatus,
      paid_minor: newPaid,
      outstanding_minor: Math.max(0, minor(payable.amount_minor) - newPaid),
    };
  });
}

export async function retryProviderPayout(
  db: Db,
  options: {
    instructionId: string;
    principal: Principal;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<ProviderPayoutInstructionView> {
  return db.transaction(async (tx) => {
    const instructionResult = await tx.query<InstructionRow>(
      `SELECT i.id, i.payable_id, pp.contract_id, pp.invoice_id, pp.provider_id,
              i.amount_minor, i.currency, i.chain, i.destination, i.status,
              i.idempotency_key, i.requested_by, i.approved_by, i.approval_id,
              i.metadata, i.created_at, i.submitted_at, i.confirmed_at,
              i.failure_code, i.failure_message
       FROM provider_payout_instructions i
       JOIN provider_payables pp ON pp.id = i.payable_id
       WHERE i.id = $1 FOR UPDATE`,
      [options.instructionId],
    );
    const instruction = instructionResult.rows[0];
    if (!instruction) {
      throw new ApiError(404, "provider_payout_instruction_not_found", "Provider payout instruction not found.");
    }
    if (instruction.status !== "failed") {
      throw new ApiError(409, "provider_payout_not_failed", "Only a failed provider payout can be retried.");
    }
    const payable = await payableForUpdate(tx, instruction.payable_id);
    assertPayableOpen(payable);
    await assertProviderPayoutNotBlocked(tx, payable);
    await checkSpendingAuthority(
      tx,
      options.principal,
      minor(instruction.amount_minor),
      payable.currency,
    );
    if (instruction.approval_id) {
      const approval = await tx.query<{ status: string }>(
        `SELECT status FROM financial_approvals WHERE id = $1`,
        [instruction.approval_id],
      );
      if (approval.rows[0]?.status !== "approved") {
        throw new ApiError(409, "provider_payout_approval_invalid", "The original payout approval is not valid.");
      }
    }
    const created = await createInstructionTx(tx, {
      payable,
      amountMinor: minor(instruction.amount_minor),
      chain: instruction.chain ?? "solana-devnet",
      destination: instruction.destination ?? "duo2-provider-payout-account",
      requestedBy: options.actorId,
      approvedBy: instruction.approved_by,
      approvalId: instruction.approval_id,
      actorRole: options.actorRole,
      idempotencyKey: options.idempotencyKey,
      metadata: { source: "failed_provider_payout_retry", previous_instruction_id: instruction.id },
    });
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "provider_payout.instruction_retried",
      objectType: "provider_payout_instruction",
      objectId: created.id,
      idempotencyKey: options.idempotencyKey,
      after: {
        previous_instruction_id: instruction.id,
        payable_id: payable.id,
        amount_minor: minor(instruction.amount_minor),
      },
    });
    return created;
  });
}
