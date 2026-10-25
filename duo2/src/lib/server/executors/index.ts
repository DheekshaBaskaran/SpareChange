// ─────────────────────────────────────────────────────────────
// Picks which executor runs a job, following the fallback chain:
//
//     remote → local-docker → local-process → mock
//
// EXECUTION_MODE chooses where in the chain to start
// ("auto" starts at remote). If an executor is unavailable,
// we move to the next one and write down why.
// ─────────────────────────────────────────────────────────────

import { getConfig } from "../config";
import { localDockerExecutor } from "./local-docker";
import { localProcessExecutor } from "./local-process";
import { mockExecutor } from "./mock";
import { remoteExecutor } from "./remote";
import type { Executor } from "./types";

const FALLBACK_CHAIN: Executor[] = [remoteExecutor, localDockerExecutor, localProcessExecutor, mockExecutor];

export interface ExecutorChoice {
  executor: Executor;
  fallbackNotes: string[];
}

export async function chooseExecutor(): Promise<ExecutorChoice> {
  const { executionMode } = getConfig();
  const startIndex =
    executionMode === "auto" ? 0 : Math.max(0, FALLBACK_CHAIN.findIndex((executor) => executor.mode === executionMode));

  const fallbackNotes: string[] = [];
  for (const executor of FALLBACK_CHAIN.slice(startIndex)) {
    const availability = await executor.isAvailable();
    if (availability.available) return { executor, fallbackNotes };
    // In "auto" mode a missing REMOTE_WORKER_URL just means "no remote worker configured" — not worth a note.
    if (!(executionMode === "auto" && executor.mode === "remote" && !getConfig().remoteWorkerUrl)) {
      fallbackNotes.push(`${executor.label} unavailable (${availability.reason}), falling back`);
    }
  }
  return { executor: mockExecutor, fallbackNotes };
}

/** Status of every executor, for the System panel in the UI. */
export async function describeExecutors() {
  return Promise.all(
    FALLBACK_CHAIN.map(async (executor) => ({
      mode: executor.mode,
      label: executor.label,
      ...(await executor.isAvailable()),
    })),
  );
}
