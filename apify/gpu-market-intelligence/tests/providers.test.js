import assert from 'node:assert/strict';
import test from 'node:test';

import { newProviderStats } from '../src/providers/http.js';
import { collectVast } from '../src/providers/vastai.js';

const OBSERVED = '2026-10-24T12:00:00.000Z';

function vastOffer(id) {
  return {
    id,
    gpu_name: 'NVIDIA GeForce RTX 4090',
    num_gpus: 1,
    gpu_total_ram: 24576,
    dph_total: 0.5,
    geolocation: 'Oregon, US',
  };
}

function fetchReturning(payload) {
  return async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => payload,
  });
}

test('vast marks a provider-truncated snapshot incomplete even when short', async () => {
  const outcome = await collectVast({
    maxItems: 300,
    includeRawPayload: false,
    observedAt: OBSERVED,
    stats: newProviderStats(),
    fetchImpl: fetchReturning({ offers: [vastOffer(1)], truncated: true }),
  });

  assert.equal(outcome.items.length, 1);
  assert.equal(outcome.complete, false);
  assert.equal(outcome.diagnostics.sampled, true);
  assert.equal(outcome.diagnostics.truncated, true);
});

test('vast treats even a short untruncated response as a sample', async () => {
  const outcome = await collectVast({
    maxItems: 300,
    includeRawPayload: false,
    observedAt: OBSERVED,
    stats: newProviderStats(),
    fetchImpl: fetchReturning({ offers: [vastOffer(1), vastOffer(2)], truncated: false }),
  });

  assert.equal(outcome.items.length, 2);
  assert.equal(outcome.complete, false);
  assert.equal(outcome.diagnostics.sampled, true);
  assert.equal(outcome.diagnostics.truncated, true);
});
