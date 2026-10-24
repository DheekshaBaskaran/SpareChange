// Vertical lifecycle: ✓ done, ● current, ○ upcoming, ✕ failed.

import { Check, X } from "lucide-react";
import { timeOfDay } from "@/lib/format";
import { LIFECYCLE, STATUS_META, lifecycleIndex } from "@/lib/status";
import type { Job } from "@/lib/types";
import { cx } from "../ui";

type StepState = "done" | "current" | "upcoming" | "failed";

export function LifecycleStepper({ job }: { job: Job }) {
  const currentIndex = lifecycleIndex(job.status, job.failure?.step);
  const reachedAt = (status: string) => job.timeline.find((entry) => entry.status === status)?.at;

  return (
    <ol className="relative">
      {LIFECYCLE.map((status, index) => {
        let state: StepState = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
        if (job.status === "FAILED" && index === currentIndex) state = "failed";
        if (job.status === "COMPLETE" && index === currentIndex) state = "done";
        // APPROVED is instantly done once the job exists.
        if (status === "APPROVED" && job.status !== "APPROVED") state = "done";

        const meta = STATUS_META[status];
        const at = reachedAt(status);
        const isLast = index === LIFECYCLE.length - 1;

        return (
          <li key={status} className="relative flex gap-3.5 pb-6 last:pb-0">
            {!isLast && (
              <span
                className={cx("absolute left-[11px] top-7 h-[calc(100%-24px)] w-px", state === "done" ? "bg-value/50" : "bg-line-strong")}
                aria-hidden
              />
            )}
            <StepIcon state={state} />
            <div className="min-w-0 pt-0.5">
              <div className={cx("text-sm font-medium", state === "upcoming" ? "text-faint" : state === "failed" ? "text-danger" : "text-ink")}>
                {meta.stepTitle}
                <span className="sr-only"> ({state})</span>
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {state === "failed" ? "Stopped here" : state === "current" ? `${meta.stepDetail}…` : meta.stepDetail}
              </div>
              {at && state !== "upcoming" && <div className="tabular mt-0.5 font-mono text-[11px] text-faint">{timeOfDay(at)}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-value text-canvas">
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-danger text-canvas">
        <X className="size-3.5" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="pulse-ring relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-compute bg-canvas">
        <span className="size-2 rounded-full bg-compute" />
      </span>
    );
  }
  return <span className="relative z-10 size-6 shrink-0 rounded-full border-2 border-line-strong bg-canvas" aria-hidden />;
}
