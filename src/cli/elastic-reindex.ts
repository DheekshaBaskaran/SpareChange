import { loadElasticConfig } from "../config.js";
import { PgDb } from "../db/client.js";
import { ElasticHttpClient } from "../elastic/client.js";
import { ElasticSyncService } from "../elastic/sync.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Environment variables may be supplied by the deployment platform.
}

// This CLI never listens on a socket, so it deliberately reads only the
// database and Elastic settings instead of the full server config (which also
// validates HOST/PORT and would fail in environments that set them for other
// processes).
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Set it to the Tiger Data/Postgres connection string.");
}
const config = loadElasticConfig(process.env);
if (!config?.enabled) {
  throw new Error(config?.disabledReason ?? "Elastic is not configured.");
}

const db = new PgDb(databaseUrl);
const client = new ElasticHttpClient(config);
const sync = new ElasticSyncService(db, config, client, (error) => {
  console.error(error instanceof Error ? error.message : error);
});

try {
  const incremental = process.argv.includes("--incremental");
  const result = incremental ? await sync.syncPending() : await sync.backfill();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "completed") process.exitCode = 1;
} finally {
  await db.close();
}
