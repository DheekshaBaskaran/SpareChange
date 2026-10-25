import { randomUUID } from "node:crypto";
import type { ElasticConfig } from "../config.js";
import type { Db } from "../db/client.js";
import { DOCUMENT_TYPES, PROJECTED_TABLES, loadDocument, listEntityIds } from "./documents.js";
import type { BulkAction, ElasticsearchPort, FinancialDocument } from "./types.js";

interface OutboxRow {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: "insert" | "update" | "delete";
}

interface QueuedEntity {
  entityType: string;
  entityId: string;
  maxOutboxId: string;
}

export interface SyncSummary {
  run_id: string;
  mode: "incremental" | "backfill";
  status: "completed" | "failed";
  documents_indexed: number;
  documents_deleted: number;
  documents_failed: number;
  pending_after: number;
  error: string | null;
}

function documentId(table: string, id: string): string {
  return `${DOCUMENT_TYPES[table] ?? table}:${id}`;
}

function uniqueEntities(rows: OutboxRow[]): QueuedEntity[] {
  const map = new Map<string, QueuedEntity>();
  for (const row of rows) {
    const key = `${row.entity_type}:${row.entity_id}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        entityType: row.entity_type,
        entityId: row.entity_id,
        maxOutboxId: String(row.id),
      });
    } else if (BigInt(row.id) > BigInt(existing.maxOutboxId)) {
      existing.maxOutboxId = String(row.id);
    }
  }
  return [...map.values()];
}

export class ElasticSyncService {
  private readonly db: Db;
  private readonly config: ElasticConfig;
  private readonly client: ElasticsearchPort;
  private readonly onError: (error: unknown) => void;

  constructor(
    db: Db,
    config: ElasticConfig,
    client: ElasticsearchPort,
    onError: (error: unknown) => void = () => undefined,
  ) {
    this.db = db;
    this.config = config;
    this.client = client;
    this.onError = onError;
  }

  private async pendingCount(): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM elastic_outbox WHERE processed_at IS NULL`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async markProcessed(entity: QueuedEntity): Promise<void> {
    await this.db.query(
      `UPDATE elastic_outbox
       SET processed_at = now(), attempts = attempts + 1, last_error = NULL
       WHERE entity_type = $1 AND entity_id = $2 AND processed_at IS NULL AND id <= $3::bigint`,
      [entity.entityType, entity.entityId, entity.maxOutboxId],
    );
  }

  private async markFailed(entity: QueuedEntity, message: string): Promise<void> {
    await this.db.query(
      `UPDATE elastic_outbox
       SET attempts = attempts + 1, last_error = $3
       WHERE entity_type = $1 AND entity_id = $2 AND processed_at IS NULL AND id <= $4::bigint`,
      [entity.entityType, entity.entityId, message.slice(0, 2_000), entity.maxOutboxId],
    );
  }

  private async writeRun(summary: SyncSummary, startedAt: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO elastic_sync_runs
         (id, mode, status, documents_indexed, documents_deleted, documents_failed,
          pending_after, error, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
      [
        summary.run_id,
        summary.mode,
        summary.status,
        summary.documents_indexed,
        summary.documents_deleted,
        summary.documents_failed,
        summary.pending_after,
        summary.error,
        startedAt.toISOString(),
      ],
    );
  }

  async syncPending(limit = this.config.maxSyncBatch): Promise<SyncSummary> {
    const startedAt = new Date();
    const runId = randomUUID();
    const rows = await this.db.query<OutboxRow>(
      `SELECT id::text AS id, entity_type, entity_id, operation
       FROM elastic_outbox
       WHERE processed_at IS NULL
       ORDER BY id
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), this.config.maxSyncBatch)],
    );
    if (rows.rows.length === 0) {
      const pending = await this.pendingCount();
      const summary: SyncSummary = {
        run_id: runId,
        mode: "incremental",
        status: "completed",
        documents_indexed: 0,
        documents_deleted: 0,
        documents_failed: 0,
        pending_after: pending,
        error: null,
      };
      return summary;
    }

    const entities = uniqueEntities(rows.rows);
    const actions: BulkAction[] = [];
    const actionEntities = new Map<string, QueuedEntity>();
    for (const entity of entities) {
      const doc = await loadDocument(this.db, entity.entityType, entity.entityId);
      const id = doc?.document_id ?? documentId(entity.entityType, entity.entityId);
      actions.push(doc ? { action: "index", id, document: doc } : { action: "delete", id });
      actionEntities.set(id, entity);
    }

    let result: Awaited<ReturnType<ElasticsearchPort["bulk"]>> = {
      indexed: [],
      deleted: [],
      failures: [],
    };
    let error: string | null = null;
    try {
      result = await this.client.bulk(actions);
      if (result.indexed.length + result.deleted.length > 0) await this.client.refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      this.onError(cause);
    }

    const failedIds = new Set(result.failures.map((failure) => failure.id));
    for (const action of actions) {
      const entity = actionEntities.get(action.id);
      if (!entity) continue;
      if (error) {
        await this.markFailed(entity, error);
      } else if (failedIds.has(action.id)) {
        await this.markFailed(
          entity,
          result.failures.find((failure) => failure.id === action.id)?.error ?? "bulk failure",
        );
      } else {
        await this.markProcessed(entity);
      }
    }

    const pendingAfter = await this.pendingCount();
    const summary: SyncSummary = {
      run_id: runId,
      mode: "incremental",
      status: error || result.failures.length > 0 ? "failed" : "completed",
      documents_indexed: result.indexed.length,
      documents_deleted: result.deleted.length,
      documents_failed: error ? actions.length : result.failures.length,
      pending_after: pendingAfter,
      error: error ?? (result.failures[0]?.error ?? null),
    };
    await this.writeRun(summary, startedAt);
    return summary;
  }

  async backfill(limitPerType = this.config.maxBackfillPerType): Promise<SyncSummary> {
    const startedAt = new Date();
    const runId = randomUUID();
    const maxOutbox = await this.db.query<{ max_id: string | null }>(
      `SELECT max(id)::text AS max_id FROM elastic_outbox WHERE processed_at IS NULL`,
    );
    const snapshot = maxOutbox.rows[0]?.max_id ?? null;
    const docs: FinancialDocument[] = [];
    const failures: string[] = [];

    for (const table of PROJECTED_TABLES) {
      const ids = await listEntityIds(this.db, table, limitPerType);
      for (const id of ids) {
        const doc = await loadDocument(this.db, table, id);
        if (doc) docs.push(doc);
      }
    }

    let indexed = 0;
    let failed = 0;
    for (let offset = 0; offset < docs.length; offset += 100) {
      const chunk = docs.slice(offset, offset + 100);
      try {
        const result = await this.client.bulk(
          chunk.map((doc) => ({ action: "index" as const, id: doc.document_id, document: doc })),
        );
        indexed += result.indexed.length;
        failed += result.failures.length;
        for (const failure of result.failures) failures.push(`${failure.id}: ${failure.error}`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        failed += chunk.length;
        failures.push(message);
        this.onError(cause);
        break;
      }
    }
    if (indexed > 0) {
      try {
        await this.client.refresh();
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : String(cause));
        this.onError(cause);
      }
    }

    if (failed === 0 && failures.length === 0 && snapshot) {
      await this.db.query(
        `UPDATE elastic_outbox
         SET processed_at = now(), attempts = attempts + 1, last_error = NULL
         WHERE processed_at IS NULL AND id <= $1::bigint`,
        [snapshot],
      );
    }
    const pendingAfter = await this.pendingCount();
    const summary: SyncSummary = {
      run_id: runId,
      mode: "backfill",
      status: failures.length > 0 || failed > 0 ? "failed" : "completed",
      documents_indexed: indexed,
      documents_deleted: 0,
      documents_failed: failed,
      pending_after: pendingAfter,
      error: failures[0] ?? null,
    };
    await this.writeRun(summary, startedAt);
    return summary;
  }

  async status(): Promise<{
    pending: number;
    last_run: Record<string, unknown> | null;
  }> {
    const pending = await this.pendingCount();
    const last = await this.db.query<Record<string, unknown>>(
      `SELECT id, mode, status, documents_indexed, documents_deleted, documents_failed,
              pending_after, error, started_at, completed_at
       FROM elastic_sync_runs ORDER BY started_at DESC LIMIT 1`,
    );
    return { pending, last_run: last.rows[0] ?? null };
  }
}
