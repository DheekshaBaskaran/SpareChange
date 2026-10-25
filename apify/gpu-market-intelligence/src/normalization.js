const GPU_RULES = [
  [/\bB300\b/i, 'B300'],
  [/\bB200\b/i, 'B200'],
  [/\bGB200\b/i, 'GB200'],
  [/\bH200\b/i, 'H200'],
  [/\bH100\b/i, 'H100'],
  [/\bA100\b/i, 'A100'],
  [/\bA10G\b/i, 'A10G'],
  [/\bA10\b/i, 'A10'],
  [/\bA40\b/i, 'A40'],
  [/\bL40S\b/i, 'L40S'],
  [/\bL40\b/i, 'L40'],
  [/\bL4\b/i, 'L4'],
  [/\bRTX\s*(?:PRO\s*)?6000\s*ADA\b/i, 'RTX 6000 Ada'],
  [/\bRTX\s*A6000\b/i, 'RTX A6000'],
  [/\bRTX\s*A5000\b/i, 'RTX A5000'],
  [/\bRTX\s*A4000\b/i, 'RTX A4000'],
  [/\bRTX\s*4090\b/i, 'RTX 4090'],
  [/\bRTX\s*4080\b/i, 'RTX 4080'],
  [/\bRTX\s*4070\s*TI\b/i, 'RTX 4070 Ti'],
  [/\bRTX\s*4070\b/i, 'RTX 4070'],
  [/\bRTX\s*4060\s*TI\b/i, 'RTX 4060 Ti'],
  [/\bRTX\s*4060\b/i, 'RTX 4060'],
  [/\bRTX\s*3090\s*TI\b/i, 'RTX 3090 Ti'],
  [/\bRTX\s*3090\b/i, 'RTX 3090'],
  [/\bRTX\s*3080\s*TI\b/i, 'RTX 3080 Ti'],
  [/\bRTX\s*3080\b/i, 'RTX 3080'],
  [/\bRTX\s*3070\s*TI\b/i, 'RTX 3070 Ti'],
  [/\bRTX\s*3070\b/i, 'RTX 3070'],
  [/\bRTX\s*3060\s*TI\b/i, 'RTX 3060 Ti'],
  [/\bRTX\s*3060\b/i, 'RTX 3060'],
  [/\bGTX\s*1650\b/i, 'GTX 1650'],
  [/\bGTX\s*1080\s*TI\b/i, 'GTX 1080 Ti'],
  [/\bGTX\s*1080\b/i, 'GTX 1080'],
  [/\bMI325X\b/i, 'MI325X'],
  [/\bMI300X\b/i, 'MI300X'],
  [/\bMI250X\b/i, 'MI250X'],
  [/\bV100\b/i, 'V100'],
  [/\bT4\b/i, 'T4'],
  [/\bP100\b/i, 'P100'],
  [/\bP40\b/i, 'P40'],
];

const COUNTRY_NAMES = {
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  canada: 'CA',
  germany: 'DE',
  france: 'FR',
  netherlands: 'NL',
  'united kingdom': 'GB',
  uk: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  poland: 'PL',
  sweden: 'SE',
  finland: 'FI',
  japan: 'JP',
  singapore: 'SG',
  australia: 'AU',
  india: 'IN',
  brazil: 'BR',
  spain: 'ES',
  italy: 'IT',
  switzerland: 'CH',
  norway: 'NO',
  denmark: 'DK',
  czechia: 'CZ',
  romania: 'RO',
  'south korea': 'KR',
  china: 'CN',
  'hong kong': 'HK',
  israel: 'IL',
  'united arab emirates': 'AE',
  mexico: 'MX',
  chile: 'CL',
  argentina: 'AR',
  turkey: 'TR',
  ukraine: 'UA',
  austria: 'AT',
  belgium: 'BE',
  ireland: 'IE',
  portugal: 'PT',
  'new zealand': 'NZ',
  taiwan: 'TW',
  lithuania: 'LT',
  estonia: 'EE',
  latvia: 'LV',
  bulgaria: 'BG',
  hungary: 'HU',
  greece: 'GR',
};

export function normalizeGpuModel(raw) {
  if (!raw || !String(raw).trim()) return 'UNKNOWN';
  const text = String(raw).trim();
  for (const [pattern, canonical] of GPU_RULES) {
    if (pattern.test(text)) return canonical;
  }
  let cleaned = text
    .replace(/\b(?:nvidia|geforce|amd|instinct|tesla|graphics)\b/gi, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*(?:GiB|GB|Gi|G)\b/gi, ' ')
    .replace(/\b(?:pcie|sxm\d*|sxm|hbm\d*|oam|nvl|server|edition)\b/gi, ' ')
    .replace(/[_/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-, ]+|[-, ]+$/g, '');
  return (cleaned || text).toUpperCase();
}

export function parseVramGb(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 100) / 100;
  }
  const match = String(value).match(/(\d+(?:\.\d+)?)\s*(?:GiB|GB|Gi|G)\b/i);
  return match ? Math.round(Number(match[1]) * 100) / 100 : null;
}

