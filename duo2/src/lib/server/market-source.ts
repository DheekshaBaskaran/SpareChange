// ─────────────────────────────────────────────────────────────
// GPU marketplace listings: live from Duo 1 when reachable.
//
// Relay offer book → the older DUO1_MARKET_URL feed → seeded demo listings.
// ─────────────────────────────────────────────────────────────

import { DEMO_LISTINGS } from "../demo-data";
import type { GpuListing, MarketDataMode } from "../types";
import { getConfig } from "./config";
import { fetchRelayListings, relayConfigured } from "./relay";

export interface MarketFeed {
  listings: GpuListing[];
  marketDataMode: MarketDataMode;
  note?: string;
}

export async function getMarketFeed(): Promise<MarketFeed> {
  const { duo1MarketUrl } = getConfig();

  if (relayConfigured()) {
    try {
      const listings = await fetchRelayListings();
      if (listings.length > 0) return { listings, marketDataMode: "duo1-live" };
    } catch (error) {
      console.warn("[market] Relay offer book unavailable, using demo listings:", (error as Error).message);
      return {
        listings: DEMO_LISTINGS,
        marketDataMode: "mock",
        note: `Relay offer book unavailable (${(error as Error).message})`,
      };
    }
  }

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
