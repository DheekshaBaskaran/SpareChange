// ─────────────────────────────────────────────────────────────
// Duo 1 (Relay) client.
//
// Duo 2 owns execution, verification and the payment rail. Duo 1 owns
// authorization, contracts, verified usage, invoices, approvals and the
// ledger. This module is the only place that talks to Duo 1, so every
// cross-duo call has one implementation and one credential boundary.
//
//   deal feed          GET  /v1/deals                     (agent key)
//   handoff            POST /v1/deals/{id}/handoff        (agent key)
//   authorization      POST /v1/deals/{id}/execution-authorizations
//   usage              POST /internal/v1/duo2/usage       (worker key)
//   payment submit     POST /internal/v1/duo2/payment-instructions/{id}/submit
//   settlement         POST /internal/v1/duo2/settlements
//
// Nothing here fabricates a settlement: callers pass the transaction id they
// actually produced (on-chain for x402, `mock_tx_…` for the labelled simulated
// rail) and Duo 1 records exactly that.
// ─────────────────────────────────────────────────────────────

import type { Deal, GpuListing } from "../types";
import { getConfig } from "./config";

const CONTRACT = "relay-duo1.v1";

export interface RelayDealView {
  deal: {
    id: string;
    workload_id: string;
    title: string;
    status: string;
    current_version: number;
    created_at: string;
    updated_at: string;
  };
  proposal: {
    title?: string;
    strategy?: string;
    total_cost_minor?: number;
    baseline_cost_minor?: number;
    projected_savings_minor?: number;
    coordination_fee_minor?: number;
    window?: { start?: string; end?: string; hours?: number };
    parties?: Array<{
      id: string;
      name: string;
      role: string;
      amount_minor?: number;
      obligation?: string;
    }>;
    compensation?: unknown[];
  } | null;
  workload?: {
    id: string;
    buyer_id: string;
    type: string;
    gpu_model: string;
    gpu_count: number;
    budget_minor: number;
    flexibility?: Record<string, unknown>;
  } | null;
  approval_requests?: Array<{ status: string }>;
}

export interface RelayAuthorization {
  id: string;
  deal_id: string;
  contracts: Array<{ id: string; buyer_id: string; provider_id: string; status?: string }>;
}

export interface RelayPaymentInstruction {
  id: string;
  invoice_id: string;
  contract_id: string;
  amount_minor: number;
  currency: string;
  chain: string;
  destination: string;
  status: string;
}

export interface RelayUsage {
  id: string;
  contract_id: string;
  gpu_seconds: number;
  amount_minor?: number;
  billing?: { amount_minor?: number; currency?: string };
}

function relay() {
  const config = getConfig();
  return config.relay;
}

export function relayConfigured(): boolean {
  const { apiUrl, agentKey } = relay();
  return Boolean(apiUrl && agentKey);
}

async function call<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    key: string;
    body?: unknown;
    idempotencyKey?: string;
    timeoutMs?: number;
  },
): Promise<T> {
  const { apiUrl } = relay();
  if (!apiUrl) throw new Error("DUO1_API_URL is not configured");
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-relay-contract": CONTRACT,
    authorization: `Bearer ${options.key}`,
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const error = json as { code?: string; detail?: string } | null;
    throw new Error(
      `Relay ${options.method ?? "GET"} ${path} failed (${response.status}): ${error?.detail ?? error?.code ?? "no detail"}`,
    );
  }
  return json as T;
}

function agentCall<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string } = {}) {
  const { agentKey } = relay();
  if (!agentKey) throw new Error("DUO1_AGENT_API_KEY is not configured");
  return call<T>(path, { ...options, key: agentKey });
}

function workerCall<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string } = {}) {
  const { workerKey } = relay();
  if (!workerKey) throw new Error("DUO1_WORKER_API_KEY is not configured");
  return call<T>(path, { ...options, key: workerKey });
}

