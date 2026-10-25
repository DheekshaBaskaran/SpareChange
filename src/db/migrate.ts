import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PgDb, type Db } from "./client.js";
import { CREATE_SCHEMA_SQL, SET_SEARCH_PATH_SQL } from "./schema.js";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

export interface MigrationOptions {
  timescale?: boolean;
}

export async function runMigrations(db: Db, options: MigrationOptions = {}): Promise<string[]> {
  // Duo 1 owns the `relay` schema so its tables never collide with the market
  // intelligence tables that live in `public` on the same Tiger database.
  await db.exec(CREATE_SCHEMA_SQL);
  await db.exec(SET_SEARCH_PATH_SQL);
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .filter((file) => options.timescale || !file.includes("timescale"))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const existing = await db.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations WHERE filename = $1`,
      [file],
    );
    if (existing.rows[0]) continue;

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
    });
    applied.push(file);
  }
  return applied;
}

function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Optional.
  }
}

async function main(): Promise<void> {
  loadEnv();
  // The runtime URL belongs to a DML-only role, so DDL uses the owner URL when
  // one is configured (see .env.example).
  const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");
  }
  const timescale = process.argv.includes("--timescale") || process.env.RELAY_TIMESCALE === "1";
  const db = new PgDb(databaseUrl);
  try {
    const applied = await runMigrations(db, { timescale });
    console.log(
      applied.length
        ? `Applied ${applied.length} migration(s): ${applied.join(", ")}`
        : "No pending migrations.",
    );
    if (timescale) console.log("TimescaleDB migration included.");
  } finally {
    await db.close();
  }
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
