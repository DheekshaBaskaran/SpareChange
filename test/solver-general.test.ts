import assert from "node:assert/strict";
import test from "node:test";
import {
  solve,
  type SolverAllocation,
  type SolverInput,
  type SolverOffer,
  type SolverWorkload,
} from "../src/solver/engine.js";

const HOUR = 60 * 60_000;

function at(hours: number): string {
  return new Date(Date.now() + hours * HOUR).toISOString();
}

function workload(
  id: string,
  buyerId: string,
  buyerName: string,
  overrides: Partial<SolverWorkload> & { switchCostMinor?: number; restartable?: boolean } = {},
): SolverWorkload {
  const { switchCostMinor = 0, restartable = true, ...rest } = overrides;
  return {
    id,
    buyerId,
    buyerName,
    type: "batch-inference",
    gpuModel: "H100",
    gpuCount: 8,
    cpuCores: 64,
    memoryGb: 640,
    budgetMinor: 50_000,
    deadline: at(40),
    earliestStart: at(1),
    durationHours: 10,
    flexibility: {
      duration_hours: 10,
      restartable,
      switch_cost_minor: switchCostMinor,
    },
    ...rest,
  };
}

function offer(
  id: string,
  providerId: string,
  providerName: string,
  rate: number,
  options: {
    transferable?: boolean;
    transferRate?: number;
    source?: SolverOffer["source"];
    executable?: boolean;
    authorizationStatus?: SolverOffer["authorizationStatus"];
  } = {},
): SolverOffer {
  const source = options.source ?? "worker";
  return {
    id,
    providerId,
    providerName,
    source,
    gpuModel: "H100",
    gpuCount: 8,
    cpuCores: 64,
    memoryGb: 640,
    rateMinorPerGpuHour: rate,
    currency: "USD",
    location: "us-east",
    availableFrom: at(-1),
    availableUntil: at(48),
    expiresAt: at(48),
    executable: options.executable ?? source === "worker",
    authorizationStatus:
      options.authorizationStatus ?? (source === "worker" ? "authorized" : "missing"),
    allowedWorkloads: [],
    transferable: options.transferable ?? false,
    transferRateMinorPerGpuHour: options.transferRate ?? null,
    metadata: {},
  };
}

function allocation(
  id: string,
  offerId: string,
  buyerId: string,
  buyerName: string,
  workloadId: string,
  overrides: Partial<SolverAllocation> = {},
): SolverAllocation {
  return {
    id,
    offerId,
    buyerId,
    buyerName,
    workloadId,
    gpuCount: 8,
    windowStart: at(2),
    windowEnd: at(12),
    status: "active",
    transferable: true,
    switchCostMinor: 0,
    ...overrides,
  };
}

function baseInput(): SolverInput {
  const target = workload("target", "buyer-t", "Target Buyer", {
    type: "fine-tuning",
    restartable: false,
  });
  const incumbentA = workload("incumbent-a", "buyer-a", "Buyer A", {
    switchCostMinor: 500,
  });
  const incumbentB = workload("incumbent-b", "buyer-b", "Buyer B", {
    switchCostMinor: 400,
  });
  return {
    workload: target,
    workloads: [target, incumbentA, incumbentB],
    offers: [
      offer("offer-a", "provider-a", "Provider A", 200, {
        transferable: true,
        transferRate: 220,
      }),
      offer("offer-b", "provider-b", "Provider B", 190, {
        transferable: true,
        transferRate: 210,
      }),
      offer("offer-free", "provider-free", "Provider Free", 150),
      offer("public-baseline", "market-reference", "Public Reference", 260, {
        source: "external_reference",
        executable: false,
        authorizationStatus: "missing",
      }),
    ],
    allocations: [
      allocation("allocation-a", "offer-a", "buyer-a", "Buyer A", "incumbent-a", {
        switchCostMinor: 500,
      }),
      allocation("allocation-b", "offer-b", "buyer-b", "Buyer B", "incumbent-b", {
        switchCostMinor: 400,
      }),
    ],
  };
}

