import type { Db } from "./client.js";
import {
  asObject,
  integer,
  iso,
  minor,
  type ApprovalRequestRow,
  type DealRow,
  type DealVersionRow,
  type NegotiationEventRow,
  type OfferRow,
  type PartyRow,
  type PricePointRow,
  type WorkloadRow,
} from "./values.js";

export interface PartyView {
  id: string;
  kind: string;
  name: string;
  status: string;
  created_at: string | null;
  provider_profile: {
    hardware: unknown;
    allowed_workloads: string[];
    regions: string[];
    price_model: unknown;
    authorized_at: string | null;
    authorization_expires_at: string | null;
  } | null;
  permissions: {
    currently_authorized: boolean;
    authorized_at: string | null;
    authorization_expires_at: string | null;
  };
}

export interface WorkloadView {
  id: string;
  buyer_id: string;
  buyer: { id: string; name: string; kind: string };
  type: string;
  gpu_model: string;
  gpu_count: number;
  cpu_cores: number;
  memory_gb: number;
  budget_minor: number;
  deadline: string | null;
  earliest_start: string | null;
  flexibility: unknown;
  state: string;
  resource_constraints: {
    gpu_model: string;
    gpu_count: number;
    cpu_cores: number;
    memory_gb: number;
  };
  created_at: string | null;
  updated_at: string | null;
}

export interface OfferView {
  id: string;
  provider: { id: string; name: string };
  source: string;
  external_ref: string | null;
  gpu_model: string;
  gpu_count: number;
  cpu_cores: number;
  memory_gb: number;
  rate_minor_per_gpu_hour: number;
  currency: string;
  location: string | null;
  available_from: string | null;
  available_until: string | null;
  observed_at: string | null;
  expires_at: string | null;
  executable: boolean;
  advertised_executable: boolean;
  authorization: {
    id: string | null;
    status: "authorized" | "missing" | "revoked" | "expired";
    expires_at: string | null;
  };
  metadata: unknown;
}

export interface ApprovalView {
  id: string;
  request_id: string;
  deal_id: string;
  version: number;
  participant_id: string;
  decision: string;
  attested_by: string;
  attestation_channel: string;
  simulated: boolean;
  note: string | null;
  created_at: string | null;
}

export interface ApprovalRequestView {
  id: string;
  deal_id: string;
  version: number;
  participant: { id: string; name: string };
  obligation: string;
  amount_minor: number;
  currency: string;
  channel: string;
  status: string;
  expires_at: string | null;
  created_at: string | null;
  approval: ApprovalView | null;
}

export interface ApprovalSummary {
  required: number;
  recorded: number;
  approved: number;
  pending: number;
  rejected: number;
  expired: number;
  simulated: number;
  stale: number;
  outstanding: string[];
  complete: boolean;
}

export interface DealView {
  deal_id: string;
  deal: {
    id: string;
    workload_id: string;
    title: string | null;
    status: string;
    current_version: number;
    created_at: string | null;
    updated_at: string | null;
  };
  terms_version: number | null;
  proposal: unknown;
  engine: unknown;
  approval_requests: ApprovalRequestView[];
  approvals: ApprovalView[];
  approval_summary: ApprovalSummary;
  approval_integrity: {
    approved_for_current: boolean;
    stale_requests: number;
    stale_approvals: number;
    expired_requests: number;
    problems: string[];
    handoff_permitted: boolean;
    settlement_authorized: false;
  };
  negotiation_events: Array<{
    id: string;
    deal_id: string;
    version: number;
    round: number;
    event_type: string;
    actor_id: string;
    payload: unknown;
    created_at: string | null;
  }>;
}

function mapApproval(row: ApprovalRequestRow): ApprovalView | null {
  if (!row.approval_id) return null;
  return {
    id: row.approval_id,
    request_id: row.request_id,
    deal_id: row.deal_id,
    version: row.version,
    participant_id: row.participant_id,
    decision: row.decision ?? "",
    attested_by: row.attested_by ?? "",
    attestation_channel: row.attestation_channel ?? "api",
    simulated: row.simulated ?? false,
    note: row.note,
    created_at: iso(row.approval_created_at),
  };
}

