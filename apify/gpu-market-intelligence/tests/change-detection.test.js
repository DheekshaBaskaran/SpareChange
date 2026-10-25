import assert from 'node:assert/strict';
import test from 'node:test';

import { computeProviderDiff } from '../src/change-detection.js';

const RUN_1 = 'run-1';
const RUN_2 = 'run-2';
const T1 = '2026-10-24T12:00:00.000Z';
const T2 = '2026-10-24T12:30:00.000Z';

function offer(id, price, { available = null, priceAvailable = true } = {}) {
  return {
    provider: 'vastai',
    provider_offer_id: id,
    gpu_model: 'NVIDIA H100',
    gpu_model_normalized: 'H100',
    price_per_hour_usd: priceAvailable ? price : '0.000000',
    price_per_gpu_hour_usd: priceAvailable ? price : '0.000000',
    price_available: priceAvailable,
    pricing_model: priceAvailable ? 'fixed' : 'bid',
    available_gpu_count: available,
    capacity_scope: available === null ? 'offer' : 'provider',
  };
}

test('first run establishes a baseline without events by default', () => {
  const result = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: null,
    items: [offer('a', '1.000000'), offer('b', '2.000000')],
    runId: RUN_1,
    observedAt: T1,
    complete: true,
  });
  assert.equal(result.events.length, 0);
  assert.equal(result.counts.current, 2);
  assert.equal(result.baseline, true);
  assert.ok(result.nextState.last_success_at);
});

test('baseline events can be requested explicitly', () => {
  const result = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: null,
    items: [offer('a', '1.000000')],
    runId: RUN_1,
    observedAt: T1,
    complete: true,
    emitBaselineEvents: true,
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event_type, 'new');
  assert.equal(result.events[0].reason, 'new_offer');
});

test('detects new, meaningful price updates, and disappeared offers', () => {
  const first = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: null,
    items: [offer('a', '1.000000'), offer('b', '2.000000')],
    runId: RUN_1,
    observedAt: T1,
    complete: true,
  });

  const second = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: first.nextState,
    items: [offer('a', '1.100000'), offer('c', '3.000000')],
    runId: RUN_2,
    observedAt: T2,
    complete: true,
    priceChangeThresholdPercent: 1,
  });

  const types = second.events.map((event) => `${event.event_type}:${event.provider_offer_id}`);
  assert.deepEqual(types.sort(), ['disappeared:b', 'new:c', 'updated:a']);
  const updated = second.events.find((event) => event.provider_offer_id === 'a');
  assert.equal(updated.reason, 'price_increase');
  assert.equal(updated.previous_price_per_hour_usd, '1.000000');
  assert.equal(updated.current_price_per_hour_usd, '1.100000');
  assert.equal(updated.price_change_percent, 10);
  assert.equal(second.counts.current, 2);
});

test('a price change below the threshold is ignored', () => {
  const first = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: null,
    items: [offer('a', '1.000000')],
    runId: RUN_1,
    observedAt: T1,
    complete: true,
  });
  const second = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: first.nextState,
    items: [offer('a', '1.001000')],
    runId: RUN_2,
    observedAt: T2,
    complete: true,
    priceChangeThresholdPercent: 1,
  });
  assert.equal(second.events.length, 0);
});

test('an always-incomplete source does not claim sampled offers are new', () => {
  const first = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: null,
    items: [offer('a', '1.000000')],
    runId: RUN_1,
    observedAt: T1,
    complete: false,
  });
  assert.equal(first.nextState.last_complete_at, null);

  const second = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: first.nextState,
    items: [offer('a', '1.000000'), offer('b', '2.000000')],
    runId: RUN_2,
    observedAt: T2,
    complete: false,
  });
  assert.equal(second.events.length, 0);
  assert.equal(second.counts.current, 2);
});

test('new offers remain detectable after a complete snapshot', () => {
  const first = computeProviderDiff({
    provider: 'runpod',
    previousProviderState: null,
    items: [offer('a', '1.000000')],
    runId: RUN_1,
    observedAt: T1,
    complete: true,
  });
  const second = computeProviderDiff({
    provider: 'runpod',
    previousProviderState: first.nextState,
    items: [offer('a', '1.000000'), offer('b', '2.000000')],
    runId: RUN_2,
    observedAt: T2,
    complete: false,
  });
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].event_type, 'new');
  assert.equal(second.nextState.last_complete_at, T1);
});

test('incomplete collections never mark unseen offers disappeared', () => {
  const first = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: null,
    items: [offer('a', '1.000000'), offer('b', '2.000000')],
    runId: RUN_1,
    observedAt: T1,
    complete: true,
  });
  const second = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: first.nextState,
    items: [offer('a', '1.000000')],
    runId: RUN_2,
    observedAt: T2,
    complete: false,
  });
  assert.equal(second.events.length, 0);
  assert.equal(second.counts.current, 2);
  assert.ok(second.nextState.offers.b);
});

test('an empty successful collection does not mass-disappear offers', () => {
  const first = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: null,
    items: [offer('a', '1.000000')],
    runId: RUN_1,
    observedAt: T1,
    complete: true,
  });
  const second = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: first.nextState,
    items: [],
    runId: RUN_2,
    observedAt: T2,
    complete: true,
  });
  assert.equal(second.events.length, 0);
  assert.ok(second.nextState.offers.a);
});

test('capacity changes emit updated events without price noise', () => {
  const first = computeProviderDiff({
    provider: 'akash',
    previousProviderState: null,
    items: [offer('a', '0.000000', { available: 4, priceAvailable: false })],
    runId: RUN_1,
    observedAt: T1,
    complete: true,
  });
  const second = computeProviderDiff({
    provider: 'akash',
    previousProviderState: first.nextState,
    items: [offer('a', '0.000000', { available: 7, priceAvailable: false })],
    runId: RUN_2,
    observedAt: T2,
    complete: true,
  });
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].reason, 'capacity_increase');
  assert.equal(second.events[0].price_available, false);
  assert.equal(second.events[0].previous_price_per_hour_usd, null);
  assert.equal(second.events[0].previous_available_gpu_count, 4);
  assert.equal(second.events[0].current_available_gpu_count, 7);
});

test('event ids are deterministic for a run and event type', () => {
  const first = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: null,
    items: [offer('a', '1.000000')],
    runId: RUN_1,
    observedAt: T1,
    complete: true,
  });
  const one = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: first.nextState,
    items: [offer('a', '2.000000')],
    runId: RUN_2,
    observedAt: T2,
    complete: true,
    priceChangeThresholdPercent: 0,
  });
  const two = computeProviderDiff({
    provider: 'vastai',
    previousProviderState: first.nextState,
    items: [offer('a', '2.000000')],
    runId: RUN_2,
    observedAt: T2,
    complete: true,
    priceChangeThresholdPercent: 0,
  });
  assert.equal(one.events[0].event_id, two.events[0].event_id);
});
