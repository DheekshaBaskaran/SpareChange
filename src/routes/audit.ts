import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../auth/service.js";
import { assertPermission } from "../auth/rbac.js";
import type { Db } from "../db/client.js";
import { iso } from "../db/values.js";
import { parse } from "../validation.js";

const auditQuery = z.object({
  object_type: z.string().trim().min(1).max(80).optional(),
  object_id: z.string().trim().min(1).max(200).optional(),
  deal_id: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export function registerAuditRoutes(app: FastifyInstance, db: Db): void {
  app.get("/v1/audit", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "audit:read");
    const query = parse(auditQuery, request.query);
    const result = await db.query<{
      id: number;
      occurred_at: unknown;
      actor_id: string;
      actor_role: string;
      action: string;
      object_type: string;
      object_id: string;
      deal_id: string | null;
      idempotency_key: string | null;
      before_state: unknown;
      after_state: unknown;
      metadata: unknown;
    }>(
      `SELECT id, occurred_at, actor_id, actor_role, action, object_type, object_id,
              deal_id, idempotency_key, before_state, after_state, metadata
       FROM audit_events
       WHERE ($1::text IS NULL OR object_type = $1)
         AND ($2::text IS NULL OR object_id = $2)
         AND ($3::uuid IS NULL OR deal_id = $3)
         AND ($4::text IS NULL OR action = $4)
       ORDER BY occurred_at DESC, id DESC
       LIMIT $5`,
      [
        query.object_type ?? null,
        query.object_id ?? null,
        query.deal_id ?? null,
        query.action ?? null,
        query.limit ?? 200,
      ],
    );
    return {
      audit_events: result.rows.map((row) => ({
        ...row,
        occurred_at: iso(row.occurred_at),
      })),
      count: result.rows.length,
    };
  });
}
