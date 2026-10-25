import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { getDeal, getWorkload, type DealView, type WorkloadView } from "../db/reads.js";
import { asObject, iso, minor, type OfferRow, type WorkloadRow } from "../db/values.js";
import { ApiError } from "../errors.js";
import {
  solve,
  solverWorkloadFromView,
  type SolverAllocation,
  type SolverMandate,
  type SolverOffer,
  type SolverProposal,
  type SolverResult,
  type SolverWorkload,
} from "./engine.js";

interface SolverOfferRow extends OfferRow {
  allowed_workloads: string[] | null;
  auth_id: string | null;
  auth_scope: unknown;
  auth_revoked_at: unknown;
  transferable: boolean | null;
}

interface AllocationRow {
  id: string;
  offer_id: string;
  buyer_id: string;
  buyer_name: string;
  workload_id: string;
  gpu_count: number;
  window_start: unknown;
  window_end: unknown;
  status: string;
  transferable: boolean;
  switch_cost_minor: unknown;
}

async function loadWorkloads(db: Db, gpuModel: string): Promise<SolverWorkload[]> {
  const result = await db.query<WorkloadRow>(
    `SELECT w.*, p.name AS buyer_name, p.kind AS buyer_kind
     FROM workloads w
     JOIN parties p ON p.id = w.buyer_id
     WHERE w.gpu_model = $1 AND w.state IN ('open', 'cleared', 'executing')
     ORDER BY w.created_at ASC`,
    [gpuModel],
  );
  return result.rows.map((row) => ({
    id: row.id,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    type: row.type,
    gpuModel: row.gpu_model,
    gpuCount: row.gpu_count,
    cpuCores: row.cpu_cores,
    memoryGb: row.memory_gb,
    budgetMinor: minor(row.budget_minor),
    deadline: iso(row.deadline),
    earliestStart: iso(row.earliest_start),
    durationHours: Number(asObject(row.flexibility).duration_hours ?? 10),
    flexibility: asObject(row.flexibility),
  }));
}

async function loadOffers(db: Db, gpuModel: string): Promise<SolverOffer[]> {
  const result = await db.query<SolverOfferRow>(
    `SELECT o.*, p.name AS provider_name,
            pp.allowed_workloads,
            pa.id AS auth_id,
            pa.expires_at AS auth_expires_at,
            pa.revoked_at AS auth_revoked_at,
            pa.scope AS auth_scope
     FROM market_offers o
     JOIN parties p ON p.id = o.provider_id
     LEFT JOIN provider_profiles pp ON pp.party_id = o.provider_id
     LEFT JOIN provider_authorizations pa ON pa.id = o.authorization_id
     WHERE o.gpu_model = $1
       AND (o.expires_at IS NULL OR o.expires_at > now())
     ORDER BY o.rate_minor_per_gpu_hour ASC, o.id ASC`,
    [gpuModel],
  );
  return result.rows.map((row) => {
    const authExpired =
      row.auth_expires_at !== null &&
      row.auth_expires_at !== undefined &&
      new Date(iso(row.auth_expires_at) ?? 0).getTime() <= Date.now();
    const authorizationStatus: SolverOffer["authorizationStatus"] =
      !row.auth_id || row.source !== "worker"
        ? "missing"
        : row.auth_revoked_at
          ? "revoked"
          : authExpired
            ? "expired"
            : "authorized";
    const metadata = asObject(row.metadata);
    const transferRate = Number(metadata.transfer_rate_minor_per_gpu_hour);
    const scope = asObject(row.auth_scope);
    return {
      id: row.id,
      providerId: row.provider_id,
      providerName: row.provider_name,
      source: row.source as "worker" | "external_reference",
      gpuModel: row.gpu_model,
      gpuCount: row.gpu_count,
      cpuCores: row.cpu_cores,
      memoryGb: row.memory_gb,
      rateMinorPerGpuHour: minor(row.rate_minor_per_gpu_hour),
      currency: row.currency,
      location: row.location,
      availableFrom: iso(row.available_from),
      availableUntil: iso(row.available_until),
      observedAt: iso(row.observed_at),
      expiresAt: iso(row.expires_at),
      executable: row.executable === true && row.source === "worker",
      authorizationStatus,
      allowedWorkloads: row.allowed_workloads ?? [],
      transferable: row.transferable === true || scope.transferable === true,
      transferRateMinorPerGpuHour:
        Number.isFinite(transferRate) && transferRate >= 0 ? transferRate : null,
      metadata,
    };
  });
}

