// The GPU marketplace: capacity listings across fragmented providers.

import { usd } from "@/lib/format";
import type { GpuListing } from "@/lib/types";
import { cx } from "./ui";

const LISTING_TYPE_LABEL: Record<GpuListing["listingType"], string> = {
  "reserved-resale": "Idle reservation",
  spot: "Spot",
  "on-demand": "On-demand",
};

function UtilizationBar({ percent }: { percent: number }) {
  const color = percent >= 90 ? "bg-danger" : percent >= 70 ? "bg-pending" : "bg-compute";
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className={cx("h-full rounded-full", color)} style={{ width: `${percent}%` }} />
      </div>
      <span className="tabular w-9 text-right text-[13px] text-ink-2">{percent}%</span>
    </div>
  );
}

function Availability({ listing }: { listing: GpuListing }) {
  if (listing.availability === "reserved") return <span className="text-[13px] text-faint">Fully reserved</span>;
  return (
    <span className="tabular text-[13px] text-ink">
      <span className="font-semibold">{listing.gpusAvailable}</span>
      <span className="text-faint"> / {listing.gpusTotal}</span>
    </span>
  );
}

export function MarketTable({ listings, highlightProviders = [] }: { listings: GpuListing[]; highlightProviders?: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-[0.12em] text-faint">
            <th className="px-5 py-3 font-medium">Provider</th>
            <th className="px-3 py-3 font-medium">GPU</th>
            <th className="px-3 py-3 font-medium">Region</th>
            <th className="px-3 py-3 text-right font-medium">Available</th>
            <th className="px-3 py-3 text-right font-medium">Price / GPU-hr</th>
            <th className="px-5 py-3 font-medium">Fleet utilization</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((listing) => {
            const inDeal = highlightProviders.includes(listing.providerName);
            return (
              <tr key={listing.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{listing.providerName}</span>
                    {inDeal && (
                      <span className="rounded border border-value/30 px-1.5 py-px text-[10.5px] font-medium text-value">In deal</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-faint">{LISTING_TYPE_LABEL[listing.listingType]}</div>
                </td>
                <td className="px-3 py-3 text-sm text-ink-2">{listing.gpuModel.replace(/^NVIDIA\s+/, "")}</td>
                <td className="px-3 py-3 text-[13px] text-muted">{listing.region}</td>
                <td className="px-3 py-3 text-right">
                  <Availability listing={listing} />
                </td>
                <td className="tabular px-3 py-3 text-right text-sm font-medium text-ink">{usd(listing.pricePerGpuHour)}</td>
                <td className="px-5 py-3">
                  <UtilizationBar percent={listing.utilizationPercent} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
