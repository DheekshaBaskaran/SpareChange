// ─────────────────────────────────────────────────────────────
// GPU marketplace listings: live from Duo 1 (e.g. Apify-scraped
// provider prices) when DUO1_MARKET_URL is set and reachable,
// seeded demo listings otherwise.
// ─────────────────────────────────────────────────────────────

import { DEMO_LISTINGS } from "../demo-data";
import type { GpuListing, MarketDataMode } from "../types";
import { getConfig } from "./config";

export interface MarketFeed {
  listings: GpuListing[];
  marketDataMode: MarketDataMode;
}

export async function getMarketFeed(): Promise<MarketFeed> {
  const { duo1MarketUrl } = getConfig();

  if (duo1MarketUrl) {
    try {
      const response = await fetch(duo1MarketUrl, { signal: AbortSignal.timeout(2500), cache: "no-store" });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = await response.json();
      const listings: GpuListing[] = Array.isArray(body) ? body : body.listings;
      if (Array.isArray(listings) && listings.length > 0) return { listings, marketDataMode: "duo1-live" };
    } catch (error) {
      console.warn("[market] Duo 1 market feed unavailable, using demo listings:", (error as Error).message);
    }
  }

  return { listings: DEMO_LISTINGS, marketDataMode: "mock" };
}
