import assert from 'node:assert/strict';
import test from 'node:test';

import { pushToRelay } from '../src/relay.js';

function offer(provider = 'vastai') {
  return {
    provider,
    provider_offer_id: `${provider}-1`,
    gpu_model: 'NVIDIA H100',
    gpu_model_normalized: 'H100',
    price_per_hour_usd: '2.000000',
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

test('retries a transient 503 and records the successful push', async () => {
  const statuses = [503, 200];
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse(statuses.shift(), {
      runs: [{ run_id: 'run-1', status: 'succeeded', fetched: 1, inserted: 1, duplicate: 0, rejected: 0 }],
    });
  };

  const result = await pushToRelay({
    baseUrl: 'https://relay.example/',
    token: 'token',
    runId: 'apify-run',
    offers: [offer()],
    events: [],
    fetchImpl,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].idempotency_key, 'apify:apify-run:vastai');
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.offer_runs[0].inserted, 1);
  assert.equal(result.base_url, 'https://relay.example');
});

test('does not retry a client error and reports the failure', async () => {
  let calls = 0;
  const fetchImpl = async () =>
    jsonResponse(401, { error: { message: 'invalid token' } });
  const wrapped = async (url, init) => {
    calls += 1;
    return fetchImpl(url, init);
  };

  const result = await pushToRelay({
    baseUrl: 'https://relay.example',
    token: 'token',
    runId: 'apify-run',
    offers: [offer()],
    events: [],
    fetchImpl: wrapped,
  });

  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /HTTP 401/);
});

test('a failing provider does not stop the remaining providers', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body.provider);
    if (body.provider === 'runpod') return jsonResponse(400, { detail: 'bad payload' });
    return jsonResponse(200, {
      runs: [{ run_id: `run-${body.provider}`, status: 'succeeded', fetched: 1, inserted: 1 }],
    });
  };

  const result = await pushToRelay({
    baseUrl: 'https://relay.example',
    token: 'token',
    runId: 'apify-run',
    offers: [offer('runpod'), offer('vastai')],
    events: [],
    fetchImpl,
  });

  assert.deepEqual(seen.sort(), ['runpod', 'vastai']);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].provider, 'runpod');
  assert.equal(result.offer_runs.length, 1);
  assert.equal(result.offer_runs[0].provider, 'vastai');
});
