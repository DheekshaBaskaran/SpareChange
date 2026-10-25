import {
  buildOffer,
  parseCountry,
  parseVramGb,
  toNumber,
} from '../normalization.js';
import { fetchJson } from './http.js';

export const PROVIDER = 'akash';
const API = 'https://console-api.akash.network/v1/providers';

function slug(value) {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

function humanizeModel(vendor, model) {
  let text = String(model || '').trim();
  if (!text) throw new Error('gpu model missing');
  text = text.replace(/[_-]+/g, ' ');

  const upper = text.toUpperCase();
  if (/^RTX\s*A\d{4}/.test(upper)) {
    text = upper.replace(/^RTX\s*A(\d{4})/, 'RTX A$1');
  } else if (/^RTX\s*\d{4}/.test(upper)) {
    text = upper.replace(/^RTX\s*(\d{4})\s*(TI|SUPER)?/, (_, num, suffix) =>
      `RTX ${num}${suffix ? ` ${suffix[0]}${suffix.slice(1).toLowerCase()}` : ''}`,
    );
  } else if (/^(?:GTX|RTX)\s*\d{3,4}/.test(upper)) {
    text = upper.replace(/^(GTX|RTX)\s*(\d{3,4})/, '$1 $2');
  } else if (/^[AHBLM]\d{2,4}[A-Z]*$/.test(upper)) {
    text = upper;
  } else if (/^MI\d{3}X$/.test(upper)) {
    text = upper;
  } else if (/^L\d{2}S?$/.test(upper)) {
    text = upper;
  } else {
    text = upper;
  }

  const vendorText = String(vendor || '').trim();
  if (vendorText && !text.toLowerCase().includes(vendorText.toLowerCase())) {
    const displayVendor =
      vendorText.toLowerCase() === 'nvidia'
        ? 'NVIDIA'
        : vendorText.toLowerCase() === 'amd'
          ? 'AMD'
          : vendorText;
    text = `${displayVendor} ${text}`;
  }
  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeAkashProvider(provider, observedAt, includeRawPayload) {
  if (!provider || typeof provider !== 'object') throw new Error('provider is not an object');
  const owner = provider.owner || provider.ownerAddress;
  if (!owner) throw new Error('provider owner missing');
  if (provider.isOnline === false) return [];
  const available = toNumber(provider.stats?.gpu?.available);
  if (available === null || available <= 0) return [];
  const models = Array.isArray(provider.gpuModels) ? provider.gpuModels : [];
  if (!models.length) return [];

  let region = typeof provider.ipRegion === 'string' ? provider.ipRegion : null;
  if (!region && Array.isArray(provider.attributes)) {
    const attr = provider.attributes.find(
      (entry) => String(entry?.key || '').toLowerCase() === 'location-region',
    );
    region = attr?.value ? String(attr.value) : null;
  }
  const country = parseCountry(provider.ipCountryCode || provider.ipCountry, region);
  const sourceUrl =
    typeof provider.hostUri === 'string' && /^https?:\/\//.test(provider.hostUri)
      ? provider.hostUri.replace(/\/+$/, '')
      : `${API}/${owner}`;

  const offers = [];
  const seen = new Set();
  for (const model of models) {
    if (!model || typeof model !== 'object' || !model.model) continue;
    const modelKey = slug(model.model);
    if (seen.has(modelKey)) continue;
    seen.add(modelKey);
    offers.push(
      buildOffer({
        provider: PROVIDER,
        providerOfferId: `akash:${owner}:${modelKey}`,
        gpuModel: humanizeModel(model.vendor, model.model),
        gpuCount: 1,
        vramGb: parseVramGb(model.ram),
        region,
        country,
        price: 0,
        priceAvailable: false,
        pricingModel: 'bid',
        billingScope: 'per_gpu_hour',
        availabilityScope: 'advertised',
        availableGpuCount: available,
        capacityScope: 'provider',
        source: 'akash_console_api',
        sourceUrl,
        sourceRecordId: owner,
        observedAt,
        rawPayload: includeRawPayload ? provider : undefined,
        metadata: {
          provider_owner: owner,
          host_uri: provider.hostUri,
          gpu_vendor: model.vendor,
          gpu_model: model.model,
          gpu_interface: model.interface,
          provider_gpu_available: available,
          provider_gpu_total: provider.stats?.gpu?.total,
          provider_gpu_active: provider.stats?.gpu?.active,
          provider_gpu_pending: provider.stats?.gpu?.pending,
          capacity_scope: 'provider_total_not_per_model',
          pricing_model: 'bid',
          price_available: false,
        },
      }),
    );
  }
  return offers;
}

export async function collectAkash({ maxItems, includeRawPayload, observedAt, stats, fetchImpl }) {
  const payload = await fetchJson(API, { stats, fetchImpl });
  const providers = Array.isArray(payload)
    ? payload
    : payload?.data || payload?.providers;
  if (!Array.isArray(providers)) {
    throw new Error('Akash response did not contain a provider array');
  }

  const generated = [];
  let rejected = 0;
  let online = 0;
  let providersWithGpus = 0;
  let capacity = 0;
  const reasons = {};
  for (const provider of providers) {
    try {
      if (provider?.isOnline !== false) online += 1;
      const offers = normalizeAkashProvider(provider, observedAt, includeRawPayload);
      if (offers.length) {
        providersWithGpus += 1;
        capacity += Number(offers[0].available_gpu_count) || 0;
      }
      generated.push(...offers);
    } catch (error) {
      rejected += 1;
      const reason = String(error.message || error).slice(0, 160);
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
  }

  const items = generated.slice(0, maxItems);
  return {
    items,
    complete: providers.length > 0 && generated.length <= maxItems,
    diagnostics: {
      returned_providers: providers.length,
      online_providers: online,
      providers_with_gpus: providersWithGpus,
      emitted_before_limit: generated.length,
      emitted: items.length,
      provider_available_gpus: capacity,
      truncated: generated.length > maxItems,
      rejected,
      rejected_reasons: reasons,
      pricing: 'bid-based; public inventory exposes no price',
      endpoint: API,
    },
  };
}