/** Map a Relay deal into the shape Duo 2's UI and job runner already use. */
export function toDuo2Deal(view: RelayDealView): Deal | null {
  const proposal = view.proposal;
  if (!proposal) return null;
  const parties = proposal.parties ?? [];
  const buyer = parties.find((party) => party.role === "buyer");
  const provider = parties.find((party) => party.role === "provider");
  const workload = view.workload;
  if (!buyer || !provider || !workload) return null;

  const hours = proposal.window?.hours && proposal.window.hours > 0 ? proposal.window.hours : 1;
  const totalMinor = proposal.total_cost_minor ?? 0;
  const savingsMinor = proposal.projected_savings_minor ?? 0;
  const buyerTotalMinor = buyer.amount_minor ?? totalMinor;

  return {
    dealId: view.deal.id,
    type: "direct",
    title: proposal.title ?? view.deal.title,
    buyer: { id: buyer.id, name: buyer.name, role: "buyer", situation: buyer.obligation },
    provider: { id: provider.id, name: provider.name, role: "capacity_holder", situation: provider.obligation },
    workload: {
      gpuModel: workload.gpu_model,
      gpuCount: workload.gpu_count,
      durationMinutes: Math.round(hours * 60),
      description: `Relay deal ${view.deal.id.slice(0, 8)} · ${proposal.strategy ?? "direct"} strategy`,
    },
    price: { amount: buyerTotalMinor / 100, currency: "USD" },
    impact: {
      dealPricePerGpuHour: Math.round((buyerTotalMinor / 100 / (workload.gpu_count * hours)) * 100) / 100,
      buyerSavingsPerHour: Math.round((savingsMinor / 100 / hours) * 100) / 100,
      idleGpusReused: workload.gpu_count,
    },
    approvedAt: view.deal.updated_at,
    source: "duo1-live",
    relay: { dealId: view.deal.id },
  };
}

export async function fetchRelayDeals(status?: string): Promise<Deal[]> {
  const query = status ? `?status=${encodeURIComponent(status)}&limit=20` : "?limit=20";
  const body = await agentCall<{ deals: RelayDealView[] }>(`/v1/deals${query}`);
  const deals: Deal[] = [];
  for (const view of body.deals ?? []) {
    const deal = toDuo2Deal(view);
    if (deal) deals.push(deal);
  }
  return deals;
}

/** Latest execution authorization for a deal, if one already exists. */
export async function findAuthorization(dealId: string): Promise<RelayAuthorization | null> {
  const body = await agentCall<{
    authorization?: RelayAuthorization | RelayAuthorization[];
    execution_authorizations?: RelayAuthorization[];
  }>(`/v1/deals/${dealId}/execution-authorizations`);
  // Relay returns `{ authorization: {...} }`; accept a list too so the shape
  // can evolve without silently disabling the reuse path.
  const single = body.authorization;
  const list = Array.isArray(single) ? single : body.execution_authorizations ?? [];
  if (single && !Array.isArray(single)) return single;
  return list[0] ?? null;
}

/**
 * Ensure the deal is handed off and has an execution authorization.
 * Safe to call twice: an existing authorization is reused.
 */
export async function ensureAuthorization(dealId: string): Promise<RelayAuthorization> {
  const existing = await findAuthorization(dealId).catch(() => null);
  if (existing) return existing;

  await agentCall(`/v1/deals/${dealId}/handoff`, {
    method: "POST",
    idempotencyKey: `duo2-handoff-${dealId}`,
  }).catch((error: Error) => {
    // A second handoff for an already handed-off deal is not fatal.
    if (!/already|409|conflict/i.test(error.message)) throw error;
  });

  const body = await agentCall<{ authorization: RelayAuthorization }>(
    `/v1/deals/${dealId}/execution-authorizations`,
    { method: "POST", idempotencyKey: `duo2-authorize-${dealId}` },
  );
  return body.authorization;
}

