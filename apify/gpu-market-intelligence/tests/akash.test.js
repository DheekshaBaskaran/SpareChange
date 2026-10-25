import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAkashProvider } from '../src/providers/akash.js';

const OBSERVED = '2026-10-24T12:00:00.000Z';

test('normalizes provider-level Akash capacity as unpriced bid inventory', () => {
  const provider = {
    owner: 'akash1owner',
    hostUri: 'https://provider.example:8443',
    isOnline: true,
    ipRegion: 'Florida',
    ipCountryCode: 'US',
    gpuModels: [
      { vendor: 'nvidia', model: 'rtx4090', ram: '24Gi', interface: 'PCIe' },
      { vendor: 'nvidia', model: 'a100', ram: '80Gi', interface: 'PCIe' },
    ],
    stats: { gpu: { available: 6, total: 8, active: 1, pending: 1 } },
    attributes: [{ key: 'location-region', value: 'na-us-east' }],
  };
  const offers = normalizeAkashProvider(provider, OBSERVED, true);
  assert.equal(offers.length, 2);
  assert.ok(offers.every((offer) => offer.provider === 'akash'));
  assert.ok(offers.every((offer) => offer.price_available === false));
  assert.ok(offers.every((offer) => offer.pricing_model === 'bid'));
  assert.ok(offers.every((offer) => offer.price_per_hour_usd === '0.000000'));
  assert.ok(offers.every((offer) => offer.available_gpu_count === 6));
  assert.ok(offers.every((offer) => offer.capacity_scope === 'provider'));
  assert.ok(offers.every((offer) => offer.executable === false));
  assert.ok(offers.every((offer) => offer.availability_scope === 'advertised'));
  assert.equal(offers[0].gpu_model_normalized, 'RTX 4090');
  assert.equal(offers[0].vram_gb, 24);
  assert.equal(offers[0].country, 'US');
  assert.equal(offers[0].metadata.capacity_scope, 'provider_total_not_per_model');
});

test('offline and zero-capacity providers are omitted', () => {
  assert.deepEqual(
    normalizeAkashProvider(
      { owner: 'a', isOnline: false, stats: { gpu: { available: 4 } } },
      OBSERVED,
      false,
    ),
    [],
  );
  assert.deepEqual(
    normalizeAkashProvider(
      { owner: 'b', isOnline: true, stats: { gpu: { available: 0 } } },
      OBSERVED,
      false,
    ),
    [],
  );
});
