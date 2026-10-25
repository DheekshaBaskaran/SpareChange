// ─────────────────────────────────────────────────────────────
// MockExecutor: pretends to run the workload. No real compute happens.
// Last-resort fallback so the UI demo always works. Jobs that use it
// are marked executionMode: "mock" and the UI labels them "Simulated".
// ─────────────────────────────────────────────────────────────

import { failModeFor, type Executor } from "./types";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const mockExecutor: Executor = {
  mode: "mock",
  label: "Simulated worker",

  async isAvailable() {
    return { available: true };
  },

  async execute(job, execution, options) {
    const failMode = failModeFor(options);
    execution.workerId = "mock-worker";
    execution.logs.push("[simulated] SpareChange workload started");

    let loss = 1.42;
    for (let step = 1; step <= 6; step++) {
      await wait(600);
      if (failMode === "crash" && step === 3) {
        execution.logs.push("[simulated] ERROR worker crashed");
        execution.exitCode = 1;
        return;
      }
      if (failMode !== "no-training") loss = loss * 0.55;
      execution.progressPercent = Math.round((step / 6) * 100);
      execution.logs.push(`[simulated] PROGRESS ${execution.progressPercent} loss=${loss.toFixed(4)}`);
    }

    execution.output = {
      jobId: job.jobId,
      task: "mlp-classifier (simulated)",
      samples: 6000,
      epochs: failMode === "no-training" ? 0 : 60,
      initialLoss: 1.42,
      finalLoss: Number(loss.toFixed(4)),
      accuracy: failMode === "no-training" ? 0.27 : 0.97,
      operations: 0,
      weightsChecksum: "simulated",
    };
    execution.logs.push("[simulated] SpareChange workload completed");
    execution.exitCode = 0;
  },
};
