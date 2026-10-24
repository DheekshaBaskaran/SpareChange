"use client";

// ─────────────────────────────────────────────────────────────
// The live execution screen. Polls GET /api/jobs/[id] every 600ms
// until the job is COMPLETE or FAILED, and redraws each panel.
// ─────────────────────────────────────────────────────────────

import { ArrowLeft, Info } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { dealNumber } from "@/lib/format";
import { EXECUTION_MODE_LABEL, PAYMENT_MODE_LABEL, STATUS_META, lifecycleIndex } from "@/lib/status";
import type { Job } from "@/lib/types";
import { DealGraph, FlowLegend, type FlowState } from "../deal-graph";
import { ModeTag, Panel, PanelHeader, StatusBadge } from "../ui";
import { ComputePanel } from "./compute-panel";
import { LifecycleStepper } from "./lifecycle-stepper";
import { CompletionBanner, FailureBanner } from "./outcome-banners";
import { SettlementPanel } from "./settlement-panel";
import { VerificationPanel } from "./verification-panel";

const POLL_MS = 600;

const HEADLINE: Record<Job["status"], string> = {
  APPROVED: "Deal approved",
  PROVISIONING: "Provisioning compute…",
  RUNNING: "Workload running",
  VERIFYING: "Verifying execution…",
  PAYMENT_PENDING: "Settling payment…",
  COMPLETE: "Deal complete",
  FAILED: "Execution failed",
};

function useJob(jobId: string) {
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (response.status === 404) {
          setNotFound(true);
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        setJob(data.job);
        if (data.job.status === "COMPLETE" || data.job.status === "FAILED") return; // stop polling
      } catch {
        // Network hiccup: just try again on the next tick.
      }
      timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  return { job, notFound };
}

/** Which flow lines in the deal graph should be animated / marked done. */
function flowStates(job: Job): { compute: FlowState; payment: FlowState } {
  const index = lifecycleIndex(job.status, job.failure?.step);
  const runningIndex = 2; // RUNNING
  const paymentIndex = 4; // PAYMENT_PENDING
  const failed = job.status === "FAILED";
  return {
    compute: index > runningIndex ? "done" : index === runningIndex && !failed ? "active" : "planned",
    payment: job.status === "COMPLETE" ? "done" : index === paymentIndex && !failed ? "active" : "planned",
  };
}

export function JobView({ jobId }: { jobId: string }) {
  const { job, notFound } = useJob(jobId);

  if (notFound) {
    return (
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <h1 className="text-xl font-semibold text-ink">Job not found</h1>
        <p className="mt-2 text-sm text-muted">This job ID was not found in the job history (.data/jobs.json).</p>
        <Link href="/" className="mt-6 inline-block text-sm text-compute hover:underline">
          Back to the market
        </Link>
      </div>
    );
  }
  if (!job) return <div className="mx-auto h-[70vh] max-w-[1320px] animate-pulse px-8 pt-10" aria-busy />;

  const index = lifecycleIndex(job.status, job.failure?.step);
  const flows = flowStates(job);
  const showVerification = index >= 3 || job.verification;
  const showSettlement = index >= 4 || job.payment;
  const executionMode = EXECUTION_MODE_LABEL[job.executionMode];
  const paymentMode = PAYMENT_MODE_LABEL[job.payment?.paymentMode ?? job.paymentMode];

  return (
    <div className="mx-auto max-w-[1320px] px-5 pb-16 pt-8 lg:px-8">
      <Link href={`/deals/${job.dealId}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Deal {dealNumber(job.dealId)}
      </Link>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-faint">Execution · {job.jobId}</span>
        <StatusBadge status={job.status} />
      </div>
      <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.015em] text-ink sm:text-[32px]" aria-live="polite">
        {HEADLINE[job.status]}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {job.deal.provider.name} → {job.deal.buyer.name} · {job.deal.workload.gpuCount}× {job.deal.workload.gpuModel}
        {job.deal.replacementProvider ? ` · backfilled by ${job.deal.replacementProvider.name}` : ""}
      </p>

      {(job.status === "COMPLETE" || job.status === "FAILED") && (
        <div className="mt-6">{job.status === "COMPLETE" ? <CompletionBanner job={job} /> : <FailureBanner job={job} />}</div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── Left: lifecycle + honesty panel ─────── */}
        <div className="flex flex-col gap-6 lg:sticky lg:top-20 lg:self-start">
          <Panel>
            <PanelHeader eyebrow="Lifecycle" title={STATUS_META[job.status].label} />
            <div className="px-5 py-5">
              <LifecycleStepper job={job} />
            </div>
          </Panel>
          <Panel>
            <PanelHeader eyebrow="Integrations" title="What ran for real" />
            <dl className="space-y-3 px-5 py-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Execution</dt>
                <dd>
                  <ModeTag real={executionMode.real}>{job.executionMode}</ModeTag>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Payment</dt>
                <dd>
                  <ModeTag real={paymentMode.real} planned={!job.payment}>
                    {job.payment?.paymentMode ?? job.paymentMode}
                  </ModeTag>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Deal source</dt>
                <dd>
                  <ModeTag real={job.deal.source === "duo1-live"}>{job.deal.source === "duo1-live" ? "duo1" : "demo"}</ModeTag>
                </dd>
              </div>
            </dl>
            {job.fallbackNotes.length > 0 && (
              <ul className="space-y-1.5 border-t border-line px-5 py-3">
                {job.fallbackNotes.map((note) => (
                  <li key={note} className="flex gap-2 text-xs leading-5 text-muted">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {note}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* ── Right: live panels ──────────────────── */}
        <div className="flex min-w-0 flex-col gap-6">
          <Panel>
            <PanelHeader eyebrow="Deal" title="Compute and payment flows" right={<FlowLegend />} />
            <div className="p-5">
              <DealGraph deal={job.deal} computeState={flows.compute} paymentState={flows.payment} highlightBuyer={job.status === "COMPLETE"} />
            </div>
          </Panel>

          <ComputePanel job={job} />

          {(showVerification || showSettlement) && (
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              {showVerification && (
                <div className="rise-in">
                  <VerificationPanel job={job} />
                </div>
              )}
              {showSettlement && (
                <div className="rise-in">
                  <SettlementPanel job={job} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
