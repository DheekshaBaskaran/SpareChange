// Market dashboard: the first screen judges see.
// Story: compute is fragmented → SpareChange found a deal → execute it.

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DealCard } from "@/components/deal-card";
import { DealGraph, FlowLegend } from "@/components/deal-graph";
import { ExecuteButton } from "@/components/execute-button";
import { ExecutionHistory } from "@/components/execution-history";
import { ImpactMetrics } from "@/components/impact-metrics";
import { MarketTable } from "@/components/market-table";
import { Badge, Eyebrow, Metric, Panel, PanelHeader } from "@/components/ui";
import { dealNumber, usd } from "@/lib/format";
import { getDealFeed } from "@/lib/server/deal-source";
import { getMarketFeed } from "@/lib/server/market-source";
import type { GpuListing } from "@/lib/types";

export default function MarketPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  await connection(); // render with fresh data on every request
  const [market, dealFeed] = await Promise.all([getMarketFeed(), getDealFeed()]);
  const featured = dealFeed.deals.find((deal) => deal.type === "multi_party") ?? dealFeed.deals[0];
  const dealProviders = featured
    ? [featured.provider.name, featured.replacementProvider?.name].filter((name): name is string => !!name)
    : [];
  const live = market.marketDataMode === "duo1-live" || dealFeed.marketDataMode === "duo1-live";

  return (
    <div className="relative">
      <div className="grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[420px]" aria-hidden />
      <div className="relative mx-auto max-w-[1320px] px-5 pb-16 pt-10 lg:px-8">
        {/* ── Hero ───────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <Eyebrow>Dynamic AI compute marketplace</Eyebrow>
              <Badge tone={live ? "value" : "neutral"} dot>
                {live ? "Live data from Duo 1" : "Demo market data"}
              </Badge>
            </div>
            <h1 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[42px]">
              Idle GPU commitments,
              <br />
              <span className="text-muted">put back to work.</span>
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-6 text-muted">
              SpareChange finds GPU capacity that is already paid for but sitting idle, routes it to teams that need it now,
              then runs, verifies and settles the job automatically.
            </p>
          </div>
        </div>

        {/* ── Market KPIs ────────────────────────── */}
        <MarketStats listings={market.listings} />

        {/* ── Featured deal ──────────────────────── */}
        {featured && (
          <Panel className="mt-6 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4 lg:px-6">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="value" dot>
                  Deal discovered
                </Badge>
                <span className="font-mono text-xs text-faint">{dealNumber(featured.dealId)}</span>
                <h2 className="text-[15px] font-semibold tracking-tight text-ink">{featured.title}</h2>
              </div>
              <FlowLegend />
            </div>
            <div className="px-5 py-6 lg:px-6">
              <DealGraph deal={featured} highlightBuyer />
            </div>
            <div className="flex flex-col gap-6 border-t border-line bg-surface-2/40 px-5 py-5 lg:flex-row lg:items-center lg:px-6">
              <ImpactMetrics impact={featured.impact} className="flex-1" />
              <div className="flex shrink-0 flex-col gap-2 lg:w-60">
                <ExecuteButton deal={featured} size="md" />
                <Link
                  href={`/deals/${featured.dealId}`}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-strong text-sm text-ink-2 transition-colors hover:border-muted hover:text-ink"
                >
                  Review deal terms <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            </div>
          </Panel>
        )}

        {/* ── Market + side column ───────────────── */}
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel>
            <PanelHeader
              eyebrow="Marketplace"
              title="Available GPU capacity"
              right={<span className="text-xs text-faint">{market.listings.length} listings · {new Set(market.listings.map((l) => l.providerName)).size} providers</span>}
            />
            <MarketTable listings={market.listings} highlightProviders={dealProviders} />
          </Panel>

          <div className="flex flex-col gap-6">
            <Panel>
              <PanelHeader eyebrow="Matching engine" title="Approved deals" right={<span className="text-xs text-faint">{dealFeed.deals.length} ready</span>} />
              <div className="flex flex-col gap-3 p-4">
                {dealFeed.deals.map((deal) => (
                  <DealCard key={deal.dealId} deal={deal} />
                ))}
              </div>
            </Panel>
            <Panel>
              <PanelHeader
                eyebrow="Execution"
                title="Recent executions"
                right={
                  <Link href="/executions" className="text-xs text-muted hover:text-ink">
                    View all
                  </Link>
                }
              />
              <ExecutionHistory limit={4} />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarketStats({ listings }: { listings: GpuListing[] }) {
  const available = listings.reduce((sum, listing) => sum + listing.gpusAvailable, 0);
  const idleReserved = listings
    .filter((listing) => listing.listingType === "reserved-resale")
    .reduce((sum, listing) => sum + listing.gpusAvailable, 0);
  const a100Prices = listings.filter((listing) => listing.gpuModel.includes("A100")).map((listing) => listing.pricePerGpuHour);
  const minA100 = Math.min(...a100Prices);
  const maxA100 = Math.max(...a100Prices);
  const tightProviders = listings.filter((listing) => listing.utilizationPercent >= 90).length;

  return (
    <Panel className="mt-8 grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
      <div className="p-5">
        <Metric label="GPUs available now" value={available} sub={`across ${listings.length} listings`} size="lg" />
      </div>
      <div className="p-5">
        <Metric label="Idle reserved GPUs" value={idleReserved} sub="Already paid for, currently unused" tone="compute" size="lg" />
      </div>
      <div className="p-5">
        <Metric
          label="A100 price spread"
          value={a100Prices.length > 1 ? `${usd(minA100)} – ${usd(maxA100)}` : a100Prices.length ? usd(minA100) : "—"}
          sub={a100Prices.length > 1 ? `Same GPU, ${(maxA100 / minA100).toFixed(1)}× price difference` : "per GPU-hour"}
          size="lg"
        />
      </div>
      <div className="p-5">
        <Metric label="Providers ≥ 90% utilized" value={tightProviders} sub="Scarce capacity, long waits" size="lg" />
      </div>
    </Panel>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1320px] px-5 pt-10 lg:px-8" aria-busy>
      <div className="h-4 w-56 animate-pulse rounded bg-surface-3" />
      <div className="mt-4 h-24 w-[min(100%,560px)] animate-pulse rounded bg-surface-2" />
      <div className="mt-8 h-28 animate-pulse rounded-xl bg-surface" />
      <div className="mt-6 h-80 animate-pulse rounded-xl bg-surface" />
    </div>
  );
}
