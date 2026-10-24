// ─────────────────────────────────────────────────────────────
// Seeded demo data. Used whenever Duo 1's live feed is not available,
// so the app never opens into an empty state during judging.
//
// The headline scenario (keep it consistent everywhere):
//   • Atlas Compute reserved 8 A100s but only uses 2 → 6 sit idle.
//   • Acme AI urgently needs 6 A100s. Market price is $3.50/GPU-hr with a ~3 day wait.
//   • Nova Cloud has cheaper replacement A100 capacity at $1.42/GPU-hr.
//   • SpareChange: Atlas releases 6 A100s to Acme at $2.10/GPU-hr,
//     and Nova backfills Atlas's reservation for later.
// ─────────────────────────────────────────────────────────────

import type { Deal, GpuListing } from "./types";

const MARKET_A100_PRICE = 3.5;
const DEAL_A100_PRICE = 2.1;
const NOVA_A100_PRICE = 1.42;
const HEADLINE_GPUS = 6;
const HEADLINE_HOURS = 1;

const round2 = (value: number) => Math.round(value * 100) / 100;

export const DEMO_LISTINGS: GpuListing[] = [
  {
    id: "lst_atlas_a100",
    providerName: "Atlas Compute",
    gpuModel: "NVIDIA A100 80GB",
    gpusAvailable: 6,
    gpusTotal: 8,
    region: "US West · San Jose",
    pricePerGpuHour: DEAL_A100_PRICE,
    utilizationPercent: 25,
    availability: "available",
    listingType: "reserved-resale",
  },
  {
    id: "lst_nova_a100",
    providerName: "Nova Cloud",
    gpuModel: "NVIDIA A100 80GB",
    gpusAvailable: 12,
    gpusTotal: 32,
    region: "US West · Portland",
    pricePerGpuHour: NOVA_A100_PRICE,
    utilizationPercent: 62,
    availability: "available",
    listingType: "on-demand",
  },
  {
    id: "lst_kestrel_a100",
    providerName: "Kestrel Compute",
    gpuModel: "NVIDIA A100 80GB",
    gpusAvailable: 2,
    gpusTotal: 64,
    region: "US East · Ashburn",
    pricePerGpuHour: MARKET_A100_PRICE,
    utilizationPercent: 97,
    availability: "limited",
    listingType: "spot",
  },
  {
    id: "lst_ridgeline_h100",
    providerName: "Ridgeline Compute",
    gpuModel: "NVIDIA H100 SXM",
    gpusAvailable: 2,
    gpusTotal: 16,
    region: "US Central · Dallas",
    pricePerGpuHour: 2.85,
    utilizationPercent: 81,
    availability: "limited",
    listingType: "reserved-resale",
  },
  {
    id: "lst_vantage_h100",
    providerName: "Vantage AI Cloud",
    gpuModel: "NVIDIA H100 SXM",
    gpusAvailable: 0,
    gpusTotal: 48,
    region: "EU Central · Frankfurt",
    pricePerGpuHour: 3.4,
    utilizationPercent: 100,
    availability: "reserved",
    listingType: "on-demand",
  },
  {
    id: "lst_meridian_h200",
    providerName: "Meridian HPC",
    gpuModel: "NVIDIA H200",
    gpusAvailable: 4,
    gpusTotal: 24,
    region: "US West · Seattle",
    pricePerGpuHour: 4.2,
    utilizationPercent: 71,
    availability: "available",
    listingType: "on-demand",
  },
  {
    id: "lst_cirrus_l40s",
    providerName: "Cirrus GPU",
    gpuModel: "NVIDIA L40S",
    gpusAvailable: 16,
    gpusTotal: 40,
    region: "US East · Ashburn",
    pricePerGpuHour: 0.92,
    utilizationPercent: 54,
    availability: "available",
    listingType: "spot",
  },
  {
    id: "lst_tessera_a10g",
    providerName: "Tessera Cloud",
    gpuModel: "NVIDIA A10G",
    gpusAvailable: 24,
    gpusTotal: 40,
    region: "US Central · Chicago",
    pricePerGpuHour: 0.55,
    utilizationPercent: 38,
    availability: "available",
    listingType: "on-demand",
  },
];

