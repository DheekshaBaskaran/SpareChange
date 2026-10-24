// ─────────────────────────────────────────────────────────────
// SpareChange compute workload
//
// Trains a small neural network (32 → 64 → 4 MLP) on a synthetic
// 4-class dataset using plain JavaScript (no dependencies), so it runs
// the same way inside Docker, as a local process, or on a remote worker.
//
// Output protocol (one line each, parsed by SpareChange):
//   SpareChange workload started
//   PROGRESS <percent> <message>
//   RESULT <json>
//   SpareChange workload completed
//
// Environment variables:
//   JOB_ID            – SpareChange job id. Echoed in the result so the verifier
//                       can confirm the output belongs to this job.
//   WORKLOAD_SECONDS  – how long to keep training (default 6).
//   FAIL_MODE         – "crash" (exit with an error) or "no-training" (produce
//                       an untrained result). Used to test failure handling.
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

const JOB_ID = process.env.JOB_ID || "local-test";
const BUDGET_MS = Math.max(1, Number(process.env.WORKLOAD_SECONDS || 6)) * 1000;
const FAIL_MODE = process.env.FAIL_MODE || "";

const INPUTS = 32;
const HIDDEN = 64;
const CLASSES = 4;
const TRAIN_SAMPLES = 6000;
const TEST_SAMPLES = 1000;
const BATCH_SIZE = 64;
const LEARNING_RATE = 0.0004;
const MAX_EPOCHS = 500;

// Seeded random numbers, so a given JOB_ID always produces the same dataset.
function makeRandom(seedText) {
  let seed = createHash("sha256").update(seedText).digest().readUInt32LE(0);
  return function random() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = makeRandom(JOB_ID);
const gaussian = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());

// ── Dataset: 4 noisy clusters in 32 dimensions ───────────────
const classCenters = Array.from({ length: CLASSES }, () =>
  Array.from({ length: INPUTS }, () => gaussian() * 0.7),
);
function makeDataset(count) {
  const inputs = new Float64Array(count * INPUTS);
  const labels = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const label = Math.floor(random() * CLASSES);
    labels[i] = label;
    for (let j = 0; j < INPUTS; j++) inputs[i * INPUTS + j] = classCenters[label][j] + gaussian();
  }
  return { inputs, labels, count };
}

// ── Model ────────────────────────────────────────────────────
const w1 = Float64Array.from({ length: INPUTS * HIDDEN }, () => gaussian() * Math.sqrt(1 / INPUTS));
const b1 = new Float64Array(HIDDEN);
const w2 = Float64Array.from({ length: HIDDEN * CLASSES }, () => gaussian() * Math.sqrt(1 / HIDDEN));
const b2 = new Float64Array(CLASSES);
let operations = 0;

const hidden = new Float64Array(HIDDEN);
const probabilities = new Float64Array(CLASSES);

function forward(inputs, offset) {
  for (let h = 0; h < HIDDEN; h++) {
    let sum = b1[h];
    for (let j = 0; j < INPUTS; j++) sum += inputs[offset + j] * w1[j * HIDDEN + h];
    hidden[h] = Math.tanh(sum);
  }
  let max = -Infinity;
  for (let c = 0; c < CLASSES; c++) {
    let sum = b2[c];
    for (let h = 0; h < HIDDEN; h++) sum += hidden[h] * w2[h * CLASSES + c];
    probabilities[c] = sum;
    if (sum > max) max = sum;
  }
  let total = 0;
  for (let c = 0; c < CLASSES; c++) {
    probabilities[c] = Math.exp(probabilities[c] - max);
    total += probabilities[c];
  }
  for (let c = 0; c < CLASSES; c++) probabilities[c] /= total;
  operations += 2 * (INPUTS * HIDDEN + HIDDEN * CLASSES);
}

function evaluate(data) {
  let loss = 0;
  let correct = 0;
  for (let i = 0; i < data.count; i++) {
    forward(data.inputs, i * INPUTS);
    loss -= Math.log(probabilities[data.labels[i]] + 1e-12);
    let best = 0;
    for (let c = 1; c < CLASSES; c++) if (probabilities[c] > probabilities[best]) best = c;
    if (best === data.labels[i]) correct++;
  }
  return { loss: loss / data.count, accuracy: correct / data.count };
}

