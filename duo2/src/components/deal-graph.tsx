// ─────────────────────────────────────────────────────────────
// The deal graph: shows who gives compute to whom (blue, top line,
// flowing left → right) and who pays whom (green, bottom line,
// flowing right → left).
//
// Multi-party:  Nova Cloud ──▶ Atlas Compute ──▶ Acme AI
//               (backfill)     (releases idle)    (buyer)
// Direct:       Provider ──▶ Buyer
//
// Flow lines can be "planned", "active" (animated) or "done", so the
// execution screen can light them up as the job progresses.
// ─────────────────────────────────────────────────────────────

import { Building2, Check, ChevronLeft, ChevronRight, Cpu, Server } from "lucide-react";
import { usd, waitTime } from "@/lib/format";
import type { Deal, DealFlow, Participant } from "@/lib/types";
import { cx } from "./ui";

export type FlowState = "planned" | "active" | "done";

const ROLE_LABEL = {
  buyer: "Buyer",
  capacity_holder: "Releases capacity",
  replacement_provider: "Replacement provider",
} as const;

const ROLE_ICON = {
  buyer: Building2,
  capacity_holder: Server,
  replacement_provider: Cpu,
} as const;

function shortGpu(model: string) {
  return model.replace(/^NVIDIA\s+/, "").replace(/\s+\d+GB$/, "");
}

/** One sentence about what each party gets out of the deal. */
function outcomeFor(deal: Deal, participant: Participant): string {
  const { workload, impact } = deal;
  const gpus = `${workload.gpuCount}× ${shortGpu(workload.gpuModel)}`;
  if (participant.id === deal.buyer.id) {
    return impact?.timeToComputeMinutes
      ? `Gets ${gpus} in ${waitTime(impact.timeToComputeMinutes)}`
      : `Gets ${gpus}`;
  }
  if (participant.id === deal.provider.id) {
    return impact?.providerNetGainPerHour ? `Earns ${usd(impact.providerNetGainPerHour)}/hr on idle GPUs` : "Monetizes idle GPUs";
  }
  return impact?.replacementPricePerGpuHour
    ? `Sells capacity at ${usd(impact.replacementPricePerGpuHour)}/GPU-hr`
    : "Sells spare capacity";
}

