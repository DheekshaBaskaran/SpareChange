// ─────────────────────────────────────────────────────────────
// The Executor abstraction.
//
// The job runner only ever calls:
//     executor.isAvailable()
//     executor.execute(job, execution)
// It never needs to know whether the workload runs in Docker,
// as a local process, on a remote machine, or is simulated.
// ─────────────────────────────────────────────────────────────

import type { ExecutionMode, ExecutionResult, ExecuteOptions, Job } from "../../types";

export interface Availability {
  available: boolean;
  /** Short explanation when not available, e.g. "Docker is not installed". */
  reason?: string;
}

export interface Executor {
  mode: ExecutionMode;
  /** Human-friendly label shown in the UI. */
  label: string;
  /** Quick check: can this executor run a workload right now? Also does any setup (e.g. building the image). */
  isAvailable(): Promise<Availability>;
  /**
   * Run the workload for this job. Update `execution` in place as logs and
   * progress arrive (the UI polls the job and sees the changes live).
   * Resolve when the workload has exited; set execution.exitCode.
   * Throw only for infrastructure problems (e.g. the remote worker is unreachable).
   */
  execute(job: Job, execution: ExecutionResult, options: ExecuteOptions): Promise<void>;
}

/** Translate the debug "simulate failure" option into the worker's FAIL_MODE variable. */
export function failModeFor(options: ExecuteOptions): string {
  if (options.simulateFailure === "workload") return "crash";
  if (options.simulateFailure === "verification") return "no-training";
  return "";
}
