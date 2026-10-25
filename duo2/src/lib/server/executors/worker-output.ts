// ─────────────────────────────────────────────────────────────
// Helpers shared by the executors that run the real worker
// (local-process and local-docker): spawning a command and parsing
// the worker's output lines into the ExecutionResult.
// ─────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import type { ExecutionResult, WorkloadOutput } from "../../types";

const MAX_LOG_LINES = 120;

/** Read one line of worker output and update the execution record. */
export function handleWorkerLine(line: string, execution: ExecutionResult): void {
  const text = line.trimEnd();
  if (!text) return;

  if (text.startsWith("RESULT ")) {
    try {
      execution.output = JSON.parse(text.slice("RESULT ".length)) as WorkloadOutput;
    } catch {
      execution.logs.push("[sparechange] could not parse RESULT line");
    }
  }

  const progressMatch = text.match(/^PROGRESS (\d+)/);
  if (progressMatch) execution.progressPercent = Math.min(100, Number(progressMatch[1]));

  execution.logs.push(text);
  if (execution.logs.length > MAX_LOG_LINES) execution.logs.splice(0, execution.logs.length - MAX_LOG_LINES);
}

/** Run a command, stream its stdout/stderr lines into `onLine`, resolve with the exit code. */
export function runCommand(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; onLine?: (line: string) => void; timeoutMs?: number },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffered = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) options.onLine?.(line);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const timer = options.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs)
      : undefined;

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffered) options.onLine?.(buffered);
      resolve(code ?? 1);
    });
  });
}

/** Run a command and return its full stdout (used for short docker commands). */
export async function captureCommand(command: string, args: string[], timeoutMs = 10_000) {
  const lines: string[] = [];
  const exitCode = await runCommand(command, args, { onLine: (line) => lines.push(line), timeoutMs });
  return { exitCode, output: lines.join("\n").trim() };
}
