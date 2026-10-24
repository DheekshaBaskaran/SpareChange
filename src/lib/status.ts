// How each job status is described and colored in the UI.

import type { ExecutionMode, JobStatus, PaymentMode } from "./types";

/** The happy-path order of the lifecycle (FAILED can happen at any step). */
export const LIFECYCLE: Exclude<JobStatus, "FAILED">[] = [
  "APPROVED",
  "PROVISIONING",
  "RUNNING",
  "VERIFYING",
  "PAYMENT_PENDING",
  "COMPLETE",
];

export const STATUS_META: Record<JobStatus, { label: string; stepTitle: string; stepDetail: string; tone: Tone }> = {
  APPROVED: { label: "Approved", stepTitle: "Deal approved", stepDetail: "Terms agreed by all parties", tone: "neutral" },
  PROVISIONING: { label: "Provisioning", stepTitle: "Compute provisioned", stepDetail: "Worker selected and prepared", tone: "compute" },
  RUNNING: { label: "Running", stepTitle: "Workload running", stepDetail: "Job executing on released capacity", tone: "compute" },
  VERIFYING: { label: "Verifying", stepTitle: "Execution verified", stepDetail: "Output checked before any payment", tone: "compute" },
  PAYMENT_PENDING: { label: "Settling", stepTitle: "Payment settled", stepDetail: "Funds released to each participant", tone: "pending" },
  COMPLETE: { label: "Complete", stepTitle: "Deal complete", stepDetail: "Everyone received their outcome", tone: "value" },
  FAILED: { label: "Failed", stepTitle: "Failed", stepDetail: "", tone: "danger" },
};

export type Tone = "neutral" | "compute" | "pending" | "value" | "danger";

export const TONE_CLASSES: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  neutral: { text: "text-ink-2", bg: "bg-surface-3", border: "border-line-strong", dot: "bg-muted" },
  compute: { text: "text-compute", bg: "bg-compute/10", border: "border-compute/30", dot: "bg-compute" },
  pending: { text: "text-pending", bg: "bg-pending/10", border: "border-pending/30", dot: "bg-pending" },
  value: { text: "text-value", bg: "bg-value/10", border: "border-value/30", dot: "bg-value" },
  danger: { text: "text-danger", bg: "bg-danger/10", border: "border-danger/30", dot: "bg-danger" },
};

export const EXECUTION_MODE_LABEL: Record<ExecutionMode, { label: string; real: boolean }> = {
  remote: { label: "Remote worker", real: true },
  "local-docker": { label: "Docker container", real: true },
  "local-process": { label: "Local worker process", real: true },
  mock: { label: "Simulated", real: false },
};

export const PAYMENT_MODE_LABEL: Record<PaymentMode, { label: string; real: boolean }> = {
  x402: { label: "x402 · on-chain", real: true },
  mock: { label: "Mock settlement", real: false },
};

/** Position of a status in the lifecycle (FAILED uses the step it failed at). */
export function lifecycleIndex(status: JobStatus, failedAt?: JobStatus): number {
  if (status === "FAILED") return failedAt ? LIFECYCLE.indexOf(failedAt as (typeof LIFECYCLE)[number]) : 0;
  return LIFECYCLE.indexOf(status);
}
