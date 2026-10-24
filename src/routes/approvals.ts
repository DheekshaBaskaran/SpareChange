import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { assertHumanAttestation, requirePrincipal } from "../auth/service.js";
import { assertPermission } from "../auth/rbac.js";
import type { AppConfig } from "../config.js";
import { IDEMPOTENCY_HEADER } from "../contract.js";
import type { Db } from "../db/client.js";
import { listApprovals } from "../db/reads.js";
import { createApproval, createApprovalRequest } from "../db/writes.js";
import { ApiError } from "../errors.js";
import { headerValue } from "../http.js";
import { idempotent } from "../idempotency.js";
import { parse } from "../validation.js";

const approvalRequestQuery = z.object({
  deal_id: z.string().uuid().optional(),
  version: z.coerce.number().int().positive().optional(),
  participant_id: z.string().uuid().optional(),
});

const approvalRequestBody = z.object({
  deal_id: z.string().uuid(),
  version: z.number().int().positive().optional(),
  participant_id: z.string().uuid(),
  obligation: z.string().trim().min(1).max(2_000),
  amount_minor: z.number().int().nonnegative().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  channel: z.string().trim().min(1).max(40).optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const approvalBody = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  attested_by: z.string().trim().min(1).max(200),
  channel: z.string().trim().min(1).max(40).optional(),
  note: z.string().max(2_000).nullable().optional(),
  simulated: z.boolean().optional(),
});

export function registerApprovalRoutes(app: FastifyInstance, db: Db, config: AppConfig): void {
  app.get("/v1/approvals", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "deal:read");
    const query = parse(approvalRequestQuery, request.query);
    const result = await listApprovals(db, {
      dealId: query.deal_id ?? null,
      version: query.version,
      participantId: query.participant_id ?? null,
    });
    if (query.deal_id && !result) throw new ApiError(404, "deal_not_found", "Deal not found.");
    return result;
  });

  app.post("/v1/approval-requests", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "deal:negotiate");
      const body = parse(approvalRequestBody, request.body);
      const approvalRequest = await createApprovalRequest(db, {
        dealId: body.deal_id,
        version: body.version,
        participantId: body.participant_id,
        obligation: body.obligation,
        amountMinor: body.amount_minor,
        currency: body.currency,
        channel: body.channel,
        expiresAt: body.expires_at,
        metadata: body.metadata,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { approval_request: approvalRequest } };
    });
  });

  app.post("/v1/approvals", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      const body = parse(approvalBody, request.body);
      assertHumanAttestation(
        principal,
        body.attested_by,
        body.simulated ?? false,
        config.allowSimulatedApprovals,
      );
      const result = await createApproval(db, {
        requestId: body.request_id,
        decision: body.decision,
        actorPartyId: principal.partyId,
        attestedBy: body.attested_by,
        channel: body.channel,
        note: body.note,
        simulated: body.simulated,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: result };
    });
  });
}
