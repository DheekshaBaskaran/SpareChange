import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createTestContext } from "./helpers/app.js";

test("migrations create the core and finance tables", async (t) => {
  const { db } = await createTestContext();
  t.after(async () => db.close());

  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const names = new Set(tables.rows.map((row) => row.table_name));
  for (const expected of [
    "parties",
    "provider_profiles",
    "provider_authorizations",
    "market_offers",
    "workloads",
    "commitments",
    "reservations",
    "deals",
    "deal_versions",
    "deal_approval_requests",
    "approvals",
    "negotiation_events",
    "escalations",
    "handoffs",
    "api_keys",
    "idempotency_keys",
    "audit_events",
    "market_observations",
    "execution_events",
    "contracts",
    "verified_usage",
    "invoices",
    "journal_entries",
    "journal_lines",
    "financial_exceptions",
    "capacity_allocations",
    "execution_authorizations",
    "spending_limits",
    "provider_payables",
    "provider_payout_instructions",
    "provider_payouts",
    "invoice_adjustments",
    "negotiation_mandates",
  ]) {
    assert.ok(names.has(expected), `missing table ${expected}`);
  }

  const view = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'journal_entry_balances'`,
  );
  assert.equal(view.rows.length, 1);
});

test("journal lines can be read as balanced without trusting a flag", async (t) => {
  const { db } = await createTestContext();
  t.after(async () => db.close());

  const entryId = randomUUID();
  await db.query(
    `INSERT INTO journal_entries (id, entry_number, entry_date, description, source_type, source_id, status)
     VALUES ($1, $2, current_date, 'test balanced entry', 'test', NULL, 'posted')`,
    [entryId, `TEST-${entryId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO journal_lines (id, entry_id, account_code, debit_minor, credit_minor)
     VALUES ($1, $2, '1000', 10000, 0), ($3, $2, '4000', 0, 10000)`,
    [randomUUID(), entryId, randomUUID()],
  );

  const balance = await db.query<{ imbalance_minor: number }>(
    `SELECT imbalance_minor FROM journal_entry_balances WHERE entry_id = $1`,
    [entryId],
  );
  assert.equal(Number(balance.rows[0]?.imbalance_minor), 0);
});
