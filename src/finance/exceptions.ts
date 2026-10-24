import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { asObject, iso, minor } from "../db/values.js";
import { ApiError } from "../errors.js";
import { postJournalEntryTx, listJournalEntries } from "./ledger.js";
import { getInvoice, type InvoiceView } from "./invoices.js";

interface ExceptionRow {
  id: string;
  kind: string;
  status: string;
  severity: string;
  deal_id: string | null;
  contract_id: string | null;
  invoice_id: string | null;
  summary: string;
  evidence: unknown;
  proposed_correction: unknown;
  assigned_to: string | null;
  created_at: unknown;
  resolved_at: unknown;
}

export interface FinancialExceptionView {
  id: string;
  kind: string;
  status: string;
  severity: string;
  deal_id: string | null;
  contract_id: string | null;
  invoice_id: string | null;
  summary: string;
  evidence: unknown;
  proposed_correction: unknown;
  assigned_to: string | null;
  created_at: string | null;
  resolved_at: string | null;
  actions: Array<{
    id: string;
    action: string;
    actor_id: string;
    details: unknown;
    created_at: string | null;
  }>;
}

function mapException(
  row: ExceptionRow,
  actions: FinancialExceptionView["actions"],
): FinancialExceptionView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    severity: row.severity,
    deal_id: row.deal_id,
    contract_id: row.contract_id,
    invoice_id: row.invoice_id,
    summary: row.summary,
    evidence: row.evidence,
    proposed_correction: row.proposed_correction,
    assigned_to: row.assigned_to,
    created_at: iso(row.created_at),
    resolved_at: iso(row.resolved_at),
    actions,
  };
}

async function actionsFor(db: Db, exceptionId: string): Promise<FinancialExceptionView["actions"]> {
  const result = await db.query<{
    id: string;
    action: string;
    actor_id: string;
    details: unknown;
    created_at: unknown;
  }>(
    `SELECT id, action, actor_id, details, created_at FROM exception_actions
     WHERE exception_id = $1 ORDER BY created_at ASC`,
    [exceptionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actor_id: row.actor_id,
    details: row.details,
    created_at: iso(row.created_at),
  }));
}

