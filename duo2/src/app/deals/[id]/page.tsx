// Deal detail: who is involved, what moves where, why everyone wins,
// and the EXECUTE DEAL button.

import { ArrowLeft, Cpu, Play, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DealGraph, FlowLegend } from "@/components/deal-graph";
import { ExecuteButton } from "@/components/execute-button";
import { ImpactMetrics } from "@/components/impact-metrics";
import { Badge, Eyebrow, KeyValue, Panel, PanelHeader } from "@/components/ui";
import { dealNumber, money, usd, waitTime } from "@/lib/format";
import { getConfig } from "@/lib/server/config";
import { findDeal } from "@/lib/server/deal-source";

export default function DealPage({ params }: PageProps<"/deals/[id]">) {
  return (
    <Suspense fallback={<div className="mx-auto h-[70vh] max-w-[1320px] animate-pulse px-8 pt-10" aria-busy />}>
      <DealDetail params={params} />
    </Suspense>
  );
}

async function DealDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await findDeal(id);
  if (!deal) notFound();

  const hours = deal.workload.durationMinutes / 60;
  const ratePerGpuHour = deal.impact?.dealPricePerGpuHour ?? deal.price.amount / (deal.workload.gpuCount * hours);
  const totalSavings = deal.impact?.buyerSavingsPerHour !== undefined ? deal.impact.buyerSavingsPerHour * hours : undefined;
  const partyCount = deal.replacementProvider ? 3 : 2;
  const settlesWithX402 = getConfig().paymentMode === "x402";

  return (
    <div className="mx-auto max-w-[1320px] px-5 pb-16 pt-8 lg:px-8">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Market
      </Link>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-faint">Deal {dealNumber(deal.dealId)}</span>
        <Badge tone="value" dot>
          Approved
        </Badge>
        <Badge tone={partyCount === 3 ? "compute" : "neutral"}>{partyCount}-party exchange</Badge>
        <Badge>{deal.source === "duo1-live" ? "From Duo 1 matching engine" : "Demo deal"}</Badge>
      </div>
      <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.015em] text-ink sm:text-[32px]">{deal.title ?? `${deal.provider.name} → ${deal.buyer.name}`}</h1>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── Main column ───────────────────────── */}
        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <PanelHeader eyebrow="The exchange" title="Who gives what" right={<FlowLegend />} />
            <div className="p-5 lg:p-6">
              <DealGraph deal={deal} highlightBuyer />
            </div>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Impact" title="Why every party comes out ahead" />
            <div className="p-5 lg:p-6">
              <ImpactMetrics impact={deal.impact} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="On execute" title="What SpareChange does next" />
            <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-b-xl bg-line sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Cpu, title: "Provision", text: `Allocate a worker for ${deal.workload.gpuCount}× ${deal.workload.gpuModel.replace(/^NVIDIA\s+/, "")}` },
                { icon: Play, title: "Run", text: "Execute the buyer's workload and stream progress" },
                { icon: ShieldCheck, title: "Verify", text: "Check exit code, output and model quality before paying" },
                { icon: Wallet, title: "Settle", text: settlesWithX402 ? "Buyer agent pays the provider via x402" : "Pay each participant their share" },
              ].map((step, index) => (
                <li key={step.title} className="bg-surface p-5">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink">
                    <span className="flex size-6 items-center justify-center rounded-md bg-surface-3 font-mono text-xs text-muted">{index + 1}</span>
                    <step.icon className="size-4 text-muted" aria-hidden />
                    {step.title}
                  </div>
                  <p className="mt-2 text-[13px] leading-5 text-muted">{step.text}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        {/* ── Terms + action ────────────────────── */}
        <aside className="xl:sticky xl:top-20 xl:self-start">
          <Panel>
            <PanelHeader eyebrow="Terms" title={`Deal ${dealNumber(deal.dealId)}`} />
            <dl className="divide-y divide-line/70 px-5">
              <KeyValue label="Buyer" value={deal.buyer.name} />
              <KeyValue label="Provider" value={deal.provider.name} />
              {deal.replacementProvider && <KeyValue label="Replacement" value={deal.replacementProvider.name} />}
              <KeyValue label="GPU" value={deal.workload.gpuModel} />
              <KeyValue label="Quantity" value={`${deal.workload.gpuCount} GPUs`} />
              <KeyValue label="Region" value={deal.workload.region ?? deal.provider.region ?? "—"} />
              <KeyValue label="Duration" value={waitTime(deal.workload.durationMinutes)} />
              <KeyValue label="Rate" value={`${usd(ratePerGpuHour)} / GPU-hr`} />
            </dl>
            <div className="mx-5 mt-2 rounded-lg border border-line bg-surface-2 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted">Total price</span>
                <span className="tabular text-2xl font-semibold tracking-tight text-ink">{money(deal.price.amount, deal.price.currency)}</span>
              </div>
              {totalSavings !== undefined && (
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-sm text-muted">Estimated savings</span>
                  <span className="tabular text-sm font-semibold text-value">{usd(totalSavings)} vs market</span>
                </div>
              )}
            </div>
            <div className="p-5">
              <ExecuteButton deal={deal} />
              <p className="mt-3 text-center text-xs leading-5 text-faint">
                Payment is released only after the workload is verified.
                <br />
                Settlement: {settlesWithX402 ? "Coinbase x402 (USDC), mock if unavailable" : "mock settlement (demo)"}
              </p>
            </div>
          </Panel>
          <Eyebrow className="mt-4 px-1 normal-case tracking-normal">
            Approved {deal.approvedAt ? new Date(deal.approvedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : ""}
          </Eyebrow>
        </aside>
      </div>
    </div>
  );
}