/** The headline multi-party deal used in the demo. */
export const DEMO_MULTI_PARTY_DEAL: Deal = {
  dealId: "deal_7f3a21",
  type: "multi_party",
  title: "Idle A100 reservation → urgent fine-tuning run",
  buyer: {
    id: "acme_ai",
    name: "Acme AI",
    role: "buyer",
    region: "US West",
    situation: "Needs 6 A100s now for a fine-tuning run. Market wait is ~3 days.",
  },
  provider: {
    id: "atlas_compute",
    name: "Atlas Compute",
    role: "capacity_holder",
    region: "US West · San Jose",
    situation: "Reserved 8 A100s but is only using 2. Paying for 6 idle GPUs.",
  },
  replacementProvider: {
    id: "nova_cloud",
    name: "Nova Cloud",
    role: "replacement_provider",
    region: "US West · Portland",
    situation: "Has unsold A100 capacity at a lower rate.",
  },
  workload: {
    gpuModel: "NVIDIA A100 80GB",
    gpuCount: HEADLINE_GPUS,
    durationMinutes: HEADLINE_HOURS * 60,
    region: "US West",
    description: "Fine-tuning job · verification workload",
  },
  price: {
    amount: round2(DEAL_A100_PRICE * HEADLINE_GPUS * HEADLINE_HOURS),
    currency: "USDC",
  },
  flows: [
    {
      from: "atlas_compute",
      to: "acme_ai",
      kind: "compute",
      label: "6× A100 released",
      gpuCount: HEADLINE_GPUS,
    },
    {
      from: "nova_cloud",
      to: "atlas_compute",
      kind: "compute",
      label: "6× A100 backfill",
      gpuCount: HEADLINE_GPUS,
    },
    {
      from: "acme_ai",
      to: "atlas_compute",
      kind: "payment",
      label: `$${DEAL_A100_PRICE.toFixed(2)}/GPU-hr`,
      amount: round2(DEAL_A100_PRICE * HEADLINE_GPUS),
    },
    {
      from: "atlas_compute",
      to: "nova_cloud",
      kind: "payment",
      label: `$${NOVA_A100_PRICE.toFixed(2)}/GPU-hr`,
      amount: round2(NOVA_A100_PRICE * HEADLINE_GPUS),
    },
  ],
  impact: {
    marketPricePerGpuHour: MARKET_A100_PRICE,
    dealPricePerGpuHour: DEAL_A100_PRICE,
    replacementPricePerGpuHour: NOVA_A100_PRICE,
    buyerSavingsPerHour: round2((MARKET_A100_PRICE - DEAL_A100_PRICE) * HEADLINE_GPUS),
    providerNetGainPerHour: round2((DEAL_A100_PRICE - NOVA_A100_PRICE) * HEADLINE_GPUS),
    idleGpusReused: HEADLINE_GPUS,
    utilizationBeforePercent: 25,
    utilizationAfterPercent: 100,
    timeToComputeMinutes: 2,
    marketWaitMinutes: 3 * 24 * 60,
  },
  approvedAt: "2026-10-24T17:42:00.000Z",
  source: "mock",
};

/** A simpler two-party deal, to show SpareChange also handles plain resale. */
export const DEMO_DIRECT_DEAL: Deal = {
  dealId: "deal_4c19e8",
  type: "direct",
  title: "Unused H100 reservation → inference burst",
  buyer: {
    id: "lumen_robotics",
    name: "Lumen Robotics",
    role: "buyer",
    region: "US Central",
    situation: "Needs 2 H100s for a 30 minute evaluation burst.",
  },
  provider: {
    id: "ridgeline_compute",
    name: "Ridgeline Compute",
    role: "capacity_holder",
    region: "US Central · Dallas",
    situation: "Has 2 reserved H100s idle this afternoon.",
  },
  workload: {
    gpuModel: "NVIDIA H100 SXM",
    gpuCount: 2,
    durationMinutes: 30,
    region: "US Central",
    description: "Model evaluation · verification workload",
  },
  price: { amount: round2(2.85 * 2 * 0.5), currency: "USDC" },
  flows: [
    { from: "ridgeline_compute", to: "lumen_robotics", kind: "compute", label: "2× H100 released", gpuCount: 2 },
    { from: "lumen_robotics", to: "ridgeline_compute", kind: "payment", label: "$2.85/GPU-hr", amount: 5.7 },
  ],
  impact: {
    marketPricePerGpuHour: 3.4,
    dealPricePerGpuHour: 2.85,
    buyerSavingsPerHour: round2((3.4 - 2.85) * 2),
    providerNetGainPerHour: 5.7,
    idleGpusReused: 2,
    utilizationBeforePercent: 81,
    utilizationAfterPercent: 94,
    timeToComputeMinutes: 2,
    marketWaitMinutes: 18 * 60,
  },
  approvedAt: "2026-10-24T17:10:00.000Z",
  source: "mock",
};

export const DEMO_DEALS: Deal[] = [DEMO_MULTI_PARTY_DEAL, DEMO_DIRECT_DEAL];

/** A finished deal from earlier, shown in the history list (static demo record). */
export const DEMO_HISTORY = [
  {
    dealId: "deal_1b77d0",
    title: "Idle L40S block → batch embedding job",
    buyer: "Orbit Labs",
    provider: "Cirrus GPU",
    gpuModel: "NVIDIA L40S",
    gpuCount: 4,
    amount: 7.36,
    currency: "USDC",
    savings: 3.12,
    completedAt: "2026-10-23T22:15:00.000Z",
    status: "COMPLETE" as const,
  },
];
