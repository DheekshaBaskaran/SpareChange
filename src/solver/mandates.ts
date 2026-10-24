import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { iso, minor } from "../db/values.js";
import { ApiError } from "../errors.js";

export interface NegotiationMandateView {
  id: string;
  party_id: string;
  agent_id: string;
  role: string;
  min_rate_minor_per_gpu_hour: number | null;
  max_rate_minor_per_gpu_hour: number | null;
  max_delta_minor: number;
  active: boolean;
  expires_at: string | null;
  created_at: string | null;
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
  created_at: unknown;
}

function map(row: MandateRow): NegotiationMandateView {
  return {
    id: row.id,
    party_id: row.party_id,
    agent_id: row.agent_id,
    role: row.role,
    min_rate_minor_per_gpu_hour:
      row.min_rate_minor_per_gpu_hour == null ? null : minor(row.min_rate_minor_per_gpu_hour),
    max_rate_minor_per_gpu_hour:
      row.max_rate_minor_per_gpu_hour == null ? null : minor(row.max_rate_minor_per_gpu_hour),
    max_delta_minor: minor(row.max_delta_minor),
    active: row.active,
    expires_at: iso(row.expires_at),
    created_at: iso(row.created_at),
  };
}

export async function listNegotiationMandates(
  db: Db,
  filters: { partyId?: string | null; agentId?: string | null; activeOnly?: boolean } = {},
): Promise<NegotiationMandateView[]> {
  const result = await db.query<MandateRow>(
    `SELECT id, party_id, agent_id, role, min_rate_minor_per_gpu_hour,
            max_rate_minor_per_gpu_hour, max_delta_minor, active, expires_at, created_at
     FROM negotiation_mandates
     WHERE ($1::uuid IS NULL OR party_id = $1)
       AND ($2::text IS NULL OR agent_id = $2)
       AND ($3::boolean = false OR (active = true AND (expires_at IS NULL OR expires_at > now())))
     ORDER BY created_at DESC LIMIT 200`,
    [filters.partyId ?? null, filters.agentId ?? null, filters.activeOnly === true],
  );
  return result.rows.map(map);
}

export async function createNegotiationMandate(
  db: Db,
  options: {
    partyId: string;
    agentId: string;
    role: "buyer" | "provider";
    minRateMinorPerGpuHour?: number | null;
    maxRateMinorPerGpuHour?: number | null;
    maxDeltaMinor: number;
    expiresAt?: string | null;
    actorId: string;
    actorRole: string;
    actorPartyId: string | null;
    idempotencyKey: string | null;
  },
): Promise<NegotiationMandateView> {
  if (options.actorRole === "human" && options.actorPartyId !== options.partyId) {
    throw new ApiError(403, "participant_forbidden", "A human may only issue a mandate for their own party.");
  }
  if (!["human", "admin", "finance"].includes(options.actorRole)) {
    throw new ApiError(403, "mandate_forbidden", "Only a human participant or administrator may issue a mandate.");
  }
  if (
    options.minRateMinorPerGpuHour != null &&
    options.maxRateMinorPerGpuHour != null &&
    options.minRateMinorPerGpuHour > options.maxRateMinorPerGpuHour
  ) {
    throw new ApiError(422, "mandate_rate_range_invalid", "The minimum rate cannot exceed the maximum rate.");
  }
  if (!Number.isSafeInteger(options.maxDeltaMinor) || options.maxDeltaMinor < 0) {
    throw new ApiError(422, "mandate_delta_invalid", "max_delta_minor must be a non-negative integer.");
  }
  const expiresAt = options.expiresAt ? new Date(options.expiresAt) : null;
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) {
    throw new ApiError(422, "mandate_expiry_invalid", "expires_at must be a future timestamp.");
  }
  return db.transaction(async (tx) => {
    const party = await tx.query<{ id: string; kind: string; status: string }>(
      `SELECT id, kind, status FROM parties WHERE id = $1`,
      [options.partyId],
    );
    if (!party.rows[0]) throw new ApiError(404, "party_not_found", "Party not found.");
    if (party.rows[0].status !== "active") throw new ApiError(409, "party_inactive", "Party is not active.");
    const id = randomUUID();
    await tx.query(
      `INSERT INTO negotiation_mandates
         (id, party_id, agent_id, role, min_rate_minor_per_gpu_hour,
          max_rate_minor_per_gpu_hour, max_delta_minor, active, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
      [
        id,
        options.partyId,
        options.agentId,
        options.role,
        options.minRateMinorPerGpuHour ?? null,
        options.maxRateMinorPerGpuHour ?? null,
        options.maxDeltaMinor,
        expiresAt ? expiresAt.toISOString() : null,
      ],
    );
    const row = await tx.query<MandateRow>(
      `SELECT id, party_id, agent_id, role, min_rate_minor_per_gpu_hour,
              max_rate_minor_per_gpu_hour, max_delta_minor, active, expires_at, created_at
       FROM negotiation_mandates WHERE id = $1`,
      [id],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "negotiation_mandate.created",
      objectType: "negotiation_mandate",
      objectId: id,
      idempotencyKey: options.idempotencyKey,
      after: {
        party_id: options.partyId,
        agent_id: options.agentId,
        role: options.role,
        min_rate_minor_per_gpu_hour: options.minRateMinorPerGpuHour ?? null,
        max_rate_minor_per_gpu_hour: options.maxRateMinorPerGpuHour ?? null,
        max_delta_minor: options.maxDeltaMinor,
      },
    });
    return map(row.rows[0]!);
  });
}
