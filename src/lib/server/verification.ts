// ─────────────────────────────────────────────────────────────
// verifyExecution(job): decides whether the compute the provider
// delivered is good enough to pay for. Payment only happens if
// every check passes.
// ─────────────────────────────────────────────────────────────

import type { Job, VerificationCheck, VerificationResult } from "../types";

const MIN_ACCURACY = 0.85;

export function verifyExecution(job: Job): VerificationResult {
  const execution = job.execution;
  const output = execution?.output;
  const logs = execution?.logs ?? [];

  const checks: VerificationCheck[] = [
    {
      name: "Worker exited cleanly",
      passed: execution?.exitCode === 0,
      detail: `exit code ${execution?.exitCode ?? "missing"}`,
    },
    {
      name: "Start and completion markers in logs",
      passed:
        logs.some((line) => line.includes("SpareChange workload started")) &&
        logs.some((line) => line.includes("SpareChange workload completed")),
      detail: `${logs.length} log lines captured`,
    },
    {
      name: "Result belongs to this job",
      passed: output?.jobId === job.jobId,
      detail: output ? `result.jobId = ${output.jobId}` : "no result produced",
    },
    {
      name: "Model actually trained",
      passed: !!output && output.epochs > 0 && output.finalLoss < output.initialLoss * 0.5,
      detail: output ? `loss ${output.initialLoss} → ${output.finalLoss} over ${output.epochs} epochs` : "no result",
    },
    {
      name: `Accuracy ≥ ${MIN_ACCURACY * 100}%`,
      passed: !!output && output.accuracy >= MIN_ACCURACY,
      detail: output ? `${(output.accuracy * 100).toFixed(1)}% on held-out data` : "no result",
    },
  ];

  return {
    status: checks.every((check) => check.passed) ? "VERIFIED" : "REJECTED",
    checks,
    verifiedAt: new Date().toISOString(),
  };
}
