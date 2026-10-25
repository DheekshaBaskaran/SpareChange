import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOffer,
  filterOffers,
  normalizeGpuModel,
  parseCountry,
  parseVramGb,
} from '../src/normalization.js';

const OBSERVED = '2026-10-24T12:00:00.000Z';

function offer(overrides = {}) {
  return buildOffer({
    provider: 'vastai',
    providerOfferId: '1',
    gpuModel: 'NVIDIA GeForce RTX 4090',
    gpuCount: 1,
    vramGb: 24,
    region: 'Oregon, US',
    country: 'US',
    price: '0.500000',
    billingScope: 'per_gpu_hour',
    availabilityScope: 'live_inventory',
    source: 'vastai_api',
    observedAt: OBSERVED,
    ...overrides,
  });
}

test('normalizes GPU model and VRAM variants', () => {
  assert.equal(normalizeGpuModel('NVIDIA GeForce RTX 4090 PCIe 24GB'), 'RTX 4090');
  assert.equal(normalizeGpuModel('rtx4060ti'), 'RTX 4060 Ti');
  assert.equal(normalizeGpuModel('NVIDIA H100 80GB HBM3'), 'H100');
  assert.equal(parseVramGb('16Gi'), 16);
  assert.equal(parseVramGb('80GB'), 80);
});

test('parses countries from name, code, and region', () => {
  assert.equal(parseCountry('Oregon, US'), 'US');
  assert.equal(parseCountry('England'), 'GB');
  assert.equal(parseCountry(null, 'Netherlands'), 'NL');
});

test('builds priced offers with a per-GPU comparable price', () => {
  const built = offer({ gpuCount: 2, price: '1.200000' });
  assert.equal(built.price_per_hour_usd, '1.200000');
  assert.equal(built.price_per_gpu_hour_usd, '0.600000');
  assert.equal(built.price_available, true);
  assert.equal(built.pricing_model, 'fixed');
  assert.equal(built.executable, false);
  assert.equal(built.trust_tier, 'apify_actor');
});

test('unpriced capacity uses a zero sentinel and explicit bid semantics', () => {
  const built = offer({
    provider: 'akash',
    price: 0,
    priceAvailable: false,
    pricingModel: 'bid',
    availableGpuCount: 12,
    capacityScope: 'provider',
    availabilityScope: 'advertised',
  });
  assert.equal(built.price_per_hour_usd, '0.000000');
  assert.equal(built.price_available, false);
  assert.equal(built.pricing_model, 'bid');
  assert.equal(built.available_gpu_count, 12);
  assert.equal(built.capacity_scope, 'provider');
});

test('filters by model, VRAM, region, country, and budget', () => {
  const offers = [
    offer({ providerOfferId: 'a' }),
    offer({ providerOfferId: 'b', gpuModel: 'NVIDIA H100', vramGb: 80, region: 'Texas, US' }),
    offer({
      providerOfferId: 'c',
      gpuModel: 'NVIDIA H100',
      vramGb: 80,
      region: 'Netherlands',
      country: 'NL',
      price: '4.000000',
    }),
    offer({
      providerOfferId: 'd',
      provider: 'akash',
      vramGb: null,
      region: null,
      country: null,
      price: 0,
      priceAvailable: false,
      pricingModel: 'bid',
      availableGpuCount: 3,
      capacityScope: 'provider',
    }),
  ];

  const byModel = filterOffers(offers, { gpuModels: ['H100'] });
  assert.deepEqual(byModel.items.map((item) => item.provider_offer_id), ['b', 'c']);

  const byVram = filterOffers(offers, { minGpuMemoryGb: 48 });
  assert.deepEqual(byVram.items.map((item) => item.provider_offer_id), ['b', 'c', 'd']);

  const byRegion = filterOffers(offers, { regions: ['netherlands'] });
  assert.deepEqual(byRegion.items.map((item) => item.provider_offer_id), ['c']);

  const byCountry = filterOffers(offers, { countries: ['US'] });
  assert.deepEqual(byCountry.items.map((item) => item.provider_offer_id), ['a', 'b']);

  const byBudget = filterOffers(offers, { maxPricePerGpuHourUsd: 1 });
  assert.deepEqual(byBudget.items.map((item) => item.provider_offer_id), ['a', 'b']);
  assert.equal(byBudget.rejected.unpriced_budget, 1);
});
