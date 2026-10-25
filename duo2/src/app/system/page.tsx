// System / debug view: which integrations are real vs. simulated,
// the fallback chain, failure scenarios, and the Duo 1 API.

import { Eyebrow, Panel, PanelHeader } from "@/components/ui";
import { DEMO_MULTI_PARTY_DEAL } from "@/lib/demo-data";
import { SystemStatus } from "./system-status";
import { ExecuteButton } from "@/components/execute-button";

const FAILURE_SCENARIOS = [
  { id: "workload", title: "Workload crashes", detail: "The worker exits with code 1 partway through training." },
  { id: "verification", title: "Verification rejects output", detail: "The worker skips training, so accuracy checks fail. No payment is made." },
  { id: "payment", title: "Payment declined", detail: "Settlement is rejected after a verified run." },
] as const;

export default function SystemPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-16 pt-10 lg:px-8">
      <Eyebrow>System</Eyebrow>
      <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.015em] text-ink">Integrations &amp; fallbacks</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Every external integration has a fallback so the demo keeps working. This page shows exactly what is live and what is simulated right now.
      </p>

      <div className="mt-8">
        <SystemStatus />
      </div>

      <Panel className="mt-6">
        <PanelHeader eyebrow="Testing" title="Failure scenarios" />
        <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-3">
          {FAILURE_SCENARIOS.map((scenario) => (
            <div key={scenario.id} className="flex flex-col bg-surface p-5">
              <div className="text-sm font-medium text-ink">{scenario.title}</div>
              <p className="mt-1 flex-1 text-[13px] leading-5 text-muted">{scenario.detail}</p>
              <ExecuteButton deal={DEMO_MULTI_PARTY_DEAL} simulateFailure={scenario.id} size="md" label="Run scenario" variant="secondary" className="mt-4" />
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader eyebrow="Duo 1 → Duo 2" title="API contract" right={<span className="font-mono text-xs text-faint">docs/API_CONTRACT.md</span>} />
        <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-2">
          {[
            ["POST", "/api/deals/execute", "Send an approved deal → returns jobId"],
            ["GET", "/api/jobs/[id]", "Current job state, execution, verification, payment"],
            ["GET", "/api/deals", "Approved deals shown in the UI"],
            ["GET", "/api/market", "GPU listings shown in the UI"],
          ].map(([method, path, description]) => (
            <div key={path} className="bg-surface px-5 py-4">
              <div className="font-mono text-[13px]">
                <span className={method === "POST" ? "text-value" : "text-compute"}>{method}</span> <span className="text-ink">{path}</span>
              </div>
              <div className="mt-1 text-xs text-muted">{description}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
