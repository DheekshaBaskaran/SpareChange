// All executions in this server session.

import { ExecutionHistory } from "@/components/execution-history";
import { Eyebrow, Panel, PanelHeader } from "@/components/ui";

export default function ExecutionsPage() {
  return (
    <div className="mx-auto max-w-[960px] px-5 pb-16 pt-10 lg:px-8">
      <Eyebrow>Execution</Eyebrow>
      <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.015em] text-ink">Executions</h1>
      <p className="mt-1 text-sm text-muted">Every approved deal SpareChange has executed, newest first.</p>
      <Panel className="mt-6">
        <PanelHeader title="Jobs" />
        <ExecutionHistory limit={50} />
      </Panel>
    </div>
  );
}
