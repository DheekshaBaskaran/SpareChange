import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../auth/service.js";
import { assertPermission } from "../auth/rbac.js";
import { IDEMPOTENCY_HEADER } from "../contract.js";
import type { Db } from "../db/client.js";
import { ApiError } from "../errors.js";
import { getException } from "../finance/exceptions.js";
import { headerValue } from "../http.js";
import { idempotent } from "../idempotency.js";
import { parse } from "../validation.js";
import type { ElasticInvestigationService } from "../elastic/types.js";

const exceptionParam = z.object({ exceptionId: z.string().uuid() });
const investigationParam = z.object({ investigationId: z.string().uuid() });

const runBody = z.object({
  question: z.string().trim().min(1).max(4_000).optional(),
  follow_up_of: z.string().uuid().optional(),
});

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function requireElastic(service: ElasticInvestigationService | null): ElasticInvestigationService {
  if (!service) {
    throw new ApiError(
      503,
      "elastic_not_configured",
      "The Elastic investigator is not configured; financial exceptions remain open and unchanged.",
      { retryable: false },
    );
  }
  return service;
}

export function registerElasticRoutes(
  app: FastifyInstance,
  db: Db,
  service: ElasticInvestigationService | null,
): void {
  app.post("/v1/creao/investigations/:exceptionId/run", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "exception:investigate");
      const { exceptionId } = parse(exceptionParam, request.params);
      const body = parse(runBody, request.body ?? {});
      const result = await requireElastic(service).runInvestigation({
        exceptionId,
        question: body.question ?? null,
        followUpOf: body.follow_up_of ?? null,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 200, body: result };
    });
  });

  app.get("/v1/creao/investigations/:exceptionId/runs", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { exceptionId } = parse(exceptionParam, request.params);
    const query = parse(historyQuery, request.query);
    const exception = await getException(db, exceptionId);
    if (!exception) throw new ApiError(404, "financial_exception_not_found", "Financial exception not found.");
    return {
      financial_exception: exception,
      investigations: await requireElastic(service).listInvestigations(exceptionId, query.limit),
    };
  });

  app.get("/v1/finance/investigations/:investigationId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { investigationId } = parse(investigationParam, request.params);
    const investigation = await requireElastic(service).getInvestigation(investigationId);
    if (!investigation) throw new ApiError(404, "investigation_not_found", "Investigation not found.");
    return {
      investigation,
      financial_exception: await getException(db, investigation.exception_id),
    };
  });
}