function trainOneEpoch(data) {
  const gradW1 = new Float64Array(w1.length);
  const gradB1 = new Float64Array(b1.length);
  const gradW2 = new Float64Array(w2.length);
  const gradB2 = new Float64Array(b2.length);
  const outputError = new Float64Array(CLASSES);

  for (let start = 0; start < data.count; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, data.count);
    gradW1.fill(0); gradB1.fill(0); gradW2.fill(0); gradB2.fill(0);

    for (let i = start; i < end; i++) {
      const offset = i * INPUTS;
      forward(data.inputs, offset);
      for (let c = 0; c < CLASSES; c++) outputError[c] = probabilities[c] - (c === data.labels[i] ? 1 : 0);
      for (let h = 0; h < HIDDEN; h++) {
        let hiddenError = 0;
        for (let c = 0; c < CLASSES; c++) {
          gradW2[h * CLASSES + c] += hidden[h] * outputError[c];
          hiddenError += w2[h * CLASSES + c] * outputError[c];
        }
        hiddenError *= 1 - hidden[h] * hidden[h];
        gradB1[h] += hiddenError;
        for (let j = 0; j < INPUTS; j++) gradW1[j * HIDDEN + h] += data.inputs[offset + j] * hiddenError;
      }
      for (let c = 0; c < CLASSES; c++) gradB2[c] += outputError[c];
      operations += 4 * (INPUTS * HIDDEN + HIDDEN * CLASSES);
    }

    const step = LEARNING_RATE / (end - start);
    for (let k = 0; k < w1.length; k++) w1[k] -= step * gradW1[k];
    for (let k = 0; k < b1.length; k++) b1[k] -= step * gradB1[k];
    for (let k = 0; k < w2.length; k++) w2[k] -= step * gradW2[k];
    for (let k = 0; k < b2.length; k++) b2[k] -= step * gradB2[k];
  }
}

function weightsChecksum() {
  const hash = createHash("sha256");
  for (const array of [w1, b1, w2, b2]) hash.update(Buffer.from(array.buffer));
  return hash.digest("hex").slice(0, 16);
}

// ── Main ─────────────────────────────────────────────────────
console.log("SpareChange workload started");
console.log(`job=${JOB_ID} task=mlp-classifier model=${INPUTS}x${HIDDEN}x${CLASSES} budget=${BUDGET_MS / 1000}s`);

const trainData = makeDataset(TRAIN_SAMPLES);
const testData = makeDataset(TEST_SAMPLES);
console.log(`PROGRESS 2 dataset ready: ${TRAIN_SAMPLES} train / ${TEST_SAMPLES} test samples`);

const initial = evaluate(testData);
console.log(`PROGRESS 4 initial loss=${initial.loss.toFixed(4)} accuracy=${(initial.accuracy * 100).toFixed(1)}%`);

const startedAt = Date.now();
let epochs = 0;
let lastReportAt = 0;

if (FAIL_MODE !== "no-training") {
  while (epochs < MAX_EPOCHS && Date.now() - startedAt < BUDGET_MS) {
    trainOneEpoch(trainData);
    epochs++;

    const elapsed = Date.now() - startedAt;
    if (FAIL_MODE === "crash" && elapsed > BUDGET_MS * 0.4) {
      console.error("ERROR simulated worker crash: GPU device lost (FAIL_MODE=crash)");
      process.exit(1);
    }
    if (elapsed - lastReportAt > 450) {
      lastReportAt = elapsed;
      const current = evaluate(testData);
      const percent = Math.min(95, 5 + Math.round((elapsed / BUDGET_MS) * 90));
      console.log(
        `PROGRESS ${percent} epoch=${epochs} loss=${current.loss.toFixed(4)} accuracy=${(current.accuracy * 100).toFixed(1)}%`,
      );
    }
  }
}

const final = evaluate(testData);
console.log(`PROGRESS 100 training finished after ${epochs} epochs`);

const result = {
  jobId: JOB_ID,
  task: "mlp-classifier",
  samples: TRAIN_SAMPLES,
  epochs,
  initialLoss: Number(initial.loss.toFixed(4)),
  finalLoss: Number(final.loss.toFixed(4)),
  accuracy: Number(final.accuracy.toFixed(4)),
  operations,
  weightsChecksum: weightsChecksum(),
};
console.log(`RESULT ${JSON.stringify(result)}`);
console.log("SpareChange workload completed");
