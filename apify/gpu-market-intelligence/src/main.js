import { Actor } from 'apify';

const PROVIDERS = ['vastai', 'runpod', 'lambda', 'tensordock'];
const USER_AGENT = 'RelayMarketIntelligenceActor/0.1 (+https://relay.market)';
const MAX_VAST = 500;

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

function normalizeGpuModel(raw) {
  if (!raw || !String(raw).trim()) return 'UNKNOWN';
  const text = String(raw).trim();
  for (const [pattern, canonical] of GPU_RULES) {
    if (pattern.test(text)) return canonical;
  }
  let cleaned = text
    .replace(/\b(?:nvidia|geforce|amd|instinct|tesla|graphics)\b/gi, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*(?:GB|GiB|G)\b/gi, ' ')
    .replace(/\b(?:pcie|sxm\d*|sxm|hbm\d*|oam|nvl|server|edition)\b/gi, ' ')
    .replace(/[_/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-, ]+|[-, ]+$/g, '');
  return (cleaned || text).toUpperCase();
}

function parseVramGb(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 100) / 100;
  }
  const match = String(value).match(/(\d+(?:\.\d+)?)\s*(?:GB|GiB|G)\b/i);
  return match ? Math.round(Number(match[1]) * 100) / 100 : null;
}

function parseCountry(value, region = null) {
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

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceString(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid price: ${value}`);
  }
  return parsed.toFixed(6);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`${url} returned HTTP ${response.status}`);
        if (attempt < attempts) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }
      if (!response.ok) {
        throw new Error(`${url} returned HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw lastError || new Error(`${url} failed`);
}

function baseItem({
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
  billingScope,
  availabilityScope,
  reliability,
  source,
  sourceUrl,
  sourceRecordId,
  rawPayload,
  metadata,
}) {
  return {
    provider,
    provider_offer_id: String(providerOfferId),
    gpu_model: String(gpuModel),
    gpu_model_normalized: normalizeGpuModel(gpuModel),
    gpu_count: Math.max(1, Number(gpuCount) || 1),
    vram_gb: vramGb === undefined ? null : vramGb,
    cpu_cores: cpuCores === undefined ? null : cpuCores,
    ram_gb: ramGb === undefined ? null : ramGb,
    disk_gb: diskGb === undefined ? null : diskGb,
    region: region || null,
    country: country || null,
    price_per_hour_usd: priceString(price),
    currency: 'USD',
    billing_scope: billingScope,
    availability_scope: availabilityScope,
    executable: false,
    reliability: reliability === undefined ? null : reliability,
    source,
    source_url: sourceUrl || null,
    source_record_id: sourceRecordId ? String(sourceRecordId) : null,
    trust_tier: 'apify_actor',
    observed_at: new Date().toISOString(),
    raw_payload: rawPayload || {},
    metadata: {
      ...(metadata || {}),
      collection_channel: 'apify_actor',
      upstream_source: source,
    },
  };
}

async function collectVast({ maxItems, includeRawPayload }) {
  const limit = Math.max(1, Math.min(maxItems, MAX_VAST));
  const query = {
    verified: { eq: true },
    rentable: { eq: true },
    order: [['dph_total', 'asc']],
    limit,
  };
  const headers = {};
  if (process.env.VASTAI_API_KEY) headers.Authorization = `Bearer ${process.env.VASTAI_API_KEY}`;
  const data = await fetchJson(
    `https://console.vast.ai/api/v0/bundles/?q=${encodeURIComponent(JSON.stringify(query))}`,
    { headers },
  );
  if (!Array.isArray(data.offers)) throw new Error('Vast.ai response did not contain offers');

  const items = [];
  let rejected = 0;
  for (const raw of data.offers) {
    try {
      const gpuCount = Number(raw.num_gpus) || 1;
      const price = raw.dph_total ?? raw.dph_base;
      const vramMb = number(raw.gpu_total_ram) ?? number(raw.gpu_ram);
      const vramGb = vramMb ? Math.round((vramMb / 1024) * 100) / 100 : null;
      const ramMb = number(raw.cpu_ram);
      const region = raw.geolocation || null;
      const reliability = number(raw.reliability2) ?? number(raw.reliability);
      items.push(
        baseItem({
          provider: 'vastai',
          providerOfferId: raw.id,
          gpuModel: raw.gpu_name,
          gpuCount,
          vramGb,
          cpuCores: number(raw.cpu_cores_effective) ?? number(raw.cpu_cores),
          ramGb: ramMb ? Math.round((ramMb / 1024) * 100) / 100 : null,
          diskGb: number(raw.disk_space),
          region,
          country: parseCountry(region),
          price,
          billingScope: 'per_instance_hour',
          availabilityScope: 'live_inventory',
          reliability: reliability === null ? null : Math.min(1, Math.max(0, reliability)),
          source: 'vastai_api',
          sourceUrl: 'https://console.vast.ai/api/v0/bundles/',
          sourceRecordId: raw.id,
          rawPayload: includeRawPayload ? raw : undefined,
          metadata: {
            host_id: raw.host_id,
            verification: raw.verification,
            gpu_price_per_hour_usd: raw.dph_base,
            disk_price_per_hour_usd: raw.storage_total_cost,
            min_bid_usd: raw.min_bid,
          },
        }),
      );
    } catch {
      rejected += 1;
    }
    if (items.length >= limit) break;
  }
  return { items, diagnostics: { returned: data.offers.length, rejected, limit } };
}

async function collectRunpod({ maxItems, includeRawPayload }) {
  const query = `
    query RelayGpuMarket {
      gpuTypes {
        id displayName memoryInGb secureCloud communityCloud
        lowestPrice(input: {gpuCount: 1}) { minimumBidPrice uninterruptablePrice }
      }
    }
  `;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.RUNPOD_API_KEY) {
    headers.Authorization = `Bearer ${process.env.RUNPOD_API_KEY}`;
  }
  const data = await fetchJson('https://api.runpod.io/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  if (data.errors) throw new Error(`RunPod GraphQL error: ${data.errors[0]?.message || 'unknown'}`);
  const gpuTypes = data.data?.gpuTypes;
  if (!Array.isArray(gpuTypes)) throw new Error('RunPod response did not contain gpuTypes');

  const items = [];
  let rejected = 0;
  for (const gpu of gpuTypes) {
    try {
      const onDemand = number(gpu.lowestPrice?.uninterruptablePrice);
      const spot = number(gpu.lowestPrice?.minimumBidPrice);
      const price = onDemand && onDemand > 0 ? onDemand : spot;
      if (!price || price <= 0) throw new Error('no price');
      for (const [tier, enabled] of [
        ['secure_cloud', gpu.secureCloud],
        ['community_cloud', gpu.communityCloud],
      ]) {
        if (!enabled) continue;
        items.push(
          baseItem({
            provider: 'runpod',
            providerOfferId: `runpod:${gpu.id}:${tier}`,
            gpuModel: gpu.id,
            gpuCount: 1,
            vramGb: number(gpu.memoryInGb),
            region: tier.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            price,
            billingScope: 'per_gpu_hour',
            availabilityScope: 'advertised',
            source: 'runpod_graphql',
            sourceUrl: 'https://www.runpod.io/pricing',
            sourceRecordId: gpu.id,
            rawPayload: includeRawPayload ? gpu : undefined,
            metadata: {
              gpu_type_id: gpu.id,
              display_name: gpu.displayName,
              cloud_tier: tier,
              on_demand_price_usd: onDemand,
              spot_price_usd: spot,
            },
          }),
        );
        if (items.length >= maxItems) break;
      }
    } catch {
      rejected += 1;
    }
    if (items.length >= maxItems) break;
  }
  return { items: items.slice(0, maxItems), diagnostics: { gpu_types: gpuTypes.length, rejected } };
}

async function collectLambda({ maxItems, includeRawPayload }) {
  const key = process.env.LAMBDA_API_KEY;
  if (!key) return { items: [], skipped: 'LAMBDA_API_KEY is not configured' };
  const data = await fetchJson('https://cloud.lambdalabs.com/api/v1/instance-types', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!data.data || typeof data.data !== 'object') {
    throw new Error('Lambda response did not contain data');
  }
  const items = [];
  let rejected = 0;
  for (const wrapper of Object.values(data.data)) {
    try {
      const instance = wrapper.instance_type || wrapper;
      const specs = instance.specs || {};
      const gpuCount = Number(specs.gpus) || Number((instance.name.match(/gpu_(\d+)x_/) || [])[1]) || 1;
      const price = Number(instance.price_cents_per_hour) / 100;
      if (!Number.isFinite(price) || price < 0) throw new Error('invalid price');
      const description = instance.description || instance.name;
      const vramGb = parseVramGb(description) || parseVramGb(instance.name);
      const regions = Array.isArray(instance.regions_with_capacity_available)
        ? instance.regions_with_capacity_available
        : [];
      const variants = regions.length
        ? regions.map((region) => ({
            region: region.name,
            description: region.description || region.name,
            scope: 'live_inventory',
          }))
        : [{ region: null, description: null, scope: 'advertised' }];
      for (const variant of variants) {
        items.push(
          baseItem({
            provider: 'lambda',
            providerOfferId: `lambda:${instance.name}:${variant.region || 'advertised'}`,
            gpuModel: description,
            gpuCount,
            vramGb,
            cpuCores: number(specs.vcpus),
            ramGb: number(specs.memory_gib),
            diskGb: number(specs.storage_gib),
            region: variant.region,
            country: parseCountry(variant.description, variant.description),
            price,
            billingScope: 'per_instance_hour',
            availabilityScope: variant.scope,
            source: 'lambda_api',
            sourceUrl: 'https://cloud.lambdalabs.com/instances',
            sourceRecordId: instance.name,
            rawPayload: includeRawPayload ? instance : undefined,
            metadata: { instance_type: instance.name, region_description: variant.description },
          }),
        );
        if (items.length >= maxItems) break;
      }
    } catch {
      rejected += 1;
    }
    if (items.length >= maxItems) break;
  }
  return { items: items.slice(0, maxItems), diagnostics: { rejected } };
}

function humanizeTensorDockSlug(slug) {
  return String(slug)
    .replace(/[_-]+/g, ' ')
    .replace(/geforcertx/gi, 'GeForce RTX ')
    .replace(/geforcegtx/gi, 'GeForce GTX ')
    .replace(/rtxa(\d{4})/gi, 'RTX A$1 ')
    .replace(/rtx(\d{4})/gi, 'RTX $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function collectTensorDock({ maxItems, includeRawPayload }) {
  const key = process.env.TENSORDOCK_API_KEY;
  if (!key) return { items: [], skipped: 'TENSORDOCK_API_KEY is not configured' };
  const data = await fetchJson('https://dashboard.tensordock.com/api/v2/hostnodes', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const hostnodes = data.data?.hostnodes;
  if (!Array.isArray(hostnodes)) throw new Error('TensorDock response did not contain hostnodes');

  const items = [];
  let rejected = 0;
  for (const hostnode of hostnodes) {
    try {
      const resources = hostnode.available_resources || {};
      const gpus = Array.isArray(resources.gpus) ? resources.gpus : [];
      const location = hostnode.location || {};
      const region =
        [location.city, location.stateprovince, location.country].filter(Boolean).join(', ') || null;
      const country = parseCountry(location.country, region);
      const reliability =
        typeof hostnode.uptime_percentage === 'number'
          ? Math.round((hostnode.uptime_percentage / 100) * 10000) / 10000
          : null;
      for (const gpu of gpus) {
        const slug = gpu.v0Name;
        const price = number(gpu.price_per_hr);
        if (!slug || price === null) throw new Error('gpu missing slug or price');
        const vramMatch = String(slug).match(/-(\d+)gb\b/i);
        items.push(
          baseItem({
            provider: 'tensordock',
            providerOfferId: `tensordock:${hostnode.id}:${slug}`,
            gpuModel: humanizeTensorDockSlug(slug),
            gpuCount: 1,
            vramGb: vramMatch ? Number(vramMatch[1]) : null,
            region,
            country,
            price,
            billingScope: 'per_gpu_hour',
            availabilityScope: 'live_inventory',
            reliability,
            source: 'tensordock_api',
            sourceUrl: 'https://dashboard.tensordock.com/api/v2/hostnodes',
            sourceRecordId: `${hostnode.id}:${slug}`,
            rawPayload: includeRawPayload ? { gpu, ...hostnode } : undefined,
            metadata: {
              hostnode_id: hostnode.id,
              gpu_slug: slug,
              available_gpu_count: gpu.availableCount,
              host_vcpu_count: resources.vcpu_count,
              host_ram_gb: resources.ram_gb,
              host_storage_gb: resources.storage_gb,
            },
          }),
        );
        if (items.length >= maxItems) break;
      }
    } catch {
      rejected += 1;
    }
    if (items.length >= maxItems) break;
  }
  return { items: items.slice(0, maxItems), diagnostics: { hostnodes: hostnodes.length, rejected } };
}

const COLLECTORS = {
  vastai: collectVast,
  runpod: collectRunpod,
  lambda: collectLambda,
  tensordock: collectTensorDock,
};

await Actor.init();

try {
  const input = (await Actor.getInput()) || {};
  const providers = (Array.isArray(input.providers) ? input.providers : ['vastai', 'runpod']).filter(
    (provider) => PROVIDERS.includes(provider),
  );
  const maxItems = Math.max(1, Math.min(Number(input.maxItemsPerProvider) || 200, 1000));
  const minVram = Math.max(0, Number(input.minGpuMemoryGb) || 0);
  const includeRawPayload = input.includeRawPayload !== false;

  const results = await Promise.allSettled(
    providers.map((provider) =>
      COLLECTORS[provider]({ maxItems, includeRawPayload }).then((result) => ({
        provider,
        ...result,
      })),
    ),
  );

  const summary = { providers: {}, total_items: 0, started_at: new Date().toISOString() };
  const items = [];
  for (let index = 0; index < results.length; index += 1) {
    const provider = providers[index];
    const result = results[index];
    if (result.status === 'rejected') {
      summary.providers[provider] = {
        status: 'failed',
        error: String(result.reason?.message || result.reason).slice(0, 300),
        items: 0,
      };
      continue;
    }
    const { items: providerItems, skipped, diagnostics } = result.value;
    const filtered = providerItems.filter(
      (item) => item.vram_gb === null || item.vram_gb >= minVram,
    );
    items.push(...filtered);
    summary.providers[provider] = {
      status: skipped ? 'skipped' : 'succeeded',
      skipped: skipped || null,
      items: filtered.length,
      diagnostics: diagnostics || {},
    };
  }

  summary.total_items = items.length;
  summary.finished_at = new Date().toISOString();

  if (items.length > 0) {
    await Actor.pushData(items);
  }
  await Actor.setValue('SUMMARY', summary);
  console.log(JSON.stringify(summary, null, 2));
  await Actor.exit();
} catch (error) {
  console.error('Relay GPU Market Intelligence Actor failed', error);
  await Actor.setValue('SUMMARY', {
    status: 'failed',
    error: String(error?.message || error),
    finished_at: new Date().toISOString(),
  });
  await Actor.fail(String(error?.message || error));
}
