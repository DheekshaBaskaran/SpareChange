import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../auth/service.js";
import { assertPermission } from "../auth/rbac.js";
import { IDEMPOTENCY_HEADER } from "../contract.js";
import type { Db } from "../db/client.js";
import { ApiError } from "../errors.js";
import { headerValue } from "../http.js";
import { idempotent } from "../idempotency.js";
import { parse } from "../validation.js";
import {
  claimWorkItem,
  completeWorkItem,
  enqueueApprovalFollowup,
  getWorkItem,
  listWorkItems,
} from "../creao/work-items.js";
import { getExceptionEvidence, listExceptions, recordInvestigation } from "../finance/exceptions.js";

const itemParam = z.object({ itemId: z.string().uuid() });
const dealParam = z.object({ dealId: z.string().uuid() });
const exceptionParam = z.object({ exceptionId: z.string().uuid() });

const workQuery = z.object({
  status: z.enum(["pending", "claimed", "completed", "failed"]).optional(),
  kind: z.enum(["deal_opportunity", "financial_exception", "approval_followup"]).optional(),
  deal_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const completeBody = z.object({
  outcome: z.record(z.string(), z.unknown()),
  status: z.enum(["completed", "failed"]).optional(),
});

const findingsBody = z.object({
  findings: z.string().trim().min(1).max(10_000),
  assigned_to: z.string().trim().min(1).max(200).optional(),
  sources: z.array(z.record(z.string(), z.unknown())).optional(),
});

const followupBody = z.object({
  reason: z.string().trim().min(1).max(2_000),
  participant_ids: z.array(z.string().uuid()).optional(),
});

export function registerCreaoRoutes(app: FastifyInstance, db: Db): void {
  app.get("/v1/creao/work-items", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "creao:work");
    const query = parse(workQuery, request.query);
    return {
      work_items: await listWorkItems(db, {
        status: query.status ?? null,
        kind: query.kind ?? null,
        dealId: query.deal_id ?? null,
        limit: query.limit,
      }),
    };
  });

  app.get("/v1/creao/work-items/:itemId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "creao:work");
    const { itemId } = parse(itemParam, request.params);
    const item = await getWorkItem(db, itemId);
    if (!item) throw new ApiError(404, "work_item_not_found", "CREAO work item not found.");
    return { work_item: item };
  });

  app.post("/v1/creao/work-items/:itemId/claim", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "creao:work");
      const { itemId } = parse(itemParam, request.params);
      const item = await claimWorkItem(db, {
        id: itemId,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 200, body: { work_item: item } };
    });
  });

  app.post("/v1/creao/work-items/:itemId/complete", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "creao:work");
      const { itemId } = parse(itemParam, request.params);
      const body = parse(completeBody, request.body);
      const item = await completeWorkItem(db, {
        id: itemId,
        outcome: body.outcome,
        status: body.status,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 200, body: { work_item: item } };
    });
  });

  app.post("/v1/creao/deals/:dealId/approval-followups", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "creao:work");
      const { dealId } = parse(dealParam, request.params);
      const body = parse(followupBody, request.body);
      const work = await enqueueApprovalFollowup(db, {
        dealId,
        payload: {
          reason: body.reason,
          participant_ids: body.participant_ids ?? [],
          next_step: "contact_participants_and_record_negotiation_events",
        },
        actorId: principal.id,
        actorRole: principal.role,
      });
      return { statusCode: 201, body: { work_item_id: work.id } };
    });
  });

  app.get("/v1/creao/investigations/:exceptionId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "exception:investigate");
    const { exceptionId } = parse(exceptionParam, request.params);
    return { evidence: await getExceptionEvidence(db, exceptionId) };
  });

  app.post("/v1/creao/investigations/:exceptionId/findings", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "exception:investigate");
      const { exceptionId } = parse(exceptionParam, request.params);
      const body = parse(findingsBody, request.body);
      const exception = await recordInvestigation(db, {
        exceptionId,
        findings: body.findings,
        assignedTo: body.assigned_to,
        sources: body.sources,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { financial_exception: exception } };
    });
  });

  app.get("/v1/creao/queue-summary", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "creao:work");
    const [items, exceptions] = await Promise.all([
      listWorkItems(db, { limit: 500 }),
      listExceptions(db, { limit: 500 }),
    ]);
    return {
      work_items: {
        pending: items.filter((item) => item.status === "pending").length,
        claimed: items.filter((item) => item.status === "claimed").length,
        completed: items.filter((item) => item.status === "completed").length,
        failed: items.filter((item) => item.status === "failed").length,
      },
      open_financial_exceptions: exceptions.filter(
        (exception) => !["resolved", "dismissed"].includes(exception.status),
      ).length,
      generated_at: new Date().toISOString(),
      source: "persisted_work_queue",
    };
  });
}