export function mapApprovalRequest(row: ApprovalRequestRow): ApprovalRequestView {
  return {
    id: row.request_id,
    deal_id: row.deal_id,
    version: row.version,
    participant: { id: row.participant_id, name: row.participant_name },
    obligation: row.obligation,
    amount_minor: minor(row.amount_minor),
    currency: row.currency,
    channel: row.channel,
    status: row.status,
    expires_at: iso(row.expires_at),
    created_at: iso(row.created_at),
    approval: mapApproval(row),
  };
}

export function summarizeApprovals(
  requests: ApprovalRequestRow[],
  currentVersion: number | null,
): ApprovalSummary {
  const approvals = requests.filter((request) => request.approval_id);
  const approved = requests.filter((request) => request.status === "approved").length;
  const pending = requests.filter((request) => request.status === "pending").length;
  const rejected = requests.filter((request) => request.status === "rejected").length;
  const expired = requests.filter(
    (request) =>
      request.status === "expired" ||
      (request.status === "pending" &&
        request.expires_at !== null &&
        new Date(iso(request.expires_at) ?? 0).getTime() <= Date.now()),
  ).length;
  return {
    required: requests.length,
    recorded: approvals.length,
    approved,
    pending,
    rejected,
    expired,
    simulated: requests.filter((request) => request.simulated === true).length,
    stale:
      currentVersion === null
        ? 0
        : requests.filter((request) => request.version !== currentVersion).length,
    outstanding: requests
      .filter((request) => request.status === "pending")
      .map((request) => request.participant_id),
    complete: requests.length > 0 && approved === requests.length && rejected === 0,
  };
}

export async function getHealth(db: Db): Promise<{ database: "ok"; now: string }> {
  const result = await db.query<{ now: unknown }>(`SELECT now() AS now`);
  return { database: "ok", now: iso(result.rows[0]?.now) ?? new Date().toISOString() };
}

