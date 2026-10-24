import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { asArray, asObject, iso, minor } from "../db/values.js";
import { ApiError } from "../errors.js";
import { getDeal } from "../db/reads.js";

interface HandoffRow {
  id: string;
  deal_id: string;
  version: number;
  status: string;
  reservation_status: string;
  package: unknown;
  created_at: unknown;
}

interface ContractRow {
  id: string;
  deal_id: string;
  deal_version: number;
  buyer_id: string;
  provider_id: string;
  status: string;
  currency: string;
  terms: unknown;
  approved_at: unknown;
  starts_at: unknown;
  ends_at: unknown;
  created_at: unknown;
}

export interface ContractView {
  id: string;
  deal_id: string;
  deal_version: number;
  buyer_id: string;
  provider_id: string;
  status: string;
  currency: string;
  terms: unknown;
  approved_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
  rate_lines: Array<{
    id: string;
    description: string;
    gpu_model: string;
    gpu_count: number;
    rate_minor_per_gpu_hour: number;
    minimum_charge_minor: number;
  }>;
}

export interface ExecutionAuthorizationView {
  id: string;
  deal_id: string;
  handoff_id: string;
  version: number;
  status: string;
  authorized_at: string | null;
  expires_at: string | null;
  payload: unknown;
  created_by: string;
  contracts: ContractView[];
}

function mapContract(row: ContractRow, lines: ContractView["rate_lines"]): ContractView {
  return {
    id: row.id,
    deal_id: row.deal_id,
    deal_version: row.deal_version,
    buyer_id: row.buyer_id,
    provider_id: row.provider_id,
    status: row.status,
    currency: row.currency,
    terms: row.terms,
    approved_at: iso(row.approved_at),
    starts_at: iso(row.starts_at),
    ends_at: iso(row.ends_at),
    created_at: iso(row.created_at),
    rate_lines: lines,
  };
}