export async function reportUsage(input: {
  contractId: string;
  authorizationId: string;
  gpuSeconds: number;
  startedAt: string;
  endedAt: string;
  jobId: string;
  workerId?: string;
  proofReference?: string;
  evidence?: Record<string, unknown>;
}): Promise<RelayUsage> {
  const body = await workerCall<{ verified_usage: RelayUsage }>("/internal/v1/duo2/usage", {
    method: "POST",
    idempotencyKey: `duo2-usage-${input.jobId}`,
    body: {
      contract_id: input.contractId,
      authorization_id: input.authorizationId,
      gpu_seconds: input.gpuSeconds,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      job_id: input.jobId,
      worker_id: input.workerId,
      proof_reference: input.proofReference,
      evidence: input.evidence,
    },
  });
  return body.verified_usage;
}

export async function getPaymentInstruction(instructionId: string): Promise<RelayPaymentInstruction> {
  const body = await workerCall<{ payment_instructions: RelayPaymentInstruction[] }>(
    "/internal/v1/duo2/payment-instructions",
  );
  const instruction = (body.payment_instructions ?? []).find((candidate) => candidate.id === instructionId);
  if (!instruction) throw new Error(`Relay payment instruction ${instructionId} was not found`);
  return instruction;
}

export async function submitPaymentInstruction(instructionId: string): Promise<RelayPaymentInstruction> {
  const body = await workerCall<{ payment_instruction: RelayPaymentInstruction }>(
    `/internal/v1/duo2/payment-instructions/${instructionId}/submit`,
    { method: "POST", idempotencyKey: `duo2-submit-${instructionId}` },
  );
  return body.payment_instruction;
}

export async function confirmSettlement(input: {
  instructionId: string;
  amountMinor: number;
  transactionId: string;
  providerReference: string;
  raw?: Record<string, unknown>;
}): Promise<{ invoice_status: string }> {
  return workerCall<{ invoice_status: string }>("/internal/v1/duo2/settlements", {
    method: "POST",
    idempotencyKey: `duo2-settle-${input.instructionId}`,
    body: {
      instruction_id: input.instructionId,
      status: "confirmed",
      amount_minor: input.amountMinor,
      transaction_id: input.transactionId,
      provider_reference: input.providerReference,
      raw: input.raw,
    },
  });
}

/** Live GPU listings from Relay's offer book, for the market table. */
export async function fetchRelayListings(): Promise<GpuListing[]> {
  const body = await agentCall<{
    offers: Array<{
      id: string;
      provider: { id: string; name: string };
      gpu_model: string;
      gpu_count: number;
      rate_minor_per_gpu_hour: number;
      currency?: string;
      executable: boolean;
      source?: string;
      location?: string | null;
      expires_at?: string | null;
    }>;
  }>("/v1/offers?limit=200");

  const now = Date.now();
  const seen = new Set<string>();
  const listings: GpuListing[] = [];
  for (const offer of body.offers ?? []) {
    // Relay keeps expired observations for audit; the marketplace must only
    // show capacity a buyer could actually act on today.
    if (offer.expires_at && Date.parse(offer.expires_at) <= now) continue;
    const key = `${offer.provider?.id}:${offer.gpu_model}:${offer.rate_minor_per_gpu_hour}:${offer.location ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listings.push({
      id: offer.id,
      providerName: offer.provider?.name ?? "Unknown provider",
      gpuModel: offer.gpu_model,
      gpusAvailable: offer.gpu_count,
      gpusTotal: offer.gpu_count,
      region: offer.location ?? "Global",
      pricePerGpuHour: offer.rate_minor_per_gpu_hour / 100,
      utilizationPercent: offer.executable ? 0 : 50,
      availability: offer.executable ? "available" : "limited",
      listingType: offer.executable ? "reserved-resale" : "spot",
    });
  }
  // Executable capacity first: it is what a buyer can actually take today.
  return listings.sort((a, b) => {
    const executable = Number(b.listingType === "reserved-resale") - Number(a.listingType === "reserved-resale");
    return executable || a.pricePerGpuHour - b.pricePerGpuHour;
  });
}
