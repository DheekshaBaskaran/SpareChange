import { buildOffer, parseCountry, toNumber } from '../normalization.js';
import { fetchJson } from './http.js';

export const PROVIDER = 'vastai';
const MAX_VAST = 500;

export async function collectVast({ maxItems, includeRawPayload, observedAt, stats, fetchImpl }) {
  const limit = Math.max(1, Math.min(maxItems, MAX_VAST));
  const query = {
    verified: { eq: true },
    rentable: { eq: true },
    order: [['dph_total', 'asc']],
    limit,
  };
  const headers = {};
  if (process.env.VASTAI_API_KEY) {
    headers.Authorization = `Bearer ${process.env.VASTAI_API_KEY}`;
  }

  const data = await fetchJson(
    `https://console.vast.ai/api/v0/bundles/?q=${encodeURIComponent(JSON.stringify(query))}`,
    { headers, stats, fetchImpl },
  );
  if (!Array.isArray(data?.offers)) {
    throw new Error('Vast.ai response did not contain an offers array');
  }

  const items = [];
  let rejected = 0;
  const reasons = {};
  for (const raw of data.offers) {
    try {
      const gpuCount = Number(raw.num_gpus) || 1;
      const price = raw.dph_total ?? raw.dph_base;
      const vramMb = toNumber(raw.gpu_total_ram) ?? toNumber(raw.gpu_ram);
      const ramMb = toNumber(raw.cpu_ram);
      const region = raw.geolocation || null;
      const reliability = toNumber(raw.reliability2) ?? toNumber(raw.reliability);
      items.push(
        buildOffer({
          provider: PROVIDER,
          providerOfferId: raw.id,
          gpuModel: raw.gpu_name,
          gpuCount,
          vramGb: vramMb ? Math.round((vramMb / 1024) * 100) / 100 : null,
          cpuCores: toNumber(raw.cpu_cores_effective) ?? toNumber(raw.cpu_cores),
          ramGb: ramMb ? Math.round((ramMb / 1024) * 100) / 100 : null,
          diskGb: toNumber(raw.disk_space),
          region,
          country: parseCountry(region),
          price,
          billingScope: 'per_instance_hour',
          availabilityScope: 'live_inventory',
          reliability:
            reliability === null ? null : Math.min(1, Math.max(0, Number(reliability))),
          source: 'vastai_api',
          sourceUrl: 'https://console.vast.ai/api/v0/bundles/',
          sourceRecordId: raw.id,
          observedAt,
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
    } catch (error) {
      rejected += 1;
      const reason = String(error.message || error).slice(0, 160);
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
    if (items.length >= limit) break;
  }

  // The public Vast search returns a capped sample, not the full inventory:
  // repeated calls return a different set even with the same query and no
  // pagination is exposed. A result can therefore never prove that an unseen
  // offer disappeared, regardless of the provider's `truncated` flag.
  const sourceTruncated = data.truncated === true;
  return {
    items,
    complete: false,
    diagnostics: {
      returned: data.offers.length,
      limit,
      sampled: true,
      source_truncated: sourceTruncated,
      truncated: true,
      rejected,
      rejected_reasons: reasons,
      endpoint: 'https://console.vast.ai/api/v0/bundles/',
    },
  };
}
