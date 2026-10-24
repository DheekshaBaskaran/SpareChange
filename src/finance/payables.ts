import type { Db } from "../db/client.js";
import { ApiError } from "../errors.js";
import { iso, minor } from "../db/values.js";

export interface ProviderPayableView {
  id: string;
  contract_id: string;
  invoice_id: string;
  provider: { id: string; name: string };
  amount_minor: number;
  paid_minor: number;
  outstanding_minor: number;
  currency: string;
  status: string;
  approval_id: string | null;
  authorized_at: string | null;
  created_at: string | null;
  paid_at: string | null;
}

interface PayableRow {
  id: string;
  contract_id: string;
  invoice_id: string;
  provider_id: string;
  provider_name: string;
  amount_minor: unknown;
  paid_minor: unknown;
  currency: string;
  status: string;
  approval_id: string | null;
  authorized_at: unknown;
  created_at: unknown;
  paid_at: unknown;
}

function mapPayable(row: PayableRow): ProviderPayableView {
  const amount = minor(row.amount_minor);
  const paid = minor(row.paid_minor);
  return {
    id: row.id,
    contract_id: row.contract_id,
    invoice_id: row.invoice_id,
    provider: { id: row.provider_id, name: row.provider_name },
    amount_minor: amount,
    paid_minor: paid,
    outstanding_minor: Math.max(0, amount - paid),
    currency: row.currency,
    status: row.status,
    approval_id: row.approval_id,
    authorized_at: iso(row.authorized_at),
    created_at: iso(row.created_at),
    paid_at: iso(row.paid_at),
  };
}

export async function listProviderPayables(
  db: Db,
  filters: { contractId?: string | null; status?: string | null; limit?: number } = {},
): Promise<ProviderPayableView[]> {
  const result = await db.query<PayableRow>(
    `SELECT pp.id, pp.contract_id, pp.invoice_id, pp.provider_id, p.name AS provider_name,
            pp.amount_minor, pp.paid_minor, pp.currency, pp.status, pp.approval_id,
            pp.authorized_at, pp.created_at, pp.paid_at
     FROM provider_payables pp
     JOIN parties p ON p.id = pp.provider_id
     WHERE ($1::uuid IS NULL OR pp.contract_id = $1)
       AND ($2::text IS NULL OR pp.status = $2)
     ORDER BY pp.created_at DESC LIMIT $3`,
    [filters.contractId ?? null, filters.status ?? null, Math.min(Math.max(filters.limit ?? 100, 1), 500)],
  );
  return result.rows.map(mapPayable);
}

export async function getProviderPayable(
  db: Db,
  payableId: string,
): Promise<ProviderPayableView> {
  const result = await db.query<PayableRow>(
    `SELECT pp.id, pp.contract_id, pp.invoice_id, pp.provider_id, p.name AS provider_name,
            pp.amount_minor, pp.paid_minor, pp.currency, pp.status, pp.approval_id,
            pp.authorized_at, pp.created_at, pp.paid_at
     FROM provider_payables pp
     JOIN parties p ON p.id = pp.provider_id
     WHERE pp.id = $1`,
    [payableId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "provider_payable_not_found", "Provider payable not found.");
  return mapPayable(row);
}