export function parseCountry(value, region = null) {
  const candidates = [value, region].filter((item) => typeof item === 'string' && item.trim());
  for (const candidate of candidates) {
    const lowered = candidate.toLowerCase().trim();
    if (COUNTRY_NAMES[lowered]) return COUNTRY_NAMES[lowered];
    const suffix = candidate.match(/(?:^|[,\s])([A-Z]{2})$/);
    if (suffix) return suffix[1].toUpperCase();
    if (/^[A-Za-z]{2}$/.test(candidate)) return candidate.toUpperCase();
    for (const [name, code] of Object.entries(COUNTRY_NAMES)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:^|[,\\s])${escaped}(?:$|[,\\s])`, 'i').test(lowered)) return code;
    }
  }
  return null;
}

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toPriceString(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid price: ${value}`);
  }
  return parsed.toFixed(6);
}

export function pricePerGpuString(priceUsd, gpuCount) {
  const count = Math.max(1, Number(gpuCount) || 1);
  return (Number(priceUsd) / count).toFixed(6);
}

export function buildOffer({
  provider,
  providerOfferId,
  gpuModel,
  gpuCount,
  vramGb,
  cpuCores,
  ramGb,
  diskGb,
  region,
  country,
  price,
  priceAvailable = true,
  pricingModel = 'fixed',
  billingScope,
  availabilityScope,
  availableGpuCount = null,
  capacityScope = 'offer',
  reliability,
  source,
  sourceUrl,
  sourceRecordId,
  trustTier = 'apify_actor',
  observedAt,
  rawPayload,
  metadata,
}) {
  const count = Math.max(1, Number(gpuCount) || 1);
  const normalizedPrice = priceAvailable ? toPriceString(price) : '0.000000';
  if (priceAvailable && Number(normalizedPrice) <= 0) {
    throw new Error(`missing positive price for ${provider}:${providerOfferId}`);
  }
  return {
    provider,
    provider_offer_id: String(providerOfferId),
    gpu_model: String(gpuModel),
    gpu_model_normalized: normalizeGpuModel(gpuModel),
    gpu_count: count,
    vram_gb: vramGb === undefined ? null : vramGb,
    cpu_cores: cpuCores === undefined ? null : cpuCores,
    ram_gb: ramGb === undefined ? null : ramGb,
    disk_gb: diskGb === undefined ? null : diskGb,
    region: region || null,
    country: country || null,
    price_per_hour_usd: normalizedPrice,
    price_per_gpu_hour_usd: pricePerGpuString(normalizedPrice, count),
    price_available: Boolean(priceAvailable),
    pricing_model: priceAvailable ? pricingModel : pricingModel === 'fixed' ? 'bid' : pricingModel,
    currency: 'USD',
    billing_scope: billingScope,
    availability_scope: availabilityScope,
    available_gpu_count: availableGpuCount === undefined ? null : availableGpuCount,
    capacity_scope: capacityScope,
    executable: false,
    reliability: reliability === undefined ? null : reliability,
    source,
    source_url: sourceUrl || null,
    source_record_id: sourceRecordId ? String(sourceRecordId) : null,
    trust_tier: trustTier,
    observed_at: observedAt,
    raw_payload: rawPayload || {},
    metadata: {
      ...(metadata || {}),
      collection_channel: 'apify_actor',
      upstream_source: source,
    },
  };
}

export function filterOffers(
  offers,
  {
    gpuModels = [],
    minGpuMemoryGb = 0,
    maxPricePerGpuHourUsd = null,
    regions = [],
    countries = [],
  } = {},
) {
  const modelSet = new Set(
    (Array.isArray(gpuModels) ? gpuModels : [])
      .map((model) => String(model).trim().toUpperCase())
      .filter(Boolean),
  );
  const regionNeedles = (Array.isArray(regions) ? regions : [])
    .map((region) => String(region).trim().toLowerCase())
    .filter(Boolean);
  const countrySet = new Set(
    (Array.isArray(countries) ? countries : [])
      .map((country) => String(country).trim().toUpperCase())
      .filter(Boolean),
  );
  const minVram = Math.max(0, Number(minGpuMemoryGb) || 0);
  const maxPrice =
    maxPricePerGpuHourUsd === null || maxPricePerGpuHourUsd === undefined
      ? null
      : Number(maxPricePerGpuHourUsd);

  const kept = [];
  const rejected = { gpu_model: 0, vram: 0, price: 0, region: 0, country: 0, unpriced_budget: 0 };
  for (const offer of offers) {
    if (modelSet.size && !modelSet.has(offer.gpu_model_normalized.toUpperCase())) {
      rejected.gpu_model += 1;
      continue;
    }
    if (offer.vram_gb !== null && offer.vram_gb < minVram) {
      rejected.vram += 1;
      continue;
    }
    if (maxPrice !== null) {
      if (!offer.price_available) {
        rejected.unpriced_budget += 1;
        continue;
      }
      if (Number(offer.price_per_gpu_hour_usd) > maxPrice) {
        rejected.price += 1;
        continue;
      }
    }
    if (regionNeedles.length) {
      const haystack = `${offer.region || ''} ${offer.country || ''}`.toLowerCase();
      if (!regionNeedles.some((needle) => haystack.includes(needle))) {
        rejected.region += 1;
        continue;
      }
    }
    if (countrySet.size && !countrySet.has(String(offer.country || '').toUpperCase())) {
      rejected.country += 1;
      continue;
    }
    kept.push(offer);
  }
  return { items: kept, rejected };
}
