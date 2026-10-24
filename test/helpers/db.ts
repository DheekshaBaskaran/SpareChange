import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import type { Db, QueryResult } from "../../src/db/client.js";

class PGliteTransaction implements Db {
  constructor(private readonly tx: Transaction) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.tx.query<T>(text, values as any[]);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }

  async exec(sql: string): Promise<void> {
    await this.tx.exec(sql);
  }

  async transaction<T>(): Promise<T> {
    throw new Error("nested transactions are not supported");
  }

  async close(): Promise<void> {
    // Owned by the parent.
  }
}

export class PGliteDb implements Db {
  private readonly client: PGlite;

  constructor(client = new PGlite()) {
    this.client = client;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.client.query<T>(text, values as any[]);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }

  async exec(sql: string): Promise<void> {
    await this.client.exec(sql);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.client.transaction((tx) => fn(new PGliteTransaction(tx)));
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
