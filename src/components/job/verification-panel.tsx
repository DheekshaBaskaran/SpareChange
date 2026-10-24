// Verification checks: payment is only released if every one passes.

import { Check, LoaderCircle, ShieldCheck, X } from "lucide-react";
import type { Job } from "@/lib/types";
import { Badge, Panel, PanelHeader, cx } from "../ui";

const PLANNED_CHECKS = [
  "Workload exited cleanly",
  "Start and completion markers in logs",
  "Result belongs to this job",
  "Model actually trained",
  "Accuracy ≥ 85%",
];

export function VerificationPanel({ job }: { job: Job }) {
  const verification = job.verification;
  const inProgress = job.status === "VERIFYING" && !verification;
  const checks = verification?.checks ?? PLANNED_CHECKS.map((name) => ({ name, passed: false, detail: "" }));

  return (
    <Panel>
      <PanelHeader
        eyebrow="Verification"
        title="Proof the compute was delivered"
        right={
          verification ? (
            <Badge tone={verification.status === "VERIFIED" ? "value" : "danger"} dot>
              {verification.status === "VERIFIED" ? "Verified" : "Rejected"}
            </Badge>
          ) : (
            <Badge tone="compute" dot>
              Checking
            </Badge>
          )
        }
      />
      <ul className="divide-y divide-line/70">
        {checks.map((check) => (
          <li key={check.name} className="flex items-center gap-3 px-5 py-2.5">
            {inProgress ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-compute" aria-label="checking" />
            ) : check.passed ? (
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-value/15 text-value">
                <Check className="size-3" strokeWidth={3} aria-label="passed" />
              </span>
            ) : (
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
                <X className="size-3" strokeWidth={3} aria-label="failed" />
              </span>
            )}
            <span className={cx("flex-1 text-sm", inProgress ? "text-muted" : "text-ink")}>{check.name}</span>
            {check.detail && <span className="hidden font-mono text-xs text-muted sm:block">{check.detail}</span>}
          </li>
        ))}
      </ul>
      {verification?.status === "VERIFIED" && (
        <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted">
          <ShieldCheck className="size-3.5 text-value" aria-hidden /> All checks passed. Payment can be released.
        </div>
      )}
    </Panel>
  );
}
