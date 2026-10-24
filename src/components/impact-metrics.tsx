// The "why this deal is worth it" numbers: savings, reuse, speed.

import { usd, waitTime } from "@/lib/format";
import type { DealImpact } from "@/lib/types";
import { Metric, cx } from "./ui";

export function ImpactMetrics({ impact, className }: { impact?: DealImpact; className?: string }) {
  if (!impact) return null;
  const metrics = [
    impact.buyerSavingsPerHour !== undefined && (
      <Metric
        key="savings"
        label="Buyer savings"
        value={`${usd(impact.buyerSavingsPerHour)}/hr`}
        sub={impact.marketPricePerGpuHour && impact.dealPricePerGpuHour ? `${usd(impact.dealPricePerGpuHour)} vs ${usd(impact.marketPricePerGpuHour)} market` : undefined}
        tone="value"
      />
    ),
    impact.idleGpusReused !== undefined && (
      <Metric key="reused" label="Idle GPUs reused" value={impact.idleGpusReused} sub="Already paid for, previously idle" tone="compute" />
    ),
    impact.providerNetGainPerHour !== undefined && (
      <Metric key="provider" label="Provider net gain" value={`+${usd(impact.providerNetGainPerHour)}/hr`} sub="Revenue on unused commitment" />
    ),
    impact.timeToComputeMinutes !== undefined && (
      <Metric
        key="time"
        label="Time to compute"
        value={waitTime(impact.timeToComputeMinutes)}
        sub={impact.marketWaitMinutes ? `vs ${waitTime(impact.marketWaitMinutes)} market wait` : undefined}
      />
    ),
    impact.utilizationBeforePercent !== undefined && impact.utilizationAfterPercent !== undefined && (
      <Metric
        key="util"
        label="Reservation utilization"
        value={`${impact.utilizationBeforePercent}% → ${impact.utilizationAfterPercent}%`}
        sub="Capacity holder's committed GPUs"
      />
    ),
  ].filter(Boolean);

  return <div className={cx("grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-5", className)}>{metrics}</div>;
}
