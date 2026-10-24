// ─────────────────────────────────────────────────────────────
// Where the UI gets its approved deals from.
//
//   1. If DUO1_DEALS_URL is set, fetch live approved deals from Duo 1.
//   2. Deals Duo 1 already pushed to POST /api/deals/execute are included.
//   3. If Duo 1 is unavailable, fall back to the seeded demo deals.
// ─────────────────────────────────────────────────────────────

import { DEMO_DEALS } from "../demo-data";
import type { Deal, MarketDataMode } from "../types";
import { getConfig } from "./config";
import { listReceivedDeals } from "./job-store";
import { validateDeal } from "./validate-deal";

export interface DealFeed {
  deals: Deal[];
  marketDataMode: MarketDataMode;
  note?: string;
}

async function fetchDuo1Deals(url: string): Promise<Deal[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500), cache: "no-store" });
  if (!response.ok) throw new Error(`Duo 1 responded with ${response.status}`);
  const body = await response.json();
  // Accept either a plain array or { deals: [...] }.
  const rawDeals: unknown[] = Array.isArray(body) ? body : Array.isArray(body?.deals) ? body.deals : [];
  const deals: Deal[] = [];
  for (const raw of rawDeals) {
    const result = validateDeal(raw);
    if (result.ok) deals.push({ ...result.deal, source: "duo1-live" });
  }
  return deals;
}

export async function getDealFeed(): Promise<DealFeed> {
  const { duo1DealsUrl } = getConfig();
  const pushed = listReceivedDeals();

  if (duo1DealsUrl) {
    try {
      const live = await fetchDuo1Deals(duo1DealsUrl);
      const merged = mergeById([...pushed, ...live]);
      if (merged.length > 0) return { deals: merged, marketDataMode: "duo1-live" };
    } catch (error) {
      console.warn("[deals] Duo 1 feed unavailable, using demo deals:", (error as Error).message);
      return {
        deals: mergeById([...pushed, ...DEMO_DEALS]),
        marketDataMode: "mock",
        note: "Duo 1 feed unavailable, showing demo deals",
      };
    }
  }

  return {
    deals: mergeById([...pushed, ...DEMO_DEALS]),
    // Only call it live if Duo 1 actually pushed a deal (the UI also re-sends demo deals).
    marketDataMode: pushed.some((deal) => deal.source === "duo1-live") ? "duo1-live" : "mock",
  };
}

export async function findDeal(dealId: string): Promise<Deal | undefined> {
  const feed = await getDealFeed();
  return feed.deals.find((deal) => deal.dealId === dealId);
}

function mergeById(deals: Deal[]): Deal[] {
  const byId = new Map<string, Deal>();
  for (const deal of deals) if (!byId.has(deal.dealId)) byId.set(deal.dealId, deal);
  return [...byId.values()];
}
