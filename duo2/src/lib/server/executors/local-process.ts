// ─────────────────────────────────────────────────────────────
// LocalProcessExecutor: runs the real worker script (worker/workload.mjs)
// as a child Node.js process on this machine. No container isolation,
// but the computation is completely real. Used when Docker is not available.
// ─────────────────────────────────────────────────────────────

import path from "node:path";
import { getConfig } from "../config";
import { failModeFor, type Executor } from "./types";
import { handleWorkerLine, runCommand } from "./worker-output";

const WORKER_SCRIPT = path.join(process.cwd(), "worker", "workload.mjs");

export const localProcessExecutor: Executor = {
  mode: "local-process",
  label: "Local worker process",

  async isAvailable() {
    return { available: true };
  },

  async execute(job, execution, options) {
    const { workloadSeconds } = getConfig();
    execution.workerId = "local-worker-01";
    execution.containerId = undefined;

    execution.exitCode = await runCommand(process.execPath, [WORKER_SCRIPT], {
      env: {
        JOB_ID: job.jobId,
        WORKLOAD_SECONDS: String(workloadSeconds),
        FAIL_MODE: failModeFor(options),
      },
      onLine: (line) => handleWorkerLine(line, execution),
      timeoutMs: (workloadSeconds + 60) * 1000,
    });
  },
};
