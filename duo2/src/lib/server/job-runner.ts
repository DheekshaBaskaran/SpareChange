// ─────────────────────────────────────────────────────────────
// The Job Manager. Moves a job through its lifecycle:
//
//   APPROVED → PROVISIONING → RUNNING → VERIFYING → PAYMENT_PENDING → COMPLETE
//                     (any step can go to FAILED)
//
// createJob() is called by POST /api/deals/execute. It returns right
// away; the lifecycle continues in the background and the UI polls
// GET /api/jobs/[id] to watch it progress.
// ─────────────────────────────────────────────────────────────

import type { Deal, ExecuteOptions, ExecutionResult, Job, JobStatus } from "../types";
import { getConfig } from "./config";
import { chooseExecutor } from "./executors";
import { saveJob, setJobStatus } from "./job-store";
import { settlePayment } from "./payments";
import { randomId } from "./payments/types";
import { ensureAuthorization, relayConfigured, reportUsage } from "./relay";
import { verifyExecution } from "./verification";

/** Small pauses so each step is visible in the UI, without slowing the demo down. */
const MIN_PROVISIONING_MS = 1500;
const MIN_VERIFYING_MS = 1400;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run `work`, but take at least `minimumMs` so the step is visible on screen. */
async function atLeast<T>(minimumMs: number, work: Promise<T>): Promise<T> {
  const [result] = await Promise.all([work, wait(minimumMs)]);
  return result;
}

class StepError extends Error {
  constructor(public step: JobStatus, message: string) {
    super(message);
  }
}

export function createJob(deal: Deal, options: ExecuteOptions = {}): Job {
  const now = new Date().toISOString();
  const config = getConfig();
  const job: Job = {
    jobId: randomId("job_", 10),
    dealId: deal.dealId,
    deal,
    status: "APPROVED",
    createdAt: now,
    // Planned modes; updated to what actually happened once each step runs.
    executionMode: config.executionMode === "auto" ? "local-process" : config.executionMode,
    paymentMode: config.paymentMode,
    fallbackNotes: [],
    timeline: [{ status: "APPROVED", at: now, note: "Approved deal received" }],
  };
  saveJob(job);
  setJobStatus(job, "PROVISIONING", "Selecting a worker and preparing the environment");

  // Start the lifecycle in the background. Errors are handled inside.
  void runJob(job, options);
  return job;
}

