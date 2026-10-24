import { randomUUID } from "node:crypto";
import type { Db } from "./client.js";
import { ApiError } from "../errors.js";
import { appendAudit } from "./audit.js";
import {
  asArray,
  asObject,
  iso,
  minor,
  type ApprovalRequestRow,
  type DealRow,
  type DealVersionRow,
  type HandoffRow,
} from "./values.js";
import {
  mapApprovalRequest,
  type ApprovalRequestView,
  type ApprovalView,
} from "./reads.js";

interface LockedDeal extends DealRow {
  workload_id: string;
}

interface RequestWithDeal extends ApprovalRequestRow {
  current_version: number;
  deal_status: string;
}

interface OfferCheckRow {
  id: string;
  source: string;
  executable: boolean;
  expires_at: unknown;
  authorization_id: string | null;
  auth_id: string | null;
  revoked_at: unknown;
  auth_expires_at: unknown;
}

interface CountRow {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
}

async function lockDeal(tx: Db, dealId: string): Promise<LockedDeal> {
  const result = await tx.query<LockedDeal>(
    `SELECT id, workload_id, title, status, current_version, created_at, updated_at
     FROM deals WHERE id = $1 FOR UPDATE`,
    [dealId],
  );
  const deal = result.rows[0];
  if (!deal) throw new ApiError(404, "deal_not_found", "Deal not found.");
  return deal;
}

async function readVersion(tx: Db, dealId: string, version: number): Promise<DealVersionRow> {
  const result = await tx.query<DealVersionRow>(
    `SELECT deal_id, version, status, proposal, engine, created_at, created_by
     FROM deal_versions WHERE deal_id = $1 AND version = $2`,
    [dealId, version],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "deal_version_not_found", "Deal version not found.");
  return row;
}

function assertCurrentVersion(deal: LockedDeal, version: number): void {
  if (version !== deal.current_version) {
    throw new ApiError(
      409,
      "terms_version_stale",
      `Requested terms version ${version} is not the current version ${deal.current_version}.`,
      { retryable: false, violations: ["terms_version_stale"] },
    );
  }
}

function proposalParties(proposal: unknown): Array<Record<string, unknown>> {
  return asArray(asObject(proposal).parties).map(asObject);
}

async function selectApprovalRequest(tx: Db, requestId: string): Promise<ApprovalRequestView> {
  const result = await tx.query<ApprovalRequestRow>(
    `SELECT r.id AS request_id, r.deal_id, r.version, r.participant_id,
            p.name AS participant_name, r.obligation, r.amount_minor, r.currency,
            r.channel, r.status, r.expires_at, r.created_at,
            a.id AS approval_id, a.decision, a.attested_by, a.attestation_channel,
            a.simulated, a.note, a.created_at AS approval_created_at
     FROM deal_approval_requests r
     JOIN parties p ON p.id = r.participant_id
     LEFT JOIN approvals a ON a.request_id = r.id
     WHERE r.id = $1`,
    [requestId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "approval_request_not_found", "Approval request not found.");
  return mapApprovalRequest(row);
}

export interface NegotiationEventInput {
  dealId: string;
  version?: number;
  round?: number;
  eventType: string;
  payload?: unknown;
  actorId: string;
  actorRole: string;
  idempotencyKey: string | null;
}

export async function createNegotiationEvent(
  db: Db,
  input: NegotiationEventInput,
): Promise<{
  id: string;
  deal_id: string;
  version: number;
  round: number;
  event_type: string;
  actor_id: string;
  payload: unknown;
  created_at: string;
}> {
  return db.transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    const version = input.version ?? deal.current_version;
    assertCurrentVersion(deal, version);
    await readVersion(tx, deal.id, version);

    const id = randomUUID();
    const result = await tx.query<{
      id: string;
      deal_id: string;
      version: number;
      round: number;
      event_type: string;
      actor_id: string;
      payload: unknown;
      created_at: unknown;
    }>(
      `INSERT INTO negotiation_events
         (id, deal_id, version, round, event_type, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, deal_id, version, round, event_type, actor_id, payload, created_at`,
      [
        id,
        deal.id,
        version,
        input.round ?? 1,
        input.eventType,
        input.actorId,
        JSON.stringify(input.payload ?? {}),
      ],
    );
    await tx.query(`UPDATE deals SET updated_at = now() WHERE id = $1`, [deal.id]);
    const event = result.rows[0]!;
    await appendAudit(tx, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: "negotiation_event.recorded",
      objectType: "negotiation_event",
      objectId: id,
      dealId: deal.id,
      idempotencyKey: input.idempotencyKey,
      after: event,
    });
    return { ...event, created_at: iso(event.created_at) ?? new Date().toISOString() };
  });
}

