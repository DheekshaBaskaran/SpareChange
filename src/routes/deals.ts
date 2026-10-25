import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../auth/service.js";
import { assertPermission } from "../auth/rbac.js";
import { IDEMPOTENCY_HEADER } from "../contract.js";
import type { Db } from "../db/client.js";
import { getDeal } from "../db/reads.js";
import { createEscalation, createHandoff, createNegotiationEvent } from "../db/writes.js";
import { createCounteroffer, searchDeals } from "../solver/service.js";
import { createNegotiationMandate, listNegotiationMandates } from "../solver/mandates.js";
import { ApiError } from "../errors.js";
import { headerValue } from "../http.js";
import { idempotent } from "../idempotency.js";
import { parse } from "../validation.js";

const idParams = z.object({ dealId: z.string().uuid() });

const searchBody = z.object({
  workload_id: z.string().uuid(),
  mandate: z
    .object({
      min_savings_minor: z.number().int().nonnegative().optional(),
      max_total_cost_minor: z.number().int().nonnegative().nullable().optional(),
      max_switching_cost_minor: z.number().int().nonnegative().nullable().optional(),
      coordination_fee_minor: z.number().int().nonnegative().optional(),
      max_chain_depth: z.number().int().min(2).max(6).optional(),
      party_budgets_minor: z.record(z.string(), z.number().int().nonnegative()).optional(),
    })
    .optional(),
});

const counterofferBody = z.object({
  terms_version: z.number().int().positive(),
  ask_price_minor_per_gpu_hour: z.number().int().nonnegative(),
  rationale: z.string().max(2_000).optional(),
  participant_id: z.string().uuid().optional(),
  mandate_id: z.string().uuid().optional(),
});

const negotiationBody = z.object({
  version: z.number().int().positive().optional(),
  round: z.number().int().positive().optional(),
  event_type: z.string().trim().min(1).max(120),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const mandateBody = z.object({
  party_id: z.string().uuid(),
  agent_id: z.string().trim().min(1).max(200),
  role: z.enum(["buyer", "provider"]),
  min_rate_minor_per_gpu_hour: z.number().int().nonnegative().nullable().optional(),
  max_rate_minor_per_gpu_hour: z.number().int().nonnegative().nullable().optional(),
  max_delta_minor: z.number().int().nonnegative(),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
});

const escalationBody = z.object({
  version: z.number().int().positive().optional(),
  reason: z.string().trim().min(1).max(2_000),
  details: z.record(z.string(), z.unknown()).optional(),
});

export function registerDealRoutes(app: FastifyInstance, db: Db): void {
  app.get("/v1/negotiation-mandates", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "deal:negotiate");
    const query = parse(
      z.object({
        party_id: z.string().uuid().optional(),
        agent_id: z.string().trim().min(1).max(200).optional(),
        active: z.enum(["true", "false"]).optional(),
      }),
      request.query,
    );
    return {
      negotiation_mandates: await listNegotiationMandates(db, {
        partyId: query.party_id ?? null,
        agentId: query.agent_id ?? null,
        activeOnly: query.active === "true",
      }),
    };
  });

  app.post("/v1/negotiation-mandates", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "deal:negotiate");
      const body = parse(mandateBody, request.body);
      const mandate = await createNegotiationMandate(db, {
        partyId: body.party_id,
        agentId: body.agent_id,
        role: body.role,
        minRateMinorPerGpuHour: body.min_rate_minor_per_gpu_hour,
        maxRateMinorPerGpuHour: body.max_rate_minor_per_gpu_hour,
        maxDeltaMinor: body.max_delta_minor,
        expiresAt: body.expires_at,
        actorId: principal.id,
        actorRole: principal.role,
        actorPartyId: principal.partyId,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { negotiation_mandate: mandate } };
    });
  });

  app.post("/v1/deals/search", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "deal:search");
      const body = parse(searchBody, request.body);
      const result = await searchDeals(db, {
        workloadId: body.workload_id,
        mandate: body.mandate
          ? {
              minSavingsMinor: body.mandate.min_savings_minor,
              maxTotalCostMinor: body.mandate.max_total_cost_minor,
              maxSwitchingCostMinor: body.mandate.max_switching_cost_minor,
              coordinationFeeMinor: body.mandate.coordination_fee_minor,
              maxChainDepth: body.mandate.max_chain_depth,
              partyBudgetsMinor: body.mandate.party_budgets_minor,
            }
          : undefined,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return {
        statusCode: result.deal ? 201 : 200,
        body: {
          status: result.solver.status,
          // `proposal` is the name used by the hosted CREAO Deal Coordinator's
          // search contract. `recommended` and `proposals` are retained for the
          // Relay API and are additive aliases.
          proposal: result.deal?.proposal ?? result.solver.recommended,
          recommended: result.solver.recommended,
          proposals: result.solver.proposals,
          rejected: result.solver.rejected,
          infeasible_options: result.solver.rejected,
          engine: result.solver.engine,
          solver_input: result.solver_input,
          deal: result.deal,
        },
      };
    });
  });

  // Read-only listing used by the Duo 2 execution console to discover deals
  // that are cleared and approved. It returns the same shape as the detail
  // route so a consumer never has to guess which fields are available.
  app.get("/v1/deals", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "deal:read");
    const query = parse(
      z.object({
        status: z.string().trim().min(1).max(40).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      }),
      request.query,
    );
    const result = await db.query<{ id: string }>(
      `SELECT id FROM deals
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [query.status ?? null, query.limit ?? 20],
    );
    const deals = [];
    for (const row of result.rows) {
      const deal = await getDeal(db, row.id);
      if (deal) deals.push(deal);
    }
    return { deals };
  });

  app.get("/v1/deals/:dealId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "deal:read");
    const { dealId } = parse(idParams, request.params);
    const deal = await getDeal(db, dealId);
    if (!deal) throw new ApiError(404, "deal_not_found", "Deal not found.");
    return deal;
  });

  app.post("/v1/deals/:dealId/counteroffers", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "deal:negotiate");
      const { dealId } = parse(idParams, request.params);
      const body = parse(counterofferBody, request.body);
      const deal = await createCounteroffer(db, {
        dealId,
        termsVersion: body.terms_version,
        askPriceMinorPerGpuHour: body.ask_price_minor_per_gpu_hour,
        rationale: body.rationale,
        participantId: body.participant_id,
        mandateId: body.mandate_id,
        actorId: principal.id,
        actorRole: principal.role,
        actorPartyId: principal.partyId,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { deal } };
    });
  });

  app.post("/v1/deals/:dealId/negotiation-events", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "deal:negotiate");
      const { dealId } = parse(idParams, request.params);
      const body = parse(negotiationBody, request.body);
      const event = await createNegotiationEvent(db, {
        dealId,
        version: body.version,
        round: body.round,
        eventType: body.event_type,
        payload: body.payload,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { event } };
    });
  });

  app.post("/v1/deals/:dealId/escalations", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "deal:negotiate");
      const { dealId } = parse(idParams, request.params);
      const body = parse(escalationBody, request.body);
      const escalation = await createEscalation(db, {
        dealId,
        version: body.version,
        reason: body.reason,
        details: body.details,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { escalation } };
    });
  });

  app.post("/v1/deals/:dealId/handoff", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "deal:handoff");
      const { dealId } = parse(idParams, request.params);
      const result = await createHandoff(db, {
        dealId,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return {
        statusCode: 200,
        body: {
          handoff: result.handoff,
          replayed: result.replayed,
          reservation_status: result.handoff.reservation_status,
          settlement_authorized: false,
        },
      };
    });
  });
}