test("general chain relocates two displaced workloads and reports its conditional economics", () => {
  const result = solve(baseInput());
  const chain = result.proposals.find(
    (proposal) => proposal.conditional_chain?.depth === 3,
  );
  assert.ok(chain, "expected a three-move conditional chain");
  assert.equal(chain.conditional_chain?.kind, "chain");
  assert.equal(chain.conditional_chain?.closed, false);
  assert.deepEqual(
    chain.conditional_chain?.moves.map((move) => move.buyer_id),
    ["buyer-t", "buyer-a", "buyer-b"],
  );
  assert.equal(chain.conditional_chain?.moves[0]?.from_allocation_id, null);
  assert.equal(chain.conditional_chain?.moves[1]?.from_allocation_id, "allocation-a");
  assert.equal(chain.conditional_chain?.moves[2]?.from_allocation_id, "allocation-b");
  assert.equal(chain.conditional_chain?.moves[2]?.to_allocation_id, null);
  assert.equal(chain.conditional_chain?.moves[2]?.to_offer_id, "offer-free");
  assert.equal(chain.required_commitments.length, 3);
  assert.equal(chain.proposed_transfers.length, 3);
  assert.equal(chain.parties.length, 6);
  assert.equal(chain.conditional_chain?.moves[0]?.gross_minor, 17_600);
  assert.equal(chain.conditional_chain?.moves[1]?.gross_minor, 16_800);
  assert.equal(chain.conditional_chain?.moves[2]?.gross_minor, 12_000);
  assert.equal(chain.switching_cost_minor, 900);
  assert.equal(chain.coordination_fee_minor, 1_000);
  assert.equal(chain.baseline_cost_minor, 52_000);
  assert.equal(chain.projected_savings_minor, 3_700);
  assert.ok(chain.explanation.some((line) => line.includes("chain terminates")));
});

test("a chain with uneconomic switching is rejected without hiding the direct fallback", () => {
  const input = baseInput();
  input.workloads = input.workloads.map((candidate) =>
    candidate.id === "incumbent-a"
      ? {
          ...candidate,
          flexibility: { ...candidate.flexibility, switch_cost_minor: 6_000 },
        }
      : candidate,
  );
  input.allocations = input.allocations.map((candidate) =>
    candidate.id === "allocation-a" ? { ...candidate, switchCostMinor: 6_000 } : candidate,
  );

  const result = solve(input);
  assert.equal(result.recommended?.strategy, "direct");
  assert.equal(result.recommended?.conditional_chain, undefined);
  assert.ok(
    !result.proposals.some((proposal) => proposal.conditional_chain?.kind === "chain"),
  );
  assert.ok(
    result.rejected.some(
      (option) =>
        option.details.conditional_kind === "chain" &&
        option.violations.includes("no_economic_surplus"),
    ),
  );
});

test("a closed cycle uses the target's released anchor allocation as the terminal slot", () => {
  const input = baseInput();
  const target = input.workloads[0]!;
  input.workloads[0] = {
    ...target,
    budgetMinor: 60_000,
    flexibility: { ...target.flexibility, restartable: true, switch_cost_minor: 0 },
  };
  input.offers.push(
    offer("offer-anchor", "provider-anchor", "Anchor Provider", 300, {
      transferable: true,
      transferRate: 230,
    }),
  );
  input.allocations.push(
    allocation("allocation-anchor", "offer-anchor", "buyer-t", "Target Buyer", "target", {
      switchCostMinor: 0,
    }),
  );

  const result = solve(input);
  const cycle = result.proposals.find(
    (proposal) =>
      proposal.conditional_chain?.kind === "cycle" &&
      proposal.conditional_chain.depth === 2 &&
      proposal.conditional_chain.moves[0]?.to_allocation_id === "allocation-a",
  );
  assert.ok(cycle, "expected a closed conditional cycle");
  assert.equal(cycle.conditional_chain?.closed, true);
  assert.equal(cycle.conditional_chain?.target_anchor_allocation_id, "allocation-anchor");
  assert.equal(cycle.conditional_chain?.depth, 2);
  assert.equal(cycle.conditional_chain?.moves[0]?.from_allocation_id, "allocation-anchor");
  assert.equal(cycle.conditional_chain?.moves[0]?.to_allocation_id, "allocation-a");
  assert.equal(cycle.conditional_chain?.moves[1]?.from_allocation_id, "allocation-a");
  assert.equal(cycle.conditional_chain?.moves[1]?.to_allocation_id, "allocation-anchor");
  assert.equal(cycle.baseline_cost_minor, 40_000);
  assert.equal(cycle.projected_savings_minor, 2_500);
  assert.ok(cycle.explanation.some((line) => line.includes("closing the cycle")));
});

