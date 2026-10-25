// ─────────────────────────────────────────────────────────────
// LocalDockerExecutor: runs the worker inside a Docker container.
//
//   docker create  → gives us the container ID
//   docker start -a → runs it and streams the logs
//   docker rm      → cleans up
//
// If the image does not exist yet, it is built from worker/Dockerfile
// during the PROVISIONING step.
// ─────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { failModeFor, type Executor } from "./types";
import { captureCommand, handleWorkerLine, runCommand } from "./worker-output";

const WORKER_DIR = path.join(process.cwd(), "worker");

// Where to find the docker CLI. Usually it is on the PATH, but Docker Desktop
// also ships it inside the app bundle (useful if the PATH link was not created).
const DOCKER_CANDIDATES = [
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
];
const DOCKER = process.env.DOCKER_BIN || DOCKER_CANDIDATES.find((candidate) => existsSync(candidate)) || "docker";

async function dockerIsRunning(): Promise<boolean> {
  try {
    const { exitCode } = await captureCommand(DOCKER, ["info", "--format", "{{.ServerVersion}}"], 5000);
    return exitCode === 0;
  } catch {
    return false; // docker binary not installed
  }
}

async function ensureImage(image: string): Promise<boolean> {
  const inspect = await captureCommand(DOCKER, ["image", "inspect", image], 5000);
  if (inspect.exitCode === 0) return true;
  console.log(`[docker] building ${image} from ${WORKER_DIR}`);
  const build = await captureCommand(DOCKER, ["build", "-t", image, WORKER_DIR], 180_000);
  return build.exitCode === 0;
}

export const localDockerExecutor: Executor = {
  mode: "local-docker",
  label: "Local Docker container",

  async isAvailable() {
    if (!(await dockerIsRunning())) return { available: false, reason: "Docker is not installed or not running" };
    if (!(await ensureImage(getConfig().dockerImage))) return { available: false, reason: "Could not build the worker image" };
    return { available: true };
  },

  async execute(job, execution, options) {
    const { dockerImage, workloadSeconds } = getConfig();
    execution.workerId = "docker-worker-01";
    execution.image = dockerImage;

    const created = await captureCommand(DOCKER, [
      "create",
      "--name", `sparechange-${job.jobId}`,
      "--cpus", "2",
      "--memory", "512m",
      "-e", `JOB_ID=${job.jobId}`,
      "-e", `WORKLOAD_SECONDS=${workloadSeconds}`,
      "-e", `FAIL_MODE=${failModeFor(options)}`,
      dockerImage,
    ]);
    if (created.exitCode !== 0) throw new Error("docker create failed");
    const containerId = created.output.split("\n").pop()!.trim();
    execution.containerId = containerId;

    try {
      execution.exitCode = await runCommand(DOCKER, ["start", "-a", containerId], {
        onLine: (line) => handleWorkerLine(line, execution),
        timeoutMs: (workloadSeconds + 60) * 1000,
      });
    } finally {
      await captureCommand(DOCKER, ["rm", "-f", containerId]).catch(() => undefined);
    }
  },
};
