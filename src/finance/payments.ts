import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { iso, minor } from "../db/values.js";
import { ApiError } from "../errors.js";
import type { Principal } from "../contract.js";
import { elasticInvestigationHint } from "../elastic/work-item.js";
import { postJournalEntryTx } from "./ledger.js";

interface ObligationRow {
  id: string;
  invoice_id: string;
  contract_id: string;
  amount_minor: unknown;
  currency: string;
  status: string;
  metadata: unknown;
}

interface InstructionRow {
  id: string;
  obligation_id: string;
  amount_minor: unknown;
  currency: string;
  chain: string | null;
  destination: string | null;
  status: string;
  idempotency_key: string;
  created_at: unknown;
  submitted_at: unknown;
  confirmed_at: unknown;
  failure_code: string | null;
  failure_message: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approval_id: string | null;
  metadata: unknown;
}

export interface PaymentInstructionView {
  id: string;
  obligation_id: string;
  invoice_id: string;
  contract_id: string;
  amount_minor: number;
  currency: string;
  chain: string | null;
  destination: string | null;
  status: string;
  idempotency_key: string;
  created_at: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approval_id: string | null;
  metadata: unknown;
}

function mapInstruction(row: InstructionRow & { invoice_id: string; contract_id: string }): PaymentInstructionView {
  return {
    id: row.id,
    obligation_id: row.obligation_id,
    invoice_id: row.invoice_id,
    contract_id: row.contract_id,
    amount_minor: minor(row.amount_minor),
    currency: row.currency,
    chain: row.chain,
    destination: row.destination,
    status: row.status,
    idempotency_key: row.idempotency_key,
    created_at: iso(row.created_at),
    submitted_at: iso(row.submitted_at),
    confirmed_at: iso(row.confirmed_at),
    failure_code: row.failure_code,
    failure_message: row.failure_message,
    requested_by: row.requested_by,
    approved_by: row.approved_by,
    approval_id: row.approval_id,
    metadata: row.metadata,
  };
}

async function instructionById(db: Db, id: string): Promise<PaymentInstructionView> {
  const result = await db.query<InstructionRow & { invoice_id: string; contract_id: string }>(
    `SELECT pi.id, pi.obligation_id, o.invoice_id, o.contract_id, pi.amount_minor, pi.currency,
            pi.chain, pi.destination, pi.status, pi.idempotency_key, pi.created_at,
            pi.submitted_at, pi.confirmed_at, pi.failure_code, pi.failure_message,
            pi.requested_by, pi.approved_by, pi.approval_id, pi.metadata
     FROM payment_instructions pi
     JOIN payment_obligations o ON o.id = pi.obligation_id
     WHERE pi.id = $1`,
    [id],
  );
  if (!result.rows[0]) throw new ApiError(404, "payment_instruction_not_found", "Payment instruction not found.");
  return mapInstruction(result.rows[0]);
}

export async function listPaymentInstructions(
  db: Db,
  filters: { invoiceId?: string | null; status?: string | null; limit?: number } = {},
): Promise<PaymentInstructionView[]> {
  const result = await db.query<InstructionRow & { invoice_id: string; contract_id: string }>(
    `SELECT pi.id, pi.obligation_id, o.invoice_id, o.contract_id, pi.amount_minor, pi.currency,
            pi.chain, pi.destination, pi.status, pi.idempotency_key, pi.created_at,
            pi.submitted_at, pi.confirmed_at, pi.failure_code, pi.failure_message,
            pi.requested_by, pi.approved_by, pi.approval_id, pi.metadata
     FROM payment_instructions pi
     JOIN payment_obligations o ON o.id = pi.obligation_id
     WHERE ($1::uuid IS NULL OR o.invoice_id = $1)
       AND ($2::text IS NULL OR pi.status = $2)
     ORDER BY pi.created_at DESC LIMIT $3`,
    [
      filters.invoiceId ?? null,
      filters.status ?? null,
      Math.min(Math.max(filters.limit ?? 100, 1), 500),
    ],
  );
  return result.rows.map(mapInstruction);
}

