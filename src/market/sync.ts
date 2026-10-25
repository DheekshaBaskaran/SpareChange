import type { MarketBridgeConfig } from "../config.js";
import type { Db } from "../db/client.js";
import { MarketApiClient, type MarketOfferItem, type MarketProviderRecord } from "./client.js";
import { marketOfferId, providerPartyId } from "./uuid.js";

/**
 * Materializes Market Intelligence's fresh public listings into
 * `relay.market_offers`.
 *
 * Duo 1 only reads the market tables; every write here comes from the market
 * API so normalization, dedupe, and trust tiers stay in one place. Bridge rows
 * are `external_reference` offers: they are quotable and comparable, but they
 * are never `executable`, because a public listing is not an authorized rental
 * Relay may transact on.
 */

export const BRIDGE_MARKER = "market-intelligence-v1";

export interface MarketSyncResult {
  started_at: string;
  finished_at: string;
  duration_ms: number;
  fetched: number;
  upserted: number;
  skipped: number;
  providers: number;
  expired: number;
  pages: number;
}

export interface MarketBridgeStatus {
  enabled: boolean;
  api_url: string;
  syncing: boolean;
  interval_ms: number;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_result: MarketSyncResult | null;
}

interface OfferRow {
  id: string;
  provider_id: string;
  source: string;
  external_ref: string;
  gpu_model: string;
  gpu_count: number;
  cpu_cores: number;
  memory_gb: number;
  rate_minor_per_gpu_hour: number;
  currency: string;
  location: string | null;
  observed_at: string;
  expires_at: string;
  executable: boolean;
  metadata: Record<string, unknown>;
}

const MAX_PAGES = 50;