async function runJob(job: Job, options: ExecuteOptions): Promise<void> {
  try {
    // ── PROVISIONING ─────────────────────────────
    // A Relay deal must be authorized before a single GPU-second runs: Relay
    // creates the contract here, and no usage can be reported without it.
    if (job.deal.relay && relayConfigured()) {
      try {
        const authorization = await ensureAuthorization(job.deal.relay.dealId);
        const contractId = job.deal.relay.contractId ?? authorization.contracts[0]?.id;
        if (!contractId) throw new Error("Relay authorization returned no contract");
        job.deal.relay = {
          dealId: job.deal.relay.dealId,
          authorizationId: authorization.id,
          contractId,
        };
        job.fallbackNotes.push(`Relay contract ${contractId.slice(0, 8)} authorized before execution`);
      } catch (error) {
        throw new StepError("PROVISIONING", `Relay would not authorize execution: ${(error as Error).message}`);
      }
    }

    const { executor, fallbackNotes } = await atLeast(MIN_PROVISIONING_MS, chooseExecutor());
    job.executionMode = executor.mode;
    job.fallbackNotes.push(...fallbackNotes);

    // ── RUNNING ──────────────────────────────────
    const execution: ExecutionResult = {
      executionMode: executor.mode,
      workerId: "pending",
      startedAt: new Date().toISOString(),
      logs: [],
      progressPercent: 0,
    };
    job.execution = execution;
    job.startedAt = execution.startedAt;
    setJobStatus(job, "RUNNING", `Workload started on ${executor.label}`);

    try {
      await executor.execute(job, execution, options);
    } catch (error) {
      console.error(`[job ${job.jobId}] executor error:`, error);
      throw new StepError("RUNNING", `Could not run the workload: ${(error as Error).message}`);
    } finally {
      execution.endedAt = new Date().toISOString();
      execution.runtimeMs = Date.parse(execution.endedAt) - Date.parse(execution.startedAt);
    }
    if (execution.exitCode !== 0) {
      // Include the worker's own error line (if it printed one) so the reason is clear.
      const errorLine = [...execution.logs].reverse().find((line) => line.includes("ERROR"));
      const reason = errorLine ? errorLine.replace(/^.*ERROR\s*/, "") : "Check the worker logs.";
      throw new StepError("RUNNING", `The workload exited with code ${execution.exitCode}: ${reason}`);
    }

    // ── VERIFYING ────────────────────────────────
    setJobStatus(job, "VERIFYING", "Checking the workload output");
    const verification = await atLeast(MIN_VERIFYING_MS, Promise.resolve(verifyExecution(job)));
    job.verification = verification;
    if (verification.status !== "VERIFIED") {
      const failed = verification.checks.filter((check) => !check.passed).map((check) => check.name);
      throw new StepError("VERIFYING", `Verification rejected the result: ${failed.join(", ")}. No payment was made.`);
    }

    // ── RELAY USAGE ──────────────────────────────
    // Only measured, verified compute is reported. Relay prices the invoice
    // from this record; Duo 2 never issues or approves one.
    if (job.deal.relay && relayConfigured()) {
      setJobStatus(job, "PAYMENT_PENDING", "Reporting verified usage to Relay");
      const link = job.deal.relay;
      const gpuSeconds = Math.round(
        job.deal.workload.gpuCount * job.deal.workload.durationMinutes * 60,
      );
      try {
        const usage = await reportUsage({
          contractId: link.contractId!,
          authorizationId: link.authorizationId!,
          gpuSeconds,
          startedAt: job.execution!.startedAt,
          endedAt: job.execution!.endedAt ?? new Date().toISOString(),
          jobId: job.jobId,
          workerId: job.execution!.workerId,
          proofReference: `duo2:${job.jobId}:${job.execution!.output?.weightsChecksum ?? "no-checksum"}`,
          evidence: {
            execution_mode: job.execution!.executionMode,
            workload_runtime_ms: job.execution!.runtimeMs,
            verification: job.verification?.status,
            accuracy: job.execution!.output?.accuracy,
            billing_basis: "reserved_contract_window",
            measured_gpu_seconds: Math.round((job.execution!.runtimeMs ?? 0) / 1000) * job.deal.workload.gpuCount,
          },
        });
        job.relay = {
          authorizationId: link.authorizationId!,
          contractId: link.contractId!,
          usageId: usage.id,
          amountMinor: usage.billing?.amount_minor ?? usage.amount_minor,
          reportedAt: new Date().toISOString(),
        };
        setJobStatus(
          job,
          "PAYMENT_PENDING",
          "Verified usage reported to Relay — waiting for the approved payment instruction",
        );
      } catch (error) {
        job.relay = {
          authorizationId: link.authorizationId!,
          contractId: link.contractId!,
          usageId: "",
          reportedAt: new Date().toISOString(),
          error: (error as Error).message,
        };
        throw new StepError(
          "PAYMENT_PENDING",
          `Verified compute ran, but Relay rejected the usage report (${(error as Error).message}). No payment was authorized.`,
        );
      }
      return;
    }

    // ── PAYMENT_PENDING ──────────────────────────
    setJobStatus(job, "PAYMENT_PENDING", "Settling payment between participants");
    try {
      const { result, fallbackNote } = await settlePayment(job, options);
      job.payment = result;
      job.paymentMode = result.paymentMode;
      if (fallbackNote) job.fallbackNotes.push(fallbackNote);
    } catch (error) {
      console.error(`[job ${job.jobId}] payment error:`, error);
      throw new StepError("PAYMENT_PENDING", (error as Error).message);
    }

    // ── COMPLETE ─────────────────────────────────
    job.completedAt = new Date().toISOString();
    setJobStatus(job, "COMPLETE", "Compute delivered, verified and paid");
  } catch (error) {
    const step = error instanceof StepError ? error.step : job.status;
    const message = error instanceof StepError ? error.message : "Unexpected error. See server logs.";
    if (!(error instanceof StepError)) console.error(`[job ${job.jobId}] unexpected error:`, error);
    job.failure = { step, message };
    job.completedAt = new Date().toISOString();
    setJobStatus(job, "FAILED", message);
  }
}
