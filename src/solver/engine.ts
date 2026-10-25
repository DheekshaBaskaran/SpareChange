/**
 * Deterministic multi-party clearing engine.
 *
 * The engine only reasons over persisted offers, authorizations, current
 * allocations, and workload constraints passed to it. It does not call an LLM,
 * mutate the database, or contain fixture-specific branch logic.
 */

export interface SolverWorkload {
  id: string;
  buyerId: string;
  buyerName: string;
  type: string;
  gpuModel: string;
  gpuCount: number;
  cpuCores: number;
  memoryGb: number;
  budgetMinor: number;
  deadline: string | null;
  earliestStart: string | null;
  durationHours: number;
  flexibility: Record<string, unknown>;
}

export interface SolverOffer {
  id: string;
  providerId: string;
  providerName: string;
  source: "worker" | "external_reference";
  gpuModel: string;
  gpuCount: number;
  cpuCores: number;
  memoryGb: number;
  rateMinorPerGpuHour: number;
  currency: string;
  location: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  // When the price was observed on the public market; null for owned capacity.
  observedAt?: string | null;
  expiresAt: string | null;
  executable: boolean;
  authorizationStatus: "authorized" | "missing" | "revoked" | "expired";
  allowedWorkloads: string[];
  transferable: boolean;
  transferRateMinorPerGpuHour: number | null;
  metadata: Record<string, unknown>;
}

export interface SolverAllocation {
  id: string;
  offerId: string;
  buyerId: string;
  buyerName: string;
  workloadId: string;
  gpuCount: number;
  windowStart: string;
  windowEnd: string;
  status: string;
  transferable: boolean;
  switchCostMinor: number;
}

export interface SolverMandate {
  /** Minimum acceptable net buyer savings. Defaults to 1 minor unit. */
  minSavingsMinor?: number;
  maxTotalCostMinor?: number | null;
  maxSwitchingCostMinor?: number | null;
  coordinationFeeMinor?: number;
  /**
   * Maximum number of conditional moves in one chain or cycle. The default is
   * 4; values are clamped to 2..6 so a request cannot trigger an unbounded
   * search. One-for-one exchanges use the same bound.
   */
  maxChainDepth?: number;
  /** Optional explicit budget override for a party (used by a negotiation). */
  partyBudgetsMinor?: Record<string, number>;
}

export interface SolverInput {
  workload: SolverWorkload;
  workloads: SolverWorkload[];
  offers: SolverOffer[];
  allocations: SolverAllocation[];
  mandate?: SolverMandate;
  now?: Date;
}

export interface Window {
  start: string;
  end: string;
  hours: number;
}

export interface CostLine {
  party_id: string;
  role: "buyer" | "provider";
  gross_minor: number;
  switching_minor: number;
  net_minor: number;
  baseline_minor: number;
  savings_minor: number;
  revenue_minor: number;
  revenue_baseline_minor: number;
  budget_minor: number | null;
}

export interface CommitmentPlan {
  offer_id: string;
  provider_id: string;
  buyer_id: string;
  gpu_count: number;
  window_start: string;
  window_end: string;
  reservation_status: "planned";
  release_allocation_id: string | null;
}

export interface TransferPlan {
  from_party_id: string;
  to_party_id: string;
  offer_id: string;
  gpu_count: number;
  window_start: string;
  window_end: string;
}

export interface CompensationPlan {
  from_party_id: string;
  to_party_id: string;
  amount_minor: number;
  reason: string;
}

export interface ComparisonBaseline {
  kind: "independent_rental" | "direct_rental" | "keep_current" | "none";
  description: string;
  buyer_cost_minor: number | null;
  provider_revenue_minor: number;
  source: "executable_offer" | "public_market_reference" | "existing_allocation" | "none";
  offer_id: string | null;
  note: string;
}

export interface ConditionalChainMovePlan {
  sequence: number;
  workload_id: string;
  buyer_id: string;
  buyer_name: string;
  from_offer_id: string | null;
  from_allocation_id: string | null;
  to_offer_id: string;
  to_allocation_id: string | null;
  gpu_count: number;
  window: Window;
  gross_minor: number;
  switching_minor: number;
  baseline_minor: number;
}

export interface ConditionalChainPlan {
  kind: "chain" | "cycle";
  closed: boolean;
  depth: number;
  target_anchor_allocation_id: string | null;
  moves: ConditionalChainMovePlan[];
}

export interface SolverProposal {
  strategy: "exchange" | "direct";
  /** Present when this proposal is a conditional chain or a closed cycle. */
  conditional_chain?: ConditionalChainPlan;
  title: string;
  window: Window;
  parties: Array<{
    id: string;
    role: "buyer" | "provider";
    name: string;
    obligation: string;
    amount_minor: number;
    currency: string;
    floor_surplus_minor: number;
  }>;
  required_commitments: CommitmentPlan[];
  proposed_transfers: TransferPlan[];
  compensation: CompensationPlan[];
  participant_costs: CostLine[];
  total_cost_minor: number;
  baseline_cost_minor: number;
  switching_cost_minor: number;
  coordination_fee_minor: number;
  projected_savings_minor: number;
  projected_surplus_minor: number;
  provider_revenue_delta_minor: number;
  comparison: {
    independent: ComparisonBaseline;
    direct: ComparisonBaseline;
  };
  constraints: Array<{ code: string; satisfied: boolean; detail: string }>;
  explanation: string[];
}

export interface RejectedOption {
  strategy: "exchange" | "direct";
  offer_id: string | null;
  replacement_offer_id: string | null;
  violations: string[];
  details: Record<string, unknown>;
}