interface LimitRow {
  subject_type: string;
  subject_id: string;
  per_transaction_minor: unknown;
  daily_minor: unknown;
  auto_approve_minor: unknown;
}

async function spendingLimit(db: Db, principal: Principal, currency: string): Promise<LimitRow> {
  const result = await db.query<LimitRow>(
    `SELECT subject_type, subject_id, per_transaction_minor, daily_minor, auto_approve_minor
     FROM spending_limits
     WHERE active = true AND currency = $1
       AND (
         (subject_type = 'party' AND subject_id = $2) OR
         (subject_type = 'human' AND subject_id = $3) OR
         (subject_type = 'role' AND subject_id = $4)
       )
     ORDER BY CASE subject_type WHEN 'party' THEN 1 WHEN 'human' THEN 2 ELSE 3 END
     LIMIT 1`,
    [currency, principal.partyId ?? "", principal.humanUserId ?? "", principal.role],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(403, "spending_limit_missing", "No spending limit is configured for this principal.", {
      violations: ["spending_limit_missing"],
    });
  }
  return row;
}

export async function checkSpendingAuthority(
  db: Db,
  principal: Principal,
  amountMinor: number,
  currency: string,
): Promise<{ autoApproveMinor: number; limit: LimitRow; dailySpentMinor: number }> {
  const limit = await spendingLimit(db, principal, currency);
  const perTransaction = minor(limit.per_transaction_minor);
  const daily = minor(limit.daily_minor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new ApiError(422, "payment_amount_invalid", "Payment amount must be a positive integer minor unit.");
  }
  if (amountMinor > perTransaction) {
    throw new ApiError(403, "spending_limit_per_transaction", "Payment exceeds the per-transaction spending limit.", {
      violations: [`per_transaction_limit:${perTransaction}`],
    });
  }
  const dailyResult = await db.query<{ spent: unknown }>(
    `SELECT (
       COALESCE((SELECT sum(amount_minor) FROM payment_instructions
                 WHERE requested_by = $1 AND created_at::date = current_date
                   AND status IN ('created', 'submitted', 'confirmed')), 0) +
       COALESCE((SELECT sum(amount_minor) FROM provider_payout_instructions
                 WHERE requested_by = $1 AND created_at::date = current_date
                   AND status IN ('created', 'submitted', 'confirmed')), 0)
     )::bigint AS spent`,
    [principal.id],
  );
  const dailySpent = minor(dailyResult.rows[0]?.spent);
  if (dailySpent + amountMinor > daily) {
    throw new ApiError(409, "spending_limit_daily", "Payment exceeds the remaining daily spending limit.", {
      violations: [`daily_limit:${daily}`, `daily_spent:${dailySpent}`],
    });
  }
  return { autoApproveMinor: minor(limit.auto_approve_minor), limit, dailySpentMinor: dailySpent };
}

async function assertPaymentNotBlocked(db: Db, invoiceId: string): Promise<void> {
  const blocks = await db.query<{ id: string; kind: string; summary: string }>(
    `SELECT id, kind, summary FROM financial_exceptions
     WHERE invoice_id = $1
       AND kind NOT LIKE 'provider_payout%'
       AND status IN ('open', 'investigating', 'correction_proposed', 'awaiting_approval')
     ORDER BY created_at DESC`,
    [invoiceId],
  );
  if (blocks.rows.length > 0) {
    throw new ApiError(409, "payment_blocked", "Open financial exceptions block this payment.", {
      violations: blocks.rows.map((block) => `financial_exception:${block.kind}:${block.id}`),
    });
  }
}