export async function getParty(db: Db, id: string): Promise<PartyView | null> {
  const result = await db.query<PartyRow>(
    `SELECT p.id, p.kind, p.name, p.status, p.created_at,
            pp.hardware, pp.allowed_workloads, pp.regions, pp.price_model,
            pp.authorized_at, pp.authorization_expires_at
     FROM parties p
     LEFT JOIN provider_profiles pp ON pp.party_id = p.id
     WHERE p.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;

  const authorizedAt = iso(row.authorized_at);
  const expiresAt = iso(row.authorization_expires_at);
  const currentlyAuthorized =
    Boolean(row.authorized_at) && (!expiresAt || new Date(expiresAt).getTime() > Date.now());

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    created_at: iso(row.created_at),
    provider_profile: row.hardware
      ? {
          hardware: row.hardware,
          allowed_workloads: row.allowed_workloads ?? [],
          regions: row.regions ?? [],
          price_model: row.price_model ?? {},
          authorized_at: authorizedAt,
          authorization_expires_at: expiresAt,
        }
      : null,
    permissions: {
      currently_authorized: currentlyAuthorized,
      authorized_at: authorizedAt,
      authorization_expires_at: expiresAt,
    },
  };
}

export async function getWorkload(db: Db, id: string): Promise<WorkloadView | null> {
  const result = await db.query<WorkloadRow>(
    `SELECT w.*, p.name AS buyer_name, p.kind AS buyer_kind
     FROM workloads w
     JOIN parties p ON p.id = w.buyer_id
     WHERE w.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    buyer_id: row.buyer_id,
    buyer: { id: row.buyer_id, name: row.buyer_name, kind: row.buyer_kind },
    type: row.type,
    gpu_model: row.gpu_model,
    gpu_count: row.gpu_count,
    cpu_cores: row.cpu_cores,
    memory_gb: row.memory_gb,
    budget_minor: minor(row.budget_minor),
    deadline: iso(row.deadline),
    earliest_start: iso(row.earliest_start),
    flexibility: row.flexibility,
    state: row.state,
    resource_constraints: {
      gpu_model: row.gpu_model,
      gpu_count: row.gpu_count,
      cpu_cores: row.cpu_cores,
      memory_gb: row.memory_gb,
    },
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export interface OfferFilters {
  gpuModel?: string | null;
  providerId?: string | null;
  source?: string | null;
  executableOnly?: boolean;
  workloadId?: string | null;
  limit?: number;
}

export async function listOffers(db: Db, filters: OfferFilters): Promise<OfferView[]> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const result = await db.query<OfferRow>(
    `WITH candidate AS (
       SELECT o.*, p.name AS provider_name,
              pa.expires_at AS auth_expires_at, pa.revoked_at,
              CASE
                WHEN o.source = 'worker'
                 AND o.executable = true
                 AND o.authorization_id IS NOT NULL
                 AND pa.id IS NOT NULL
                 AND pa.revoked_at IS NULL
                 AND (pa.expires_at IS NULL OR pa.expires_at > now())
                 AND (o.expires_at IS NULL OR o.expires_at > now())
                THEN true ELSE false
              END AS executable_now
       FROM market_offers o
       JOIN parties p ON p.id = o.provider_id
       LEFT JOIN provider_authorizations pa ON pa.id = o.authorization_id
     )
     SELECT * FROM candidate
     WHERE ($1::text IS NULL OR gpu_model = $1)
       AND ($2::uuid IS NULL OR provider_id = $2)
       AND ($3::text IS NULL OR source = $3)
       AND ($4::boolean IS NULL OR executable_now = $4)
       AND ($5::uuid IS NULL OR EXISTS (
         SELECT 1 FROM workloads w
         WHERE w.id = $5 AND w.gpu_model = candidate.gpu_model AND w.gpu_count <= candidate.gpu_count
       ))
     ORDER BY executable_now DESC, rate_minor_per_gpu_hour ASC, observed_at DESC
     LIMIT $6`,
    [
      filters.gpuModel ?? null,
      filters.providerId ?? null,
      filters.source ?? null,
      filters.executableOnly ? true : null,
      filters.workloadId ?? null,
      limit,
    ],
  );

  return result.rows.map((row) => {
    const revoked = Boolean(row.revoked_at);
    const expired = row.auth_expires_at ? new Date(iso(row.auth_expires_at)!).getTime() <= Date.now() : false;
    return {
      id: row.id,
      provider: { id: row.provider_id, name: row.provider_name },
      source: row.source,
      external_ref: row.external_ref,
      gpu_model: row.gpu_model,
      gpu_count: row.gpu_count,
      cpu_cores: row.cpu_cores,
      memory_gb: row.memory_gb,
      rate_minor_per_gpu_hour: minor(row.rate_minor_per_gpu_hour),
      currency: row.currency,
      location: row.location,
      available_from: iso(row.available_from),
      available_until: iso(row.available_until),
      observed_at: iso(row.observed_at),
      expires_at: iso(row.expires_at),
      executable: row.executable_now,
      advertised_executable: row.executable,
      authorization: {
        id: row.authorization_id,
        status: !row.authorization_id
          ? "missing"
          : revoked
            ? "revoked"
            : expired
              ? "expired"
              : "authorized",
        expires_at: iso(row.auth_expires_at),
      },
      metadata: row.metadata,
    };
  });
}

export interface PriceHistory {
  history: Array<{
    bucket: string | null;
    gpu_model: string;
    min_minor: number;
    avg_minor: number;
    max_minor: number;
    sample_count: number;
  }>;
  window_hours: number;
  gpu_model: string | null;
  source: "market_observations";
}

export async function getPriceHistory(
  db: Db,
  options: { gpuModel?: string | null; windowHours?: number; limit?: number },
): Promise<PriceHistory> {
  const windowHours = Math.min(Math.max(options.windowHours ?? 24, 1), 720);
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2_000);
  const result = await db.query<PricePointRow>(
    `SELECT date_trunc('hour', observed_at) AS bucket,
            gpu_model,
            min(rate_minor_per_gpu_hour) AS min_minor,
            round(avg(rate_minor_per_gpu_hour))::bigint AS avg_minor,
            max(rate_minor_per_gpu_hour) AS max_minor,
            count(*)::int AS sample_count
     FROM market_observations
     WHERE observed_at >= now() - make_interval(hours => $1)
       AND ($2::text IS NULL OR gpu_model = $2)
     GROUP BY 1, 2
     ORDER BY 1 DESC
     LIMIT $3`,
    [windowHours, options.gpuModel ?? null, limit],
  );

  return {
    history: result.rows.map((row) => ({
      bucket: iso(row.bucket),
      gpu_model: row.gpu_model,
      min_minor: minor(row.min_minor),
      avg_minor: minor(row.avg_minor),
      max_minor: minor(row.max_minor),
      sample_count: integer(row.sample_count),
    })),
    window_hours: windowHours,
    gpu_model: options.gpuModel ?? null,
    source: "market_observations",
  };
}