export interface ApprovalRequestInput {
  dealId: string;
  version?: number;
  participantId: string;
  obligation: string;
  amountMinor?: number;
  currency?: string;
  channel?: string;
  expiresAt?: string;
  metadata?: unknown;
  actorId: string;
  actorRole: string;
  idempotencyKey: string | null;
}

export async function createApprovalRequest(
  db: Db,
  input: ApprovalRequestInput,
): Promise<ApprovalRequestView> {
  return db.transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    const version = input.version ?? deal.current_version;
    assertCurrentVersion(deal, version);
    const dealVersion = await readVersion(tx, deal.id, version);

    if (["rejected_by_participant", "escalated", "expired", "failed", "handoff_ready"].includes(deal.status)) {
      throw new ApiError(409, "deal_not_open", `Deal is in state ${deal.status} and cannot accept new approvals.`);
    }

    const party = proposalParties(dealVersion.proposal).find(
      (candidate) => candidate.id === input.participantId,
    );
    if (!party) {
      throw new ApiError(
        422,
        "participant_not_in_proposal",
        "participant_id is not a party to the current proposal.",
        { violations: ["participant_not_in_proposal"] },
      );
    }

    const proposalAmount = Number(party.amount_minor ?? 0);
    const amountMinor = input.amountMinor ?? (Number.isFinite(proposalAmount) ? proposalAmount : 0);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new ApiError(422, "invalid_amount", "amount_minor must be a non-negative integer.");
    }

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + 24 * 60 * 60_000);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new ApiError(422, "invalid_expiry", "expires_at must be a future ISO 8601 timestamp.");
    }

    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM deal_approval_requests
       WHERE deal_id = $1 AND version = $2 AND participant_id = $3`,
      [deal.id, version, input.participantId],
    );
    if (existing.rows[0]) {
      throw new ApiError(
        409,
        "approval_request_exists",
        "An approval request already exists for this deal version and participant.",
      );
    }

    const id = randomUUID();
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO deal_approval_requests
         (id, deal_id, version, participant_id, obligation, amount_minor, currency,
          channel, status, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10::jsonb)
       RETURNING id`,
      [
        id,
        deal.id,
        version,
        input.participantId,
        input.obligation,
        amountMinor,
        (input.currency ?? "USD").toUpperCase(),
        input.channel ?? "api",
        expiresAt.toISOString(),
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    await tx.query(
      `UPDATE deals SET status = CASE WHEN status IN ('draft', 'approved') THEN 'awaiting_human_approval' ELSE status END,
                        updated_at = now()
       WHERE id = $1`,
      [deal.id],
    );
    await appendAudit(tx, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: "approval_request.created",
      objectType: "approval_request",
      objectId: inserted.rows[0]!.id,
      dealId: deal.id,
      idempotencyKey: input.idempotencyKey,
      after: {
        deal_id: deal.id,
        version,
        participant_id: input.participantId,
        obligation: input.obligation,
        amount_minor: amountMinor,
        expires_at: expiresAt.toISOString(),
      },
    });
    return selectApprovalRequest(tx, id);
  });
}

export interface ApprovalDecisionInput {
  requestId: string;
  decision: "approved" | "rejected";
  actorPartyId: string | null;
  attestedBy: string;
  channel?: string;
  note?: string | null;
  simulated?: boolean;
  actorId: string;
  actorRole: string;
  idempotencyKey: string | null;
}

export interface ApprovalDecisionResult {
  approval: ApprovalView;
  request: ApprovalRequestView;
  deal_status: string;
}

