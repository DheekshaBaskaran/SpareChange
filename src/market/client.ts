/**
 * Read-only client for the Relay Market Intelligence API.
 *
 * Market Intelligence (Python) is the system of record for public GPU listings
 * (see contracts/market-intelligence.openapi.json). This client only reads, so
 * the market service keeps owning validation, dedupe, trust tiers, and
 * freshness. Duo 1 mirrors what it needs for quoting and settlement.
 */

export type MarketFreshness = "fresh" | "stale" | "expired";

export interface MarketOfferItem {
  id: string;
  provider: string;
  provider_offer_id: string;
  gpu_model: string;
  gpu_model_normalized: string;
  gpu_count: number;
  vram_gb: number | null;
  cpu_cores: number | null;
  ram_gb: number | null;
  disk_gb: number | null;
  region: string | null;
  country: string | null;
  price_per_hour_minor: number;
  price_per_hour_micros: number;
  price_per_gpu_hour_minor: number;
  price_per_gpu_hour_micros: number;
  currency: string;
  billing_scope: string;
  availability_scope: string;
  executable: boolean;
  price_available: boolean;
  pricing_model: string;
  available_gpu_count: number | null;
  capacity_scope: string;
  source: string;
  source_url: string | null;
  source_record_id: string | null;
  trust_tier: string;
  freshness: MarketFreshness;
  observed_at: string;
  expires_at: string;
  ingested_at: string;
  reliability: number | null;
  raw_hash: string;
  metadata: Record<string, unknown>;
}

export interface MarketOfferPage {
  items: MarketOfferItem[];
  next_cursor: string | null;
  generated_at: string;
  filters?: Record<string, unknown>;
}

export interface MarketProviderRecord {
  provider: string;
  display_name: string;
  enabled: boolean;
  status: string;
  pricing_model: string;
  collection_mode: string;
  trust_tier: string;
  freshness_ttl_seconds: number;
  last_success_at: string | null;
}

export interface MarketSummary {
  generated_at: string;
  window: string;
  currency: string;
  offers: {
    total: number;
    fresh: number;
    providers: number;
    executable: number;
    priced: number;
    unpriced: number;
  };
  gpus: Array<{
    gpu_model_normalized: string;
    provider_count: number;
    fresh_offer_count: number;
    median_price_per_gpu_hour_micros: number | null;
    min_price_per_gpu_hour_micros: number | null;
    change_percent: number | null;
  }>;
}

export class MarketApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "MarketApiError";
  }
}

export interface MarketClientOptions {
  baseUrl: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class MarketApiClient {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: MarketClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    // Public reads do not require a token, but deployments may protect reads.
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new MarketApiError(`market API request failed: ${message}`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new MarketApiError(
        `market API HTTP ${response.status}: ${body.slice(0, 300)}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  async listOffers(
    options: {
      limit?: number;
      cursor?: string | null;
      freshness?: string;
      gpuModel?: string | null;
      provider?: string | null;
    } = {},
  ): Promise<MarketOfferPage> {
    const params = new URLSearchParams();
    // The API caps `limit` at 200; anything larger is rejected with a 422.
    params.set("limit", String(Math.min(Math.max(options.limit ?? 200, 1), 200)));
    params.set("sort", "price");
    if (options.freshness) params.set("freshness", options.freshness);
    if (options.gpuModel) params.set("gpu_model", options.gpuModel);
    if (options.provider) params.set("provider", options.provider);
    if (options.cursor) params.set("cursor", options.cursor);
    return this.get<MarketOfferPage>(`/v1/market/offers?${params.toString()}`);
  }

  async listProviders(): Promise<MarketProviderRecord[]> {
    return this.get<MarketProviderRecord[]>("/v1/market/providers");
  }

  async summary(window: "1h" | "24h" | "7d" | "30d" = "24h"): Promise<MarketSummary> {
    return this.get<MarketSummary>(`/v1/market/summary?window=${window}`);
  }

  async healthy(): Promise<boolean> {
    try {
      await this.summary();
      return true;
    } catch {
      return false;
    }
  }
}