export interface SolverResult {
  status: "feasible" | "no_feasible_deal";
  recommended: SolverProposal | null;
  proposals: SolverProposal[];
  rejected: RejectedOption[];
  engine: {
    name: "relay-deterministic-solver";
    version: "1.1.0";
    deterministic: true;
    evaluated_options: number;
    feasible_options: number;
    generated_at: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iso(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

const WINDOW_TOLERANCE_MS = 60_000;

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60_000);
}

function afterLimit(value: number, limit: number): boolean {
  return value > limit + WINDOW_TOLERANCE_MS;
}

function roundMinor(value: number): number {
  if (!Number.isFinite(value)) throw new Error("non-finite money value");
  return Math.max(0, Math.round(value));
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function durationHours(workload: SolverWorkload): number {
  const value = asNumber(workload.flexibility.duration_hours);
  if (value && value > 0) return Math.min(value, 24 * 30);
  return 10;
}

function includesWorkload(offer: SolverOffer, workload: SolverWorkload): boolean {
  return offer.allowedWorkloads.length === 0 || offer.allowedWorkloads.includes(workload.type);
}

function hardwareFits(offer: SolverOffer, workload: SolverWorkload): boolean {
  return (
    offer.gpuModel === workload.gpuModel &&
    offer.gpuCount >= workload.gpuCount &&
    offer.cpuCores >= workload.cpuCores &&
    offer.memoryGb >= workload.memoryGb
  );
}

function offerExecutable(
  offer: SolverOffer,
  workload: SolverWorkload,
  now: number,
  requireTransfer = false,
): string[] {
  const violations: string[] = [];
  if (offer.source !== "worker" || !offer.executable) violations.push("offer_not_executable");
  if (offer.authorizationStatus !== "authorized") violations.push("provider_not_authorized");
  if (offer.gpuModel !== workload.gpuModel) violations.push("gpu_model_mismatch");
  if (offer.gpuCount < workload.gpuCount) violations.push("insufficient_gpu_count");
  if (offer.cpuCores < workload.cpuCores) violations.push("insufficient_cpu");
  if (offer.memoryGb < workload.memoryGb) violations.push("insufficient_memory");
  if (!includesWorkload(offer, workload)) violations.push("workload_type_not_allowed");
  if (offer.expiresAt && (iso(offer.expiresAt) ?? 0) <= now) violations.push("offer_expired");
  if (requireTransfer && !offer.transferable) violations.push("capacity_not_transferable");
  if (requireTransfer && offer.transferRateMinorPerGpuHour === null) {
    // The provider's ordinary rate is still a valid transfer rate. This branch
    // exists only to make the absence deliberate rather than accidental.
  }
  return violations;
}

function availableCapacity(
  offer: SolverOffer,
  allocations: SolverAllocation[],
  start: number,
  end: number,
  excludingAllocationId: string | null,
): number {
  const used = allocations
    .filter(
      (allocation) =>
        allocation.offerId === offer.id &&
        allocation.status === "active" &&
        allocation.id !== excludingAllocationId &&
        overlaps(
          new Date(allocation.windowStart).getTime(),
          new Date(allocation.windowEnd).getTime(),
          start,
          end,
        ),
    )
    .reduce((sum, allocation) => sum + allocation.gpuCount, 0);
  return offer.gpuCount - used;
}

function directWindow(
  workload: SolverWorkload,
  offer: SolverOffer,
  now: Date,
): Window | null {
  const hours = durationHours(workload);
  const nowMs = now.getTime();
  const candidates = [
    nowMs,
    iso(workload.earliestStart) ?? nowMs,
    iso(offer.availableFrom) ?? nowMs,
  ];
  const start = Math.max(...candidates);
  const end = addHours(new Date(start), hours).getTime();
  if (workload.deadline && afterLimit(end, iso(workload.deadline) ?? Number.POSITIVE_INFINITY)) return null;
  if (offer.availableUntil && afterLimit(end, iso(offer.availableUntil) ?? Number.POSITIVE_INFINITY)) return null;
  if (offer.expiresAt && (iso(offer.expiresAt) ?? 0) <= nowMs) return null;
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    hours,
  };
}

function heldWindow(
  workload: SolverWorkload,
  allocation: SolverAllocation,
  offer: SolverOffer,
  now: Date,
): Window | null {
  const hours = durationHours(workload);
  const allocationStart = iso(allocation.windowStart) ?? now.getTime();
  const earliest = Math.max(
    now.getTime(),
    iso(workload.earliestStart) ?? now.getTime(),
    iso(offer.availableFrom) ?? now.getTime(),
    allocationStart,
  );
  const end = addHours(new Date(earliest), hours).getTime();
  if (workload.deadline && afterLimit(end, iso(workload.deadline) ?? Number.POSITIVE_INFINITY)) return null;
  if (offer.availableUntil && afterLimit(end, iso(offer.availableUntil) ?? Number.POSITIVE_INFINITY)) return null;
  if (allocation.windowEnd && afterLimit(end, iso(allocation.windowEnd) ?? Number.POSITIVE_INFINITY)) {
    return null;
  }
  return {
    start: new Date(earliest).toISOString(),
    end: new Date(end).toISOString(),
    hours,
  };
}

function rateFor(offer: SolverOffer, transfer: boolean): number {
  if (transfer && offer.transferRateMinorPerGpuHour !== null) {
    return offer.transferRateMinorPerGpuHour;
  }
  return offer.rateMinorPerGpuHour;
}

function price(
  offer: SolverOffer,
  workload: SolverWorkload,
  hours: number,
  transfer: boolean,
): number {
  return roundMinor(rateFor(offer, transfer) * workload.gpuCount * hours);
}

interface PublicBaseline {
  offer: SolverOffer;
  unitRateMinorPerGpuHour: number;
  requestedGpuCount: number;
  amountMinor: number;
  hours: number;
}

/**
 * Mirror providers publish a per-GPU-hour unit price for whatever inventory they
 * happen to list, usually a single card. A buyer that needs eight GPUs cannot
 * wait for an eight-card public listing before it can price a deal, so the
 * baseline is the cheapest observed unit rate scaled to the requested count.
 * The observation stays a reference price, never executable inventory.
 */
function cheapestPublicBaseline(
  workload: SolverWorkload,
  offers: SolverOffer[],
): PublicBaseline | null {
  const hours = durationHours(workload);
  const candidates = offers
    .filter(
      (offer) =>
        offer.source === "external_reference" &&
        offer.gpuModel === workload.gpuModel &&
        offer.gpuCount > 0,
    )
    .sort(
      (a, b) =>
        a.rateMinorPerGpuHour - b.rateMinorPerGpuHour ||
        Date.parse(b.observedAt ?? "") - Date.parse(a.observedAt ?? "") ||
        a.id.localeCompare(b.id),
    );
  const offer = candidates[0];
  if (!offer) return null;
  return {
    offer,
    unitRateMinorPerGpuHour: offer.rateMinorPerGpuHour,
    requestedGpuCount: workload.gpuCount,
    amountMinor: roundMinor(offer.rateMinorPerGpuHour * workload.gpuCount * hours),
    hours,
  };
}

/**
 * Explains where a baseline price came from, including the case where a
 * single-GPU market observation was scaled up to a multi-GPU workload.
 */
function describeBaseline(baseline: PublicBaseline): string {
  const observed = baseline.offer.observedAt
    ? ` observed ${baseline.offer.observedAt}`
    : "";
  const scale =
    baseline.offer.gpuCount === baseline.requestedGpuCount
      ? `${baseline.offer.gpuCount}x ${baseline.offer.gpuModel}`
      : `${baseline.offer.gpuCount}x ${baseline.offer.gpuModel} scaled to ${baseline.requestedGpuCount} GPUs`;
  return `Cheapest observed market rate: ${baseline.offer.providerName} at ${baseline.unitRateMinorPerGpuHour} minor/GPU-hour (${scale}${observed}).`;
}

function budgetFor(workload: SolverWorkload, mandate: SolverMandate): number {
  return mandate.partyBudgetsMinor?.[workload.buyerId] ?? workload.budgetMinor;
}

function pushConstraint(
  constraints: Array<{ code: string; satisfied: boolean; detail: string }>,
  code: string,
  satisfied: boolean,
  detail: string,
): void {
  constraints.push({ code, satisfied, detail });
}

interface ExchangeCandidate {
  proposal: SolverProposal;
  score: number;
  violations: string[];
}

function buildExchangeCandidate(
  input: SolverInput,
  target: SolverWorkload,
  heldOffer: SolverOffer,
  allocation: SolverAllocation,
  incumbent: SolverWorkload,
  replacement: SolverOffer,
  now: Date,
): ExchangeCandidate {
  const violations: string[] = [];
  const mandate = input.mandate ?? {};
  const fee = Math.max(0, mandate.coordinationFeeMinor ?? 1000);
  const targetWindow = heldWindow(target, allocation, heldOffer, now);
  const incumbentWindow = heldWindow(incumbent, allocation, replacement, now);
  const targetBaseline = cheapestPublicBaseline(target, input.offers);
  const incumbentBaseline = roundMinor(
    heldOffer.rateMinorPerGpuHour * allocation.gpuCount * durationHours(incumbent),
  );

  if (!targetWindow) violations.push("target_window_not_feasible");
  if (!incumbentWindow) violations.push("incumbent_replacement_window_not_feasible");
  if (!targetBaseline) violations.push("target_market_baseline_missing");
  if (target.buyerId === incumbent.buyerId) violations.push("invalid_same_buyer_exchange");
  if (heldOffer.providerId === replacement.providerId) violations.push("replacement_same_provider");
  if (target.gpuCount > allocation.gpuCount) violations.push("held_allocation_too_small");

  const targetViolations = offerExecutable(heldOffer, target, now.getTime(), true);
  violations.push(...targetViolations.map((code) => `target:${code}`));
  const replacementViolations = offerExecutable(replacement, incumbent, now.getTime());
  violations.push(...replacementViolations.map((code) => `replacement:${code}`));

  if (!targetWindow || !incumbentWindow || !targetBaseline) {
    return {
      proposal: null as unknown as SolverProposal,
      score: Number.NEGATIVE_INFINITY,
      violations,
    };
  }

  const targetStart = new Date(targetWindow.start).getTime();
  const targetEnd = new Date(targetWindow.end).getTime();
  const incumbentStart = new Date(incumbentWindow.start).getTime();
  const incumbentEnd = new Date(incumbentWindow.end).getTime();

  const targetCapacity = availableCapacity(
    heldOffer,
    input.allocations,
    targetStart,
    targetEnd,
    allocation.id,
  );
  if (targetCapacity < target.gpuCount) violations.push("held_capacity_conflict");

  const replacementCapacity = availableCapacity(
    replacement,
    input.allocations,
    incumbentStart,
    incumbentEnd,
    null,
  );
  if (replacementCapacity < incumbent.gpuCount) violations.push("replacement_capacity_conflict");

  const targetGross = price(heldOffer, target, targetWindow.hours, true);
  const incumbentGross = price(replacement, incumbent, incumbentWindow.hours, false);
  const switching = Math.max(
    0,
    asNumber(incumbent.flexibility.switch_cost_minor) ?? allocation.switchCostMinor,
  );
  const restartable = incumbent.flexibility.restartable === true;
  if (!restartable && switching > 0) violations.push("incumbent_workload_not_restartable");
  if (mandate.maxSwitchingCostMinor !== null && mandate.maxSwitchingCostMinor !== undefined) {
    if (switching > mandate.maxSwitchingCostMinor) violations.push("switching_cost_above_mandate");
  }

  const targetBudget = budgetFor(target, mandate);
  const incumbentBudget = budgetFor(incumbent, mandate);
  if (targetGross > targetBudget) violations.push("target_budget_exceeded");
  if (incumbentGross + switching > incumbentBudget) violations.push("incumbent_budget_exceeded");

  const baselineTotal = targetBaseline.amountMinor + incumbentBaseline;
  const coordinatedSpend = targetGross + incumbentGross + switching + fee;
  const savings = baselineTotal - coordinatedSpend;
  if (savings < (mandate.minSavingsMinor ?? 1)) violations.push("no_economic_surplus");
  if (mandate.maxTotalCostMinor != null && targetGross + incumbentGross > mandate.maxTotalCostMinor) {
    violations.push("total_cost_above_mandate");
  }

  const providerRevenueDelta =
    targetGross + incumbentGross - incumbentBaseline;

  if (violations.length > 0) {
    return { proposal: null as unknown as SolverProposal, score: savings, violations };
  }

  const parties: SolverProposal["parties"] = [
    {
      id: target.buyerId,
      role: "buyer",
      name: target.buyerName,
      obligation: `Take the reassigned ${target.gpuCount}x ${target.gpuModel} window from ${heldOffer.providerName} and pay the agreed reassignment price`,
      amount_minor: targetGross,
      currency: heldOffer.currency,
      floor_surplus_minor: Math.max(0, targetBaseline.amountMinor - targetGross),
    },
    {
      id: incumbent.buyerId,
      role: "buyer",
      name: incumbent.buyerName,
      obligation: `Release the ${allocation.gpuCount}x ${target.gpuModel} window, restart the eligible workload on ${replacement.providerName}, and pay the replacement price`,
      amount_minor: incumbentGross + switching,
      currency: replacement.currency,
      floor_surplus_minor: Math.max(0, incumbentBaseline - incumbentGross - switching),
    },
    {
      id: heldOffer.providerId,
      role: "provider",
      name: heldOffer.providerName,
      obligation: `Authorize reassignment of the held window to ${target.buyerName} at the agreed price`,
      amount_minor: 0,
      currency: heldOffer.currency,
      floor_surplus_minor: 0,
    },
    {
      id: replacement.providerId,
      role: "provider",
      name: replacement.providerName,
      obligation: `Reserve the replacement window for ${incumbent.buyerName}`,
      amount_minor: 0,
      currency: replacement.currency,
      floor_surplus_minor: 0,
    },
  ];

  const participantCosts: CostLine[] = [
    {
      party_id: target.buyerId,
      role: "buyer",
      gross_minor: targetGross,
      switching_minor: 0,
      net_minor: targetGross,
      baseline_minor: targetBaseline.amountMinor,
      savings_minor: targetBaseline.amountMinor - targetGross,
      revenue_minor: 0,
      revenue_baseline_minor: 0,
      budget_minor: targetBudget,
    },
    {
      party_id: incumbent.buyerId,
      role: "buyer",
      gross_minor: incumbentGross,
      switching_minor: switching,
      net_minor: incumbentGross + switching,
      baseline_minor: incumbentBaseline,
      savings_minor: incumbentBaseline - incumbentGross - switching,
      revenue_minor: 0,
      revenue_baseline_minor: 0,
      budget_minor: incumbentBudget,
    },
    {
      party_id: heldOffer.providerId,
      role: "provider",
      gross_minor: 0,
      switching_minor: 0,
      net_minor: 0,
      baseline_minor: 0,
      savings_minor: 0,
      revenue_minor: targetGross,
      revenue_baseline_minor: incumbentBaseline,
      budget_minor: null,
    },
    {
      party_id: replacement.providerId,
      role: "provider",
      gross_minor: 0,
      switching_minor: 0,
      net_minor: 0,
      baseline_minor: 0,
      savings_minor: 0,
      revenue_minor: incumbentGross,
      revenue_baseline_minor: 0,
      budget_minor: null,
    },
  ];

  const constraints: SolverProposal["constraints"] = [];
  pushConstraint(constraints, "gpu_compatibility", true, "Both offers satisfy the workload GPU, CPU, and memory constraints.");
  pushConstraint(constraints, "workload_permission", true, "Each provider profile permits the assigned workload type.");
  pushConstraint(constraints, "provider_authorization", true, "Both offers have a live provider authorization; the held offer permits reassignment.");
  pushConstraint(constraints, "capacity_exclusivity", true, "The held allocation is released and the replacement capacity is not double-booked.");
  pushConstraint(constraints, "buyer_budgets", true, "Both buyer obligations, including switching cost, fit their budgets.");
  pushConstraint(constraints, "deadlines", true, "Both replacement windows end before the workload deadlines.");
  pushConstraint(constraints, "restart_feasibility", true, "The displaced workload is restartable with a declared switching cost.");
  pushConstraint(constraints, "economic_surplus", true, `Net buyer savings are ${savings} minor units after switching and the coordination fee.`);

  const proposal: SolverProposal = {
    strategy: "exchange",
    title: `Move ${incumbent.buyerName} to ${replacement.providerName} and reassign ${heldOffer.providerName} capacity to ${target.buyerName}`,
    window: targetWindow,
    parties,
    required_commitments: [
      {
        offer_id: heldOffer.id,
        provider_id: heldOffer.providerId,
        buyer_id: target.buyerId,
        gpu_count: target.gpuCount,
        window_start: targetWindow.start,
        window_end: targetWindow.end,
        reservation_status: "planned",
        release_allocation_id: allocation.id,
      },
      {
        offer_id: replacement.id,
        provider_id: replacement.providerId,
        buyer_id: incumbent.buyerId,
        gpu_count: incumbent.gpuCount,
        window_start: incumbentWindow.start,
        window_end: incumbentWindow.end,
        reservation_status: "planned",
        release_allocation_id: null,
      },
    ],
    proposed_transfers: [
      {
        from_party_id: incumbent.buyerId,
        to_party_id: target.buyerId,
        offer_id: heldOffer.id,
        gpu_count: target.gpuCount,
        window_start: targetWindow.start,
        window_end: targetWindow.end,
      },
      {
        from_party_id: replacement.providerId,
        to_party_id: incumbent.buyerId,
        offer_id: replacement.id,
        gpu_count: incumbent.gpuCount,
        window_start: incumbentWindow.start,
        window_end: incumbentWindow.end,
      },
    ],
    compensation: [
      {
        from_party_id: target.buyerId,
        to_party_id: heldOffer.providerId,
        amount_minor: targetGross,
        reason: "reassigned capacity at the provider's agreed reassignment price",
      },
      {
        from_party_id: incumbent.buyerId,
        to_party_id: replacement.providerId,
        amount_minor: incumbentGross,
        reason: "replacement capacity for the displaced workload",
      },
    ],
    participant_costs: participantCosts,
    total_cost_minor: targetGross + incumbentGross,
    baseline_cost_minor: baselineTotal,
    switching_cost_minor: switching,
    coordination_fee_minor: fee,
    projected_savings_minor: savings,
    projected_surplus_minor: savings,
    provider_revenue_delta_minor: providerRevenueDelta,
    comparison: {
      independent: {
        kind: "independent_rental",
        description: `${incumbent.buyerName} keeps the existing allocation and ${target.buyerName} uses the public market reference because no executable transfer is authorized independently.`,
        buyer_cost_minor: baselineTotal,
        provider_revenue_minor: incumbentBaseline,
        source: "public_market_reference",
        offer_id: targetBaseline.offer.id,
        note: `Public reference ${targetBaseline.offer.providerName} at ${targetBaseline.offer.rateMinorPerGpuHour} minor/GPU-hour is a market observation, not confirmed inventory.`,
      },
      direct: {
        kind: "direct_rental",
        description: `Direct acquisition by ${target.buyerName} was evaluated against executable offers before the exchange.`,
        buyer_cost_minor: null,
        provider_revenue_minor: 0,
        source: "none",
        offer_id: null,
        note: "No direct executable offer satisfied the target workload without releasing the held allocation.",
      },
    },
    constraints,
    explanation: [
      `${target.buyerName} needs ${target.gpuCount}x ${target.gpuModel} (${target.type}) but the matching capacity is held by ${incumbent.buyerName}.`,
      `${incumbent.buyerName}'s workload is restartable, so it can move to ${replacement.providerName} at ${replacement.rateMinorPerGpuHour} minor/GPU-hour with ${switching} minor switching cost.`,
      `${target.buyerName} takes the released capacity at ${rateFor(heldOffer, true)} minor/GPU-hour instead of the ${targetBaseline.offer.rateMinorPerGpuHour} public reference.`,
      `The bundle saves ${savings} minor units for buyers net of switching and the ${fee} minor coordination fee; both transactions are required for either party to receive capacity.`,
    ],
  };

  return { proposal, score: savings, violations: [] };
}

interface GeneralPathNode {
  offer: SolverOffer;
  allocation: SolverAllocation | null;
  tenant: SolverWorkload;
  incumbent: SolverWorkload | null;
  sourceOffer: SolverOffer | null;
  sourceAllocation: SolverAllocation | null;
  window: Window;
  grossMinor: number;
  switchingMinor: number;
  baselineMinor: number;
}

function sourceBaseline(
  sourceOffer: SolverOffer,
  sourceAllocation: SolverAllocation,
  workload: SolverWorkload,
): number {
  return roundMinor(
    sourceOffer.rateMinorPerGpuHour * sourceAllocation.gpuCount * durationHours(workload),
  );
}

function planDestination(
  input: SolverInput,
  tenant: SolverWorkload,
  destination: SolverOffer,
  destinationAllocation: SolverAllocation | null,
  sourceOffer: SolverOffer | null,
  sourceAllocation: SolverAllocation | null,
  now: Date,
  fallbackBaselineMinor: number,
): { node: GeneralPathNode; violations: string[] } {
  const mandate = input.mandate ?? {};
  const violations = offerExecutable(
    destination,
    tenant,
    now.getTime(),
    destinationAllocation !== null,
  ).map((code) => `destination:${code}`);
  const window = destinationAllocation
    ? heldWindow(tenant, destinationAllocation, destination, now)
    : directWindow(tenant, destination, now);
  let grossMinor = 0;
  let switchingMinor = 0;
  let baselineMinor = sourceAllocation && sourceOffer
    ? sourceBaseline(sourceOffer, sourceAllocation, tenant)
    : fallbackBaselineMinor;

  if (!window) {
    violations.push("destination_window_not_feasible");
  } else {
    if (destinationAllocation && destinationAllocation.gpuCount < tenant.gpuCount) {
      violations.push("destination_allocation_too_small");
    }
    const capacity = availableCapacity(
      destination,
      input.allocations,
      new Date(window.start).getTime(),
      new Date(window.end).getTime(),
      destinationAllocation?.id ?? null,
    );
    if (capacity < tenant.gpuCount) violations.push("destination_capacity_conflict");
    grossMinor = price(destination, tenant, window.hours, destinationAllocation !== null);
    switchingMinor = sourceAllocation
      ? Math.max(0, asNumber(tenant.flexibility.switch_cost_minor) ?? sourceAllocation.switchCostMinor)
      : 0;
    if (!sourceAllocation && !sourceOffer && fallbackBaselineMinor <= 0) {
      violations.push("market_baseline_missing");
    }
    if (grossMinor + switchingMinor > budgetFor(tenant, mandate)) {
      violations.push("buyer_budget_exceeded");
    }
    if (switchingMinor > 0 && tenant.flexibility.restartable !== true) {
      violations.push("workload_not_restartable");
    }
    if (
      mandate.maxSwitchingCostMinor !== null &&
      mandate.maxSwitchingCostMinor !== undefined &&
      switchingMinor > mandate.maxSwitchingCostMinor
    ) {
      violations.push("switching_cost_above_mandate");
    }
  }

  return {
    violations,
    node: {
      offer: destination,
      allocation: destinationAllocation,
      tenant,
      incumbent: null,
      sourceOffer,
      sourceAllocation,
      window: window ?? {
        start: new Date(now).toISOString(),
        end: new Date(now).toISOString(),
        hours: durationHours(tenant),
      },
      grossMinor,
      switchingMinor,
      baselineMinor,
    },
  };
}

function exploreGeneralPaths(
  input: SolverInput,
  target: SolverWorkload,
  startOffer: SolverOffer,
  startAllocation: SolverAllocation,
  startIncumbent: SolverWorkload,
  anchor: SolverAllocation | null,
  anchorOffer: SolverOffer | null,
  kind: "chain" | "cycle",
  now: Date,
  maxDepth: number,
  emit: (nodes: GeneralPathNode[]) => void,
): number {
  const mandate = input.mandate ?? {};
  const targetBaseline = kind === "cycle"
    ? 0
    : (cheapestPublicBaseline(target, input.offers)?.amountMinor ?? 0);
  const initial = planDestination(
    input,
    target,
    startOffer,
    startAllocation,
    kind === "cycle" ? anchorOffer : null,
    kind === "cycle" ? anchor : null,
    now,
    targetBaseline,
  );
  if (initial.violations.length > 0) return 0;

  const nodes: GeneralPathNode[] = [];
  const usedAllocations = new Set<string>([startAllocation.id]);
  const usedOffers = new Set<string>([startOffer.id]);
  const executableOffers = input.offers.filter(
    (offer) =>
      offer.source === "worker" &&
      offer.gpuModel === target.gpuModel &&
      offer.executable,
  );
  const activeAllocations = input.allocations.filter(
    (allocation) => allocation.status === "active" && allocation.id !== anchor?.id,
  );
  let evaluated = 0;

  nodes.push({ ...initial.node, incumbent: startIncumbent });

  const walk = (workload: SolverWorkload, sourceAllocation: SolverAllocation, sourceOffer: SolverOffer): void => {
    if (nodes.length >= maxDepth) return;

    if (kind === "chain") {
      for (const freeOffer of executableOffers) {
        if (usedOffers.has(freeOffer.id)) continue;
        const planned = planDestination(
          input,
          workload,
          freeOffer,
          null,
          sourceOffer,
          sourceAllocation,
          now,
          durationHours(workload),
        );
        if (planned.violations.length > 0) continue;
        evaluated += 1;
        nodes.push({ ...planned.node, incumbent: null });
        emit([...nodes]);
        nodes.pop();
      }
    }

    for (const nextAllocation of activeAllocations) {
      if (usedAllocations.has(nextAllocation.id) || usedOffers.has(nextAllocation.offerId)) continue;
      const nextOffer = input.offers.find((offer) => offer.id === nextAllocation.offerId);
      const nextIncumbent = input.workloads.find(
        (candidate) => candidate.id === nextAllocation.workloadId,
      );
      if (!nextOffer || !nextIncumbent || nextIncumbent.buyerId === workload.buyerId) continue;
      const planned = planDestination(
        input,
        workload,
        nextOffer,
        nextAllocation,
        sourceOffer,
        sourceAllocation,
        now,
        durationHours(workload),
      );
      if (planned.violations.length > 0) continue;
      evaluated += 1;
      nodes.push({ ...planned.node, incumbent: nextIncumbent });
      usedAllocations.add(nextAllocation.id);
      usedOffers.add(nextOffer.id);
      walk(nextIncumbent, nextAllocation, nextOffer);
      usedOffers.delete(nextOffer.id);
      usedAllocations.delete(nextAllocation.id);
      nodes.pop();
    }

    if (kind === "cycle" && anchor && anchorOffer && !usedAllocations.has(anchor.id)) {
      const planned = planDestination(
        input,
        workload,
        anchorOffer,
        anchor,
        sourceOffer,
        sourceAllocation,
        now,
        durationHours(workload),
      );
      if (planned.violations.length === 0) {
        evaluated += 1;
        nodes.push({ ...planned.node, incumbent: null });
        emit([...nodes]);
        nodes.pop();
      }
    }
  };

  if (kind === "chain") {
    // A chain must end in fresh executable capacity, so the first displaced
    // workload is the first point that can either extend the chain or close it.
    walk(startIncumbent, startAllocation, startOffer);
  } else if (anchor && anchorOffer) {
    walk(startIncumbent, startAllocation, startOffer);
  }

  return evaluated;
}

function buildGeneralCandidate(
  input: SolverInput,
  target: SolverWorkload,
  nodes: GeneralPathNode[],
  kind: "chain" | "cycle",
  anchor: SolverAllocation | null,
  now: Date,
): ExchangeCandidate {
  const mandate = input.mandate ?? {};
  const fee = Math.max(0, mandate.coordinationFeeMinor ?? 1000);
  const violations: string[] = [];
  if (nodes.length < 2) violations.push("conditional_path_too_short");

  const totalGross = nodes.reduce((sum, node) => sum + node.grossMinor, 0);
  const totalSwitching = nodes.reduce((sum, node) => sum + node.switchingMinor, 0);
  const baselineTotal = nodes.reduce((sum, node) => sum + node.baselineMinor, 0);
  const providerRevenueBaseline = nodes.reduce((sum, node) => {
    if (!node.sourceOffer || !node.sourceAllocation) return sum;
    return sum + sourceBaseline(node.sourceOffer, node.sourceAllocation, node.tenant);
  }, 0);
  const savings = baselineTotal - totalGross - totalSwitching - fee;
  if (savings < (mandate.minSavingsMinor ?? 1)) violations.push("no_economic_surplus");
  if (mandate.maxTotalCostMinor != null && totalGross > mandate.maxTotalCostMinor) {
    violations.push("total_cost_above_mandate");
  }
  if (violations.length > 0) {
    return { proposal: null as unknown as SolverProposal, score: savings, violations };
  }

  const buyers = new Map<string, SolverWorkload>();
  buyers.set(target.buyerId, target);
  for (const node of nodes) {
    if (node.tenant.buyerId !== target.buyerId) buyers.set(node.tenant.buyerId, node.tenant);
  }
  const providerIds = new Set<string>();
  for (const node of nodes) {
    providerIds.add(node.offer.providerId);
    if (node.sourceOffer) providerIds.add(node.sourceOffer.providerId);
  }

  const parties: SolverProposal["parties"] = [];
  const seenParties = new Set<string>();
  for (const [partyId, buyer] of buyers) {
    const relevant = nodes.filter((node) => node.tenant.buyerId === partyId);
    const net = relevant.reduce((sum, node) => sum + node.grossMinor + node.switchingMinor, 0);
    const baseline = relevant.reduce((sum, node) => sum + node.baselineMinor, 0);
    const obligation = partyId === target.buyerId
      ? kind === "cycle"
        ? `Move ${target.gpuCount}x ${target.gpuModel} from the current allocation into the conditional cycle and pay the agreed reassignment price`
        : `Take the reassigned ${target.gpuCount}x ${target.gpuModel} window from ${nodes[0]!.offer.providerName} and pay the agreed reassignment price`
      : `Release the held window, restart the eligible workload on the next conditional slot, and pay the agreed price`;
    parties.push({
      id: partyId,
      role: "buyer",
      name: buyer.buyerName,
      obligation,
      amount_minor: net,
      currency: relevant[0]?.offer.currency ?? "USD",
      floor_surplus_minor: Math.max(0, baseline - net),
    });
    seenParties.add(partyId);
  }
  for (const providerId of providerIds) {
    if (seenParties.has(providerId)) continue;
    const providerName = nodes.find((node) => node.offer.providerId === providerId)?.offer.providerName ??
      nodes.find((node) => node.sourceOffer?.providerId === providerId)?.sourceOffer?.providerName ??
      "Provider";
    parties.push({
      id: providerId,
      role: "provider",
      name: providerName,
      obligation: kind === "cycle"
        ? "Authorize the conditional reassignment and accept the incoming tenant at the agreed price"
        : "Authorize the conditional release and reserve the incoming tenant's window at the agreed price",
      amount_minor: 0,
      currency: nodes[0]?.offer.currency ?? "USD",
      floor_surplus_minor: 0,
    });
  }

  const participantCosts: CostLine[] = [];
  for (const [partyId, buyer] of buyers) {
    const relevant = nodes.filter((node) => node.tenant.buyerId === partyId);
    const gross = relevant.reduce((sum, node) => sum + node.grossMinor, 0);
    const switching = relevant.reduce((sum, node) => sum + node.switchingMinor, 0);
    const baseline = relevant.reduce((sum, node) => sum + node.baselineMinor, 0);
    participantCosts.push({
      party_id: partyId,
      role: "buyer",
      gross_minor: gross,
      switching_minor: switching,
      net_minor: gross + switching,
      baseline_minor: baseline,
      savings_minor: baseline - gross - switching,
      revenue_minor: 0,
      revenue_baseline_minor: 0,
      budget_minor: budgetFor(buyer, mandate),
    });
  }
  for (const providerId of providerIds) {
    const revenue = nodes
      .filter((node) => node.offer.providerId === providerId)
      .reduce((sum, node) => sum + node.grossMinor, 0);
    const revenueBaseline = nodes
      .filter((node) => node.sourceOffer?.providerId === providerId && node.sourceAllocation)
      .reduce(
        (sum, node) =>
          sum + sourceBaseline(node.sourceOffer!, node.sourceAllocation!, node.tenant),
        0,
      );
    participantCosts.push({
      party_id: providerId,
      role: "provider",
      gross_minor: 0,
      switching_minor: 0,
      net_minor: 0,
      baseline_minor: 0,
      savings_minor: 0,
      revenue_minor: revenue,
      revenue_baseline_minor: revenueBaseline,
      budget_minor: null,
    });
  }

  const commitments: CommitmentPlan[] = nodes.map((node) => ({
    offer_id: node.offer.id,
    provider_id: node.offer.providerId,
    buyer_id: node.tenant.buyerId,
    gpu_count: node.tenant.gpuCount,
    window_start: node.window.start,
    window_end: node.window.end,
    reservation_status: "planned",
    release_allocation_id: node.allocation?.id ?? null,
  }));
  const transfers: TransferPlan[] = nodes.map((node) => ({
    from_party_id: node.allocation?.buyerId ?? node.offer.providerId,
    to_party_id: node.tenant.buyerId,
    offer_id: node.offer.id,
    gpu_count: node.tenant.gpuCount,
    window_start: node.window.start,
    window_end: node.window.end,
  }));
  const compensation: CompensationPlan[] = nodes.map((node) => ({
    from_party_id: node.tenant.buyerId,
    to_party_id: node.offer.providerId,
    amount_minor: node.grossMinor,
    reason: node.allocation
      ? "conditional reassignment at the provider's agreed transfer price"
      : "fresh executable capacity for the terminal workload in the conditional chain",
  }));
  const moves: ConditionalChainMovePlan[] = nodes.map((node, index) => ({
    sequence: index + 1,
    workload_id: node.tenant.id,
    buyer_id: node.tenant.buyerId,
    buyer_name: node.tenant.buyerName,
    from_offer_id: node.sourceOffer?.id ?? null,
    from_allocation_id: node.sourceAllocation?.id ?? null,
    to_offer_id: node.offer.id,
    to_allocation_id: node.allocation?.id ?? null,
    gpu_count: node.tenant.gpuCount,
    window: node.window,
    gross_minor: node.grossMinor,
    switching_minor: node.switchingMinor,
    baseline_minor: node.baselineMinor,
  }));
  const incumbentNames = nodes
    .slice(1)
    .map((node) => node.tenant.buyerName)
    .join(" -> ");
  const title = kind === "cycle"
    ? `Rotate ${nodes.length} conditional capacity windows to place ${target.buyerName}`
    : `Move ${incumbentNames} through ${nodes.length} conditional windows and assign ${target.buyerName} the released capacity`;
  const comparisonIndependent: ComparisonBaseline = {
    kind: kind === "cycle" ? "keep_current" : "independent_rental",
    description: kind === "cycle"
      ? `${target.buyerName} keeps its current allocation and every displaced workload remains in place.`
      :      `${target.buyerName} uses the public market reference while every displaced workload keeps its current allocation.`,
    buyer_cost_minor: baselineTotal,
    provider_revenue_minor: providerRevenueBaseline,
    source: kind === "cycle" ? "existing_allocation" : "public_market_reference",
    offer_id: kind === "cycle"
      ? anchor?.offerId ?? null
      : cheapestPublicBaseline(target, input.offers)?.offer.id ?? nodes[0]?.offer.id ?? null,
    note: kind === "cycle"
      ? "The comparison is the persisted current allocation; no new capacity is created by the cycle."
      : (() => {
          const baseline = cheapestPublicBaseline(target, input.offers);
          return baseline
            ? `${describeBaseline(baseline)} Not confirmed inventory.`
            : "Public reference prices are observations, not confirmed inventory.";
        })(),
  };
  const comparisonDirect: ComparisonBaseline = {
    kind: "none",
    description: "No single direct rental satisfies the conditional path without releasing the held allocations.",
    buyer_cost_minor: null,
    provider_revenue_minor: 0,
    source: "none",
    offer_id: null,
    note: "Every move in this proposal depends on the preceding release.",
  };

  const proposal: SolverProposal = {
    strategy: "exchange",
    conditional_chain: {
      kind,
      closed: kind === "cycle",
      depth: nodes.length,
      target_anchor_allocation_id: anchor?.id ?? null,
      moves,
    },
    title,
    window: nodes[0]!.window,
    parties,
    required_commitments: commitments,
    proposed_transfers: transfers,
    compensation,
    participant_costs: participantCosts,
    total_cost_minor: totalGross,
    baseline_cost_minor: baselineTotal,
    switching_cost_minor: totalSwitching,
    coordination_fee_minor: fee,
    projected_savings_minor: savings,
    projected_surplus_minor: savings,
    provider_revenue_delta_minor: totalGross - providerRevenueBaseline,
    comparison: { independent: comparisonIndependent, direct: comparisonDirect },
    constraints: [
      {
        code: "conditional_structure",
        satisfied: true,
        detail: `${kind === "cycle" ? "Closed cycle" : "Acyclic chain"} with ${nodes.length} conditional moves.`,
      },
      {
        code: "capacity_exclusivity",
        satisfied: true,
        detail: "Every held slot is used once and every fresh offer is reserved for exactly one terminal move.",
      },
      {
        code: "provider_authorization",
        satisfied: true,
        detail: "Every reassigned slot has a live provider authorization that permits transfer.",
      },
      {
        code: "buyer_budgets",
        satisfied: true,
        detail: "Every buyer's new gross cost plus switching cost fits its budget.",
      },
      {
        code: "deadlines",
        satisfied: true,
        detail: "Every new window ends before the corresponding workload deadline.",
      },
      {
        code: "restart_feasibility",
        satisfied: true,
        detail: "Every displaced workload declares a restartable plan and switching cost.",
      },
      {
        code: "economic_surplus",
        satisfied: true,
        detail: `Net buyer savings are ${savings} minor units after switching and the ${fee} minor coordination fee.`,
      },
    ],
    explanation: [
      `${target.buyerName} needs ${target.gpuCount}x ${target.gpuModel}, but the matching capacity is held by ${nodes[0]!.incumbent?.buyerName ?? "another buyer"}.`,
      `${kind === "cycle" ? "The final displaced workload returns to the target buyer's released anchor allocation, closing the cycle" : `The chain terminates in fresh executable capacity from ${nodes[nodes.length - 1]!.offer.providerName}`}.`,
      `The bundle saves ${savings} minor units for buyers net of ${totalSwitching} minor switching cost and the ${fee} minor coordination fee.`,
      "No transfer, reservation, or payment is authorized unless every participant approves the same terms version.",
    ],
  };

  return { proposal, score: savings, violations: [] };
}

function buildDirectCandidate(
  input: SolverInput,
  target: SolverWorkload,
  offer: SolverOffer,
  now: Date,
): ExchangeCandidate {
  const violations: string[] = [];
  const mandate = input.mandate ?? {};
  const fee = Math.max(0, mandate.coordinationFeeMinor ?? 1000);
  const window = directWindow(target, offer, now);
  const baseline = cheapestPublicBaseline(target, input.offers);
  const executableViolations = offerExecutable(offer, target, now.getTime());
  violations.push(...executableViolations);
  if (!window) violations.push("target_window_not_feasible");
  if (!baseline) violations.push("target_market_baseline_missing");
  if (!window || !baseline) {
    return { proposal: null as unknown as SolverProposal, score: Number.NEGATIVE_INFINITY, violations };
  }
  const capacity = availableCapacity(
    offer,
    input.allocations,
    new Date(window.start).getTime(),
    new Date(window.end).getTime(),
    null,
  );
  if (capacity < target.gpuCount) violations.push("capacity_conflict");
  const gross = price(offer, target, window.hours, false);
  if (gross > budgetFor(target, mandate)) violations.push("target_budget_exceeded");
  const savings = baseline.amountMinor - gross - fee;
  if (savings < (mandate.minSavingsMinor ?? 1)) violations.push("no_economic_surplus");
  if (mandate.maxTotalCostMinor != null && gross > mandate.maxTotalCostMinor) {
    violations.push("total_cost_above_mandate");
  }
  if (violations.length > 0) {
    return { proposal: null as unknown as SolverProposal, score: savings, violations };
  }

  return {
    score: savings,
    violations: [],
    proposal: {
      strategy: "direct",
      title: `Direct rental of ${target.gpuCount}x ${target.gpuModel} from ${offer.providerName} for ${target.buyerName}`,
      window,
      parties: [
        {
          id: target.buyerId,
          role: "buyer",
          name: target.buyerName,
          obligation: `Rent ${target.gpuCount}x ${target.gpuModel} from ${offer.providerName}`,
          amount_minor: gross,
          currency: offer.currency,
          floor_surplus_minor: Math.max(0, baseline.amountMinor - gross),
        },
        {
          id: offer.providerId,
          role: "provider",
          name: offer.providerName,
          obligation: `Reserve ${target.gpuCount}x ${target.gpuModel} for ${target.buyerName}`,
          amount_minor: 0,
          currency: offer.currency,
          floor_surplus_minor: 0,
        },
      ],
      required_commitments: [
        {
          offer_id: offer.id,
          provider_id: offer.providerId,
          buyer_id: target.buyerId,
          gpu_count: target.gpuCount,
          window_start: window.start,
          window_end: window.end,
          reservation_status: "planned",
          release_allocation_id: null,
        },
      ],
      proposed_transfers: [
        {
          from_party_id: offer.providerId,
          to_party_id: target.buyerId,
          offer_id: offer.id,
          gpu_count: target.gpuCount,
          window_start: window.start,
          window_end: window.end,
        },
      ],
      compensation: [
        {
          from_party_id: target.buyerId,
          to_party_id: offer.providerId,
          amount_minor: gross,
          reason: "direct rental at the provider's published executable rate",
        },
      ],
      participant_costs: [
        {
          party_id: target.buyerId,
          role: "buyer",
          gross_minor: gross,
          switching_minor: 0,
          net_minor: gross,
          baseline_minor: baseline.amountMinor,
          savings_minor: savings,
          revenue_minor: 0,
          revenue_baseline_minor: 0,
          budget_minor: budgetFor(target, mandate),
        },
        {
          party_id: offer.providerId,
          role: "provider",
          gross_minor: 0,
          switching_minor: 0,
          net_minor: 0,
          baseline_minor: 0,
          savings_minor: 0,
          revenue_minor: gross,
          revenue_baseline_minor: 0,
          budget_minor: null,
        },
      ],
      total_cost_minor: gross,
      baseline_cost_minor: baseline.amountMinor,
      switching_cost_minor: 0,
      coordination_fee_minor: fee,
      projected_savings_minor: savings,
      projected_surplus_minor: savings,
      provider_revenue_delta_minor: gross,
      comparison: {
        independent: {
          kind: "independent_rental",
          description: "Target buyer uses the cheapest public market reference.",
          buyer_cost_minor: baseline.amountMinor,
          provider_revenue_minor: 0,
          source: "public_market_reference",
          offer_id: baseline.offer.id,
          note: `${describeBaseline(baseline)} Not confirmed inventory.`
        },
        direct: {
          kind: "direct_rental",
          description: "Target buyer rents the executable offer directly.",
          buyer_cost_minor: gross,
          provider_revenue_minor: gross,
          source: "executable_offer",
          offer_id: offer.id,
          note: "The offer has live provider authorization and available capacity.",
        },
      },
      constraints: [
        { code: "gpu_compatibility", satisfied: true, detail: "Offer satisfies GPU, CPU, and memory constraints." },
        { code: "workload_permission", satisfied: true, detail: "Provider permits this workload type." },
        { code: "provider_authorization", satisfied: true, detail: "Provider authorization is active." },
        { code: "capacity_exclusivity", satisfied: true, detail: "Capacity is unallocated for the requested window." },
        { code: "buyer_budget", satisfied: true, detail: "Cost fits the buyer budget." },
        { code: "economic_surplus", satisfied: true, detail: `Direct rental saves ${savings} minor units versus the public reference after the coordination fee.` },
      ],
      explanation: [
        `${offer.providerName} has ${offer.gpuCount}x ${offer.gpuModel} available at ${offer.rateMinorPerGpuHour} minor/GPU-hour.`,
        `${describeBaseline(baseline)} For ${target.gpuCount}x ${target.gpuModel} over ${baseline.hours} hours that is ${baseline.amountMinor} minor, so the direct rental saves ${savings} minor units net of the ${fee} fee.`,
      ],
    },
  };
}

/**
 * Evaluate every direct executable offer and every possible release-and-replace
 * exchange, then return the feasible option with the largest net buyer savings.
 * Ties are broken deterministically by total cost, then offer ids.
 */
export function solve(input: SolverInput): SolverResult {
  const now = input.now ?? new Date();
  const target = input.workload;
  const rejected: RejectedOption[] = [];
  const candidates: ExchangeCandidate[] = [];
  let evaluated = 0;

  const executableOffers = input.offers.filter(
    (offer) => offer.source === "worker" && offer.gpuModel === target.gpuModel,
  );

  for (const offer of executableOffers) {
    evaluated += 1;
    const candidate = buildDirectCandidate(input, target, offer, now);
    if (candidate.proposal) candidates.push(candidate);
    else {
      rejected.push({
        strategy: "direct",
        offer_id: offer.id,
        replacement_offer_id: null,
        violations: [...new Set(candidate.violations)],
        details: { offer_rate_minor: offer.rateMinorPerGpuHour, provider_id: offer.providerId },
      });
    }
  }

  const heldAllocations = input.allocations.filter((allocation) => {
    if (allocation.status !== "active") return false;
    if (allocation.buyerId === target.buyerId) return false;
    const heldOffer = input.offers.find((offer) => offer.id === allocation.offerId);
    return Boolean(heldOffer);
  });

  const workloadsById = new Map(input.workloads.map((workload) => [workload.id, workload]));
  for (const allocation of heldAllocations) {
    const heldOffer = input.offers.find((offer) => offer.id === allocation.offerId);
    const incumbent = workloadsById.get(allocation.workloadId);
    if (!heldOffer || !incumbent) {
      rejected.push({
        strategy: "exchange",
        offer_id: allocation.offerId,
        replacement_offer_id: null,
        violations: ["allocation_context_missing"],
        details: { allocation_id: allocation.id },
      });
      continue;
    }
    for (const replacement of executableOffers) {
      if (replacement.id === heldOffer.id) continue;
      evaluated += 1;
      const candidate = buildExchangeCandidate(
        input,
        target,
        heldOffer,
        allocation,
        incumbent,
        replacement,
        now,
      );
      if (candidate.proposal) candidates.push(candidate);
      else {
        rejected.push({
          strategy: "exchange",
          offer_id: heldOffer.id,
          replacement_offer_id: replacement.id,
          violations: [...new Set(candidate.violations)],
          details: {
            allocation_id: allocation.id,
            incumbent_workload_id: incumbent.id,
            incumbent_buyer_id: incumbent.buyerId,
          },
        });
      }
    }
  }

  const requestedDepth = input.mandate?.maxChainDepth ?? 4;
  const maxDepth = Math.min(Math.max(Math.trunc(requestedDepth), 2), 6);
  const anchor = input.allocations.find(
    (allocation) =>
      allocation.status === "active" &&
      allocation.buyerId === target.buyerId &&
      allocation.workloadId === target.id,
  ) ?? null;
  const anchorOffer = anchor
    ? input.offers.find((offer) => offer.id === anchor.offerId) ?? null
    : null;
  const chainStarts = input.allocations.filter(
    (allocation) =>
      allocation.status === "active" &&
      allocation.buyerId !== target.buyerId &&
      allocation.id !== anchor?.id,
  );

  for (const startAllocation of chainStarts) {
    const startOffer = input.offers.find((offer) => offer.id === startAllocation.offerId);
    const startIncumbent = workloadsById.get(startAllocation.workloadId);
    if (!startOffer || !startIncumbent) continue;
    for (const kind of ["chain", "cycle"] as const) {
      if (kind === "cycle" && (!anchor || !anchorOffer)) continue;
      const traversed = exploreGeneralPaths(
        input,
        target,
        startOffer,
        startAllocation,
        startIncumbent,
        anchor,
        anchorOffer,
        kind,
        now,
        maxDepth,
        (nodes) => {
          // The legacy one-for-one exchange already covers a two-node chain.
          if (kind === "chain" && nodes.length < 3) return;
          const candidate = buildGeneralCandidate(input, target, nodes, kind, anchor, now);
          if (candidate.proposal) candidates.push(candidate);
          else {
            rejected.push({
              strategy: "exchange",
              offer_id: startOffer.id,
              replacement_offer_id: nodes[nodes.length - 1]?.offer.id ?? null,
              violations: [...new Set(candidate.violations)],
              details: {
                conditional_kind: kind,
                depth: nodes.length,
                offer_ids: nodes.map((node) => node.offer.id),
                workload_ids: nodes.map((node) => node.tenant.id),
              },
            });
          }
        },
      );
      evaluated += traversed;
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.proposal.total_cost_minor !== b.proposal.total_cost_minor) {
      return a.proposal.total_cost_minor - b.proposal.total_cost_minor;
    }
    const aKey = `${a.proposal.strategy}:${a.proposal.required_commitments.map((c) => c.offer_id).join(",")}`;
    const bKey = `${b.proposal.strategy}:${b.proposal.required_commitments.map((c) => c.offer_id).join(",")}`;
    return aKey.localeCompare(bKey);
  });
  const best = candidates[0]?.proposal ?? null;
  return {
    status: best ? "feasible" : "no_feasible_deal",
    recommended: best,
    proposals: candidates.slice(0, 10).map((candidate) => candidate.proposal),
    rejected,
    engine: {
    name: "relay-deterministic-solver",
    version: "1.1.0",
      deterministic: true,
      evaluated_options: evaluated,
      feasible_options: candidates.length,
      generated_at: now.toISOString(),
    },
  };
}

export function solverWorkloadFromView(
  workload: {
    id: string;
    buyer_id: string;
    buyer: { name: string };
    type: string;
    gpu_model: string;
    gpu_count: number;
    cpu_cores: number;
    memory_gb: number;
    budget_minor: number;
    deadline: string | null;
    earliest_start: string | null;
    flexibility: unknown;
  },
): SolverWorkload {
  const flexibility = asRecord(workload.flexibility);
  return {
    id: workload.id,
    buyerId: workload.buyer_id,
    buyerName: workload.buyer.name,
    type: workload.type,
    gpuModel: workload.gpu_model,
    gpuCount: workload.gpu_count,
    cpuCores: workload.cpu_cores,
    memoryGb: workload.memory_gb,
    budgetMinor: workload.budget_minor,
    deadline: workload.deadline,
    earliestStart: workload.earliest_start,
    durationHours: asNumber(flexibility.duration_hours) ?? 10,
    flexibility,
  };
}
