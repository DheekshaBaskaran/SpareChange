import { Actor } from 'apify';

import { computeProviderDiff, emptyState } from './change-detection.js';
import { filterOffers } from './normalization.js';
import { COLLECTORS, PROVIDER_DISPLAY, PROVIDERS } from './providers/index.js';
import { newProviderStats } from './providers/http.js';
import { pushToRelay } from './relay.js';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim());
  return [];
}

function asInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyProviderSummary(provider) {
  return {
    provider,
    display_name: PROVIDER_DISPLAY[provider] || provider,
    status: 'failed',
    raw_items: 0,
    items: 0,
    complete: false,
    duration_ms: 0,
    diagnostics: {},
    stats: {},
    filters: {},
    events: { new: 0, updated: 0, disappeared: 0 },
    error: null,
  };
}

await Actor.init();

const startedAt = new Date().toISOString();
const startedMs = Date.now();
const env = Actor.getEnv();
const runId =
  env.actorRunId || process.env.APIFY_ACTOR_RUN_ID || `local-${startedMs}`;
const summary = {
  status: 'failed',
  actor: 'relay-gpu-market-intelligence',
  actor_id: env.actorId || null,
  run_id: runId,
  started_at: startedAt,
  finished_at: null,
  duration_ms: 0,
  providers: {},
  totals: {
    raw_offers: 0,
    offers: 0,
    priced: 0,
    unpriced: 0,
    providers_succeeded: 0,
    providers_failed: 0,
    events: { new: 0, updated: 0, disappeared: 0, total: 0 },
  },
  filters: {},
  change_detection: {
    enabled: true,
    baseline: true,
    state_store: 'market-state',
    state_key: 'MARKET_STATE',
    state_saved: false,
    emit_baseline_events: false,
    price_threshold_percent: 1,
  },
  datasets: {
    offers_dataset_id: env.defaultDatasetId || null,
    events_dataset_id: null,
  },
  relay_push: null,
  warnings: [],
};