function providerDisplayName(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function integer(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

export class MarketSyncService {
  private readonly client: MarketApiClient;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<MarketSyncResult> | null = null;
  private lastPages = 0;
  private lastSyncAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;
  private lastResult: MarketSyncResult | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: MarketBridgeConfig,
    private readonly onError: (error: unknown) => void = () => {},
  ) {
    this.client = new MarketApiClient({
      baseUrl: config.apiUrl,
      token: config.token,
      timeoutMs: 20_000,
    });
  }

  start(): void {
    if (this.timer || this.config.syncIntervalMs <= 0) return;
    // Seed once at boot so a restart does not leave the solver blind for a
    // whole interval; it never blocks startup.
    void this.syncNow().catch(this.onError);
    this.timer = setInterval(() => {
      void this.syncNow().catch(this.onError);
    }, this.config.syncIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  status(): MarketBridgeStatus {
    return {
      enabled: true,
      api_url: this.config.apiUrl,
      syncing: this.running !== null,
      interval_ms: this.config.syncIntervalMs,
      last_sync_at: this.lastSyncAt,
      last_success_at: this.lastSuccessAt,
      last_error: this.lastError,
      last_result: this.lastResult,
    };
  }

  /** Concurrent callers share one pass instead of stacking API traffic. */
  async syncNow(): Promise<MarketSyncResult> {
    if (this.running) return this.running;
    const run = this.run().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async run(): Promise<MarketSyncResult> {
    const startedAt = new Date();
    this.lastSyncAt = startedAt.toISOString();
    try {
      const [offers, providers] = await Promise.all([
        this.fetchOffers(),
        this.client.listProviders().catch(() => [] as MarketProviderRecord[]),
      ]);
      const names = new Map(providers.map((record) => [record.provider, record.display_name]));
      const result = await this.persist(offers, names, startedAt);
      this.lastSuccessAt = result.finished_at;
      this.lastResult = result;
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async fetchOffers(): Promise<MarketOfferItem[]> {
    const collected: MarketOfferItem[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;

    while (pages < MAX_PAGES && collected.length < this.config.maxOffers) {
      const page = await this.client.listOffers({ limit: 200, cursor, freshness: "fresh" });
      pages += 1;
      for (const offer of page.items ?? []) {
        const key = `${offer.provider}:${offer.provider_offer_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(offer);
        if (collected.length >= this.config.maxOffers) break;
      }
      cursor = page.next_cursor ?? null;
      if (!cursor || (page.items ?? []).length === 0) break;
    }
    this.lastPages = pages;
    return collected;
  }

  private async persist(
    offers: MarketOfferItem[],
    displayNames: Map<string, string>,
    startedAt: Date,
  ): Promise<MarketSyncResult> {
    const now = Date.now();
    const rows: OfferRow[] = [];
    const providerIds = new Map<string, { id: string; name: string }>();
    let skipped = 0;

    for (const offer of offers) {
      const rate = offer.price_per_gpu_hour_minor;
      if (
        !offer.price_available ||
        typeof rate !== "number" ||
        !Number.isFinite(rate) ||
        rate < 0 ||
        !Number.isInteger(offer.gpu_count) ||
        offer.gpu_count < 1
      ) {
        skipped += 1;
        continue;
      }

      const providerId = providerPartyId(offer.provider);
      if (!providerIds.has(offer.provider)) {
        providerIds.set(offer.provider, {
          id: providerId,
          name: displayNames.get(offer.provider) ?? providerDisplayName(offer.provider),
        });
      }

      const observedMs = Date.parse(offer.observed_at);
      const publishedExpiry = Date.parse(offer.expires_at);
      const scopeTtlMs =
        offer.availability_scope === "live_inventory"
          ? this.config.offerTtlSeconds * 1_000
          : this.config.advertisedOfferTtlSeconds * 1_000;
      // Honor the market's expiry, but never outlive the bridge's own TTL: a
      // stale listing must not keep influencing a quote.
      const expiresAt = Math.min(
        Number.isFinite(publishedExpiry) ? publishedExpiry : now + scopeTtlMs,
        now + scopeTtlMs,
      );

      rows.push({
        id: marketOfferId(offer.provider, offer.provider_offer_id),
        provider_id: providerId,
        source: "external_reference",
        external_ref: `${offer.provider}:${offer.provider_offer_id}`,
        // Canonical identity keeps `workloads.gpu_model` matching exact, which
        // is what the solver and /v1/offers rely on. The provider's own label
        // travels in metadata for display.
        gpu_model: offer.gpu_model_normalized,
        gpu_count: offer.gpu_count,
        cpu_cores: integer(offer.cpu_cores),
        memory_gb: integer(offer.vram_gb),
        rate_minor_per_gpu_hour: rate,
        currency: offer.currency || "USD",
        location: offer.region ?? offer.country ?? null,
        observed_at: new Date(Number.isFinite(observedMs) ? observedMs : now).toISOString(),
        expires_at: new Date(Math.max(expiresAt, now + 60_000)).toISOString(),
        executable: false,
        metadata: {
          bridge: BRIDGE_MARKER,
          provider: offer.provider,
          provider_offer_id: offer.provider_offer_id,
          market_offer_id: offer.id,
          gpu_model_display: offer.gpu_model,
          trust_tier: offer.trust_tier,
          market_freshness: offer.freshness,
          availability_scope: offer.availability_scope,
          billing_scope: offer.billing_scope,
          pricing_model: offer.pricing_model,
          price_per_hour_minor: offer.price_per_hour_minor,
          price_per_hour_micros: offer.price_per_hour_micros,
          price_per_gpu_hour_micros: offer.price_per_gpu_hour_micros,
          available_gpu_count: offer.available_gpu_count,
          source_url: offer.source_url,
          source_record_id: offer.source_record_id,
          reliability: offer.reliability,
          ingested_at: offer.ingested_at,
          synced_at: new Date(now).toISOString(),
        },
      });
    }

    let upserted = 0;
    await this.db.transaction(async (tx) => {
      if (providerIds.size > 0) {
        const parties = [...providerIds.values()];
        await tx.query(
          `INSERT INTO parties (id, kind, name)
           SELECT id, 'provider', name
           FROM jsonb_to_recordset($1::jsonb) AS p(id uuid, name text)
           ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name, updated_at = now()`,
          [JSON.stringify(parties)],
        );
      }

      // One statement per chunk keeps the round trips low without exceeding
      // PostgreSQL's parameter budget on a large mirror.
      for (let index = 0; index < rows.length; index += 250) {
        const chunk = rows.slice(index, index + 250);
        const result = await tx.query(
          `INSERT INTO market_offers
             (id, provider_id, source, external_ref, gpu_model, gpu_count, cpu_cores,
              memory_gb, rate_minor_per_gpu_hour, currency, location, available_from,
              available_until, observed_at, expires_at, executable, authorization_id, metadata)
           SELECT id, provider_id, source, external_ref, gpu_model, gpu_count, cpu_cores,
                  memory_gb, rate_minor_per_gpu_hour, currency, location, NULL,
                  NULL, observed_at, expires_at, executable, NULL, metadata
           FROM jsonb_to_recordset($1::jsonb) AS o(
             id uuid, provider_id uuid, source text, external_ref text, gpu_model text,
             gpu_count integer, cpu_cores integer, memory_gb integer,
             rate_minor_per_gpu_hour bigint, currency char(3), location text,
             observed_at timestamptz, expires_at timestamptz, executable boolean,
             metadata jsonb)
           ON CONFLICT (id) DO UPDATE SET
             provider_id = EXCLUDED.provider_id,
             external_ref = EXCLUDED.external_ref,
             gpu_model = EXCLUDED.gpu_model,
             gpu_count = EXCLUDED.gpu_count,
             cpu_cores = EXCLUDED.cpu_cores,
             memory_gb = EXCLUDED.memory_gb,
             rate_minor_per_gpu_hour = EXCLUDED.rate_minor_per_gpu_hour,
             currency = EXCLUDED.currency,
             location = EXCLUDED.location,
             observed_at = EXCLUDED.observed_at,
             expires_at = EXCLUDED.expires_at,
             metadata = EXCLUDED.metadata`,
          [JSON.stringify(chunk)],
        );
        upserted += result.rowCount;
      }
    });

    // Rows the market stopped publishing simply age out through expires_at;
    // deleting them would destroy the audit trail of what a past quote saw.
    const expired = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_offers
        WHERE source = 'external_reference'
          AND metadata->>'bridge' = $1
          AND expires_at <= now()`,
      [BRIDGE_MARKER],
    );

    const finishedAt = new Date();
    return {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      fetched: offers.length,
      upserted,
      skipped,
      providers: providerIds.size,
      expired: Number(expired.rows[0]?.count ?? 0),
      pages: this.lastPages,
    };
  }
}
