import pg from "pg";
import type { Pool as PgPool, PoolClient, QueryResultRow } from "pg";

const { Pool } = pg;

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
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "relay-duo1",
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