test("a three-move closed cycle rotates every held slot through the target anchor", () => {
  const input = baseInput();
  const target = input.workloads[0]!;
  input.workloads[0] = {
    ...target,
    budgetMinor: 60_000,
    flexibility: { ...target.flexibility, restartable: true, switch_cost_minor: 0 },
  };
  input.offers.push(
    offer("offer-anchor", "provider-anchor", "Anchor Provider", 300, {
      transferable: true,
      transferRate: 230,
    }),
  );
  input.allocations.push(
    allocation("allocation-anchor", "offer-anchor", "buyer-t", "Target Buyer", "target", {
      switchCostMinor: 0,
    }),
  );

  const result = solve(input);
  const cycle = result.proposals.find(
    (proposal) =>
      proposal.conditional_chain?.kind === "cycle" &&
      proposal.conditional_chain.depth === 3,
  );
  assert.ok(cycle, "expected a three-move closed cycle");
  assert.equal(cycle.conditional_chain?.closed, true);
  assert.equal(cycle.conditional_chain?.moves.length, 3);
  assert.equal(cycle.conditional_chain?.moves[0]?.from_allocation_id, "allocation-anchor");
  assert.equal(cycle.conditional_chain?.moves[2]?.to_allocation_id, "allocation-anchor");
  assert.equal(cycle.baseline_cost_minor, 55_200);
  assert.equal(cycle.switching_cost_minor, 900);
  assert.equal(cycle.projected_savings_minor, 500);
});

test("an uneconomic closed cycle is rejected with the aggregate surplus violation", () => {
  const target = workload("target", "buyer-t", "Target Buyer", {
    budgetMinor: 100_000,
    restartable: true,
  });
  const input: SolverInput = {
    workload: target,
    workloads: [target, workload("incumbent-a", "buyer-a", "Buyer A")],
    offers: [
      offer("offer-a", "provider-a", "Provider A", 100, {
        transferable: true,
        transferRate: 300,
      }),
      offer("offer-anchor", "provider-anchor", "Anchor Provider", 100, {
        transferable: true,
        transferRate: 300,
      }),
    ],
    allocations: [
      allocation("allocation-a", "offer-a", "buyer-a", "Buyer A", "incumbent-a", {
        switchCostMinor: 0,
      }),
      allocation("allocation-anchor", "offer-anchor", "buyer-t", "Target Buyer", "target", {
        switchCostMinor: 0,
      }),
    ],
  };

  const result = solve(input);
  assert.ok(!result.proposals.some((proposal) => proposal.conditional_chain?.kind === "cycle"));
  assert.ok(
    result.rejected.some(
      (option) =>
        option.details.conditional_kind === "cycle" &&
        option.violations.includes("no_economic_surplus"),
    ),
  );
});

test("a cycle is not fabricated when the target has no anchor allocation", () => {
  const result = solve(baseInput());
  assert.ok(!result.proposals.some((proposal) => proposal.conditional_chain?.kind === "cycle"));
  assert.ok(!result.rejected.some((option) => option.details.conditional_kind === "cycle"));
});
