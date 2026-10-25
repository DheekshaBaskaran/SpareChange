// ─────────────────────────────────────────────────────────────
// SpareChange remote worker.
//
// Run this on another machine (e.g. a Vultr VM or any server with
// Docker). SpareChange's RemoteExecutor sends it jobs over HTTP.
//
//   node worker/server.mjs
//
// Environment:
//   PORT                 – default 8402
//   WORKER_ID            – name shown in the SpareChange UI (default: remote-worker-01)
//   REMOTE_WORKER_TOKEN  – shared secret; if set, requests must send
//                          "Authorization: Bearer <token>"
//   USE_DOCKER           – "false" to run the workload as a plain process
//   DOCKER_IMAGE         – default sparechange-worker:latest
//
// API:
//   GET  /health        → { ok, workerId, executionMode }
//   POST /runs          → body { jobId, workloadSeconds, failMode } → { runId, workerId }
//   GET  /runs/:runId   → { status, logs, exitCode, containerId, ... }
// No dependencies besides Node.js 20+.
// ─────────────────────────────────────────────────────────────

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8402);
const WORKER_ID = process.env.WORKER_ID || "remote-worker-01";
const TOKEN = process.env.REMOTE_WORKER_TOKEN || "";
const DOCKER_IMAGE = process.env.DOCKER_IMAGE || "sparechange-worker:latest";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const dockerAvailable =
  process.env.USE_DOCKER !== "false" && spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const executionMode = dockerAvailable ? "docker" : "process";

if (dockerAvailable && spawnSync("docker", ["image", "inspect", DOCKER_IMAGE], { stdio: "ignore" }).status !== 0) {
  console.log(`Building ${DOCKER_IMAGE}…`);
  spawnSync("docker", ["build", "-t", DOCKER_IMAGE, HERE], { stdio: "inherit" });
}

/** runId → run state */
const runs = new Map();

function startRun({ jobId, workloadSeconds = 6, failMode = "" }) {
  const runId = randomUUID();
  const run = { runId, jobId, status: "running", workerId: WORKER_ID, executionMode, logs: [], startedAt: new Date().toISOString() };
  runs.set(runId, run);

  const env = { JOB_ID: String(jobId), WORKLOAD_SECONDS: String(workloadSeconds), FAIL_MODE: String(failMode) };
  let child;
  if (dockerAvailable) {
    const created = spawnSync("docker", [
      "create", "--cpus", "2", "--memory", "512m",
      ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      DOCKER_IMAGE,
    ]);
    run.containerId = created.stdout.toString().trim();
    child = spawn("docker", ["start", "-a", run.containerId]);
  } else {
    child = spawn(process.execPath, [path.join(HERE, "workload.mjs")], { env: { ...process.env, ...env } });
  }

  let buffered = "";
  const onData = (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    run.logs.push(...lines.filter(Boolean));
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => {
    if (buffered) run.logs.push(buffered);
    run.exitCode = code ?? 1;
    run.status = "finished";
    run.endedAt = new Date().toISOString();
    if (run.containerId) spawn("docker", ["rm", "-f", run.containerId], { stdio: "ignore" });
    console.log(`[${jobId}] finished with exit code ${run.exitCode}`);
  });

  console.log(`[${jobId}] started run ${runId} (${executionMode})`);
  return run;
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  if (TOKEN && request.headers.authorization !== `Bearer ${TOKEN}`) return send(response, 401, { error: "Unauthorized" });

  if (request.method === "GET" && request.url === "/health") {
    return send(response, 200, { ok: true, workerId: WORKER_ID, executionMode });
  }

  if (request.method === "POST" && request.url === "/runs") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      try {
        const run = startRun(JSON.parse(body || "{}"));
        send(response, 201, { runId: run.runId, workerId: WORKER_ID });
      } catch {
        send(response, 400, { error: "Invalid JSON body" });
      }
    });
    return;
  }

  const match = request.url?.match(/^\/runs\/([\w-]+)$/);
  if (request.method === "GET" && match) {
    const run = runs.get(match[1]);
    return run ? send(response, 200, run) : send(response, 404, { error: "Run not found" });
  }

  send(response, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`SpareChange remote worker "${WORKER_ID}" listening on :${PORT} (${executionMode} mode)`);
});