export async function getException(db: Db, id: string): Promise<FinancialExceptionView | null> {
  const result = await db.query<ExceptionRow>(
    `SELECT id, kind, status, severity, deal_id, contract_id, invoice_id, summary,
            evidence, proposed_correction, assigned_to, created_at, resolved_at
     FROM financial_exceptions WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapException(row, await actionsFor(db, id));
}

export async function listExceptions(
  db: Db,
  filters: { status?: string | null; kind?: string | null; limit?: number } = {},
): Promise<FinancialExceptionView[]> {
  const result = await db.query<ExceptionRow>(
    `SELECT id, kind, status, severity, deal_id, contract_id, invoice_id, summary,
            evidence, proposed_correction, assigned_to, created_at, resolved_at
     FROM financial_exceptions
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::text IS NULL OR kind = $2)
     ORDER BY created_at DESC LIMIT $3`,
    [filters.status ?? null, filters.kind ?? null, Math.min(Math.max(filters.limit ?? 100, 1), 500)],
  );
  const resultView: FinancialExceptionView[] = [];
  for (const row of result.rows) resultView.push(mapException(row, await actionsFor(db, row.id)));
  return resultView;
}

export async function getExceptionEvidence(db: Db, id: string): Promise<unknown> {
  const exception = await getException(db, id);
  if (!exception) throw new ApiError(404, "financial_exception_not_found", "Financial exception not found.");
  const contract = exception.contract_id
    ? await db.query<Record<string, unknown>>(
        `SELECT id, deal_id, deal_version, buyer_id, provider_id, status, currency, terms,
                approved_at, starts_at, ends_at, created_at
         FROM contracts WHERE id = $1`,
        [exception.contract_id],
      )
    : { rows: [] };
  const invoices = exception.invoice_id
    ? [await getInvoice(db, exception.invoice_id)]
    : exception.contract_id
      ? (await db.query<{ id: string }>(`SELECT id FROM invoices WHERE contract_id = $1 ORDER BY created_at`, [exception.contract_id])).rows.map((row) => row.id)
      : [];
  const invoiceViews: InvoiceView[] = [];
  for (const invoiceId of invoices) {
    invoiceViews.push(typeof invoiceId === "string" ? await getInvoice(db, invoiceId) : invoiceId);
  }
  const usage = exception.contract_id
    ? await db.query<Record<string, unknown>>(
        `SELECT u.id, u.execution_event_id, u.gpu_model, u.gpu_count, u.gpu_seconds,
                u.billing_basis, u.verified_at, u.evidence,
                b.id AS billing_calculation_id, b.amount_minor, b.currency,
                b.breakdown, b.calculation_version
         FROM verified_usage u
         LEFT JOIN billing_calculations b ON b.usage_id = u.id
         WHERE u.contract_id = $1 ORDER BY u.verified_at`,
        [exception.contract_id],
      )
    : { rows: [] };
  const payments = exception.invoice_id
    ? await db.query<Record<string, unknown>>(
        `SELECT id, invoice_id, amount_minor, currency, status, provider_reference,
                confirmed_at, raw, created_at
         FROM payments WHERE invoice_id = $1 ORDER BY created_at`,
        [exception.invoice_id],
      )
    : { rows: [] };
  const approvals = await db.query<Record<string, unknown>>(
    `SELECT id, object_type, object_id, action, requested_by, approved_by, status,
            note, created_at, decided_at
     FROM financial_approvals
     WHERE object_type = 'financial_exception' AND object_id = $1
     ORDER BY created_at DESC`,
    [id],
  );
  const ledger = await listJournalEntries(db, {
    sourceType: "invoice_adjustment",
    sourceId: exception.invoice_id,
    limit: 100,
  });
  return {
    exception,
    contract: contract.rows[0] ?? null,
    invoices: invoiceViews,
    verified_usage: usage.rows,
    payments: payments.rows,
    financial_approvals: approvals.rows,
    correction_ledger_entries: ledger,
    generated_at: new Date().toISOString(),
    source: "persisted_records",
  };
}

export async function recordInvestigation(
  db: Db,
  options: {
    exceptionId: string;
    findings: string;
    assignedTo?: string | null;
    sources?: unknown;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<FinancialExceptionView> {
  return db.transaction(async (tx) => {
    const result = await tx.query<ExceptionRow>(
      `SELECT id, kind, status, severity, deal_id, contract_id, invoice_id, summary,
              evidence, proposed_correction, assigned_to, created_at, resolved_at
       FROM financial_exceptions WHERE id = $1 FOR UPDATE`,
      [options.exceptionId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "financial_exception_not_found", "Financial exception not found.");
    if (["resolved", "dismissed"].includes(row.status)) {
      throw new ApiError(409, "exception_closed", `Exception is ${row.status}.`);
    }
    const actionId = randomUUID();
    await tx.query(
      `INSERT INTO exception_actions (id, exception_id, action, actor_id, details)
       VALUES ($1, $2, 'investigation_recorded', $3, $4::jsonb)`,
      [
        actionId,
        row.id,
        options.actorId,
        JSON.stringify({
          findings: options.findings,
          sources: options.sources ?? [],
          assigned_to: options.assignedTo ?? options.actorId,
        }),
      ],
    );
    await tx.query(
      `UPDATE financial_exceptions
       SET status = CASE WHEN status = 'open' THEN 'investigating' ELSE status END,
           assigned_to = COALESCE($2, assigned_to)
       WHERE id = $1`,
      [row.id, options.assignedTo ?? options.actorId],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "financial_exception.investigated",
      objectType: "financial_exception",
      objectId: row.id,
      dealId: row.deal_id,
      idempotencyKey: options.idempotencyKey,
      after: { findings: options.findings, sources: options.sources ?? [] },
    });
    const updated = await getException(tx, row.id);
    if (!updated) throw new ApiError(500, "exception_write_failed", "Exception could not be read back.");
    return updated;
  });
}

export async function proposeCorrection(
  db: Db,
  options: {
    exceptionId: string;
    correctedTotalMinor: number;
    reason: string;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<{ exception: FinancialExceptionView; approval: Record<string, unknown> }> {
  if (!Number.isSafeInteger(options.correctedTotalMinor) || options.correctedTotalMinor < 0) {
    throw new ApiError(422, "corrected_total_invalid", "corrected_total_minor must be a non-negative integer.");
  }
  return db.transaction(async (tx) => {
    const result = await tx.query<ExceptionRow>(
      `SELECT id, kind, status, severity, deal_id, contract_id, invoice_id, summary,
              evidence, proposed_correction, assigned_to, created_at, resolved_at
       FROM financial_exceptions WHERE id = $1 FOR UPDATE`,
      [options.exceptionId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "financial_exception_not_found", "Financial exception not found.");
    if (!["open", "investigating", "correction_proposed"].includes(row.status)) {
      throw new ApiError(409, "exception_not_open", `Exception is ${row.status}.`);
    }
    if (!row.invoice_id) throw new ApiError(409, "exception_invoice_missing", "No invoice is attached to this exception.");
    const invoice = await tx.query<{ total_minor: unknown; paid_minor: unknown; status: string }>(
      `SELECT total_minor, paid_minor, status FROM invoices WHERE id = $1 FOR UPDATE`,
      [row.invoice_id],
    );
    const invoiceRow = invoice.rows[0];
    if (!invoiceRow) throw new ApiError(404, "invoice_not_found", "Invoice not found.");
    if (invoiceRow.status === "paid") throw new ApiError(409, "invoice_already_paid", "A paid invoice needs a refund workflow.");
    if (options.correctedTotalMinor >= minor(invoiceRow.total_minor)) {
      throw new ApiError(422, "correction_not_a_reduction", "This correction must reduce the invoice total.", {
        violations: ["correction_not_a_reduction"],
      });
    }
    const proposal = {
      action: "adjust_invoice",
      invoice_id: row.invoice_id,
      current_total_minor: minor(invoiceRow.total_minor),
      corrected_total_minor: options.correctedTotalMinor,
      delta_minor: options.correctedTotalMinor - minor(invoiceRow.total_minor),
      reason: options.reason,
      requested_by: options.actorId,
      requested_at: new Date().toISOString(),
    };
    const approvalId = randomUUID();
    await tx.query(
      `INSERT INTO financial_approvals
         (id, object_type, object_id, object_version, action, requested_by, status, note)
       VALUES ($1, 'financial_exception', $2, 1, 'adjust_invoice', $3, 'pending', $4)`,
      [approvalId, row.id, options.actorId, options.reason],
    );
    await tx.query(
      `INSERT INTO invoice_adjustments
         (id, invoice_id, amount_minor, reason, status, financial_approval_id, created_by)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
      [
        randomUUID(),
        row.invoice_id,
        options.correctedTotalMinor - minor(invoiceRow.total_minor),
        options.reason,
        approvalId,
        options.actorId,
      ],
    );
    await tx.query(
      `UPDATE financial_exceptions
       SET status = 'awaiting_approval', proposed_correction = $2::jsonb
       WHERE id = $1`,
      [row.id, JSON.stringify(proposal)],
    );
    await tx.query(
      `INSERT INTO exception_actions (id, exception_id, action, actor_id, details)
       VALUES ($1, $2, 'correction_proposed', $3, $4::jsonb)`,
      [randomUUID(), row.id, options.actorId, JSON.stringify(proposal)],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "financial_exception.correction_proposed",
      objectType: "financial_exception",
      objectId: row.id,
      dealId: row.deal_id,
      idempotencyKey: options.idempotencyKey,
      after: proposal,
    });
    const exception = await getException(tx, row.id);
    if (!exception) throw new ApiError(500, "exception_write_failed", "Exception could not be read back.");
    return {
      exception,
      approval: {
        id: approvalId,
        object_type: "financial_exception",
        object_id: row.id,
        action: "adjust_invoice",
        requested_by: options.actorId,
        status: "pending",
        note: options.reason,
      },
    };
  });
}

