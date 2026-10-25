import { buildOffer, toNumber } from '../normalization.js';
import { fetchJson } from './http.js';

export const PROVIDER = 'runpod';

const GPU_TYPES_QUERY = `
  query RelayGpuMarket {
    gpuTypes {
      id
      displayName
      memoryInGb
      secureCloud
      communityCloud
      lowestPrice(input: {gpuCount: 1}) {
        minimumBidPrice
        uninterruptablePrice
      }
    }
  }
`;

export async function collectRunpod({ maxItems, includeRawPayload, observedAt, stats, fetchImpl }) {
  const headers = {};
  if (process.env.RUNPOD_API_KEY) {
    headers.Authorization = `Bearer ${process.env.RUNPOD_API_KEY}`;
  }
  const data = await fetchJson('https://api.runpod.io/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: GPU_TYPES_QUERY }),
    stats,
    fetchImpl,
  });
  if (data?.errors) {
    throw new Error(`RunPod GraphQL error: ${data.errors[0]?.message || 'unknown'}`);
  }
  const gpuTypes = data?.data?.gpuTypes;
  if (!Array.isArray(gpuTypes)) {
    throw new Error('RunPod response did not contain gpuTypes');
  }

  const generated = [];
  let rejected = 0;
  const reasons = {};
  for (const gpu of gpuTypes) {
    try {
      const onDemand = toNumber(gpu.lowestPrice?.uninterruptablePrice);
      const spot = toNumber(gpu.lowestPrice?.minimumBidPrice);
      const price = onDemand && onDemand > 0 ? onDemand : spot;
      if (!price || price <= 0) throw new Error('no price');

      for (const [tier, enabled] of [
        ['secure_cloud', gpu.secureCloud],
        ['community_cloud', gpu.communityCloud],
      ]) {
        if (!enabled) continue;
        generated.push(
          buildOffer({
            provider: PROVIDER,
            providerOfferId: `runpod:${gpu.id}:${tier}`,
            gpuModel: gpu.id,
            gpuCount: 1,
            vramGb: toNumber(gpu.memoryInGb),
            region: tier.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
            price,
            billingScope: 'per_gpu_hour',
            availabilityScope: 'advertised',
            source: 'runpod_graphql',
            sourceUrl: 'https://www.runpod.io/pricing',
            sourceRecordId: gpu.id,
            observedAt,
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
      }
    } catch (error) {
      rejected += 1;
      const reason = String(error.message || error).slice(0, 160);
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
  }

  const items = generated.slice(0, maxItems);
  return {
    items,
    complete: generated.length <= maxItems,
    diagnostics: {
      gpu_types: gpuTypes.length,
      emitted_before_limit: generated.length,
      emitted: items.length,
      truncated: generated.length > maxItems,
      rejected,
      rejected_reasons: reasons,
      endpoint: 'https://api.runpod.io/graphql',
      authenticated: Boolean(process.env.RUNPOD_API_KEY),
    },
  };
}
