import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { ApiError } from "../errors.js";
import { asObject, iso, minor } from "../db/values.js";

export interface JournalLineInput {
  accountCode: string;
  debitMinor?: number;
  creditMinor?: number;
  partyId?: string | null;
  metadata?: unknown;
}

export interface JournalEntryInput {
  description: string;
  sourceType: string;
  sourceId?: string | null;
  entryDate?: string;
  lines: JournalLineInput[];
  metadata?: unknown;
}

export interface JournalEntryView {
  id: string;
  entry_number: string;
  entry_date: string | null;
  description: string;
  source_type: string;
  source_id: string | null;
  status: string;
  created_at: string | null;
  posted_at: string | null;
  total_debit_minor: number;
  total_credit_minor: number;
  imbalance_minor: number;
  lines: Array<{
    id: string;
    account_code: string;
    account_name: string | null;
    debit_minor: number;
    credit_minor: number;
    party_id: string | null;
    metadata: unknown;
  }>;
}

function entryNumber(): string {
  return `JE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
}

export async function postJournalEntry(
  db: Db,
  input: JournalEntryInput,
): Promise<JournalEntryView> {
  return db.transaction((tx) => postJournalEntryTx(tx, input));
}

/**
 * Post inside an existing transaction. Callers that already hold row locks use
 * this so the business write and the ledger write commit atomically.
 */
export async function postJournalEntryTx(
  tx: Db,
  input: JournalEntryInput,
): Promise<JournalEntryView> {
    if (input.lines.length < 2) {
      throw new ApiError(422, "journal_entry_incomplete", "A journal entry needs at least two lines.");
    }
    let debit = 0;
    let credit = 0;
    for (const line of input.lines) {
      const d = line.debitMinor ?? 0;
      const c = line.creditMinor ?? 0;
      if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0) {
        throw new ApiError(422, "journal_amount_invalid", "Journal amounts must be non-negative integer minor units.");
      }
      if ((d > 0 ? 1 : 0) + (c > 0 ? 1 : 0) !== 1) {
        throw new ApiError(422, "journal_line_invalid", "Each journal line must have exactly one non-zero debit or credit.");
      }
      debit += d;
      credit += c;
    }
    if (debit !== credit || debit === 0) {
      throw new ApiError(409, "journal_entry_unbalanced", "Journal entry debits and credits must balance.", {
        violations: [`imbalance:${debit - credit}`],
      });
    }

    const accounts = await tx.query<{ code: string; active: boolean }>(
      `SELECT code, active FROM ledger_accounts WHERE code = ANY($1::text[])`,
      [input.lines.map((line) => line.accountCode)],
    );
    const known = new Map(accounts.rows.map((row) => [row.code, row.active]));
    for (const line of input.lines) {
      if (!known.has(line.accountCode)) {
        throw new ApiError(422, "ledger_account_unknown", `Unknown ledger account ${line.accountCode}.`);
      }
      if (!known.get(line.accountCode)) {
        throw new ApiError(409, "ledger_account_inactive", `Ledger account ${line.accountCode} is inactive.`);
      }
    }

    const id = randomUUID();
    const entry = await tx.query<{
      id: string;
      entry_number: string;
      entry_date: unknown;
      description: string;
      source_type: string;
      source_id: string | null;
      status: string;
      created_at: unknown;
      posted_at: unknown;
    }>(
      `INSERT INTO journal_entries
         (id, entry_number, entry_date, description, source_type, source_id, status, posted_at)
       VALUES ($1, $2, COALESCE($3::date, current_date), $4, $5, $6, 'posted', now())
       RETURNING id, entry_number, entry_date, description, source_type, source_id, status, created_at, posted_at`,
      [id, entryNumber(), input.entryDate ?? null, input.description, input.sourceType, input.sourceId ?? null],
    );
    for (const line of input.lines) {
      await tx.query(
        `INSERT INTO journal_lines
           (id, entry_id, account_code, debit_minor, credit_minor, party_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          randomUUID(),
          id,
          line.accountCode,
          line.debitMinor ?? 0,
          line.creditMinor ?? 0,
          line.partyId ?? null,
          JSON.stringify({
            ...asObject(line.metadata),
            ...(input.metadata === undefined ? {} : { entry: asObject(input.metadata) }),
          }),
        ],
      );
    }
    return readJournalEntry(tx, entry.rows[0]!);
}