export async function createApproval(
  db: Db,
  input: ApprovalDecisionInput,
): Promise<ApprovalDecisionResult> {
  return db.transaction(async (tx) => {
    const requestResult = await tx.query<RequestWithDeal>(
      `SELECT r.id AS request_id, r.deal_id, r.version, r.participant_id,
              p.name AS participant_name, r.obligation, r.amount_minor, r.currency,
              r.channel, r.status, r.expires_at, r.created_at,
              a.id AS approval_id, a.decision, a.attested_by, a.attestation_channel,
              a.simulated, a.note, a.created_at AS approval_created_at,
              d.current_version, d.status AS deal_status
       FROM deal_approval_requests r
       JOIN deals d ON d.id = r.deal_id
       JOIN parties p ON p.id = r.participant_id
       LEFT JOIN approvals a ON a.request_id = r.id
       WHERE r.id = $1
       FOR UPDATE OF r`,
      [input.requestId],
    );
    const request = requestResult.rows[0];
    if (!request) throw new ApiError(404, "approval_request_not_found", "Approval request not found.");
    const deal = await lockDeal(tx, request.deal_id);

    if (!input.actorPartyId || input.actorPartyId !== request.participant_id) {
      throw new ApiError(
        403,
        "participant_forbidden",
        "A human may only decide the approval request for their own participant.",
      );
    }
    if (["rejected_by_participant", "escalated", "expired", "failed"].includes(deal.status)) {
      throw new ApiError(409, "deal_not_open", `Deal is in state ${deal.status} and cannot accept decisions.`);
    }

    if (request.version !== deal.current_version) {
      throw new ApiError(409, "terms_version_stale", "This approval request is for an outdated terms version.", {
        violations: ["terms_version_stale"],
      });
    }
    if (request.status !== "pending") {
      throw new ApiError(409, "approval_request_not_pending", `Approval request is ${request.status}.`);
    }
    if (request.expires_at && new Date(iso(request.expires_at)!).getTime() <= Date.now()) {
      throw new ApiError(409, "approval_request_expired", "This approval request has expired.");
    }
    if (request.approval_id) {
      throw new ApiError(409, "approval_already_recorded", "An approval decision is already recorded.");
    }

    const approvalId = randomUUID();
    await tx.query(
      `INSERT INTO approvals
         (id, request_id, deal_id, version, participant_id, decision,
          attested_by, attestation_channel, simulated, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        approvalId,
        request.request_id,
        request.deal_id,
        request.version,
        request.participant_id,
        input.decision,
        input.attestedBy,
        input.channel ?? "api",
        input.simulated ?? false,
        input.note ?? null,
      ],
    );
    await tx.query(`UPDATE deal_approval_requests SET status = $2 WHERE id = $1`, [
      request.request_id,
      input.decision,
    ]);

    const counts = await tx.query<CountRow>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'approved')::int AS approved,
              count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
              count(*) FILTER (WHERE status = 'pending')::int AS pending
       FROM deal_approval_requests
       WHERE deal_id = $1 AND version = $2`,
      [deal.id, deal.current_version],
    );
    const count = counts.rows[0]!;
    const dealStatus =
      count.rejected > 0
        ? "rejected_by_participant"
        : count.pending === 0 && count.approved === count.total && count.total > 0
          ? "approved"
          : "awaiting_human_approval";

    await tx.query(`UPDATE deals SET status = $2, updated_at = now() WHERE id = $1`, [
      deal.id,
      dealStatus,
    ]);
    await appendAudit(tx, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.decision === "approved" ? "approval.approved" : "approval.rejected",
      objectType: "approval",
      objectId: approvalId,
      dealId: deal.id,
      idempotencyKey: input.idempotencyKey,
      after: {
        request_id: request.request_id,
        version: request.version,
        participant_id: request.participant_id,
        decision: input.decision,
        attested_by: input.attestedBy,
        simulated: input.simulated ?? false,
      },
    });

    const updated = await selectApprovalRequest(tx, request.request_id);
    if (!updated.approval) {
      throw new ApiError(500, "approval_write_failed", "Approval was written but could not be read back.");
    }
    return { approval: updated.approval, request: updated, deal_status: dealStatus };
  });
}

export interface HandoffInput {
  dealId: string;
  version?: number;
  actorId: string;
  actorRole: string;
  idempotencyKey: string | null;
}

