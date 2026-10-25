import pg from "pg";
import type { Pool as PgPool, PoolClient, QueryResultRow } from "pg";
import { SEARCH_PATH_OPTION } from "./schema.js";

const { Pool } = pg;

/**
 * Tiger Data hands out `sslmode=require`, which in libpq means "encrypt, but do
 * not validate the CA". node-postgres parses the URL after the explicit config
 * (pg/lib/connection-parameters.js), so `sslmode=require` overwrites `ssl` with
 * `true` and then fails against Tiger's managed CA. Strip that one parameter and
 * pass the equivalent SSL options, so both services read the same URL and behave
 * the same way. `verify-full` keeps full validation.
 */
function pgOptions(connectionString: string): {
  connectionString: string;
  ssl?: false | { rejectUnauthorized: boolean };
} {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { connectionString };
  }
  const mode = url.searchParams.get("sslmode");
  if (mode === "disable") {
    url.searchParams.delete("sslmode");
    return { connectionString: url.toString(), ssl: false };
  }
  if (mode === "require" || mode === "prefer" || mode === "allow" || mode === "no-verify") {
    url.searchParams.delete("sslmode");
    return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
  }
  return { connectionString };
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/**
 * A deliberately small SQL surface so production uses `pg` and tests can use
 * an embedded Postgres without changing repository code.
 */
export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PgDb implements Db {
  private readonly pool: PgPool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      ...pgOptions(connectionString),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "relay-duo1",
      // Applied by the server at connect time, so every pooled connection
      // resolves Duo 1 tables in `relay` and falls back to `public` for the
      // market tables and extensions.
      options: SEARCH_PATH_OPTION,
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.pool.query<T>(text, values as never[]);
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx = new PgTransaction(client);
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original error is more useful than a rollback failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PgTransaction implements Db {
  constructor(private readonly client: PoolClient) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.client.query<T>(text, values as never[]);
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async transaction<T>(): Promise<T> {
    throw new Error("nested transactions are not supported");
  }

  async close(): Promise<void> {
    // Owned by the parent transaction.
  }
}