async function readJournalEntry(
  db: Db,
  entry: {
    id: string;
    entry_number: string;
    entry_date: unknown;
    description: string;
    source_type: string;
    source_id: string | null;
    status: string;
    created_at: unknown;
    posted_at: unknown;
  },
): Promise<JournalEntryView> {
  const lines = await db.query<{
    id: string;
    account_code: string;
    account_name: string | null;
    debit_minor: unknown;
    credit_minor: unknown;
    party_id: string | null;
    metadata: unknown;
  }>(
    `SELECT l.id, l.account_code, a.name AS account_name, l.debit_minor, l.credit_minor,
            l.party_id, l.metadata
     FROM journal_lines l
     LEFT JOIN ledger_accounts a ON a.code = l.account_code
     WHERE l.entry_id = $1
     ORDER BY l.created_at ASC, l.id ASC`,
    [entry.id],
  );
  const totalDebit = lines.rows.reduce((sum, line) => sum + minor(line.debit_minor), 0);
  const totalCredit = lines.rows.reduce((sum, line) => sum + minor(line.credit_minor), 0);
  return {
    id: entry.id,
    entry_number: entry.entry_number,
    entry_date: iso(entry.entry_date),
    description: entry.description,
    source_type: entry.source_type,
    source_id: entry.source_id,
    status: entry.status,
    created_at: iso(entry.created_at),
    posted_at: iso(entry.posted_at),
    total_debit_minor: totalDebit,
    total_credit_minor: totalCredit,
    imbalance_minor: totalDebit - totalCredit,
    lines: lines.rows.map((line) => ({
      id: line.id,
      account_code: line.account_code,
      account_name: line.account_name,
      debit_minor: minor(line.debit_minor),
      credit_minor: minor(line.credit_minor),
      party_id: line.party_id,
      metadata: line.metadata,
    })),
  };
}

export async function listJournalEntries(
  db: Db,
  filters: { sourceType?: string | null; sourceId?: string | null; limit?: number } = {},
): Promise<JournalEntryView[]> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const entries = await db.query<{
    id: string;
    entry_number: string;
    entry_date: unknown;
    description: string;
    source_type: string;
    source_id: string | null;
    status: string;
    created_at: unknown;
    posted_at: unknown;
  }>(
    `SELECT id, entry_number, entry_date, description, source_type, source_id, status,
            created_at, posted_at
     FROM journal_entries
     WHERE ($1::text IS NULL OR source_type = $1)
       AND ($2::uuid IS NULL OR source_id = $2)
     ORDER BY created_at DESC
     LIMIT $3`,
    [filters.sourceType ?? null, filters.sourceId ?? null, limit],
  );
  const result: JournalEntryView[] = [];
  for (const entry of entries.rows) result.push(await readJournalEntry(db, entry));
  return result;
}

export async function trialBalance(
  db: Db,
): Promise<Array<{ account_code: string; account_name: string; account_type: string; debit_minor: number; credit_minor: number; balance_minor: number }>> {
  const result = await db.query<{
    code: string;
    name: string;
    account_type: string;
    normal_balance: string;
    debit_minor: unknown;
    credit_minor: unknown;
  }>(
    `SELECT a.code, a.name, a.account_type, a.normal_balance,
            COALESCE(sum(l.debit_minor), 0)::bigint AS debit_minor,
            COALESCE(sum(l.credit_minor), 0)::bigint AS credit_minor
     FROM ledger_accounts a
     LEFT JOIN journal_lines l ON l.account_code = a.code
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
     GROUP BY a.code, a.name, a.account_type, a.normal_balance
     ORDER BY a.code`,
  );
  return result.rows.map((row) => {
    const debit = minor(row.debit_minor);
    const credit = minor(row.credit_minor);
    return {
      account_code: row.code,
      account_name: row.name,
      account_type: row.account_type,
      debit_minor: debit,
      credit_minor: credit,
      balance_minor: row.normal_balance === "debit" ? debit - credit : credit - debit,
    };
  });
}

export async function accountBalance(
  db: Db,
  accountCode: string,
  metadataFilter: { contractId?: string | null; invoiceId?: string | null } = {},
): Promise<number> {
  const result = await db.query<{ balance: unknown }>(
    `SELECT COALESCE(sum(l.debit_minor - l.credit_minor), 0)::bigint AS balance
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account_code = $1 AND e.status = 'posted'
       AND ($2::uuid IS NULL OR (l.metadata->>'contract_id')::uuid = $2::uuid)
       AND ($3::uuid IS NULL OR (l.metadata->>'invoice_id')::uuid = $3::uuid)`,
    [accountCode, metadataFilter.contractId ?? null, metadataFilter.invoiceId ?? null],
  );
  return minor(result.rows[0]?.balance);
}
