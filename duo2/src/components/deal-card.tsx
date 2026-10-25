// A compact row for a deal in the "Approved deals" list.

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { dealNumber, money, usd } from "@/lib/format";
import type { Deal } from "@/lib/types";
import { Badge } from "./ui";

export function DealCard({ deal }: { deal: Deal }) {
  const parties = [deal.replacementProvider, deal.provider, deal.buyer].filter(Boolean).map((party) => party!.name);
  return (
    <Link
      href={`/deals/${deal.dealId}`}
      className="group block rounded-lg border border-line bg-surface-2 p-4 transition-colors hover:border-line-strong hover:bg-surface-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-faint">{dealNumber(deal.dealId)}</span>
          <Badge tone={deal.type === "multi_party" ? "compute" : "neutral"}>
            {deal.type === "multi_party" ? `${parties.length}-party` : "Direct"}
          </Badge>
        </div>
        <ArrowUpRight className="size-4 text-faint transition-colors group-hover:text-ink" aria-hidden />
      </div>
      <div className="mt-2.5 text-sm font-medium text-ink">{deal.title ?? `${deal.provider.name} → ${deal.buyer.name}`}</div>
      <div className="mt-1 text-xs text-muted">{parties.join(" → ")}</div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-ink-2">
          {deal.workload.gpuCount}× {deal.workload.gpuModel.replace(/^NVIDIA\s+/, "")} · {money(deal.price.amount, deal.price.currency)}
        </span>
        {deal.impact?.buyerSavingsPerHour !== undefined && (
          <span className="font-medium text-value">saves {usd(deal.impact.buyerSavingsPerHour)}/hr</span>
        )}
      </div>
    </Link>
  );
}