export async function dismissException(
  db: Db,
  options: {
    exceptionId: string;
    reason: string;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<FinancialExceptionView> {
  return db.transaction(async (tx) => {
    const result = await tx.query<ExceptionRow>(
      `SELECT id, kind, status, severity, deal_id, contract_id, invoice_id, summary,
              evidence, proposed_correction, assigned_to, created_at, resolved_at
       FROM financial_exceptions WHERE id = $1 FOR UPDATE`,
      [options.exceptionId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "financial_exception_not_found", "Financial exception not found.");
    if (["resolved", "dismissed"].includes(row.status)) {
      throw new ApiError(409, "exception_closed", `Exception is ${row.status}.`);
    }
    await tx.query(
      `UPDATE financial_exceptions
       SET status = 'dismissed', resolved_at = now()
       WHERE id = $1`,
      [row.id],
    );
    await tx.query(
      `INSERT INTO exception_actions (id, exception_id, action, actor_id, details)
       VALUES ($1, $2, 'exception_dismissed', $3, $4::jsonb)`,
      [randomUUID(), row.id, options.actorId, JSON.stringify({ reason: options.reason })],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "financial_exception.dismissed",
      objectType: "financial_exception",
      objectId: row.id,
      dealId: row.deal_id,
      idempotencyKey: options.idempotencyKey,
      after: { reason: options.reason },
    });
    const updated = await getException(tx, row.id);
    if (!updated) throw new ApiError(500, "exception_write_failed", "Exception could not be read back.");
    return updated;
  });
}

export async function applyExceptionCorrection(
  tx: Db,
  options: {
    exceptionId: string;
    approvalId: string;
    approver: string;
    note?: string | null;
  },
): Promise<{ exception: FinancialExceptionView; invoice: InvoiceView }> {
  const result = await tx.query<ExceptionRow>(
    `SELECT id, kind, status, severity, deal_id, contract_id, invoice_id, summary,
            evidence, proposed_correction, assigned_to, created_at, resolved_at
     FROM financial_exceptions WHERE id = $1 FOR UPDATE`,
    [options.exceptionId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "financial_exception_not_found", "Financial exception not found.");
  if (!row.invoice_id) throw new ApiError(409, "exception_invoice_missing", "No invoice is attached to this exception.");
  const correction = asObject(row.proposed_correction);
  const corrected = Number(correction.corrected_total_minor);
  if (!Number.isSafeInteger(corrected) || corrected < 0) {
    throw new ApiError(409, "correction_invalid", "The stored correction is invalid.");
  }
  const invoiceResult = await tx.query<{
    total_minor: unknown;
    paid_minor: unknown;
    subtotal_minor: unknown;
    status: string;
    contract_id: string;
  }>(
    `SELECT total_minor, paid_minor, subtotal_minor, status, contract_id
     FROM invoices WHERE id = $1 FOR UPDATE`,
    [row.invoice_id],
  );
  const invoiceRow = invoiceResult.rows[0];
  if (!invoiceRow) throw new ApiError(404, "invoice_not_found", "Invoice not found.");
  const current = minor(invoiceRow.total_minor);
  const delta = corrected - current;
  if (delta === 0) throw new ApiError(409, "correction_no_change", "The corrected total already matches the invoice.");
  if (corrected < minor(invoiceRow.paid_minor)) {
    throw new ApiError(409, "correction_below_paid", "The corrected total cannot be below the amount already paid.");
  }
  const providerPayable = await tx.query<{ amount_minor: unknown; paid_minor: unknown }>(
    `SELECT amount_minor, paid_minor FROM provider_payables WHERE invoice_id = $1 FOR UPDATE`,
    [row.invoice_id],
  );
  const providerRow = providerPayable.rows[0];
  const newProviderAmount = providerRow ? minor(providerRow.amount_minor) + delta : null;
  if (
    providerRow &&
    newProviderAmount !== null &&
    newProviderAmount < minor(providerRow.paid_minor)
  ) {
    throw new ApiError(
      409,
      "correction_below_provider_paid",
      "The corrected invoice would reduce the provider payable below its already paid amount.",
    );
  }
  await tx.query(
    `UPDATE invoices
     SET subtotal_minor = subtotal_minor + $2,
         total_minor = total_minor + $2,
         status = CASE WHEN status = 'disputed' THEN 'issued' ELSE status END,
         updated_at = now()
     WHERE id = $1`,
    [row.invoice_id, delta],
  );
  await tx.query(
    `UPDATE invoice_adjustments SET status = 'applied', applied_at = now()
     WHERE invoice_id = $1 AND financial_approval_id = $2 AND status = 'pending'`,
    [row.invoice_id, options.approvalId],
  );
  await tx.query(
    `UPDATE payment_obligations
     SET amount_minor = CASE WHEN amount_minor + $2 > 0 THEN amount_minor + $2 ELSE amount_minor END,
         status = CASE WHEN status = 'pending' THEN 'pending' ELSE status END
     WHERE invoice_id = $1`,
    [row.invoice_id, delta],
  );
  if (delta < 0) {
    const amount = Math.abs(delta);
    await postJournalEntryTx(tx, {
      description: `Invoice correction approved for ${row.invoice_id.slice(0, 8)}`,
      sourceType: "invoice_adjustment",
      sourceId: row.invoice_id,
      lines: [
        { accountCode: "4000", debitMinor: amount, metadata: { contract_id: row.contract_id, invoice_id: row.invoice_id, exception_id: row.id } },
        { accountCode: "1100", creditMinor: amount, metadata: { contract_id: row.contract_id, invoice_id: row.invoice_id, exception_id: row.id } },
      ],
      metadata: { contract_id: row.contract_id, invoice_id: row.invoice_id, exception_id: row.id, approval_id: options.approvalId },
    });
    await postJournalEntryTx(tx, {
      description: `Provider payable reduced by invoice correction ${row.invoice_id.slice(0, 8)}`,
      sourceType: "invoice_adjustment_provider",
      sourceId: row.invoice_id,
      lines: [
        { accountCode: "2000", debitMinor: amount, metadata: { contract_id: row.contract_id, invoice_id: row.invoice_id, exception_id: row.id } },
        { accountCode: "5000", creditMinor: amount, metadata: { contract_id: row.contract_id, invoice_id: row.invoice_id, exception_id: row.id } },
      ],
      metadata: { contract_id: row.contract_id, invoice_id: row.invoice_id, exception_id: row.id, approval_id: options.approvalId },
    });
    await tx.query(
      `UPDATE provider_payables
       SET amount_minor = CASE WHEN amount_minor + $2 >= 0 THEN amount_minor + $2 ELSE 0 END,
           status = CASE
             WHEN paid_minor > 0 AND paid_minor >= amount_minor + $2 THEN 'paid'
             WHEN paid_minor > 0 THEN 'partially_paid'
             ELSE status
           END,
           paid_at = CASE
             WHEN paid_minor > 0 AND paid_minor >= amount_minor + $2 THEN COALESCE(paid_at, now())
             ELSE paid_at
           END
       WHERE invoice_id = $1`,
      [row.invoice_id, delta],
    );
  }
  await tx.query(
    `UPDATE financial_exceptions
     SET status = 'resolved', resolved_at = now()
     WHERE id = $1`,
    [row.id],
  );
  await tx.query(
    `INSERT INTO exception_actions (id, exception_id, action, actor_id, details)
     VALUES ($1, $2, 'correction_applied', $3, $4::jsonb)`,
    [
      randomUUID(),
      row.id,
      options.approver,
      JSON.stringify({
        approval_id: options.approvalId,
        previous_total_minor: current,
        corrected_total_minor: corrected,
        delta_minor: delta,
        note: options.note ?? null,
      }),
    ],
  );
  await appendAudit(tx, {
    actorId: options.approver,
    actorRole: "human",
    action: "financial_exception.correction_applied",
    objectType: "financial_exception",
    objectId: row.id,
    dealId: row.deal_id,
    after: { approval_id: options.approvalId, previous_total_minor: current, corrected_total_minor: corrected, delta_minor: delta },
  });
  const exception = await getException(tx, row.id);
  if (!exception) throw new ApiError(500, "exception_write_failed", "Exception could not be read back.");
  return { exception, invoice: await getInvoice(tx, row.invoice_id) };
}
