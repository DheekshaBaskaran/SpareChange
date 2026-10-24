"use client";

// The two end states: a satisfying COMPLETE summary, or a clear
// FAILED explanation with a Retry button.

import { CircleCheck, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { money, seconds, shortHash, usd } from "@/lib/format";
import { EXECUTION_MODE_LABEL, PAYMENT_MODE_LABEL, STATUS_META } from "@/lib/status";
import type { Job } from "@/lib/types";

export function CompletionBanner({ job }: { job: Job }) {
  const { deal, execution, payment } = job;
  const hours = deal.workload.durationMinutes / 60;
  const savings = deal.impact?.buyerSavingsPerHour !== undefined ? deal.impact.buyerSavingsPerHour * hours : undefined;

  const facts: { label: string; value: string; mono?: boolean; accent?: boolean }[] = [
    { label: "Runtime", value: execution?.runtimeMs ? seconds(execution.runtimeMs) : "—", mono: true },
    {
      label: execution?.containerId ? "Container" : "Worker",
      value: execution?.containerId ? execution.containerId.slice(0, 12) : execution?.workerId ?? "—",
      mono: true,
    },
    { label: "Compute delivered", value: `${deal.workload.gpuCount}× ${deal.workload.gpuModel.replace(/^NVIDIA\s+/, "")}` },
    { label: "Total cost", value: money(deal.price.amount, deal.price.currency) },
    { label: "Buyer savings", value: savings !== undefined ? usd(savings) : "—", accent: true },
    { label: "Payment", value: payment ? `${payment.status === "SUCCESS" ? "Settled" : payment.status} · ${PAYMENT_MODE_LABEL[payment.paymentMode].label}` : "—" },
    { label: "Transaction ID", value: payment ? shortHash(payment.transactionId, 10, 6) : "—", mono: true },
    { label: "Execution", value: EXECUTION_MODE_LABEL[job.executionMode].label },
  ];

  return (
    <section className="rise-in overflow-hidden rounded-xl border border-value/35 bg-value/[0.06]" aria-live="polite">
      <div className="flex flex-wrap items-center gap-4 px-6 py-5">
        <span className="flex size-11 items-center justify-center rounded-full bg-value text-canvas">
          <CircleCheck className="size-6" aria-hidden />
        </span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">DEAL COMPLETE</h2>
          <p className="text-sm text-ink-2">
            Compute successfully executed and verified. {deal.buyer.name} received {deal.workload.gpuCount}× GPUs, {deal.provider.name}
            {deal.replacementProvider ? ` and ${deal.replacementProvider.name}` : ""} got paid.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px border-t border-value/20 bg-value/10 sm:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-canvas/80 px-5 py-3.5">
            <dt className="text-xs text-muted">{fact.label}</dt>
            <dd className={`mt-1 truncate text-sm ${fact.mono ? "tabular font-mono text-[13px]" : ""} ${fact.accent ? "font-semibold text-value" : "text-ink"}`}>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function FailureBanner({ job }: { job: Job }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const step = job.failure?.step ?? "RUNNING";

  async function retry() {
    setRetrying(true);
    const response = await fetch(`/api/jobs/${job.jobId}/retry`, { method: "POST" });
    const data = await response.json();
    if (data.success) router.push(`/jobs/${data.jobId}`);
    else setRetrying(false);
  }

  return (
    <section className="rise-in flex flex-wrap items-center gap-4 rounded-xl border border-danger/35 bg-danger/[0.07] px-6 py-5" role="alert">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold tracking-tight text-ink">Execution failed at: {STATUS_META[step].stepTitle.toLowerCase()}</h2>
        <p className="mt-0.5 text-sm text-ink-2">{job.failure?.message}</p>
        <p className="mt-1 text-xs text-muted">No funds were released for this job.</p>
      </div>
      <button
        type="button"
        onClick={retry}
        disabled={retrying}
        className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-4 text-sm font-medium text-ink transition-colors hover:border-muted disabled:opacity-70"
      >
        {retrying ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
        Retry execution
      </button>
    </section>
  );
}