async function loadAllocations(db: Db, gpuModel: string): Promise<SolverAllocation[]> {
  const result = await db.query<AllocationRow>(
    `SELECT a.id, a.offer_id, a.buyer_id, p.name AS buyer_name, a.workload_id,
            a.gpu_count, a.window_start, a.window_end, a.status,
            a.transferable, a.switch_cost_minor
     FROM capacity_allocations a
     JOIN parties p ON p.id = a.buyer_id
     JOIN market_offers o ON o.id = a.offer_id
     WHERE a.status = 'active' AND o.gpu_model = $1
     ORDER BY a.window_start ASC, a.id ASC`,
    [gpuModel],
  );
  return result.rows.map((row) => ({
    id: row.id,
    offerId: row.offer_id,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    workloadId: row.workload_id,
    gpuCount: row.gpu_count,
    windowStart: iso(row.window_start) ?? new Date().toISOString(),
    windowEnd: iso(row.window_end) ?? new Date().toISOString(),
    status: row.status,
    transferable: row.transferable,
    switchCostMinor: minor(row.switch_cost_minor),
  }));
}

export async function searchDeals(
  db: Db,
  options: {
    workloadId: string;
    mandate?: SolverMandate;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
    persist?: boolean;
  },
): Promise<{ solver: SolverResult; deal: DealView | null; solver_input: { offers: number; allocations: number } }> {
  const workload = await getWorkload(db, options.workloadId);
  if (!workload) throw new ApiError(404, "workload_not_found", "Workload not found.");
  if (workload.state !== "open") {
    throw new ApiError(409, "workload_not_open", `Workload is ${workload.state} and cannot be cleared.`);
  }

  const [workloads, offers, allocations] = await Promise.all([
    loadWorkloads(db, workload.gpu_model),
    loadOffers(db, workload.gpu_model),
    loadAllocations(db, workload.gpu_model),
  ]);

  const target = workloads.find((candidate) => candidate.id === workload.id) ??
    solverWorkloadFromView(workload);

  const solver = solve({
    workload: target,
    workloads,
    offers,
    allocations,
    mandate: options.mandate,
  });

  if (!solver.recommended || options.persist === false) {
    return {
      solver,
      deal: null,
      solver_input: { offers: offers.length, allocations: allocations.length },
    };
  }

  const deal = await persistDeal(db, {
    workload: target,
    proposal: solver.recommended,
    solver,
    actorId: options.actorId,
    actorRole: options.actorRole,
    idempotencyKey: options.idempotencyKey,
  });

  return {
    solver,
    deal,
    solver_input: { offers: offers.length, allocations: allocations.length },
  };
}