export async function getDeal(db: Db, id: string): Promise<DealView | null> {
  const dealResult = await db.query<DealRow>(
    `SELECT id, workload_id, title, status, current_version, created_at, updated_at
     FROM deals WHERE id = $1`,
    [id],
  );
  const deal = dealResult.rows[0];
  if (!deal) return null;

  const versionResult = deal.current_version
    ? await db.query<DealVersionRow>(
        `SELECT deal_id, version, status, proposal, engine, created_at, created_by
         FROM deal_versions WHERE deal_id = $1 AND version = $2`,
        [id, deal.current_version],
      )
    : { rows: [] as DealVersionRow[], rowCount: 0 };
  const version = versionResult.rows[0];

  const requestResult = await db.query<ApprovalRequestRow>(
    `SELECT r.id AS request_id, r.deal_id, r.version, r.participant_id,
            p.name AS participant_name, r.obligation, r.amount_minor, r.currency,
            r.channel, r.status, r.expires_at, r.created_at,
            a.id AS approval_id, a.decision, a.attested_by, a.attestation_channel,
            a.simulated, a.note, a.created_at AS approval_created_at
     FROM deal_approval_requests r
     JOIN parties p ON p.id = r.participant_id
     LEFT JOIN approvals a ON a.request_id = r.id
     WHERE r.deal_id = $1 AND r.version = $2
     ORDER BY r.participant_id`,
    [id, deal.current_version],
  );

  const negotiationResult = await db.query<NegotiationEventRow>(
    `SELECT id, deal_id, version, round, event_type, actor_id, payload, created_at
     FROM negotiation_events
     WHERE deal_id = $1
     ORDER BY created_at ASC
     LIMIT 100`,
    [id],
  );

  const requests = requestResult.rows;
  const summary = summarizeApprovals(requests, deal.current_version);
  const problems: string[] = [];
  if (!summary.complete) problems.push("approvals_incomplete");
  if (summary.stale > 0) problems.push("stale_approvals");
  if (summary.expired > 0) problems.push("expired_approval_requests");
  if (deal.status !== "approved") problems.push(`deal_status:${deal.status}`);
  const handoffPermitted =
    summary.complete &&
    summary.stale === 0 &&
    summary.expired === 0 &&
    deal.status === "approved";

  return {
    deal_id: deal.id,
    deal: {
      id: deal.id,
      workload_id: deal.workload_id,
      title: deal.title,
      status: deal.status,
      current_version: deal.current_version,
      created_at: iso(deal.created_at),
      updated_at: iso(deal.updated_at),
    },
    terms_version: version?.version ?? null,
    proposal: version?.proposal ?? null,
    engine: version?.engine ?? null,
    approval_requests: requests.map((request) => mapApprovalRequest(request)),
    approvals: requests
      .map((request) => mapApproval(request))
      .filter((approval): approval is ApprovalView => approval !== null),
    approval_summary: summary,
    approval_integrity: {
      approved_for_current: summary.complete && summary.stale === 0,
      stale_requests: summary.stale,
      stale_approvals: 0,
      expired_requests: summary.expired,
      problems,
      handoff_permitted: handoffPermitted,
      settlement_authorized: false,
    },
    negotiation_events: negotiationResult.rows.map((row) => ({
      id: row.id,
      deal_id: row.deal_id,
      version: row.version,
      round: row.round,
      event_type: row.event_type,
      actor_id: row.actor_id,
      payload: row.payload,
      created_at: iso(row.created_at),
    })),
  };
}

