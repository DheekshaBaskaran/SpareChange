// ─────────────────────────────────────────────────────────────
// RemoteExecutor: sends the workload to an already-running remote
// worker (worker/server.mjs on another machine, e.g. a Vultr VM)
// and polls it for logs until the workload finishes.
//
// Remote worker API (see worker/server.mjs):
//   GET  /health          → { ok: true, workerId }
//   POST /runs            → { runId, workerId }
//   GET  /runs/:runId     → { status, logs, exitCode, containerId, ... }
// ─────────────────────────────────────────────────────────────

import { getConfig } from "../config";
import { failModeFor, type Executor } from "./types";
import { handleWorkerLine } from "./worker-output";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function remoteHeaders(): Record<string, string> {
  const { remoteWorkerToken } = getConfig();
  return {
    "Content-Type": "application/json",
    ...(remoteWorkerToken ? { Authorization: `Bearer ${remoteWorkerToken}` } : {}),
  };
}

interface RemoteRun {
  status: "running" | "finished";
  workerId: string;
  executionMode: "docker" | "process";
  containerId?: string;
  logs: string[];
  exitCode?: number;
}

export const remoteExecutor: Executor = {
  mode: "remote",
  label: "Remote GPU worker",

  async isAvailable() {
    const { remoteWorkerUrl } = getConfig();
    if (!remoteWorkerUrl) return { available: false, reason: "REMOTE_WORKER_URL is not set" };
    try {
      const response = await fetch(`${remoteWorkerUrl}/health`, {
        headers: remoteHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      return response.ok ? { available: true } : { available: false, reason: `Remote worker returned ${response.status}` };
    } catch {
      return { available: false, reason: "Could not reach the remote worker" };
    }
  },

  async execute(job, execution, options) {
    const { remoteWorkerUrl, workloadSeconds } = getConfig();
    const start = await fetch(`${remoteWorkerUrl}/runs`, {
      method: "POST",
      headers: remoteHeaders(),
      body: JSON.stringify({ jobId: job.jobId, workloadSeconds, failMode: failModeFor(options) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!start.ok) throw new Error(`Remote worker refused the job (${start.status})`);
    const { runId, workerId } = (await start.json()) as { runId: string; workerId: string };
    execution.workerId = workerId;

    let linesSeen = 0;
    let consecutiveErrors = 0;
    const deadline = Date.now() + (workloadSeconds + 120) * 1000;

    while (Date.now() < deadline) {
      await wait(700);
      let run: RemoteRun;
      try {
        const response = await fetch(`${remoteWorkerUrl}/runs/${runId}`, {
          headers: remoteHeaders(),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(String(response.status));
        run = (await response.json()) as RemoteRun;
        consecutiveErrors = 0;
      } catch {
        if (++consecutiveErrors >= 5) throw new Error("Lost contact with the remote worker");
        continue;
      }

      if (run.containerId) execution.containerId = run.containerId;
      for (const line of run.logs.slice(linesSeen)) handleWorkerLine(line, execution);
      linesSeen = run.logs.length;

      if (run.status === "finished") {
        execution.exitCode = run.exitCode ?? 1;
        return;
      }
    }
    throw new Error("Remote worker timed out");
  },
};