export interface HandoffView {
  id: string;
  deal_id: string;
  version: number;
  status: string;
  reservation_status: string;
  settlement_authorized: false;
  package: unknown;
  created_at: string | null;
}

function mapHandoff(row: HandoffRow): HandoffView {
  return {
    id: row.id,
    deal_id: row.deal_id,
    version: row.version,
    status: row.status,
    reservation_status: row.reservation_status,
    settlement_authorized: false,
    package: row.package,
    created_at: iso(row.created_at),
  };
}

export async function createHandoff(
  db: Db,
  input: HandoffInput,
): Promise<{ handoff: HandoffView; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    const version = input.version ?? deal.current_version;
    assertCurrentVersion(deal, version);

    const existing = await tx.query<HandoffRow>(
      `SELECT id, deal_id, version, status, reservation_status, settlement_authorized, package, created_at
       FROM handoffs WHERE deal_id = $1 AND version = $2`,
      [deal.id, version],
    );
    if (existing.rows[0]) {
      return { handoff: mapHandoff(existing.rows[0]), replayed: true };
    }

    const dealVersion = await readVersion(tx, deal.id, version);
    const proposals = asObject(dealVersion.proposal);
    const requests = await tx.query<{ status: string; participant_id: string }>(
      `SELECT status, participant_id FROM deal_approval_requests
       WHERE deal_id = $1 AND version = $2`,
      [deal.id, version],
    );
    const violations: string[] = [];
    if (deal.status !== "approved") violations.push(`deal_not_approved:${deal.status}`);
    const proposalPartyIds = proposalParties(dealVersion.proposal)
      .map((party) => (typeof party.id === "string" ? party.id : null))
      .filter((partyId): partyId is string => partyId !== null);
    const requestedPartyIds = new Set(requests.rows.map((request) => request.participant_id));
    if (proposalPartyIds.length === 0) violations.push("no_proposal_parties");
    for (const partyId of proposalPartyIds) {
      if (!requestedPartyIds.has(partyId)) violations.push(`approval_coverage_missing:${partyId}`);
    }
    for (const request of requests.rows) {
      if (!proposalPartyIds.includes(request.participant_id)) {
        violations.push(`approval_request_not_in_proposal:${request.participant_id}`);
      }
      if (request.status !== "approved") {
        violations.push(`approval_not_approved:${request.participant_id}`);
      }
    }

    const required = asArray(proposals.required_commitments).map(asObject);
    if (required.length === 0) violations.push("no_required_commitments");
    for (const commitment of required) {
      const offerId = typeof commitment.offer_id === "string" ? commitment.offer_id : null;
      if (!offerId) {
        violations.push("commitment_offer_id_missing");
        continue;
      }
      const offerResult = await tx.query<OfferCheckRow>(
        `SELECT o.id, o.source, o.executable, o.expires_at, o.authorization_id,
                pa.id AS auth_id, pa.revoked_at, pa.expires_at AS auth_expires_at
         FROM market_offers o
         LEFT JOIN provider_authorizations pa ON pa.id = o.authorization_id
         WHERE o.id = $1`,
        [offerId],
      );
      const offer = offerResult.rows[0];
      if (!offer) {
        violations.push(`offer_missing:${offerId}`);
        continue;
      }
      const offerExpired =
        offer.expires_at !== null && new Date(iso(offer.expires_at) ?? 0).getTime() <= Date.now();
      const authExpired =
        offer.auth_expires_at !== null &&
        new Date(iso(offer.auth_expires_at) ?? 0).getTime() <= Date.now();
      if (offer.source !== "worker" || !offer.executable) {
        violations.push(`offer_not_executable:${offerId}`);
      }
      if (!offer.authorization_id || !offer.auth_id || offer.revoked_at || authExpired) {
        violations.push(`provider_not_authorized:${offerId}`);
      }
      if (offerExpired) violations.push(`offer_expired:${offerId}`);
    }

    // `total_cost_minor` spans multiple buyers, so compare each buyer's own
    // obligation against that buyer's workload budget instead of comparing the
    // combined total to one buyer's budget.
    const buyers = proposalParties(dealVersion.proposal).filter((party) => party.role === "buyer");
    if (buyers.length === 0) violations.push("no_buyer_parties");
    for (const buyer of buyers) {
      const buyerId = typeof buyer.id === "string" ? buyer.id : null;
      const amount = Number(buyer.amount_minor ?? 0);
      if (!buyerId || !Number.isSafeInteger(amount) || amount < 0) {
        violations.push("invalid_buyer_obligation");
        continue;
      }
      const workloadResult = await tx.query<{ budget_minor: unknown }>(
        `SELECT budget_minor FROM workloads
         WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [buyerId],
      );
      const workload = workloadResult.rows[0];
      if (!workload) {
        violations.push(`buyer_workload_missing:${buyerId}`);
      } else if (!Number.isFinite(amount) || amount > minor(workload.budget_minor)) {
        violations.push(`budget_exceeded:${buyerId}`);
      }
    }
    const proposedVersion = Number(proposals.terms_version);
    if (Number.isFinite(proposedVersion) && proposedVersion !== version) {
      violations.push("proposal_version_mismatch");
    }

    if (violations.length > 0) {
      throw new ApiError(409, "handoff_not_permitted", "The deal is not ready for handoff.", {
        violations: [...new Set(violations)],
      });
    }

    const id = randomUUID();
    const pkg = {
      deal_id: deal.id,
      terms_version: version,
      proposal: dealVersion.proposal,
      approvals: requests.rows,
      checks: {
        approvals_complete: true,
        executable_inventory: true,
        provider_authorized: true,
        budget_respected: true,
        terms_version_current: true,
      },
      reservation_status: "not_reserved",
      settlement_authorized: false,
      generated_at: new Date().toISOString(),
      note: "P0 contract handoff only. No capacity was reserved and no funds were authorized.",
    };
    const inserted = await tx.query<HandoffRow>(
      `INSERT INTO handoffs
         (id, deal_id, version, status, reservation_status, settlement_authorized, package)
       VALUES ($1, $2, $3, 'provisional', 'not_reserved', false, $4::jsonb)
       RETURNING id, deal_id, version, status, reservation_status, settlement_authorized, package, created_at`,
      [id, deal.id, version, JSON.stringify(pkg)],
    );
    await tx.query(`UPDATE deals SET status = 'handoff_ready', updated_at = now() WHERE id = $1`, [
      deal.id,
    ]);
    await appendAudit(tx, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: "handoff.provisional_created",
      objectType: "handoff",
      objectId: id,
      dealId: deal.id,
      idempotencyKey: input.idempotencyKey,
      after: { version, reservation_status: "not_reserved", settlement_authorized: false },
    });
    return { handoff: mapHandoff(inserted.rows[0]!), replayed: false };
  });
}

export interface EscalationInput {
  dealId: string;
  version?: number;
  reason: string;
  details?: unknown;
  actorId: string;
  actorRole: string;
  idempotencyKey: string | null;
}

export async function createEscalation(
  db: Db,
  input: EscalationInput,
): Promise<{
  id: string;
  deal_id: string;
  version: number;
  reason: string;
  details: unknown;
  status: string;
  created_at: string;
}> {
  return db.transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    const version = input.version ?? deal.current_version;
    assertCurrentVersion(deal, version);
    await readVersion(tx, deal.id, version);
    const id = randomUUID();
    const result = await tx.query<{
      id: string;
      deal_id: string;
      version: number;
      reason: string;
      details: unknown;
      status: string;
      created_at: unknown;
    }>(
      `INSERT INTO escalations (id, deal_id, version, reason, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, deal_id, version, reason, details, status, created_at`,
      [id, deal.id, version, input.reason, JSON.stringify(input.details ?? {})],
    );
    await tx.query(`UPDATE deals SET status = 'escalated', updated_at = now() WHERE id = $1`, [
      deal.id,
    ]);
    await appendAudit(tx, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: "deal.escalated",
      objectType: "escalation",
      objectId: id,
      dealId: deal.id,
      idempotencyKey: input.idempotencyKey,
      after: { version, reason: input.reason },
    });
    return { ...result.rows[0]!, created_at: iso(result.rows[0]!.created_at) ?? new Date().toISOString() };
  });
}