try {
  const input = (await Actor.getInput()) || {};
  const requested = asArray(input.providers)
    .map((provider) => String(provider).toLowerCase())
    .filter((provider) => PROVIDERS.includes(provider));
  const providers = requested.length ? [...new Set(requested)] : [...PROVIDERS];
  const maxItemsPerProvider = Math.max(1, Math.min(asInt(input.maxItemsPerProvider, 300), 1000));
  const filters = {
    gpuModels: asArray(input.gpuModels),
    minGpuMemoryGb: Math.max(0, Number(input.minGpuMemoryGb) || 0),
    maxPricePerGpuHourUsd:
      input.maxPricePerGpuHourUsd === null || input.maxPricePerGpuHourUsd === undefined
        ? null
        : Math.max(0, Number(input.maxPricePerGpuHourUsd)),
    regions: asArray(input.regions),
    countries: asArray(input.countries),
  };
  const filtersActive =
    filters.gpuModels.length > 0 ||
    filters.minGpuMemoryGb > 0 ||
    filters.maxPricePerGpuHourUsd !== null ||
    filters.regions.length > 0 ||
    filters.countries.length > 0;

  const includeRawPayload = input.includeRawPayload !== false;
  const detectChanges = input.detectChanges !== false;
  const emitBaselineEvents = input.emitBaselineEvents === true;
  const priceChangeThresholdPercent = Math.max(
    0,
    Number(input.priceChangeThresholdPercent ?? 1),
  );
  const stateRetentionDays = Math.max(1, Math.min(asInt(input.stateRetentionDays, 14), 90));
  const stateKey = String(input.stateKey || 'MARKET_STATE');
  const pushEnabled = input.pushToRelay === true;
  const relayIngestUrl = input.relayIngestUrl || process.env.RELAY_INGEST_URL || '';
  const relayToken = process.env.RELAY_INGEST_TOKEN || '';

  Object.assign(summary.filters, filters, {
    active: filtersActive,
    max_items_per_provider: maxItemsPerProvider,
    include_raw_payload: includeRawPayload,
  });
  summary.change_detection = {
    enabled: detectChanges,
    baseline: true,
    state_store: 'market-state',
    state_key: stateKey,
    state_saved: false,
    emit_baseline_events: emitBaselineEvents,
    price_threshold_percent: priceChangeThresholdPercent,
  };

  if (pushEnabled && (!relayIngestUrl || !relayToken)) {
    throw new Error(
      'pushToRelay requires relayIngestUrl (or RELAY_INGEST_URL) and RELAY_INGEST_TOKEN',
    );
  }

  let previousState = emptyState();
  const stateStore = detectChanges
    ? await Actor.openKeyValueStore('market-state')
    : null;
  if (detectChanges && stateStore) {
    const stored = await stateStore.getValue(stateKey);
    if (stored && typeof stored === 'object') {
      previousState = {
        version: stored.version || 1,
        updated_at: stored.updated_at || null,
        providers:
          stored.providers && typeof stored.providers === 'object' ? stored.providers : {},
      };
    }
  }
  const nextState = clone(previousState);

  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const stats = newProviderStats();
      const start = Date.now();
      const result = await COLLECTORS[provider]({
        maxItems: maxItemsPerProvider,
        includeRawPayload,
        observedAt: startedAt,
        stats,
      });
      return { ...result, stats, duration_ms: Date.now() - start };
    }),
  );

  const allOffers = [];
  const allEvents = [];

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const outcome = results[index];
    const providerSummary = emptyProviderSummary(provider);
    summary.providers[provider] = providerSummary;

    if (outcome.status === 'rejected') {
      const error = outcome.reason;
      providerSummary.error = String(error?.message || error).slice(0, 300);
      providerSummary.diagnostics = {
        error_type: error?.name || 'Error',
        retryable: Boolean(error?.retryable),
      };
      summary.totals.providers_failed += 1;
      summary.warnings.push(`${provider}: ${providerSummary.error}`);
      continue;
    }

    const result = outcome.value;
    providerSummary.status = 'succeeded';
    providerSummary.raw_items = result.items.length;
    providerSummary.complete = result.complete === true;
    providerSummary.duration_ms = result.duration_ms;
    providerSummary.diagnostics = result.diagnostics || {};
    providerSummary.stats = result.stats;
    summary.totals.providers_succeeded += 1;

    const filtered = filterOffers(result.items, filters);
    providerSummary.items = filtered.items.length;
    providerSummary.filters = filtered.rejected;
    summary.totals.raw_offers += result.items.length;
    summary.totals.priced += filtered.items.filter((offer) => offer.price_available).length;
    summary.totals.unpriced += filtered.items.filter((offer) => !offer.price_available).length;
    allOffers.push(...filtered.items);

    if (detectChanges) {
      const diff = computeProviderDiff({
        provider,
        previousProviderState: previousState.providers[provider] || null,
        items: result.items,
        runId,
        observedAt: startedAt,
        complete: result.complete === true,
        emitBaselineEvents,
        priceChangeThresholdPercent,
        retentionDays: stateRetentionDays,
      });
      providerSummary.events = {
        new: diff.counts.new,
        updated: diff.counts.updated,
        disappeared: diff.counts.disappeared,
      };
      allEvents.push(...diff.events);
      nextState.providers[provider] = diff.nextState;
      if (diff.baseline) summary.change_detection.baseline = true;
    }
  }

  summary.change_detection.baseline =
    Object.keys(previousState.providers).length === 0 ||
    Object.values(previousState.providers).every((state) => !state.last_success_at);
  summary.totals.offers = allOffers.length;
  summary.totals.events = {
    new: allEvents.filter((event) => event.event_type === 'new').length,
    updated: allEvents.filter((event) => event.event_type === 'updated').length,
    disappeared: allEvents.filter((event) => event.event_type === 'disappeared').length,
    total: allEvents.length,
  };

  if (allOffers.length) {
    await Actor.pushData(allOffers);
  }

  if (allEvents.length) {
    const eventsDataset = await Actor.openDataset({ alias: 'events' });
    await eventsDataset.pushData(allEvents);
    summary.datasets.events_dataset_id = eventsDataset.id || null;
  }

  if (summary.totals.providers_succeeded === 0) {
    summary.status = 'failed';
    summary.finished_at = new Date().toISOString();
    summary.duration_ms = Date.now() - startedMs;
    await Actor.setValue('SUMMARY', summary);
    console.error(JSON.stringify(summary, null, 2));
    await Actor.fail('All configured providers failed; no market data was emitted.');
  }

  summary.status =
    summary.totals.providers_failed > 0 ? 'partial' : 'succeeded';

  if (pushEnabled) {
    summary.relay_push = await pushToRelay({
      baseUrl: relayIngestUrl,
      token: relayToken,
      runId,
      offers: allOffers,
      events: allEvents,
    });
    if (!summary.relay_push.ok) {
      // Collection succeeded and the dataset is durable. A relay outage must
      // not turn a successful collection into a failed Actor run; the backend
      // can replay the run later, and state is left unchanged so the next run
      // can recompute any events that were not delivered.
      summary.status = 'partial';
      summary.warnings.push(
        `Relay push incomplete: ${summary.relay_push.failures
          .map((failure) => failure.error)
          .join('; ')}`,
      );
    }
  }

  if (
    detectChanges &&
    summary.totals.providers_succeeded > 0 &&
    (summary.relay_push === null || summary.relay_push.ok)
  ) {
    nextState.updated_at = new Date().toISOString();
    await stateStore.setValue(stateKey, nextState);
    summary.change_detection.state_saved = true;
  }

  summary.finished_at = new Date().toISOString();
  summary.duration_ms = Date.now() - startedMs;
  await Actor.setValue('SUMMARY', summary);
  console.log(JSON.stringify(summary, null, 2));
  await Actor.exit();
} catch (error) {
  summary.status = 'failed';
  summary.finished_at = new Date().toISOString();
  summary.duration_ms = Date.now() - startedMs;
  summary.error = String(error?.message || error).slice(0, 500);
  await Actor.setValue('SUMMARY', summary);
  console.error('Relay GPU Market Intelligence Actor failed', error);
  await Actor.fail(summary.error);
}
