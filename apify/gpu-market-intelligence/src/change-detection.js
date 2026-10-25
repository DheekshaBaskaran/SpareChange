import { createHash } from 'node:crypto';

const DAY_MS = 86_400_000;

function eventId(provider, offerId, type, runId) {
  return `evt_${createHash('sha1')
    .update(`${provider}|${offerId}|${type}|${runId}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function micros(price) {
  return Math.round(Number(price) * 1_000_000);
}

function changePercent(previous, current) {
  const previousMicros = micros(previous);
  if (!Number.isFinite(previousMicros) || previousMicros === 0) return null;
  return Math.round(((micros(current) - previousMicros) / previousMicros) * 100 * 10_000) / 10_000;
}

function stateFor(offer, runId, observedAt, previous) {
  return {
    gpu_model: offer.gpu_model,
    gpu_model_normalized: offer.gpu_model_normalized,
    price_available: offer.price_available,
    price_per_hour_usd: offer.price_available ? offer.price_per_hour_usd : null,
    price_per_gpu_hour_usd: offer.price_available ? offer.price_per_gpu_hour_usd : null,
    available_gpu_count: offer.available_gpu_count,
    capacity_scope: offer.capacity_scope,
    first_seen_at: previous?.first_seen_at || observedAt,
    last_seen_at: observedAt,
    last_run_id: runId,
  };
}

function makeEvent({
  type,
  provider,
  offer,
  previous,
  runId,
  observedAt,
  complete,
  baseline,
  reason,
  availabilityChange,
  previousPrice,
  currentPrice,
  previousCapacity,
  currentCapacity,
}) {
  const priceAvailable =
    type === 'disappeared' ? Boolean(previous?.price_available) : Boolean(offer?.price_available);
  const percent =
    previousPrice !== null &&
    previousPrice !== undefined &&
    currentPrice !== null &&
    currentPrice !== undefined
      ? changePercent(previousPrice, currentPrice)
      : null;
  return {
    event_id: eventId(provider, offer?.provider_offer_id || previous?.provider_offer_id, type, runId),
    event_type: type,
    provider,
    provider_offer_id: offer?.provider_offer_id || previous?.provider_offer_id,
    gpu_model: offer?.gpu_model || previous?.gpu_model || 'UNKNOWN',
    gpu_model_normalized:
      offer?.gpu_model_normalized || previous?.gpu_model_normalized || 'UNKNOWN',
    price_available: priceAvailable,
    previous_price_per_hour_usd: previousPrice ?? null,
    current_price_per_hour_usd: currentPrice ?? null,
    price_change_percent: percent,
    previous_available_gpu_count: previousCapacity ?? null,
    current_available_gpu_count: currentCapacity ?? null,
    availability_change: availabilityChange,
    reason,
    observed_at: observedAt,
    actor_run_id: runId,
    metadata: {
      actor_run_id: runId,
      complete,
      baseline,
    },
  };
}

/**
 * Compare one provider's current offers with its previous state.
 *
 * `complete` must be false whenever a source truncated results or failed. In
 * that case unseen offers are retained and no disappearance events are
 * produced. An empty successful collection also never mass-disappears offers.
 */
export function computeProviderDiff({
  provider,
  previousProviderState = null,
  items,
  runId,
  observedAt,
  complete = true,
  emitBaselineEvents = false,
  priceChangeThresholdPercent = 1,
  retentionDays = 14,
}) {
  const previousOffers =
    previousProviderState?.offers && typeof previousProviderState.offers === 'object'
      ? previousProviderState.offers
      : {};
  const baseline = !previousProviderState || !previousProviderState.last_success_at;
  // A first observation is only reliably "new" when some earlier snapshot
  // covered the whole provider. For sampled sources (Vast.ai) no snapshot is
  // ever complete, so unseen IDs are never asserted as new listings.
  const previousWasComplete = Boolean(previousProviderState?.last_complete_at);
  const events = [];
  const nextOffers = {};
  const currentIds = new Set();
  const threshold = Math.max(0, Number(priceChangeThresholdPercent) || 0);

  for (const offer of items) {
    const id = offer.provider_offer_id;
    currentIds.add(id);
    const previous = previousOffers[id];
    nextOffers[id] = stateFor(offer, runId, observedAt, previous);

    if (!previous) {
      if ((baseline && emitBaselineEvents) || (!baseline && previousWasComplete)) {
        events.push(
          makeEvent({
            type: 'new',
            provider,
            offer,
            previous,
            runId,
            observedAt,
            complete,
            baseline,
            reason: 'new_offer',
            availabilityChange: 'appeared',
            previousPrice: null,
            currentPrice: offer.price_available ? offer.price_per_hour_usd : null,
            previousCapacity: null,
            currentCapacity: offer.available_gpu_count,
          }),
        );
      }
      continue;
    }

    const priceAvailabilityChanged =
      Boolean(previous.price_available) !== Boolean(offer.price_available);
    let priceChanged = false;
    if (previous.price_available && offer.price_available) {
      const previousMicros = micros(previous.price_per_hour_usd);
      const currentMicros = micros(offer.price_per_hour_usd);
      if (previousMicros !== currentMicros) {
        const percent =
          previousMicros === 0
            ? 100
            : Math.abs((currentMicros - previousMicros) / previousMicros) * 100;
        priceChanged = percent >= threshold;
      }
    }

    const previousCapacity = previous.available_gpu_count;
    const currentCapacity = offer.available_gpu_count;
    const capacityChanged =
      previousCapacity !== null &&
      previousCapacity !== undefined &&
      currentCapacity !== null &&
      currentCapacity !== undefined &&
      Number(previousCapacity) !== Number(currentCapacity);

    if (!priceAvailabilityChanged && !priceChanged && !capacityChanged) continue;

    let reason = 'price_changed';
    if (priceAvailabilityChanged) {
      reason = offer.price_available ? 'price_became_available' : 'price_became_unavailable';
    } else if (priceChanged && capacityChanged) {
      reason = 'price_and_capacity_change';
    } else if (priceChanged) {
      reason =
        micros(offer.price_per_hour_usd) > micros(previous.price_per_hour_usd)
          ? 'price_increase'
          : 'price_decrease';
    } else if (capacityChanged) {
      reason =
        Number(currentCapacity) > Number(previousCapacity)
          ? 'capacity_increase'
          : 'capacity_decrease';
    }

    events.push(
      makeEvent({
        type: 'updated',
        provider,
        offer,
        previous,
        runId,
        observedAt,
        complete,
        baseline,
        reason,
        availabilityChange: capacityChanged
          ? Number(currentCapacity) > Number(previousCapacity)
            ? 'capacity_increased'
            : 'capacity_decreased'
          : 'none',
        previousPrice: previous.price_available ? previous.price_per_hour_usd : null,
        currentPrice: offer.price_available ? offer.price_per_hour_usd : null,
        previousCapacity,
        currentCapacity,
      }),
    );
  }

  const canDisappear =
    complete === true && items.length > 0 && Boolean(previousProviderState?.last_success_at);
  for (const [id, previous] of Object.entries(previousOffers)) {
    if (currentIds.has(id)) continue;
    if (canDisappear) {
      events.push(
        makeEvent({
          type: 'disappeared',
          provider,
          offer: null,
          previous: { ...previous, provider_offer_id: id },
          runId,
          observedAt,
          complete,
          baseline,
          reason: 'no_longer_listed',
          availabilityChange: 'disappeared',
          previousPrice: previous.price_available ? previous.price_per_hour_usd : null,
          currentPrice: null,
          previousCapacity: previous.available_gpu_count,
          currentCapacity: null,
        }),
      );
      continue;
    }
    nextOffers[id] = previous;
  }

  const cutoff = Date.parse(observedAt) - Math.max(1, Number(retentionDays) || 14) * DAY_MS;
  for (const [id, value] of Object.entries(nextOffers)) {
    const seen = Date.parse(value.last_seen_at);
    if (Number.isFinite(seen) && seen < cutoff) {
      delete nextOffers[id];
    }
  }

  const counts = {
    new: events.filter((event) => event.event_type === 'new').length,
    updated: events.filter((event) => event.event_type === 'updated').length,
    disappeared: events.filter((event) => event.event_type === 'disappeared').length,
    current: Object.keys(nextOffers).length,
  };

  return {
    events,
    nextState: {
      last_run_id: runId,
      last_success_at: observedAt,
      last_complete_at: complete ? observedAt : previousProviderState?.last_complete_at || null,
      offers: nextOffers,
    },
    counts,
    baseline,
  };
}

export function emptyState() {
  return {
    version: 1,
    updated_at: null,
    providers: {},
  };
}
