/**
 * Reset the Duo 1 transactional state so the demo can be run again.
 *
 * This is destructive by design, so it is guarded:
 *   - it only touches the `relay` schema (Market Intelligence owns `public`);
 *   - it keeps identity, credentials, ledger accounts and the market mirror;
 *   - it refuses to run without `--confirm`, and refuses a connection string
 *     whose host looks like a production target.
 *
 * After clearing it re-seeds the demo fixtures (parties, offers, workloads,
 * capacity, spending limits), so the next deal search sees free capacity.
 *
 *   npm run db:reset-demo -- --confirm
 *   npm run db:reset-demo -- --confirm --purge-elastic   # also rebuild the index
 *
 * Truncation bypasses the outbox, so deleted rows never emit Elastic deletion
 * tombstones. `--purge-elastic` clears the projection index and rebuilds it from
 * the freshly seeded data; without it, run `npm run elastic:reindex` afterwards.
 */
import { loadElasticConfig } from "../config.js";
import { PgDb } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { DUO1_SCHEMA } from "../db/schema.js";
import { seedDemo } from "../db/seed-demo.js";
import { ElasticHttpClient } from "../elastic/client.js";
import { ElasticSyncService } from "../elastic/sync.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Optional.
}

/**
 * Transactional tables only. Preserved on purpose:
 *   parties, human_users, provider_profiles, provider_authorizations,
 *   spending_limits, api_keys, ledger_accounts, negotiation_mandates,
 *   market_offers, market_observations (the mirrored reference data the
 *   bridge is authoritative for), audit_events (the evidence trail),
 *   idempotency_keys, schema_migrations.
 */
const TRANSACTIONAL_TABLES = [
  "reconciliation_matches",
  "reconciliation_runs",
  "exception_actions",
  "financial_exceptions",
  "elastic_investigation_evidence",
  "elastic_investigation_findings",
  "elastic_investigations",
  "elastic_outbox",
  "elastic_sync_runs",
  "agent_work_items",
  "escalations",
  "payments",
  "payment_instructions",
  "payment_obligations",
  "provider_payouts",
  "provider_payout_instructions",
  "provider_payables",
  "invoice_adjustments",
  "invoice_lines",
  "invoices",
  "verified_usage",
  "billing_calculations",
  "financial_approvals",
  "journal_lines",
  "journal_entries",
  "contract_rate_lines",
  "contracts",
  "execution_events",
  "execution_authorizations",
  "commitments",
  "reservations",
  "handoffs",
  "approvals",
  "deal_approval_requests",
  "deal_versions",
  "deals",
  "capacity_allocations",
  "negotiation_events",
  "outbox",
] as const;

function target(): string {
  const url = process.env.MIGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");
  return url;
}

function describe(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
}

async function main(): Promise<void> {
  const url = target();
  const confirmed = process.argv.includes("--confirm");
  // The runtime image sets NODE_ENV=production, so the guard is the target
  // itself: a host labelled prod/production is never reset by this tool.
  const production = /[.-]prod(uction)?[.-]/i.test(url);

  if (!confirmed || production) {
    console.log("Refusing to reset the demo state.");
    console.log(`  target   : ${describe(url)}`);
    console.log(`  schema   : ${DUO1_SCHEMA}`);
    if (!confirmed) console.log("  reason   : pass --confirm to proceed");
    if (production) console.log("  reason   : production targets are never reset by this tool");
    console.log("\nThis deletes every deal, contract, invoice, payment and exception.");
    process.exit(confirmed ? 1 : 2);
  }

  const db = new PgDb(url);
  try {
    await runMigrations(db);
    const counts = await db.query<{ table_name: string; rows: number }>(
      `SELECT relname AS table_name, n_live_tup::int AS rows
       FROM pg_stat_user_tables
       WHERE schemaname = $1 AND relname = ANY($2::text[])
       ORDER BY n_live_tup DESC`,
      [DUO1_SCHEMA, TRANSACTIONAL_TABLES],
    );
    const before = counts.rows.filter((row) => row.rows > 0);
    console.log(`Resetting ${DUO1_SCHEMA} transactions on ${describe(url)}`);
    for (const row of before) console.log(`  before  ${row.table_name}: ${row.rows}`);

    await db
      .transaction(async (tx) => {
        // A half-finished reset from a killed client can leave another truncate
        // holding AccessExclusiveLock. Fail with a clear timeout instead of
        // hanging forever.
        await tx.exec("SET LOCAL lock_timeout = '15s'");
        await tx.exec("SET LOCAL statement_timeout = '120s'");
        await tx.exec(
          `TRUNCATE TABLE ${TRANSACTIONAL_TABLES.map((table) => `${DUO1_SCHEMA}.${table}`).join(", ")} CASCADE`,
        );
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!/lock timeout/i.test(message)) throw error;
        throw new Error(
          `Could not lock the demo tables: ${message}`,
          {
            cause: new Error(
              "Another session holds a lock, usually an `idle in transaction` client left behind by a killed process. " +
                "Terminate it (pg_terminate_backend) or wait for it to disconnect, then retry.",
            ),
          },
        );
      });
    await seedDemo(db);
    console.log("Demo fixtures re-seeded (parties, offers, workloads, capacity, spending limits).");

    const elastic = loadElasticConfig(process.env);
    if (process.argv.includes("--purge-elastic") && elastic?.enabled) {
      const client = new ElasticHttpClient(elastic);
      const deleted = await client.deleteAllDocuments();
      console.log(`Elastic projection cleared (${deleted} document(s) removed).`);
      const sync = new ElasticSyncService(db, elastic, client, (error) =>
        console.error(error instanceof Error ? error.message : error),
      );
      const summary = await sync.backfill();
      console.log(
        `Elastic rebuilt: ${summary.documents_indexed} document(s) indexed, ${summary.documents_failed} failed.`,
      );
      if (summary.status !== "completed") process.exitCode = 1;
    } else if (elastic?.enabled) {
      console.log("Elastic is configured: re-run `npm run elastic:reindex`, or pass --purge-elastic.");
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
