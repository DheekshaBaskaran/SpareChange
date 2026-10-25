const USER_AGENT = 'RelayMarketIntelligenceActor/1.0 (+https://relay.market)';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 4;
const MAX_RETRY_DELAY_MS = 30_000;

export class HttpError extends Error {
  constructor(message, { status = null, url = null, retryable = false } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms) {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(MAX_RETRY_DELAY_MS, seconds * 1000));
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.min(MAX_RETRY_DELAY_MS, date - Date.now()));
  }
  return null;
}

function bodyExcerpt(text) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, 200);
}

export async function fetchJson(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    stats = null,
    attempts = MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = {},
) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (stats) stats.requests += 1;
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 429 || response.status >= 500) {
        lastError = new HttpError(`${url} returned HTTP ${response.status}`, {
          status: response.status,
          url,
          retryable: true,
        });
        if (attempt < attempts) {
          if (stats) {
            stats.retries += 1;
            if (response.status === 429) stats.rate_limit_retries += 1;
          }
          const delay = retryAfterMs(response) ?? jitter(500 * 2 ** (attempt - 1));
          await sleep(Math.min(delay, MAX_RETRY_DELAY_MS));
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new HttpError(`${url} returned HTTP ${response.status}: ${bodyExcerpt(text)}`, {
          status: response.status,
          url,
          retryable: false,
        });
      }

      try {
        return await response.json();
      } catch {
        throw new HttpError(`${url} returned non-JSON content`, {
          status: response.status,
          url,
          retryable: false,
        });
      }
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && !error.retryable) throw error;
      if (attempt >= attempts) break;
      if (stats) stats.retries += 1;
      await sleep(jitter(500 * 2 ** (attempt - 1)));
    }
  }
  if (lastError instanceof HttpError) throw lastError;
  throw new HttpError(`${url} failed: ${lastError?.message || 'unknown network error'}`, {
    url,
    retryable: true,
  });
}

export function newProviderStats() {
  return {
    requests: 0,
    retries: 0,
    rate_limit_retries: 0,
    started_at: new Date().toISOString(),
  };
}