async function persistDeal(
  db: Db,
  options: {
    workload: SolverWorkload;
    proposal: SolverProposal;
    solver: SolverResult;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<DealView> {
  const dealId = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const proposal = {
    proposal_id: dealId,
    deal_id: dealId,
    terms_version: 1,
    status: "awaiting_human_approval",
    ...options.proposal,
    approval_status: "pending",
    reservation_status: "planned",
    settlement_authorized: false,
    engine: options.solver.engine,
    fallback: {
      action: "cancel_and_keep_existing_allocations",
      description:
        "If any participant rejects, an offer expires, or a reservation fails, no transfer or payment is authorized and the current allocation remains in place.",
    },
  };

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO deals (id, workload_id, title, status, current_version)
       VALUES ($1, $2, $3, 'awaiting_human_approval', 1)`,
      [dealId, options.workload.id, options.proposal.title],
    );
    await tx.query(
      `INSERT INTO deal_versions (deal_id, version, status, proposal, engine, created_by)
       VALUES ($1, 1, 'awaiting_human_approval', $2::jsonb, $3::jsonb, $4)`,
      [dealId, JSON.stringify(proposal), JSON.stringify(options.solver.engine), options.actorId],
    );

    for (const party of options.proposal.parties) {
      await tx.query(
        `INSERT INTO deal_approval_requests
           (id, deal_id, version, participant_id, obligation, amount_minor, currency,
            channel, status, expires_at, metadata)
         VALUES ($1, $2, 1, $3, $4, $5, $6, 'api', 'pending', $7, $8::jsonb)`,
        [
          randomUUID(),
          dealId,
          party.id,
          party.obligation,
          party.amount_minor,
          party.currency,
          expiresAt,
          JSON.stringify({ source: "deterministic_solver", strategy: options.proposal.strategy }),
        ],
      );
    }

    await tx.query(
      `INSERT INTO agent_work_items (id, kind, deal_id, status, payload)
       VALUES ($1, 'deal_opportunity', $2, 'pending', $3::jsonb)`,
      [
        randomUUID(),
        dealId,
        JSON.stringify({
          deal_id: dealId,
          title: options.proposal.title,
          strategy: options.proposal.strategy,
          projected_savings_minor: options.proposal.projected_savings_minor,
          required_participants: options.proposal.parties.map((party) => ({
            id: party.id,
            name: party.name,
            role: party.role,
          })),
          next_step: "coordinate_participant_approvals",
        }),
      ],
    );

    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "deal.proposed_by_solver",
      objectType: "deal",
      objectId: dealId,
      dealId,
      idempotencyKey: options.idempotencyKey,
      after: {
        version: 1,
        strategy: options.proposal.strategy,
        projected_savings_minor: options.proposal.projected_savings_minor,
        required_commitments: options.proposal.required_commitments,
      },
    });
  });

  const deal = await getDeal(db, dealId);
  if (!deal) throw new ApiError(500, "deal_write_failed", "Deal was written but could not be read back.");
  return deal;
}

interface MandateRow {
  id: string;
  party_id: string;
  agent_id: string;
  role: string;
  min_rate_minor_per_gpu_hour: unknown;
  max_rate_minor_per_gpu_hour: unknown;
  max_delta_minor: unknown;
  active: boolean;
  expires_at: unknown;
}

export async function createCounteroffer(
  db: Db,
  options: {
    dealId: string;
    termsVersion: number;
    askPriceMinorPerGpuHour: number;
    rationale?: string;
    participantId?: string;
    mandateId?: string;
    actorId: string;
    actorRole: string;
    actorPartyId: string | null;
    idempotencyKey: string | null;
  },
): Promise<DealView> {
  return db.transaction(async (tx) => {
    const locked = await tx.query<{
      id: string;
      workload_id: string;
      title: string | null;
      status: string;
      current_version: number;
    }>(
      `SELECT id, workload_id, title, status, current_version FROM deals WHERE id = $1 FOR UPDATE`,
      [options.dealId],
    );
    const deal = locked.rows[0];
    if (!deal) throw new ApiError(404, "deal_not_found", "Deal not found.");
    if (deal.current_version !== options.termsVersion) {
      throw new ApiError(409, "terms_version_stale", "The counteroffer targets an outdated terms version.", {
        violations: ["terms_version_stale"],
      });
    }
    if (["rejected_by_participant", "handoff_ready", "expired", "failed"].includes(deal.status)) {
      throw new ApiError(409, "deal_not_open", `Deal is ${deal.status} and cannot be renegotiated.`);
    }
    const current = await tx.query<{ proposal: unknown; engine: unknown }>(
      `SELECT proposal, engine FROM deal_versions WHERE deal_id = $1 AND version = $2`,
      [deal.id, deal.current_version],
    );
    const row = current.rows[0];
    if (!row) throw new ApiError(404, "deal_version_not_found", "Deal version not found.");
    const proposal = asObject(row.proposal) as unknown as SolverProposal & Record<string, unknown>;
    const parties = Array.isArray(proposal.parties) ? proposal.parties : [];
    const participantId = options.participantId ?? options.actorPartyId;
    if (!participantId) {
      throw new ApiError(422, "participant_required", "participant_id is required for agent counteroffers.");
    }
    const party = parties.find((candidate) => candidate.id === participantId);
    if (!party) throw new ApiError(422, "participant_not_in_proposal", "Participant is not part of the proposal.");
    if (party.role !== "provider") {
      throw new ApiError(403, "only_provider_counteroffers", "Only a provider participant may raise a price counteroffer.");
    }
    if (options.actorRole === "human") {
      if (options.actorPartyId !== participantId) {
        throw new ApiError(403, "participant_forbidden", "A human may only counter on their own participant.");
      }
    } else if (options.actorRole === "agent") {
      if (!options.mandateId) {
        throw new ApiError(403, "negotiation_mandate_required", "Agents must present an active negotiation mandate.");
      }
      const mandateResult = await tx.query<MandateRow>(
        `SELECT * FROM negotiation_mandates
         WHERE id = $1 AND agent_id = $2 AND party_id = $3 AND active = true
           AND (expires_at IS NULL OR expires_at > now())`,
        [options.mandateId, options.actorId, participantId],
      );
      const mandate = mandateResult.rows[0];
      if (!mandate) throw new ApiError(403, "negotiation_mandate_invalid", "The negotiation mandate is not valid.");
      const min = mandate.min_rate_minor_per_gpu_hour == null
        ? null
        : minor(mandate.min_rate_minor_per_gpu_hour);
      const max = mandate.max_rate_minor_per_gpu_hour == null
        ? null
        : minor(mandate.max_rate_minor_per_gpu_hour);
      if (min !== null && options.askPriceMinorPerGpuHour < min) {
        throw new ApiError(422, "counteroffer_below_mandate", "Counteroffer is below the agent's mandate.");
      }
      if (max !== null && options.askPriceMinorPerGpuHour > max) {
        throw new ApiError(422, "counteroffer_above_mandate", "Counteroffer exceeds the agent's mandate.");
      }
    } else {
      throw new ApiError(403, "counteroffer_forbidden", "Only a human participant or a mandated CREAO agent may counter.");
    }

    const commitment = (proposal.required_commitments ?? []).find(
      (candidate) => candidate.provider_id === participantId,
    );
    if (!commitment) {
      throw new ApiError(422, "provider_commitment_missing", "The provider has no commitment to reprice.");
    }
    const hours = Math.max(
      1,
      (new Date(commitment.window_end).getTime() - new Date(commitment.window_start).getTime()) /
        3_600_000,
    );
    const newProviderAmount = Math.round(
      options.askPriceMinorPerGpuHour * commitment.gpu_count * hours,
    );
    const compensation = Array.isArray(proposal.compensation) ? proposal.compensation : [];
    const line = compensation.find((candidate) => candidate.to_party_id === participantId);
    if (!line) throw new ApiError(422, "compensation_line_missing", "The provider has no compensation line.");
    const oldProviderAmount = line.amount_minor;
    if (options.actorRole === "agent") {
      const mandateResult = await tx.query<{ max_delta_minor: unknown }>(
        `SELECT max_delta_minor FROM negotiation_mandates WHERE id = $1`,
        [options.mandateId],
      );
      const maxDelta = minor(mandateResult.rows[0]?.max_delta_minor ?? 0);
      if (Math.abs(newProviderAmount - oldProviderAmount) > maxDelta) {
        throw new ApiError(422, "counteroffer_delta_above_mandate", "Counteroffer exceeds the mandate's allowed change.");
      }
    }
    const buyerId = line.from_party_id;
    const buyer = parties.find((candidate) => candidate.id === buyerId);
    if (!buyer) throw new ApiError(422, "buyer_party_missing", "The compensating buyer is missing.");
    const buyerDelta = newProviderAmount - oldProviderAmount;
    const newBuyerAmount = buyer.amount_minor + buyerDelta;
    const buyerWorkload = await tx.query<{ budget_minor: unknown }>(
      `SELECT budget_minor FROM workloads WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [buyerId],
    );
    const budget = buyerWorkload.rows[0] ? minor(buyerWorkload.rows[0].budget_minor) : 0;
    if (newBuyerAmount > budget) {
      throw new ApiError(409, "counteroffer_infeasible", "The counteroffer would exceed the buyer budget.", {
        violations: ["counteroffer_exceeds_buyer_budget"],
      });
    }
    const newTotal = proposal.total_cost_minor + buyerDelta;
    const savings = proposal.baseline_cost_minor - (newTotal + proposal.switching_cost_minor + proposal.coordination_fee_minor);
    if (savings < 0) {
      throw new ApiError(409, "counteroffer_infeasible", "The counteroffer would remove the economic surplus.", {
        violations: ["counteroffer_destroys_surplus"],
      });
    }

    line.amount_minor = newProviderAmount;
    buyer.amount_minor = newBuyerAmount;
    proposal.total_cost_minor = newTotal;
    proposal.projected_savings_minor = savings;
    proposal.projected_surplus_minor = savings;
    proposal.provider_revenue_delta_minor =
      proposal.provider_revenue_delta_minor + (newProviderAmount - oldProviderAmount);
    proposal.terms_version = deal.current_version + 1;
    proposal.approval_status = "pending";
    const costs = Array.isArray(proposal.participant_costs) ? proposal.participant_costs : [];
    for (const cost of costs) {
      if (cost.party_id === participantId) {
        cost.revenue_minor = newProviderAmount;
      }
      if (cost.party_id === buyerId) {
        cost.gross_minor = cost.gross_minor + buyerDelta;
        cost.net_minor = cost.gross_minor + (cost.switching_minor ?? 0);
        cost.savings_minor = cost.baseline_minor - cost.net_minor;
      }
    }
    const explanation = Array.isArray(proposal.explanation) ? proposal.explanation : [];
    proposal.explanation = [
      ...explanation,
      `${party.name} countered at ${options.askPriceMinorPerGpuHour} minor/GPU-hour (${newProviderAmount} minor); ${buyer.name}'s obligation becomes ${newBuyerAmount} minor and projected net savings become ${savings} minor.`,
    ];
    const engine = {
      ...asObject(row.engine),
      counteroffer: {
        participant_id: participantId,
        ask_price_minor_per_gpu_hour: options.askPriceMinorPerGpuHour,
        rationale: options.rationale ?? null,
        mandate_id: options.mandateId ?? null,
        prior_terms_version: deal.current_version,
        at: new Date().toISOString(),
      },
    };

    await tx.query(
      `UPDATE deal_versions SET status = 'superseded' WHERE deal_id = $1 AND version = $2`,
      [deal.id, deal.current_version],
    );
    await tx.query(
      `UPDATE deal_approval_requests SET status = 'superseded'
       WHERE deal_id = $1 AND version = $2 AND status = 'pending'`,
      [deal.id, deal.current_version],
    );
    await tx.query(
      `INSERT INTO deal_versions (deal_id, version, status, proposal, engine, created_by)
       VALUES ($1, $2, 'awaiting_human_approval', $3::jsonb, $4::jsonb, $5)`,
      [deal.id, deal.current_version + 1, JSON.stringify(proposal), JSON.stringify(engine), options.actorId],
    );
    await tx.query(
      `UPDATE deals SET current_version = $2, status = 'awaiting_human_approval', updated_at = now()
       WHERE id = $1`,
      [deal.id, deal.current_version + 1],
    );
    for (const candidate of parties) {
      await tx.query(
        `INSERT INTO deal_approval_requests
           (id, deal_id, version, participant_id, obligation, amount_minor, currency,
            channel, status, expires_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'api', 'pending',
                 now() + interval '24 hours', $8::jsonb)`,
        [
          randomUUID(),
          deal.id,
          deal.current_version + 1,
          candidate.id,
          candidate.obligation,
          candidate.amount_minor,
          candidate.currency,
          JSON.stringify({ source: "counteroffer", prior_version: deal.current_version }),
        ],
      );
    }
    await tx.query(
      `INSERT INTO negotiation_events (id, deal_id, version, round, event_type, actor_id, payload)
       VALUES ($1, $2, $3, 1, 'counteroffer', $4, $5::jsonb)`,
      [
        randomUUID(),
        deal.id,
        deal.current_version + 1,
        options.actorId,
        JSON.stringify({
          participant_id: participantId,
          ask_price_minor_per_gpu_hour: options.askPriceMinorPerGpuHour,
          rationale: options.rationale ?? null,
          mandate_id: options.mandateId ?? null,
          prior_version: deal.current_version,
        }),
      ],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "deal.counteroffer.created",
      objectType: "deal",
      objectId: deal.id,
      dealId: deal.id,
      idempotencyKey: options.idempotencyKey,
      before: { version: deal.current_version, provider_amount: oldProviderAmount, buyer_amount: buyer.amount_minor - buyerDelta },
      after: { version: deal.current_version + 1, provider_amount: newProviderAmount, buyer_amount: newBuyerAmount, savings },
    });
    const updated = await getDeal(tx, deal.id);
    if (!updated) throw new ApiError(500, "deal_write_failed", "Counteroffer was written but could not be read back.");
    return updated;
  });
}

export function workloadForSolver(workload: WorkloadView): SolverWorkload {
  return solverWorkloadFromView(workload);
}
