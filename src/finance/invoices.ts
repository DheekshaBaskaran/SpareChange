import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { asObject, iso, minor } from "../db/values.js";
import { ApiError } from "../errors.js";
import { postJournalEntryTx } from "./ledger.js";
import { getContractsForDeal } from "./contracts.js";

interface InvoiceRow {
  id: string;
  contract_id: string;
  invoice_number: string;
  status: string;
  issued_at: unknown;
  due_at: unknown;
  currency: string;
  subtotal_minor: unknown;
  tax_minor: unknown;
  total_minor: unknown;
  paid_minor: unknown;
  source: string;
  duplicate_of: string | null;
  metadata: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export interface InvoiceLineView {
  id: string;
  description: string;
  quantity: number;
  unit_rate_minor: number;
  amount_minor: number;
  usage_id: string | null;
  billing_calculation_id: string | null;
}

export interface InvoiceView {
  id: string;
  contract_id: string;
  invoice_number: string;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  paid_minor: number;
  outstanding_minor: number;
  source: string;
  duplicate_of: string | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
  lines: InvoiceLineView[];
}

function invoiceNumber(): string {
  return `INV-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
}

async function readInvoice(db: Db, id: string): Promise<InvoiceView> {
  const result = await db.query<InvoiceRow>(
    `SELECT id, contract_id, invoice_number, status, issued_at, due_at, currency,
            subtotal_minor, tax_minor, total_minor, paid_minor, source, duplicate_of,
            metadata, created_at, updated_at
     FROM invoices WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "invoice_not_found", "Invoice not found.");
  const lines = await db.query<{
    id: string;
    description: string;
    quantity: unknown;
    unit_rate_minor: unknown;
    amount_minor: unknown;
    usage_id: string | null;
    billing_calculation_id: string | null;
  }>(
    `SELECT id, description, quantity, unit_rate_minor, amount_minor, usage_id, billing_calculation_id
     FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at ASC, id ASC`,
    [id],
  );
  return {
    id: row.id,
    contract_id: row.contract_id,
    invoice_number: row.invoice_number,
    status: row.status,
    issued_at: iso(row.issued_at),
    due_at: iso(row.due_at),
    currency: row.currency,
    subtotal_minor: minor(row.subtotal_minor),
    tax_minor: minor(row.tax_minor),
    total_minor: minor(row.total_minor),
    paid_minor: minor(row.paid_minor),
    outstanding_minor: minor(row.total_minor) - minor(row.paid_minor),
    source: row.source,
    duplicate_of: row.duplicate_of,
    metadata: row.metadata,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    lines: lines.rows.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: Number(line.quantity),
      unit_rate_minor: minor(line.unit_rate_minor),
      amount_minor: minor(line.amount_minor),
      usage_id: line.usage_id,
      billing_calculation_id: line.billing_calculation_id,
    })),
  };
}

interface PendingLine {
  description: string;
  quantity: number;
  unitRateMinor: number;
  amountMinor: number;
  usageId: string | null;
  billingCalculationId: string | null;
  metadata?: unknown;
}

