import type { Db } from "./client.js";

export interface AuditInput {
  actorId: string;
  actorRole: string;
  action: string;
  objectType: string;
  objectId: string;
  dealId?: string | null;
  idempotencyKey?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

export async function appendAudit(db: Db, input: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_events
       (actor_id, actor_role, action, object_type, object_id, deal_id,
        idempotency_key, before_state, after_state, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [
      input.actorId,
      input.actorRole,
      input.action,
      input.objectType,
      input.objectId,
      input.dealId ?? null,
      input.idempotencyKey ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