export interface ApprovalList {
  deal_id: string | null;
  terms_version: number | null;
  approval_requests: ApprovalRequestView[];
  approvals: ApprovalView[];
  summary: ApprovalSummary;
}

export async function listApprovals(
  db: Db,
  filters: { dealId?: string | null; version?: number | null; participantId?: string | null },
): Promise<ApprovalList | null> {
  if (filters.dealId) {
    const dealResult = await db.query<{ id: string; current_version: number }>(
      `SELECT id, current_version FROM deals WHERE id = $1`,
      [filters.dealId],
    );
    const deal = dealResult.rows[0];
    if (!deal) return null;
    const version = filters.version ?? deal.current_version;
    const result = await db.query<ApprovalRequestRow>(
      `SELECT r.id AS request_id, r.deal_id, r.version, r.participant_id,
              p.name AS participant_name, r.obligation, r.amount_minor, r.currency,
              r.channel, r.status, r.expires_at, r.created_at,
              a.id AS approval_id, a.decision, a.attested_by, a.attestation_channel,
              a.simulated, a.note, a.created_at AS approval_created_at
       FROM deal_approval_requests r
       JOIN parties p ON p.id = r.participant_id
       LEFT JOIN approvals a ON a.request_id = r.id
       WHERE r.deal_id = $1 AND r.version = $2
         AND ($3::uuid IS NULL OR r.participant_id = $3)
       ORDER BY r.participant_id`,
      [deal.id, version, filters.participantId ?? null],
    );
    const requests = result.rows.map((request) => mapApprovalRequest(request));
    return {
      deal_id: deal.id,
      terms_version: deal.current_version,
      approval_requests: requests,
      approvals: result.rows
        .map((request) => mapApproval(request))
        .filter((approval): approval is ApprovalView => approval !== null),
      summary: summarizeApprovals(result.rows, deal.current_version),
    };
  }

  const result = await db.query<ApprovalRequestRow>(
    `SELECT r.id AS request_id, r.deal_id, r.version, r.participant_id,
            p.name AS participant_name, r.obligation, r.amount_minor, r.currency,
            r.channel, r.status, r.expires_at, r.created_at,
            a.id AS approval_id, a.decision, a.attested_by, a.attestation_channel,
            a.simulated, a.note, a.created_at AS approval_created_at
     FROM deal_approval_requests r
     JOIN parties p ON p.id = r.participant_id
     LEFT JOIN approvals a ON a.request_id = r.id
     WHERE ($1::int IS NULL OR r.version = $1)
       AND ($2::uuid IS NULL OR r.participant_id = $2)
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [filters.version ?? null, filters.participantId ?? null],
  );

  const requests = result.rows.map((request) => mapApprovalRequest(request));
  return {
    deal_id: null,
    terms_version: null,
    approval_requests: requests,
    approvals: result.rows
      .map((request) => mapApproval(request))
      .filter((approval): approval is ApprovalView => approval !== null),
    summary: summarizeApprovals(result.rows, null),
  };
}