async function insertInvoice(
  tx: Db,
  input: {
    contractId: string;
    buyerId: string;
    providerId: string;
    currency: string;
    source: "system" | "manual" | "external";
    lines: PendingLine[];
    duplicateOf?: string | null;
    metadata?: unknown;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<InvoiceView> {
  const subtotal = input.lines.reduce((sum, line) => sum + line.amountMinor, 0);
  if (subtotal <= 0) throw new ApiError(422, "invoice_empty", "An invoice needs at least one positive charge.");
  const id = randomUUID();
  const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  await tx.query(
    `INSERT INTO invoices
       (id, contract_id, invoice_number, status, issued_at, due_at, currency,
        subtotal_minor, tax_minor, total_minor, paid_minor, source, duplicate_of, metadata)
     VALUES ($1, $2, $3, 'issued', now(), $4, $5, $6, 0, $6, 0, $7, $8, $9::jsonb)`,
    [
      id,
      input.contractId,
      invoiceNumber(),
      dueAt,
      input.currency,
      subtotal,
      input.source,
      input.duplicateOf ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  for (const line of input.lines) {
    await tx.query(
      `INSERT INTO invoice_lines
         (id, invoice_id, description, quantity, unit_rate_minor, amount_minor,
          usage_id, billing_calculation_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        randomUUID(),
        id,
        line.description,
        line.quantity,
        line.unitRateMinor,
        line.amountMinor,
        line.usageId,
        line.billingCalculationId,
        JSON.stringify(line.metadata ?? {}),
      ],
    );
  }

  const contract = await tx.query<{ terms: unknown; deal_id: string }>(
    `SELECT terms, deal_id FROM contracts WHERE id = $1`,
    [input.contractId],
  );
  const terms = asObject(contract.rows[0]?.terms);
  const dealId = contract.rows[0]?.deal_id ?? null;
  const fee = Math.min(subtotal, Math.max(0, Number(terms.coordination_fee_minor ?? 0)));
  const providerShare = Math.max(0, subtotal - fee);

  await postJournalEntryTx(tx, {
    description: `Invoice ${id.slice(0, 8)} issued for verified compute`,
    sourceType: "invoice",
    sourceId: id,
    lines: [
      { accountCode: "1100", debitMinor: subtotal, partyId: input.buyerId, metadata: { contract_id: input.contractId, invoice_id: id } },
      { accountCode: "4000", creditMinor: subtotal, metadata: { contract_id: input.contractId, invoice_id: id } },
    ],
    metadata: { contract_id: input.contractId, invoice_id: id },
  });
  if (providerShare > 0) {
    await postJournalEntryTx(tx, {
      description: `Provider payable accrued for invoice ${id.slice(0, 8)}`,
      sourceType: "invoice_provider_payable",
      sourceId: id,
      lines: [
        { accountCode: "5000", debitMinor: providerShare, metadata: { contract_id: input.contractId, invoice_id: id } },
        { accountCode: "2000", creditMinor: providerShare, partyId: input.providerId, metadata: { contract_id: input.contractId, invoice_id: id } },
      ],
      metadata: { contract_id: input.contractId, invoice_id: id },
    });
  }
  await tx.query(
    `INSERT INTO provider_payables
       (id, contract_id, invoice_id, provider_id, amount_minor, currency, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'accrued', $7::jsonb)`,
    [
      randomUUID(),
      input.contractId,
      id,
      input.providerId,
      providerShare,
      input.currency,
      JSON.stringify({ coordination_fee_minor: fee }),
    ],
  );
  await tx.query(
    `INSERT INTO payment_obligations
       (id, invoice_id, contract_id, amount_minor, currency, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb)`,
    [
      randomUUID(),
      id,
      input.contractId,
      subtotal,
      input.currency,
      JSON.stringify({ buyer_id: input.buyerId, provider_id: input.providerId }),
    ],
  );
  await appendAudit(tx, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "invoice.issued",
    objectType: "invoice",
    objectId: id,
    dealId,
    idempotencyKey: input.idempotencyKey,
    after: {
      contract_id: input.contractId,
      total_minor: subtotal,
      currency: input.currency,
      source: input.source,
      provider_payable_minor: providerShare,
      lines: input.lines.map((line) => ({
        description: line.description,
        amount_minor: line.amountMinor,
        usage_id: line.usageId,
        billing_calculation_id: line.billingCalculationId,
      })),
    },
  });
  return readInvoice(tx, id);
}

export async function generateInvoiceForContract(
  db: Db,
  options: {
    contractId: string;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<InvoiceView> {
  return db.transaction(async (tx) => {
    const contractResult = await tx.query<{
      id: string;
      deal_id: string;
      buyer_id: string;
      provider_id: string;
      currency: string;
      status: string;
      terms: unknown;
    }>(
      `SELECT id, deal_id, buyer_id, provider_id, currency, status, terms
       FROM contracts WHERE id = $1 FOR UPDATE`,
      [options.contractId],
    );
    const contract = contractResult.rows[0];
    if (!contract) throw new ApiError(404, "contract_not_found", "Contract not found.");
    if (contract.status !== "active") throw new ApiError(409, "contract_not_active", `Contract is ${contract.status}.`);
    const terms = asObject(contract.terms);

    const unbilled = await tx.query<{
      calculation_id: string;
      usage_id: string;
      amount_minor: unknown;
      currency: string;
      gpu_seconds: unknown;
      rate_minor_per_gpu_hour: unknown;
    }>(
      `SELECT b.id AS calculation_id, u.id AS usage_id, b.amount_minor, b.currency,
              u.gpu_seconds,
              COALESCE((b.breakdown->>'rate_minor_per_gpu_hour')::bigint, 0) AS rate_minor_per_gpu_hour
       FROM billing_calculations b
       JOIN verified_usage u ON u.id = b.usage_id
       WHERE b.contract_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM invoice_lines l
           WHERE l.invoice_id IN (SELECT id FROM invoices WHERE contract_id = $1 AND status <> 'void')
             AND (l.billing_calculation_id = b.id OR l.usage_id = u.id)
         )
       ORDER BY u.verified_at ASC`,
      [contract.id],
    );

    const lines: PendingLine[] = unbilled.rows.map((row) => {
      const amount = minor(row.amount_minor);
      const gpuHours = Number(row.gpu_seconds) / 3600;
      return {
        description: `Verified ${terms.gpu_model ?? "GPU"} usage (${gpuHours.toFixed(3)} GPU-hours)`,
        quantity: Math.max(0.001, Number(gpuHours.toFixed(3))),
        unitRateMinor: minor(row.rate_minor_per_gpu_hour),
        amountMinor: amount,
        usageId: row.usage_id,
        billingCalculationId: row.calculation_id,
      };
    });

    const switching = minor(terms.switching_cost_minor);
    if (switching > 0) {
      const existingFee = await tx.query<{ id: string }>(
        `SELECT l.id FROM invoice_lines l
         JOIN invoices i ON i.id = l.invoice_id
         WHERE i.contract_id = $1 AND i.status <> 'void'
           AND l.metadata->>'fee_type' = 'switching'
         LIMIT 1`,
        [contract.id],
      );
      if (!existingFee.rows[0]) {
        lines.push({
          description: "Approved workload restart and switching cost",
          quantity: 1,
          unitRateMinor: switching,
          amountMinor: switching,
          usageId: null,
          billingCalculationId: null,
          metadata: { fee_type: "switching" },
        });
      }
    }
    if (lines.length === 0) {
      throw new ApiError(409, "nothing_to_invoice", "All verified usage for this contract is already invoiced.");
    }
    return insertInvoice(tx, {
      contractId: contract.id,
      buyerId: contract.buyer_id,
      providerId: contract.provider_id,
      currency: contract.currency,
      source: "system",
      lines,
      metadata: { deal_id: contract.deal_id, terms_version: terms.deal_version },
      actorId: options.actorId,
      actorRole: options.actorRole,
      idempotencyKey: options.idempotencyKey,
    });
  });
}

export async function createManualInvoice(
  db: Db,
  options: {
    contractId: string;
    source: "manual" | "external";
    duplicateOf?: string | null;
    currency?: string;
    lines: Array<{ description: string; quantity: number; unit_rate_minor: number; amount_minor?: number }>;
    metadata?: unknown;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<InvoiceView> {
  return db.transaction(async (tx) => {
    const contract = await tx.query<{
      buyer_id: string;
      provider_id: string;
      currency: string;
      status: string;
    }>(`SELECT buyer_id, provider_id, currency, status FROM contracts WHERE id = $1`, [options.contractId]);
    const row = contract.rows[0];
    if (!row) throw new ApiError(404, "contract_not_found", "Contract not found.");
    if (row.status !== "active") throw new ApiError(409, "contract_not_active", `Contract is ${row.status}.`);
    const lines: PendingLine[] = options.lines.map((line) => {
      const amount = line.amount_minor ?? Math.round(line.quantity * line.unit_rate_minor);
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new ApiError(422, "invoice_line_amount_invalid", "Invoice line amounts must be non-negative integers.");
      }
      return {
        description: line.description,
        quantity: line.quantity,
        unitRateMinor: line.unit_rate_minor,
        amountMinor: amount,
        usageId: null,
        billingCalculationId: null,
        metadata: { fee_type: "manual" },
      };
    });
    return insertInvoice(tx, {
      contractId: options.contractId,
      buyerId: row.buyer_id,
      providerId: row.provider_id,
      currency: (options.currency ?? row.currency).toUpperCase(),
      source: options.source,
      lines,
      duplicateOf: options.duplicateOf ?? null,
      metadata: options.metadata,
      actorId: options.actorId,
      actorRole: options.actorRole,
      idempotencyKey: options.idempotencyKey,
    });
  });
}

export async function addInvoiceLine(
  db: Db,
  options: {
    invoiceId: string;
    description: string;
    quantity: number;
    unitRateMinor: number;
    amountMinor?: number;
    reason: string;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<InvoiceView> {
  return db.transaction(async (tx) => {
    const invoiceResult = await tx.query<{
      id: string;
      contract_id: string;
      status: string;
      total_minor: unknown;
      subtotal_minor: unknown;
      currency: string;
      buyer_id: string;
      provider_id: string;
    }>(
      `SELECT i.id, i.contract_id, i.status, i.total_minor, i.subtotal_minor, i.currency,
              c.buyer_id, c.provider_id
       FROM invoices i JOIN contracts c ON c.id = i.contract_id
       WHERE i.id = $1 FOR UPDATE`,
      [options.invoiceId],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) throw new ApiError(404, "invoice_not_found", "Invoice not found.");
    if (!["draft", "issued", "partially_paid", "disputed"].includes(invoice.status)) {
      throw new ApiError(409, "invoice_not_adjustable", `Invoice is ${invoice.status}.`);
    }
    const amount = options.amountMinor ?? Math.round(options.quantity * options.unitRateMinor);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ApiError(422, "invoice_line_amount_invalid", "Invoice line amount must be a positive integer.");
    }
    await tx.query(
      `INSERT INTO invoice_lines
         (id, invoice_id, description, quantity, unit_rate_minor, amount_minor, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        randomUUID(),
        invoice.id,
        options.description,
        options.quantity,
        options.unitRateMinor,
        amount,
        JSON.stringify({ fee_type: "manual_adjustment", reason: options.reason }),
      ],
    );
    await tx.query(
      `UPDATE invoices
       SET subtotal_minor = subtotal_minor + $2, total_minor = total_minor + $2, updated_at = now()
       WHERE id = $1`,
      [invoice.id, amount],
    );
    await tx.query(
      `UPDATE payment_obligations SET amount_minor = amount_minor + $2
       WHERE invoice_id = $1 AND status = 'pending'`,
      [invoice.id, amount],
    );
    await postJournalEntryTx(tx, {
      description: `Manual invoice line added to ${rowLabel(invoice.id)}`,
      sourceType: "invoice_manual_line",
      sourceId: invoice.id,
      lines: [
        { accountCode: "1100", debitMinor: amount, partyId: invoice.buyer_id, metadata: { contract_id: invoice.contract_id, invoice_id: invoice.id } },
        { accountCode: "4000", creditMinor: amount, metadata: { contract_id: invoice.contract_id, invoice_id: invoice.id } },
      ],
      metadata: { contract_id: invoice.contract_id, invoice_id: invoice.id, reason: options.reason },
    });
    await postJournalEntryTx(tx, {
      description: `Provider payable increased by manual invoice line ${rowLabel(invoice.id)}`,
      sourceType: "invoice_manual_line_provider",
      sourceId: invoice.id,
      lines: [
        { accountCode: "5000", debitMinor: amount, metadata: { contract_id: invoice.contract_id, invoice_id: invoice.id } },
        { accountCode: "2000", creditMinor: amount, partyId: invoice.provider_id, metadata: { contract_id: invoice.contract_id, invoice_id: invoice.id } },
      ],
      metadata: { contract_id: invoice.contract_id, invoice_id: invoice.id, reason: options.reason },
    });
    await tx.query(
      `UPDATE provider_payables SET amount_minor = amount_minor + $2 WHERE invoice_id = $1`,
      [invoice.id, amount],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "invoice.line_added",
      objectType: "invoice",
      objectId: invoice.id,
      idempotencyKey: options.idempotencyKey,
      after: {
        description: options.description,
        amount_minor: amount,
        reason: options.reason,
        new_total_minor: minor(invoice.total_minor) + amount,
      },
    });
    return readInvoice(tx, invoice.id);
  });
}

function rowLabel(id: string): string {
  return id.slice(0, 8);
}

export async function getInvoice(db: Db, invoiceId: string): Promise<InvoiceView> {
  return readInvoice(db, invoiceId);
}

export async function listInvoices(
  db: Db,
  filters: { contractId?: string | null; status?: string | null; limit?: number } = {},
): Promise<InvoiceView[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM invoices
     WHERE ($1::uuid IS NULL OR contract_id = $1)
       AND ($2::text IS NULL OR status = $2)
     ORDER BY created_at DESC LIMIT $3`,
    [filters.contractId ?? null, filters.status ?? null, Math.min(Math.max(filters.limit ?? 100, 1), 500)],
  );
  const invoices: InvoiceView[] = [];
  for (const row of result.rows) invoices.push(await readInvoice(db, row.id));
  return invoices;
}

export async function listContractsForDeal(db: Db, dealId: string) {
  return getContractsForDeal(db, dealId);
}
