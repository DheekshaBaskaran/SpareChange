const MAX_ATTEMPTS = 3;
const CHUNK_SIZE = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function isRetryableStatus(status) {
  return status >= 500 || status === 429;
}

async function postJson(url, body, token, { attempts = MAX_ATTEMPTS, fetchImpl = fetch } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retryable = true;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (response.ok) return parsed;
      const message = parsed?.error?.message || parsed?.detail || text.slice(0, 200);
      lastError = new Error(`Relay ingestion HTTP ${response.status}: ${message}`);
      retryable = isRetryableStatus(response.status);
    } catch (error) {
      lastError = error;
    }
    if (!retryable) throw lastError;
    if (attempt < attempts) await sleep(1_000 * 2 ** (attempt - 1));
  }
  throw lastError || new Error('Relay ingestion failed');
}

export async function pushToRelay({
  baseUrl,
  token,
  runId,
  offers,
  events,
  fetchImpl = fetch,
}) {
  if (!baseUrl) throw new Error('relayIngestUrl or RELAY_INGEST_URL is required');
  if (!token) throw new Error('RELAY_INGEST_TOKEN is required');
  const base = trimBaseUrl(baseUrl);

  const grouped = new Map();
  for (const offer of offers) {
    if (!grouped.has(offer.provider)) grouped.set(offer.provider, []);
    grouped.get(offer.provider).push(offer);
  }

  const offerRuns = [];
  const failures = [];
  for (const [provider, providerItems] of grouped) {
    try {
      const response = await postJson(
        `${base}/v1/admin/ingestion/runs`,
        {
          provider,
          mode: 'items',
          limit_per_provider: Math.max(1, Math.min(providerItems.length, 1000)),
          idempotency_key: `apify:${runId}:${provider}`,
          items: providerItems,
        },
        token,
        { fetchImpl },
      );
      for (const run of response?.runs || []) {
        offerRuns.push({
          provider,
          run_id: run.run_id,
          status: run.status,
          fetched: run.fetched,
          inserted: run.inserted,
          duplicate: run.duplicate,
          rejected: run.rejected,
        });
      }
    } catch (error) {
      failures.push({ stage: 'offers', provider, error: String(error.message || error).slice(0, 300) });
    }
  }

  let eventResult = { received: 0, inserted: 0, duplicate: 0 };
  if (events.length) {
    for (let index = 0; index < events.length; index += CHUNK_SIZE) {
      try {
        const response = await postJson(
          `${base}/v1/admin/market/events`,
          { actor_run_id: runId, events: events.slice(index, index + CHUNK_SIZE) },
          token,
          { fetchImpl },
        );
        eventResult.received += response?.received || 0;
        eventResult.inserted += response?.inserted || 0;
        eventResult.duplicate += response?.duplicate || 0;
      } catch (error) {
        failures.push({
          stage: 'events',
          error: String(error.message || error).slice(0, 300),
        });
      }
    }
  }

  return {
    ok: failures.length === 0,
    base_url: base,
    offer_runs: offerRuns,
    events: eventResult,
    failures,
  };
}