function ParticipantNode({ deal, participant, highlight }: { deal: Deal; participant: Participant; highlight?: boolean }) {
  const role = participant.role ?? (participant.id === deal.buyer.id ? "buyer" : "capacity_holder");
  const Icon = ROLE_ICON[role];
  return (
    <div
      className={cx(
        "relative flex min-w-0 flex-col rounded-lg border bg-surface-2 p-4 transition-colors",
        highlight ? "border-value/40" : "border-line-strong",
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
        <Icon className="size-3.5" aria-hidden />
        {ROLE_LABEL[role]}
      </div>
      <div className="mt-2 text-base font-semibold tracking-tight text-ink">{participant.name}</div>
      {participant.situation && <p className="mt-1 text-[13px] leading-5 text-muted">{participant.situation}</p>}
      <div className="mt-3 border-t border-line pt-3 text-[13px] font-medium text-ink-2">{outcomeFor(deal, participant)}</div>
    </div>
  );
}

function FlowLine({ flow, direction, state, kind }: { flow?: DealFlow; direction: "right" | "left"; state: FlowState; kind: "compute" | "payment" }) {
  if (!flow) return <div className="h-9" />;
  const color = kind === "compute" ? "text-compute" : "text-value";
  const Arrow = direction === "right" ? ChevronRight : ChevronLeft;
  const label = (
    <div className={cx("flex items-center gap-1 whitespace-nowrap text-xs font-medium", state === "planned" ? "text-muted" : color)}>
      {state === "done" && <Check className="size-3" aria-label="completed" />}
      {flow.label}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-1">
      {kind === "compute" && label}
      <div className={cx("flex w-full items-center", color, state === "planned" && "opacity-45")}>
        {direction === "left" && <Arrow className="-mr-1.5 size-4 shrink-0" aria-hidden />}
        <div
          className={cx(
            "flow-line flex-1",
            state === "done" && "solid",
            state !== "done" && (direction === "right" ? "flow-right" : "flow-left"),
            state === "planned" && "flow-slow",
          )}
        />
        {direction === "right" && <Arrow className="-ml-1.5 size-4 shrink-0" aria-hidden />}
      </div>
      {kind === "payment" && label}
    </div>
  );
}

function findFlow(flows: DealFlow[], from: string, to: string, kind: DealFlow["kind"]) {
  return flows.find((flow) => flow.from === from && flow.to === to && flow.kind === kind);
}

/** The connector between two neighbouring parties: compute on top, payment below. */
function Connector({ deal, left, right, computeState, paymentState }: { deal: Deal; left: Participant; right: Participant; computeState: FlowState; paymentState: FlowState }) {
  const flows = deal.flows ?? defaultFlows(deal);
  const compute = findFlow(flows, left.id, right.id, "compute");
  const payment = findFlow(flows, right.id, left.id, "payment");
  return (
    <>
      {/* Wide screens: horizontal arrows between the cards */}
      <div className="hidden flex-col justify-center gap-5 px-1 lg:flex">
        <FlowLine flow={compute} direction="right" state={computeState} kind="compute" />
        <FlowLine flow={payment} direction="left" state={paymentState} kind="payment" />
      </div>
      {/* Narrow screens: a compact vertical connector */}
      <div className="flex items-center justify-center gap-4 py-1 text-xs font-medium lg:hidden">
        {compute && <span className="text-compute">↓ {compute.label}</span>}
        {payment && <span className="text-value">↑ {payment.label}</span>}
      </div>
    </>
  );
}

/** Fallback flows if Duo 1 sends a deal without a `flows` array. */
function defaultFlows(deal: Deal): DealFlow[] {
  const hourly = deal.price.amount / (deal.workload.durationMinutes / 60);
  const flows: DealFlow[] = [
    { from: deal.provider.id, to: deal.buyer.id, kind: "compute", label: `${deal.workload.gpuCount}× ${shortGpu(deal.workload.gpuModel)}` },
    { from: deal.buyer.id, to: deal.provider.id, kind: "payment", label: `${usd(hourly)}/hr` },
  ];
  if (deal.replacementProvider) {
    flows.push(
      { from: deal.replacementProvider.id, to: deal.provider.id, kind: "compute", label: "Backfill capacity" },
      { from: deal.provider.id, to: deal.replacementProvider.id, kind: "payment", label: "Backfill payment" },
    );
  }
  return flows;
}

export function DealGraph({
  deal,
  computeState = "planned",
  paymentState = "planned",
  highlightBuyer = false,
}: {
  deal: Deal;
  computeState?: FlowState;
  paymentState?: FlowState;
  highlightBuyer?: boolean;
}) {
  const parties = [deal.replacementProvider, deal.provider, deal.buyer].filter(Boolean) as Participant[];
  const columns = parties.length === 3 ? "lg:grid-cols-[1fr_minmax(140px,0.8fr)_1fr_minmax(140px,0.8fr)_1fr]" : "lg:grid-cols-[1fr_minmax(160px,1fr)_1fr]";

  return (
    <div className={cx("grid grid-cols-1 items-stretch gap-2 lg:gap-0", columns)} role="group" aria-label="Deal participants and flows">
      {parties.map((participant, index) => (
        <div key={participant.id} className="contents">
          <ParticipantNode deal={deal} participant={participant} highlight={highlightBuyer && participant.id === deal.buyer.id} />
          {index < parties.length - 1 && (
            <Connector deal={deal} left={participant} right={parties[index + 1]} computeState={computeState} paymentState={paymentState} />
          )}
        </div>
      ))}
    </div>
  );
}

export function FlowLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded bg-compute" aria-hidden /> Compute
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded bg-value" aria-hidden /> Payment
      </span>
    </div>
  );
}