async function createInstructionTx(
  tx: Db,
  input: {
    obligation: ObligationRow;
    invoiceId: string;
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
): Promise<PaymentInstructionView> {
  const id = randomUUID();
  const instructionKey = input.idempotencyKey
    ? `pi:${input.approvalId ?? input.obligation.id}:${input.idempotencyKey}`.slice(0, 255)
    : `pi:${id}`;
  await tx.query(
    `INSERT INTO payment_instructions
       (id, obligation_id, amount_minor, currency, chain, destination, status,
        idempotency_key, requested_by, approved_by, approval_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'created', $7, $8, $9, $10, $11::jsonb)`,
    [
      id,
      input.obligation.id,
      input.amountMinor,
      input.obligation.currency,
      input.chain,
      input.destination,
      instructionKey,
      input.requestedBy,
      input.approvedBy,
      input.approvalId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  await tx.query(
    `UPDATE payment_obligations
     SET status = 'authorized', authorized_at = now(), authorization_id = $2
     WHERE id = $1`,
    [input.obligation.id, input.approvalId],
  );
  await appendAudit(tx, {
    actorId: input.approvedBy,
    actorRole: input.actorRole,
    action: "payment.instruction_created",
    objectType: "payment_instruction",
    objectId: id,
    idempotencyKey: input.idempotencyKey,
    after: {
      obligation_id: input.obligation.id,
      invoice_id: input.invoiceId,
      amount_minor: input.amountMinor,
      currency: input.obligation.currency,
      chain: input.chain,
      destination: input.destination,
      requested_by: input.requestedBy,
      approval_id: input.approvalId,
    },
  });
  return instructionById(tx, id);
}

export async function requestPaymentInstruction(
  db: Db,
  options: {
    invoiceId: string;
    chain?: string;
    destination?: string;
    approvalId?: string;
    principal: Principal;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<{ status: "instruction_created" | "approval_required"; instruction?: PaymentInstructionView; approval?: Record<string, unknown>; obligation_id: string }> {
  return db.transaction(async (tx) => {
    const invoiceResult = await tx.query<{
      id: string;
      contract_id: string;
      status: string;
      total_minor: unknown;
      paid_minor: unknown;
      currency: string;
    }>(
      `SELECT id, contract_id, status, total_minor, paid_minor, currency
       FROM invoices WHERE id = $1 FOR UPDATE`,
      [options.invoiceId],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) throw new ApiError(404, "invoice_not_found", "Invoice not found.");
    if (!["issued", "partially_paid"].includes(invoice.status)) {
      throw new ApiError(409, "invoice_not_payable", `Invoice is ${invoice.status} and cannot be paid.`);
    }
    await assertPaymentNotBlocked(tx, invoice.id);
    const obligationResult = await tx.query<ObligationRow>(
      `SELECT id, invoice_id, contract_id, amount_minor, currency, status, metadata
       FROM payment_obligations WHERE invoice_id = $1 FOR UPDATE`,
      [invoice.id],
    );
    const obligation = obligationResult.rows[0];
    if (!obligation) throw new ApiError(409, "payment_obligation_missing", "Invoice has no payment obligation.");
    if (["paid", "cancelled"].includes(obligation.status)) {
      throw new ApiError(409, "obligation_not_payable", `Payment obligation is ${obligation.status}.`);
    }
    const amount = Math.min(
      minor(obligation.amount_minor),
      minor(invoice.total_minor) - minor(invoice.paid_minor),
    );
    if (amount <= 0) throw new ApiError(409, "nothing_to_pay", "The invoice has no outstanding balance.");

    const chain = options.chain ?? "solana-devnet";
    const destination = options.destination ?? "test-settlement-account";
    const authority = await checkSpendingAuthority(tx, options.principal, amount, obligation.currency);

    if (options.approvalId) {
      const approval = await tx.query<{ status: string; object_type: string; object_id: string }>(
        `SELECT status, object_type, object_id FROM financial_approvals WHERE id = $1`,
        [options.approvalId],
      );
      const row = approval.rows[0];
      if (
        !row ||
        row.object_type !== "payment_obligation" ||
        row.object_id !== obligation.id ||
        row.status !== "approved"
      ) {
        throw new ApiError(409, "payment_approval_invalid", "The payment approval is not valid for this obligation.");
      }
      const instruction = await createInstructionTx(tx, {
        obligation,
        invoiceId: invoice.id,
        amountMinor: amount,
        chain,
        destination,
        requestedBy: options.actorId,
        approvedBy: "approved-human",
        approvalId: options.approvalId,
        actorRole: options.actorRole,
        idempotencyKey: options.idempotencyKey,
        metadata: { source: "preapproved" },
      });
      return { status: "instruction_created", instruction, obligation_id: obligation.id };
    }

    if (amount <= authority.autoApproveMinor) {
      const instruction = await createInstructionTx(tx, {
        obligation,
        invoiceId: invoice.id,
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
      return { status: "instruction_created", instruction, obligation_id: obligation.id };
    }

    const approvalId = randomUUID();
    const note = JSON.stringify({
      invoice_id: invoice.id,
      obligation_id: obligation.id,
      amount_minor: amount,
      currency: obligation.currency,
      chain,
      destination,
    });
    await tx.query(
      `INSERT INTO financial_approvals
         (id, object_type, object_id, object_version, action, requested_by, status, note)
       VALUES ($1, 'payment_obligation', $2, 1, 'create_payment_instruction', $3, 'pending', $4)`,
      [approvalId, obligation.id, options.actorId, note],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "payment.approval_requested",
      objectType: "financial_approval",
      objectId: approvalId,
      idempotencyKey: options.idempotencyKey,
      after: { obligation_id: obligation.id, invoice_id: invoice.id, amount_minor: amount, chain, destination },
    });
    return {
      status: "approval_required",
      obligation_id: obligation.id,
      approval: {
        id: approvalId,
        object_type: "payment_obligation",
        object_id: obligation.id,
        action: "create_payment_instruction",
        requested_by: options.actorId,
        status: "pending",
        note: JSON.parse(note) as unknown,
      },
    };
  });
}

export async function issuePaymentInstructionFromApproval(
  tx: Db,
  options: {
    approvalId: string;
    approver: string;
    approverRole: string;
  },
): Promise<PaymentInstructionView> {
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
  if (!row || row.object_type !== "payment_obligation") {
    throw new ApiError(404, "payment_approval_not_found", "Payment approval not found.");
  }
  const note = row.note ? (JSON.parse(row.note) as Record<string, unknown>) : {};
  const obligationResult = await tx.query<ObligationRow>(
    `SELECT id, invoice_id, contract_id, amount_minor, currency, status, metadata
     FROM payment_obligations WHERE id = $1 FOR UPDATE`,
    [row.object_id],
  );
  const obligation = obligationResult.rows[0];
  if (!obligation) throw new ApiError(404, "payment_obligation_missing", "Payment obligation not found.");
  await assertPaymentNotBlocked(tx, obligation.invoice_id);
  if (obligation.status === "paid") throw new ApiError(409, "obligation_paid", "The obligation is already paid.");
  const invoice = await tx.query<{ total_minor: unknown; paid_minor: unknown }>(
    `SELECT total_minor, paid_minor FROM invoices WHERE id = $1`,
    [obligation.invoice_id],
  );
  const amount = Math.min(
    minor(obligation.amount_minor),
    minor(invoice.rows[0]?.total_minor) - minor(invoice.rows[0]?.paid_minor),
  );
  if (amount <= 0) throw new ApiError(409, "nothing_to_pay", "The invoice has no outstanding balance.");
  return createInstructionTx(tx, {
    obligation,
    invoiceId: obligation.invoice_id,
    amountMinor: amount,
    chain: typeof note.chain === "string" ? note.chain : "solana-devnet",
    destination: typeof note.destination === "string" ? note.destination : "test-settlement-account",
    requestedBy: row.requested_by,
    approvedBy: options.approver,
    approvalId: options.approvalId,
    actorRole: options.approverRole,
    idempotencyKey: null,
    metadata: { source: "human_approved" },
  });
}

export async function submitPaymentInstruction(
  db: Db,
  options: {
    instructionId: string;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<PaymentInstructionView> {
  return db.transaction(async (tx) => {
    const result = await tx.query<InstructionRow>(
      `SELECT id, obligation_id, amount_minor, currency, chain, destination, status,
              idempotency_key, created_at, submitted_at, confirmed_at, failure_code,
              failure_message, requested_by, approved_by, approval_id, metadata
       FROM payment_instructions WHERE id = $1 FOR UPDATE`,
      [options.instructionId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "payment_instruction_not_found", "Payment instruction not found.");
    if (row.status === "submitted" || row.status === "confirmed") return instructionById(tx, row.id);
    if (row.status !== "created") {
      throw new ApiError(409, "instruction_not_submittable", `Instruction is ${row.status}.`);
    }
    await tx.query(
      `UPDATE payment_instructions SET status = 'submitted', submitted_at = now() WHERE id = $1`,
      [row.id],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "payment.instruction_submitted",
      objectType: "payment_instruction",
      objectId: row.id,
      idempotencyKey: options.idempotencyKey,
      after: { amount_minor: minor(row.amount_minor), chain: row.chain, destination: row.destination },
    });
    return instructionById(tx, row.id);
  });
}

export async function confirmSettlement(
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
): Promise<{ instruction: PaymentInstructionView; payment_id: string; invoice_status: string }> {
  return db.transaction(async (tx) => {
    const instructionResult = await tx.query<InstructionRow>(
      `SELECT id, obligation_id, amount_minor, currency, chain, destination, status,
              idempotency_key, created_at, submitted_at, confirmed_at, failure_code,
              failure_message, requested_by, approved_by, approval_id, metadata
       FROM payment_instructions WHERE id = $1 FOR UPDATE`,
      [options.instructionId],
    );
    const instruction = instructionResult.rows[0];
    if (!instruction) throw new ApiError(404, "payment_instruction_not_found", "Payment instruction not found.");
    if (instruction.status === "confirmed" || instruction.status === "failed") {
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM payments WHERE instruction_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [instruction.id],
      );
      const invoice = await tx.query<{ status: string }>(
        `SELECT i.status FROM invoices i JOIN payment_obligations o ON o.invoice_id = i.id
         WHERE o.id = $1`,
        [instruction.obligation_id],
      );
      return {
        instruction: await instructionById(tx, instruction.id),
        payment_id: existing.rows[0]?.id ?? "",
        invoice_status: invoice.rows[0]?.status ?? "",
      };
    }
    if (instruction.status !== "submitted") {
      throw new ApiError(
        409,
        "settlement_not_submitted",
        "Submit the payment instruction before confirming settlement.",
      );
    }
    const existingReference = await tx.query<{ id: string }>(
      `SELECT id FROM payments WHERE provider_reference = $1`,
      [options.providerReference],
    );
    if (existingReference.rows[0]) {
      throw new ApiError(409, "settlement_reference_reused", "This provider reference was already recorded.");
    }
    const amount = options.amountMinor;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > minor(instruction.amount_minor)) {
      throw new ApiError(422, "settlement_amount_invalid", "Settlement amount must be positive and not exceed the instruction.");
    }
    const obligationResult = await tx.query<ObligationRow>(
      `SELECT id, invoice_id, contract_id, amount_minor, currency, status, metadata
       FROM payment_obligations WHERE id = $1 FOR UPDATE`,
      [instruction.obligation_id],
    );
    const obligation = obligationResult.rows[0];
    if (!obligation) throw new ApiError(404, "payment_obligation_missing", "Payment obligation not found.");
    const invoiceResult = await tx.query<{
      id: string;
      status: string;
      total_minor: unknown;
      paid_minor: unknown;
      contract_id: string;
    }>(
      `SELECT id, status, total_minor, paid_minor, contract_id FROM invoices WHERE id = $1 FOR UPDATE`,
      [obligation.invoice_id],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) throw new ApiError(404, "invoice_not_found", "Invoice not found.");
    const confirmedAt = options.confirmedAt ?? new Date().toISOString();
    const paymentId = randomUUID();

    if (options.status === "failed") {
      await tx.query(
        `INSERT INTO payments
           (id, instruction_id, invoice_id, amount_minor, currency, status, raw, created_at)
         VALUES ($1, $2, $3, $4, $5, 'failed', $6::jsonb, $7)`,
        [
          paymentId,
          instruction.id,
          invoice.id,
          amount,
          instruction.currency,
          JSON.stringify({ ...(options.raw as Record<string, unknown>), transaction_id: options.transactionId }),
          confirmedAt,
        ],
      );
      await tx.query(
        `UPDATE payment_instructions
         SET status = 'failed', failure_code = $2, failure_message = $3
         WHERE id = $1`,
        [instruction.id, options.failureCode ?? "settlement_failed", options.failureMessage ?? "The settlement failed."],
      );
      await tx.query(`UPDATE payment_obligations SET status = 'failed' WHERE id = $1`, [obligation.id]);
      const exceptionId = randomUUID();
      await tx.query(
        `INSERT INTO financial_exceptions
           (id, kind, status, severity, deal_id, contract_id, invoice_id, summary, evidence)
         VALUES ($1, 'payment_failed', 'open', 'high',
                 (SELECT deal_id FROM contracts WHERE id = $2), $2, $3, $4, $5::jsonb)`,
        [
          exceptionId,
          invoice.contract_id,
          invoice.id,
          `Settlement ${options.transactionId || "without a transaction id"} failed for ${amount} minor.`,
          JSON.stringify({
            instruction_id: instruction.id,
            transaction_id: options.transactionId,
            failure_code: options.failureCode ?? "settlement_failed",
            failure_message: options.failureMessage ?? "The settlement failed.",
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
          invoice.contract_id,
          JSON.stringify({
            exception_id: exceptionId,
            kind: "payment_failed",
            invoice_id: invoice.id,
            ...elasticInvestigationHint(exceptionId),
          }),
        ],
      );
      await appendAudit(tx, {
        actorId: options.actorId,
        actorRole: options.actorRole,
        action: "payment.settlement_failed",
        objectType: "payment_instruction",
        objectId: instruction.id,
        idempotencyKey: options.idempotencyKey,
        after: {
          payment_id: paymentId,
          amount_minor: amount,
          transaction_id: options.transactionId,
          failure_code: options.failureCode ?? "settlement_failed",
        },
      });
      return { instruction: await instructionById(tx, instruction.id), payment_id: paymentId, invoice_status: invoice.status };
    }

    await tx.query(
      `INSERT INTO payments
         (id, instruction_id, invoice_id, amount_minor, currency, status,
          provider_reference, confirmed_at, raw)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8::jsonb)`,
      [
        paymentId,
        instruction.id,
        invoice.id,
        amount,
        instruction.currency,
        options.providerReference,
        confirmedAt,
        JSON.stringify({ ...(options.raw as Record<string, unknown>), transaction_id: options.transactionId }),
      ],
    );
    await tx.query(
      `UPDATE payment_instructions SET status = 'confirmed', confirmed_at = $2 WHERE id = $1`,
      [instruction.id, confirmedAt],
    );
    const newPaid = minor(invoice.paid_minor) + amount;
    const newStatus = newPaid >= minor(invoice.total_minor) ? "paid" : "partially_paid";
    await tx.query(
      `UPDATE invoices SET paid_minor = $2, status = $3, updated_at = now() WHERE id = $1`,
      [invoice.id, newPaid, newStatus],
    );
    await tx.query(
      `UPDATE payment_obligations SET status = 'paid' WHERE id = $1`,
      [obligation.id],
    );
    await postJournalEntryTx(tx, {
      description: `Settlement ${options.transactionId} received for invoice ${invoice.id.slice(0, 8)}`,
      sourceType: "payment",
      sourceId: paymentId,
      lines: [
        {
          accountCode: "1000",
          debitMinor: amount,
          metadata: { contract_id: invoice.contract_id, invoice_id: invoice.id, payment_id: paymentId, transaction_id: options.transactionId },
        },
        {
          accountCode: "1100",
          creditMinor: amount,
          metadata: { contract_id: invoice.contract_id, invoice_id: invoice.id, payment_id: paymentId, transaction_id: options.transactionId },
        },
      ],
      metadata: {
        contract_id: invoice.contract_id,
        invoice_id: invoice.id,
        payment_id: paymentId,
        provider_reference: options.providerReference,
        transaction_id: options.transactionId,
        chain: instruction.chain,
      },
    });
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "payment.settled",
      objectType: "payment",
      objectId: paymentId,
      idempotencyKey: options.idempotencyKey,
      after: {
        instruction_id: instruction.id,
        invoice_id: invoice.id,
        amount_minor: amount,
        provider_reference: options.providerReference,
        transaction_id: options.transactionId,
        invoice_status: newStatus,
      },
    });
    return {
      instruction: await instructionById(tx, instruction.id),
      payment_id: paymentId,
      invoice_status: newStatus,
    };
  });
}

export async function retryFailedInstruction(
  db: Db,
  options: {
    instructionId: string;
    principal: Principal;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<PaymentInstructionView> {
  return db.transaction(async (tx) => {
    const instructionResult = await tx.query<InstructionRow>(
      `SELECT id, obligation_id, amount_minor, currency, chain, destination, status,
              idempotency_key, created_at, submitted_at, confirmed_at, failure_code,
              failure_message, requested_by, approved_by, approval_id, metadata
       FROM payment_instructions WHERE id = $1 FOR UPDATE`,
      [options.instructionId],
    );
    const instruction = instructionResult.rows[0];
    if (!instruction) throw new ApiError(404, "payment_instruction_not_found", "Payment instruction not found.");
    if (instruction.status !== "failed") {
      throw new ApiError(409, "instruction_not_failed", "Only a failed instruction can be retried.");
    }
    const obligation = await tx.query<ObligationRow>(
      `SELECT id, invoice_id, contract_id, amount_minor, currency, status, metadata
       FROM payment_obligations WHERE id = $1 FOR UPDATE`,
      [instruction.obligation_id],
    );
    const row = obligation.rows[0];
    if (!row) throw new ApiError(404, "payment_obligation_missing", "Payment obligation not found.");
    await assertPaymentNotBlocked(tx, row.invoice_id);
    await checkSpendingAuthority(tx, options.principal, minor(instruction.amount_minor), row.currency);
    await tx.query(`UPDATE payment_obligations SET status = 'pending' WHERE id = $1`, [row.id]);
    const created = await createInstructionTx(tx, {
      obligation: row,
      invoiceId: row.invoice_id,
      amountMinor: minor(instruction.amount_minor),
      chain: instruction.chain ?? "solana-devnet",
      destination: instruction.destination ?? "test-settlement-account",
      requestedBy: options.actorId,
      approvedBy: "retry:previous_approval",
      approvalId: instruction.approval_id,
      actorRole: options.actorRole,
      idempotencyKey: options.idempotencyKey,
      metadata: { source: "failed_payment_retry", previous_instruction_id: instruction.id },
    });
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "payment.instruction_retried",
      objectType: "payment_instruction",
      objectId: created.id,
      idempotencyKey: options.idempotencyKey,
      after: { previous_instruction_id: instruction.id, amount_minor: minor(instruction.amount_minor) },
    });
    return created;
  });
}
