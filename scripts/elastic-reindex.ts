import { loadConfig } from "../src/config.js";
import { PgDb } from "../src/db/client.js";
import { ElasticHttpClient } from "../src/elastic/client.js";
import { ElasticSyncService } from "../src/elastic/sync.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Environment variables may be supplied by the deployment platform.
}

const config = loadConfig();
if (!config.elastic?.enabled) {
  throw new Error(config.elastic?.disabledReason ?? "Elastic is not configured.");
}

const db = new PgDb(config.databaseUrl);
const client = new ElasticHttpClient(config.elastic);
const sync = new ElasticSyncService(db, config.elastic, client, (error) => {
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
