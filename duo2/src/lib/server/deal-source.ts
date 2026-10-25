// ─────────────────────────────────────────────────────────────
// Where the UI gets its approved deals from.
//
//   1. Relay (Duo 1) API when DUO1_API_URL + DUO1_AGENT_API_KEY are set.
//   2. Deals Duo 1 already pushed to POST /api/deals/execute.
//   3. The older DUO1_DEALS_URL feed, if configured.
//   4. Seeded demo deals when nothing live is reachable.
// ─────────────────────────────────────────────────────────────

import { DEMO_DEALS } from "../demo-data";
import type { Deal, MarketDataMode } from "../types";
import { getConfig } from "./config";
import { listReceivedDeals } from "./job-store";
import { fetchRelayDeals, relayConfigured, toDuo2Deal, type RelayDealView } from "./relay";
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

  // Relay is the authoritative source: it emits deals that have cleared and
  // been approved, each with the metadata needed to report usage back.
  if (relayConfigured()) {
    try {
      const live = await fetchRelayDeals();
      const merged = mergeById([...pushed, ...live]);
      return { deals: merged, marketDataMode: "duo1-live" };
    } catch (error) {
      console.warn("[deals] Relay feed unavailable, using demo deals:", (error as Error).message);
      return {
        deals: mergeById([...pushed, ...DEMO_DEALS]),
        marketDataMode: "mock",
        note: `Relay feed unavailable (${(error as Error).message}), showing demo deals`,
      };
    }
  }

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
  const found = feed.deals.find((deal) => deal.dealId === dealId);
  if (found) return found;

  // The feed only lists clearable deals; a job may reference one whose status
  // has since moved on. Fetch it directly from Relay before giving up.
  if (relayConfigured()) {
    try {
      const body = await relayDetail(dealId);
      return body ? toDuo2Deal(body) ?? undefined : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function relayDetail(dealId: string): Promise<RelayDealView | null> {
  const { apiUrl, agentKey } = getConfig().relay;
  if (!apiUrl || !agentKey) return null;
  const response = await fetch(`${apiUrl}/v1/deals/${dealId}`, {
    headers: {
      accept: "application/json",
      "x-relay-contract": "relay-duo1.v1",
      authorization: `Bearer ${agentKey}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as RelayDealView;
  return body;
}

function mergeById(deals: Deal[]): Deal[] {
  const byId = new Map<string, Deal>();
  for (const deal of deals) if (!byId.has(deal.dealId)) byId.set(deal.dealId, deal);
  return [...byId.values()];
}
