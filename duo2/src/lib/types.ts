// ─────────────────────────────────────────────────────────────
// SpareChange core data model.
// These types are shared by the API, the job engine and the UI.
// docs/API_CONTRACT.md documents the parts Duo 1 needs to know.
// ─────────────────────────────────────────────────────────────

/** Every job moves through these states, in this order (or jumps to FAILED). */
export const JOB_STATUSES = [
  "APPROVED",
  "PROVISIONING",
  "RUNNING",
  "VERIFYING",
  "PAYMENT_PENDING",
  "COMPLETE",
  "FAILED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Where a piece of data or an action actually came from. Used to stay honest in the demo. */
export type MarketDataMode = "mock" | "duo1-live";
export type ExecutionMode = "mock" | "local-process" | "local-docker" | "remote";
export type PaymentMode = "mock" | "x402";

// ── Marketplace ──────────────────────────────────────────────

export interface GpuListing {
  id: string;
  providerName: string;
  gpuModel: string;
  gpusAvailable: number;
  gpusTotal: number;
  region: string;
  pricePerGpuHour: number; // USD
  utilizationPercent: number; // 0-100, how busy the provider's fleet is
  availability: "available" | "limited" | "reserved";
  listingType: "spot" | "reserved-resale" | "on-demand";
}

// ── Deals (what Duo 1 sends us) ──────────────────────────────

export type ParticipantRole =
  | "buyer" // receives compute, pays money
  | "capacity_holder" // releases capacity it already reserved
  | "replacement_provider"; // backfills the capacity holder with cheaper compute

export interface Participant {
  id: string;
  name: string;
  role?: ParticipantRole;
  region?: string;
  /** One short sentence describing this party's situation. */
  situation?: string;
}

export interface Workload {
  gpuModel: string;
  gpuCount: number;
  durationMinutes: number;
  region?: string;
  /** Free-text description of the job the buyer wants to run. */
  description?: string;
}

export interface Price {
  amount: number;
  currency: "USDC" | "USD";
}

/** One arrow in the deal graph: compute or money moving between two parties. */
export interface DealFlow {
  from: string; // participant id
  to: string; // participant id
  kind: "compute" | "payment";
  label: string;
  gpuCount?: number;
  amount?: number; // per hour, USD
}

/** The numbers that explain why the deal is worth doing. All optional. */
export interface DealImpact {
  marketPricePerGpuHour?: number; // what the buyer would pay elsewhere
  dealPricePerGpuHour?: number; // what the buyer pays through SpareChange
  replacementPricePerGpuHour?: number; // what the capacity holder pays for backfill
  buyerSavingsPerHour?: number;
  providerNetGainPerHour?: number;
  idleGpusReused?: number;
  utilizationBeforePercent?: number;
  utilizationAfterPercent?: number;
  timeToComputeMinutes?: number;
  marketWaitMinutes?: number; // how long the buyer would otherwise wait
}

/**
 * Link to the Relay (Duo 1) record this deal came from. Present only when the
 * deal was cleared by Duo 1; demo deals have no Relay linkage.
 */
export interface RelayLink {
  dealId: string;
  authorizationId?: string;
  contractId?: string;
}

/** What Duo 2 reported back to Relay after real, verified compute. */
export interface RelayUsageReport {
  authorizationId: string;
  contractId: string;
  usageId: string;
  invoiceId?: string;
  amountMinor?: number;
  reportedAt: string;
  error?: string;
}

export interface Deal {
  dealId: string;
  /** "direct" = one buyer, one provider. "multi_party" = includes a replacement provider. */
  type?: "direct" | "multi_party";
  title?: string;
  buyer: Participant;
  provider: Participant; // the party whose compute the buyer receives
  replacementProvider?: Participant;
  workload: Workload;
  price: Price; // total amount the buyer pays for this deal
  flows?: DealFlow[];
  impact?: DealImpact;
  approvedAt?: string;
  /** Where the deal came from. Duo 1 does not need to set this. */
  source?: MarketDataMode;
  /** Relay (Duo 1) linkage. When present, execution feeds Relay's finance flow. */
  relay?: RelayLink;
}

// ── Jobs (what Duo 2 creates when a deal is executed) ────────

export interface ExecutionResult {
  executionMode: ExecutionMode;
  workerId: string;
  containerId?: string;
  image?: string;
  startedAt: string;
  endedAt?: string;
  runtimeMs?: number;
  exitCode?: number;
  /** Lines printed by the workload. Trimmed to keep the payload small. */
  logs: string[];
  progressPercent: number;
  /** Parsed JSON the workload prints as its final result. */
  output?: WorkloadOutput;
}

/** What the SpareChange worker prints on its final RESULT line. */
export interface WorkloadOutput {
  jobId: string;
  task: string;
  samples: number;
  epochs: number;
  initialLoss: number;
  finalLoss: number;
  accuracy: number;
  operations: number;
  weightsChecksum: string;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerificationResult {
  status: "VERIFIED" | "REJECTED";
  checks: VerificationCheck[];
  verifiedAt: string;
}

export interface SettlementLeg {
  from: string;
  to: string;
  amount: number;
  currency: string;
  mode: PaymentMode;
  status: "SUCCESS" | "FAILED";
  transactionId: string;
  explorerUrl?: string;
  /** For x402 legs: the (scaled-down testnet) amount that actually moved on-chain, e.g. "0.01 USDC". */
  onChainAmount?: string;
}

export interface PaymentResult {
  status: "SUCCESS" | "FAILED";
  paymentMode: PaymentMode;
  transactionId: string;
  amount: number;
  currency: string;
  timestamp: string;
  /** For x402: the chain the payment settled on, e.g. "eip155:84532" (Base Sepolia). */
  network?: string;
  explorerUrl?: string;
  /** For x402 test settlements the on-chain amount can be smaller than the deal amount. */
  settledOnChainAmount?: string;
  payer?: string;
  /** Each payment between parties in the deal. */
  legs: SettlementLeg[];
  /** Step-by-step trace of the x402 handshake, shown in the UI. */
  steps: string[];
  /** Plain-English notes, e.g. when one leg had to fall back to mock. */
  notes?: string[];
}

export interface TimelineEntry {
  status: JobStatus;
  at: string;
  note?: string;
}

export interface JobFailure {
  step: JobStatus; // which step failed
  message: string; // short, human-readable
}

export interface Job {
  jobId: string;
  dealId: string;
  deal: Deal;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  executionMode: ExecutionMode;
  paymentMode: PaymentMode;
  /** Plain-English notes whenever SpareChange fell back to a simpler mode. */
  fallbackNotes: string[];
  timeline: TimelineEntry[];
  execution?: ExecutionResult;
  verification?: VerificationResult;
  payment?: PaymentResult;
  failure?: JobFailure;
  /** Relay linkage and the verified usage Duo 2 reported for this job. */
  relay?: RelayUsageReport;
}

/** Optional knobs for testing failure paths from the debug panel. */
export interface ExecuteOptions {
  simulateFailure?: "workload" | "verification" | "payment";
}