export async function getContractById(db: Db, contractId: string): Promise<ContractView | null> {
  const result = await db.query<ContractRow>(
    `SELECT id, deal_id, deal_version, buyer_id, provider_id, status, currency, terms,
            approved_at, starts_at, ends_at, created_at
     FROM contracts WHERE id = $1`,
    [contractId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const lines = await db.query<{
    id: string;
    description: string;
    gpu_model: string;
    gpu_count: number;
    rate_minor_per_gpu_hour: unknown;
    minimum_charge_minor: unknown;
  }>(
    `SELECT id, description, gpu_model, gpu_count, rate_minor_per_gpu_hour, minimum_charge_minor
     FROM contract_rate_lines WHERE contract_id = $1 ORDER BY created_at ASC`,
    [row.id],
  );
  return mapContract(
    row,
    lines.rows.map((line) => ({
      id: line.id,
      description: line.description,
      gpu_model: line.gpu_model,
      gpu_count: line.gpu_count,
      rate_minor_per_gpu_hour: minor(line.rate_minor_per_gpu_hour),
      minimum_charge_minor: minor(line.minimum_charge_minor),
    })),
  );
}

export async function getContractsForDeal(db: Db, dealId: string): Promise<ContractView[]> {
  const contracts = await db.query<ContractRow>(
    `SELECT id, deal_id, deal_version, buyer_id, provider_id, status, currency, terms,
            approved_at, starts_at, ends_at, created_at
     FROM contracts WHERE deal_id = $1 ORDER BY created_at ASC`,
    [dealId],
  );
  const result: ContractView[] = [];
  for (const contract of contracts.rows) {
    const lines = await db.query<{
      id: string;
      description: string;
      gpu_model: string;
      gpu_count: number;
      rate_minor_per_gpu_hour: unknown;
      minimum_charge_minor: unknown;
    }>(
      `SELECT id, description, gpu_model, gpu_count, rate_minor_per_gpu_hour, minimum_charge_minor
       FROM contract_rate_lines WHERE contract_id = $1 ORDER BY created_at ASC`,
      [contract.id],
    );
    result.push(
      mapContract(
        contract,
        lines.rows.map((line) => ({
          id: line.id,
          description: line.description,
          gpu_model: line.gpu_model,
          gpu_count: line.gpu_count,
          rate_minor_per_gpu_hour: minor(line.rate_minor_per_gpu_hour),
          minimum_charge_minor: minor(line.minimum_charge_minor),
        })),
      ),
    );
  }
  return result;
}

export async function getExecutionAuthorization(
  db: Db,
  authorizationId: string,
): Promise<ExecutionAuthorizationView | null> {
  const result = await db.query<{
    id: string;
    deal_id: string;
    handoff_id: string;
    version: number;
    status: string;
    authorized_at: unknown;
    expires_at: unknown;
    payload: unknown;
    created_by: string;
  }>(
    `SELECT id, deal_id, handoff_id, version, status, authorized_at, expires_at, payload, created_by
     FROM execution_authorizations WHERE id = $1`,
    [authorizationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    deal_id: row.deal_id,
    handoff_id: row.handoff_id,
    version: row.version,
    status: row.status,
    authorized_at: iso(row.authorized_at),
    expires_at: iso(row.expires_at),
    payload: row.payload,
    created_by: row.created_by,
    contracts: await getContractsForDeal(db, row.deal_id),
  };
}

export async function authorizeExecution(
  db: Db,
  options: {
    dealId: string;
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<{ authorization: ExecutionAuthorizationView; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const dealResult = await tx.query<{
      id: string;
      workload_id: string;
      status: string;
      current_version: number;
    }>(
      `SELECT id, workload_id, status, current_version FROM deals WHERE id = $1 FOR UPDATE`,
      [options.dealId],
    );
    const deal = dealResult.rows[0];
    if (!deal) throw new ApiError(404, "deal_not_found", "Deal not found.");
    if (deal.status !== "handoff_ready") {
      throw new ApiError(409, "handoff_required", "Execution can only be authorized after a provisional handoff.", {
        violations: [`deal_status:${deal.status}`],
      });
    }

    const existing = await tx.query<{
      id: string;
      deal_id: string;
      handoff_id: string;
      version: number;
      status: string;
      authorized_at: unknown;
      expires_at: unknown;
      payload: unknown;
      created_by: string;
    }>(
      `SELECT id, deal_id, handoff_id, version, status, authorized_at, expires_at, payload, created_by
       FROM execution_authorizations WHERE deal_id = $1 AND version = $2`,
      [deal.id, deal.current_version],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      return {
        replayed: true,
        authorization: {
          id: row.id,
          deal_id: row.deal_id,
          handoff_id: row.handoff_id,
          version: row.version,
          status: row.status,
          authorized_at: iso(row.authorized_at),
          expires_at: iso(row.expires_at),
          payload: row.payload,
          created_by: row.created_by,
          contracts: await getContractsForDeal(tx, deal.id),
        },
      };
    }

    const handoffResult = await tx.query<HandoffRow>(
      `SELECT id, deal_id, version, status, reservation_status, package, created_at
       FROM handoffs WHERE deal_id = $1 AND version = $2`,
      [deal.id, deal.current_version],
    );
    const handoff = handoffResult.rows[0];
    if (!handoff) throw new ApiError(409, "handoff_required", "No handoff exists for the current deal version.");
    const versionResult = await tx.query<{ proposal: unknown }>(
      `SELECT proposal FROM deal_versions WHERE deal_id = $1 AND version = $2`,
      [deal.id, deal.current_version],
    );
    const proposal = asObject(versionResult.rows[0]?.proposal);
    const parties = asArray(proposal.parties).map(asObject);
    const commitments = asArray(proposal.required_commitments).map(asObject);
    const compensation = asArray(proposal.compensation).map(asObject);
    const costs = asArray(proposal.participant_costs).map(asObject);
    if (compensation.length === 0) {
      throw new ApiError(409, "compensation_missing", "The proposal has no compensation lines to contract.");
    }

    const authorizationId = randomUUID();
    const expiresAt = new Date(
      Math.max(
        Date.now() + 24 * 60 * 60_000,
        ...commitments.map((commitment) =>
          iso(typeof commitment.window_end === "string" ? commitment.window_end : null)
            ? new Date(String(commitment.window_end)).getTime() + 24 * 60 * 60_000
            : Date.now() + 24 * 60 * 60_000,
        ),
      ),
    ).toISOString();

    const workload = await tx.query<{ buyer_id: string; type: string }>(
      `SELECT buyer_id, type FROM workloads WHERE id = $1`,
      [deal.workload_id],
    );
    if (!workload.rows[0]) throw new ApiError(409, "workload_missing", "The deal workload no longer exists.");

    const contracts: Array<{
      contractId: string;
      buyerId: string;
      providerId: string;
      amountMinor: number;
      currency: string;
      offerId: string;
      gpuModel: string;
      gpuCount: number;
      rateMinorPerGpuHour: number;
      switchingCostMinor: number;
    }> = [];

    for (const line of compensation) {
      const fromId = String(line.from_party_id ?? "");
      const toId = String(line.to_party_id ?? "");
      const fromParty = parties.find((party) => party.id === fromId);
      const toParty = parties.find((party) => party.id === toId);
      if (!fromParty || !toParty || fromParty.role !== "buyer" || toParty.role !== "provider") {
        throw new ApiError(409, "compensation_party_invalid", "Every compensation line must run from a buyer to a provider.");
      }
      const commitment = commitments.find(
        (candidate) => candidate.provider_id === toId && candidate.buyer_id === fromId,
      );
      if (!commitment) {
        throw new ApiError(409, "compensation_commitment_missing", "Compensation has no matching capacity commitment.");
      }
      const offerId = String(commitment.offer_id ?? "");
      const offer = await tx.query<{
        gpu_model: string;
        gpu_count: number;
        currency: string;
      }>(`SELECT gpu_model, gpu_count, currency FROM market_offers WHERE id = $1`, [offerId]);
      if (!offer.rows[0]) throw new ApiError(409, "offer_missing", "A committed offer no longer exists.");
      const start = iso(typeof commitment.window_start === "string" ? commitment.window_start : null);
      const end = iso(typeof commitment.window_end === "string" ? commitment.window_end : null);
      if (!start || !end) throw new ApiError(409, "commitment_window_missing", "A commitment has no valid window.");
      const hours = Math.max(
        1 / 60,
        (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000,
      );
      const gpuCount = Number(commitment.gpu_count ?? offer.rows[0].gpu_count);
      const amountMinor = Number(line.amount_minor ?? 0);
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
        throw new ApiError(409, "compensation_amount_invalid", "Compensation must be a non-negative integer.");
      }
      const switchCost = minor(
        costs.find((cost) => cost.party_id === fromId)?.switching_minor ?? 0,
      );
      const rate = Math.max(0, Math.round(amountMinor / (gpuCount * hours)));
      const contractId = randomUUID();
      const terms = {
        deal_id: deal.id,
        deal_version: deal.current_version,
        handoff_id: handoff.id,
        authorization_id: authorizationId,
        workload_id: deal.workload_id,
        workload_type: workload.rows[0].type,
        offer_id: offerId,
        buyer_id: fromId,
        provider_id: toId,
        gpu_model: offer.rows[0].gpu_model,
        gpu_count: gpuCount,
        duration_hours: hours,
        window_start: start,
        window_end: end,
        rate_minor_per_gpu_hour: rate,
        compute_amount_minor: amountMinor,
        switching_cost_minor: switchCost,
        coordination_fee_minor: Number(proposal.coordination_fee_minor ?? 0),
        currency: (typeof line.currency === "string" ? line.currency : offer.rows[0].currency).toUpperCase(),
        reservation_status: handoff.reservation_status,
      };
      await tx.query(
        `INSERT INTO contracts
           (id, deal_id, deal_version, buyer_id, provider_id, status, currency, terms,
            approved_at, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7::jsonb, now(), $8, $9)`,
        [
          contractId,
          deal.id,
          deal.current_version,
          fromId,
          toId,
          terms.currency,
          JSON.stringify(terms),
          start,
          end,
        ],
      );
      await tx.query(
        `INSERT INTO contract_rate_lines
           (id, contract_id, description, gpu_model, gpu_count, rate_minor_per_gpu_hour,
            minimum_charge_minor, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7::jsonb)`,
        [
          randomUUID(),
          contractId,
          `${gpuCount}x ${offer.rows[0].gpu_model} for ${hours} hours`,
          offer.rows[0].gpu_model,
          gpuCount,
          rate,
          JSON.stringify({ deal_id: deal.id, offer_id: offerId, authorization_id: authorizationId }),
        ],
      );
      contracts.push({
        contractId,
        buyerId: fromId,
        providerId: toId,
        amountMinor,
        currency: terms.currency,
        offerId,
        gpuModel: offer.rows[0].gpu_model,
        gpuCount,
        rateMinorPerGpuHour: rate,
        switchingCostMinor: switchCost,
      });
    }

    // Convert the approved plan into persisted capacity assignments. The old
    // holder's allocation is released first, otherwise the same GPU capacity
    // could be assigned twice. This is an authorization record, not a claim that
    // a remote provider has already acknowledged a physical reservation.
    for (const commitment of commitments) {
      const releaseId =
        typeof commitment.release_allocation_id === "string"
          ? commitment.release_allocation_id
          : null;
      if (releaseId) {
        await tx.query(
          `UPDATE capacity_allocations SET status = 'released'
           WHERE id = $1 AND status = 'active'`,
          [releaseId],
        );
      }
      const offerId = String(commitment.offer_id ?? "");
      const capacity = await tx.query<{ gpu_count: number }>(
        `SELECT gpu_count FROM market_offers WHERE id = $1`,
        [offerId],
      );
      if (!capacity.rows[0]) {
        throw new ApiError(409, "commitment_offer_missing", "A committed offer no longer exists.");
      }
      const conflict = await tx.query<{ used: unknown }>(
        `SELECT COALESCE(sum(gpu_count), 0)::bigint AS used
         FROM capacity_allocations
         WHERE offer_id = $1 AND status = 'active' AND id <> $2::uuid
           AND window_start < $4::timestamptz AND window_end > $3::timestamptz`,
        [
          offerId,
          releaseId ?? "00000000-0000-4000-8000-000000000000",
          String(commitment.window_start ?? ""),
          String(commitment.window_end ?? ""),
        ],
      );
      if (
        minor(conflict.rows[0]?.used) + Number(commitment.gpu_count ?? 0) >
        capacity.rows[0].gpu_count
      ) {
        throw new ApiError(409, "capacity_conflict", "The committed window is no longer available.", {
          violations: [`capacity_conflict:${offerId}`],
        });
      }
      const buyerId = String(commitment.buyer_id ?? "");
      const buyerWorkload = await tx.query<{ id: string }>(
        `SELECT id FROM workloads WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [buyerId],
      );
      if (!buyerWorkload.rows[0]) {
        throw new ApiError(409, "commitment_workload_missing", "A committed buyer has no workload record.");
      }
      await tx.query(
        `INSERT INTO capacity_allocations
           (id, offer_id, buyer_id, workload_id, gpu_count, window_start, window_end,
            status, transferable, switch_cost_minor, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', true, 0, $8::jsonb)`,
        [
          randomUUID(),
          String(commitment.offer_id ?? ""),
          buyerId,
          buyerWorkload.rows[0].id,
          Number(commitment.gpu_count ?? 0),
          String(commitment.window_start ?? ""),
          String(commitment.window_end ?? ""),
          JSON.stringify({
            deal_id: deal.id,
            authorization_id: authorizationId,
            source: "execution_authorization",
            remote_reservation_confirmed: false,
          }),
        ],
      );
    }

    const payload = {
      deal_id: deal.id,
      terms_version: deal.current_version,
      handoff_id: handoff.id,
      authorization_id: authorizationId,
      approved_at: new Date().toISOString(),
      expires_at: expiresAt,
      reservation_status: handoff.reservation_status,
      settlement_authorized: true,
      scope: {
        workloads: commitments,
        contracts: contracts.map((contract) => ({
          contract_id: contract.contractId,
          buyer_id: contract.buyerId,
          provider_id: contract.providerId,
          offer_id: contract.offerId,
          gpu_model: contract.gpuModel,
          gpu_count: contract.gpuCount,
          rate_minor_per_gpu_hour: contract.rateMinorPerGpuHour,
          compute_amount_minor: contract.amountMinor,
          now_hours_minor: contract.switchingCostMinor,
          currency: contract.currency,
        })),
      },
      note:
        "This authorizes Duo 2 execution and verified usage reporting. It does not settle funds; settlement requires an invoice, approval, and a separate payment instruction.",
    };
    await tx.query(
      `INSERT INTO execution_authorizations
         (id, deal_id, handoff_id, version, status, authorized_at, expires_at, payload, created_by)
       VALUES ($1, $2, $3, $4, 'active', now(), $5, $6::jsonb, $7)`,
      [authorizationId, deal.id, handoff.id, deal.current_version, expiresAt, JSON.stringify(payload), options.actorId],
    );
    await tx.query(`UPDATE deals SET status = 'handoff_ready', updated_at = now() WHERE id = $1`, [deal.id]);
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "execution.authorized",
      objectType: "execution_authorization",
      objectId: authorizationId,
      dealId: deal.id,
      idempotencyKey: options.idempotencyKey,
      after: {
        version: deal.current_version,
        contracts: contracts.map((contract) => contract.contractId),
        expires_at: expiresAt,
        settlement_authorized: true,
      },
    });

    const created = await tx.query<{
      id: string;
      deal_id: string;
      handoff_id: string;
      version: number;
      status: string;
      authorized_at: unknown;
      expires_at: unknown;
      payload: unknown;
      created_by: string;
    }>(
      `SELECT id, deal_id, handoff_id, version, status, authorized_at, expires_at, payload, created_by
       FROM execution_authorizations WHERE id = $1`,
      [authorizationId],
    );
    const row = created.rows[0]!;
    return {
      replayed: false,
      authorization: {
        id: row.id,
        deal_id: row.deal_id,
        handoff_id: row.handoff_id,
        version: row.version,
        status: row.status,
        authorized_at: iso(row.authorized_at),
        expires_at: iso(row.expires_at),
        payload: row.payload,
        created_by: row.created_by,
        contracts: await getContractsForDeal(tx, deal.id),
      },
    };
  });
}

export async function requireActiveContract(
  db: Db,
  contractId: string,
): Promise<{ contract: ContractView; authorizationId: string; terms: Record<string, unknown> }> {
  const result = await db.query<ContractRow>(
    `SELECT id, deal_id, deal_version, buyer_id, provider_id, status, currency, terms,
            approved_at, starts_at, ends_at, created_at
     FROM contracts WHERE id = $1`,
    [contractId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "contract_not_found", "Contract not found.");
  if (row.status !== "active") {
    throw new ApiError(409, "contract_not_active", `Contract is ${row.status}.`);
  }
  const terms = asObject(row.terms);
  const authorizationId = typeof terms.authorization_id === "string" ? terms.authorization_id : "";
  if (!authorizationId) throw new ApiError(409, "authorization_missing", "Contract has no execution authorization.");
  const auth = await db.query<{ status: string; expires_at: unknown; deal_id: string; version: number }>(
    `SELECT status, expires_at, deal_id, version FROM execution_authorizations WHERE id = $1`,
    [authorizationId],
  );
  const authorization = auth.rows[0];
  if (!authorization || authorization.status !== "active") {
    throw new ApiError(409, "authorization_inactive", "The execution authorization is not active.");
  }
  if (authorization.expires_at && new Date(iso(authorization.expires_at) ?? 0).getTime() <= Date.now()) {
    throw new ApiError(409, "authorization_expired", "The execution authorization has expired.");
  }
  if (authorization.deal_id !== row.deal_id || authorization.version !== row.deal_version) {
    throw new ApiError(409, "authorization_scope_mismatch", "Contract and authorization versions do not match.");
  }
  return {
    contract: mapContract(row, []),
    authorizationId,
    terms,
  };
}

export async function listExecutionAuthorizations(
  db: Db,
  dealId: string,
): Promise<ExecutionAuthorizationView | null> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM execution_authorizations WHERE deal_id = $1 ORDER BY authorized_at DESC LIMIT 1`,
    [dealId],
  );
  if (!result.rows[0]) return null;
  return getExecutionAuthorization(db, result.rows[0].id);
}

export async function dealForContract(db: Db, contractId: string): Promise<unknown> {
  const result = await db.query<{ deal_id: string }>(`SELECT deal_id FROM contracts WHERE id = $1`, [contractId]);
  if (!result.rows[0]) return null;
  return getDeal(db, result.rows[0].deal_id);
}
