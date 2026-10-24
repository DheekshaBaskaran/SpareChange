import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { asObject, iso } from "../db/values.js";
import { ApiError } from "../errors.js";

interface WorkItemRow {
  id: string;
  kind: string;
  deal_id: string | null;
  status: string;
  payload: unknown;
  created_at: unknown;
  claimed_at: unknown;
  completed_at: unknown;
}

export interface WorkItemView {
  id: string;
  kind: string;
  deal_id: string | null;
  status: string;
  payload: unknown;
  claimed_by: string | null;
  outcome: unknown;
  created_at: string | null;
  claimed_at: string | null;
  completed_at: string | null;
}

function map(row: WorkItemRow): WorkItemView {
  const payload = asObject(row.payload);
  return {
    id: row.id,
    kind: row.kind,
    deal_id: row.deal_id,
    status: row.status,
    payload,
    claimed_by: typeof payload.claimed_by === "string" ? payload.claimed_by : null,
    outcome: payload.outcome ?? null,
    created_at: iso(row.created_at),
    claimed_at: iso(row.claimed_at),
    completed_at: iso(row.completed_at),
  };
}

export async function listWorkItems(
  db: Db,
  filters: { status?: string | null; kind?: string | null; dealId?: string | null; limit?: number } = {},
): Promise<WorkItemView[]> {
  const result = await db.query<WorkItemRow>(
    `SELECT id, kind, deal_id, status, payload, created_at, claimed_at, completed_at
     FROM agent_work_items
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::text IS NULL OR kind = $2)
       AND ($3::uuid IS NULL OR deal_id = $3)
     ORDER BY created_at ASC LIMIT $4`,
    [
      filters.status ?? null,
      filters.kind ?? null,
      filters.dealId ?? null,
      Math.min(Math.max(filters.limit ?? 100, 1), 500),
    ],
  );
  return result.rows.map(map);
}

export async function getWorkItem(db: Db, id: string): Promise<WorkItemView | null> {
  const result = await db.query<WorkItemRow>(
    `SELECT id, kind, deal_id, status, payload, created_at, claimed_at, completed_at
     FROM agent_work_items WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? map(result.rows[0]) : null;
}

export async function claimWorkItem(
  db: Db,
  options: {
    id: string;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<WorkItemView> {
  return db.transaction(async (tx) => {
    const result = await tx.query<WorkItemRow>(
      `SELECT id, kind, deal_id, status, payload, created_at, claimed_at, completed_at
       FROM agent_work_items WHERE id = $1 FOR UPDATE`,
      [options.id],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "work_item_not_found", "CREAO work item not found.");
    if (row.status === "claimed") {
      const payload = asObject(row.payload);
      if (payload.claimed_by === options.actorId) return map(row);
      throw new ApiError(409, "work_item_already_claimed", "This work item is claimed by another agent.");
    }
    if (row.status !== "pending") throw new ApiError(409, "work_item_not_pending", `Work item is ${row.status}.`);
    const payload = { ...asObject(row.payload), claimed_by: options.actorId, claimed_at: new Date().toISOString() };
    await tx.query(
      `UPDATE agent_work_items SET status = 'claimed', claimed_at = now(), payload = $2::jsonb
       WHERE id = $1`,
      [row.id, JSON.stringify(payload)],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "creao.work_item_claimed",
      objectType: "agent_work_item",
      objectId: row.id,
      dealId: row.deal_id,
      idempotencyKey: options.idempotencyKey,
      after: { kind: row.kind },
    });
    const updated = await tx.query<WorkItemRow>(
      `SELECT id, kind, deal_id, status, payload, created_at, claimed_at, completed_at
       FROM agent_work_items WHERE id = $1`,
      [row.id],
    );
    return map(updated.rows[0]!);
  });
}

export async function completeWorkItem(
  db: Db,
  options: {
    id: string;
    outcome: unknown;
    status?: "completed" | "failed";
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<WorkItemView> {
  return db.transaction(async (tx) => {
    const result = await tx.query<WorkItemRow>(
      `SELECT id, kind, deal_id, status, payload, created_at, claimed_at, completed_at
       FROM agent_work_items WHERE id = $1 FOR UPDATE`,
      [options.id],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "work_item_not_found", "CREAO work item not found.");
    if (["completed", "failed"].includes(row.status)) return map(row);
    const payload = {
      ...asObject(row.payload),
      claimed_by: asObject(row.payload).claimed_by ?? options.actorId,
      outcome: options.outcome,
      completed_by: options.actorId,
    };
    await tx.query(
      `UPDATE agent_work_items
       SET status = $2, completed_at = now(), payload = $3::jsonb
       WHERE id = $1`,
      [row.id, options.status ?? "completed", JSON.stringify(payload)],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "creao.work_item_completed",
      objectType: "agent_work_item",
      objectId: row.id,
      dealId: row.deal_id,
      idempotencyKey: options.idempotencyKey,
      after: { kind: row.kind, status: options.status ?? "completed", outcome: options.outcome },
    });
    const updated = await tx.query<WorkItemRow>(
      `SELECT id, kind, deal_id, status, payload, created_at, claimed_at, completed_at
       FROM agent_work_items WHERE id = $1`,
      [row.id],
    );
    return map(updated.rows[0]!);
  });
}

export async function enqueueApprovalFollowup(
  db: Db,
  options: { dealId: string; payload: unknown; actorId: string; actorRole: string },
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO agent_work_items (id, kind, deal_id, status, payload)
       VALUES ($1, 'approval_followup', $2, 'pending', $3::jsonb)`,
      [id, options.dealId, JSON.stringify(options.payload)],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "creao.approval_followup_enqueued",
      objectType: "agent_work_item",
      objectId: id,
      dealId: options.dealId,
      after: options.payload,
    });
  });
  return { id };
}
