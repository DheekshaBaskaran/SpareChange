"use client";

// Live compute telemetry: worker, container, runtime, progress,
// a small accuracy chart parsed from the worker's PROGRESS lines,
// and the last few log lines.

import { ChevronDown, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { clock } from "@/lib/format";
import { EXECUTION_MODE_LABEL } from "@/lib/status";
import type { Job } from "@/lib/types";
import { ModeTag, Panel, PanelHeader, cx } from "../ui";

/** Pull accuracy values out of lines like "PROGRESS 40 epoch=12 loss=0.07 accuracy=97.8%". */
function accuracySeries(logs: string[]): number[] {
  const values: number[] = [];
  for (const line of logs) {
    const match = line.match(/accuracy=([\d.]+)%/);
    if (match && line.includes("PROGRESS")) values.push(Number(match[1]));
  }
  return values;
}

function AccuracyChart({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="flex h-24 items-center justify-center text-xs text-faint">Waiting for training metrics…</div>;
  }
  const width = 320;
  const height = 96;
  const step = width / (values.length - 1);
  const y = (value: number) => height - 6 - (value / 100) * (height - 12);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">Model accuracy (held-out)</span>
        <span className="tabular text-sm font-semibold text-ink">
          {values[0].toFixed(1)}% <span className="text-faint">→</span> <span className="text-value">{last.toFixed(1)}%</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-24 w-full" preserveAspectRatio="none" role="img" aria-label={`Accuracy rose from ${values[0]}% to ${last}%`}>
        {[25, 50, 75, 100].map((tick) => (
          <line key={tick} x1="0" x2={width} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <polyline points={points} fill="none" stroke="var(--color-value)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function ComputePanel({ job }: { job: Job }) {
  const execution = job.execution;
  const running = job.status === "RUNNING";
  const [now, setNow] = useState(0); // ticks while running
  const [showAllLogs, setShowAllLogs] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);

  const runtimeMs = execution
    ? execution.runtimeMs ?? (running ? now - Date.parse(execution.startedAt) : 0)
    : 0;
  const progress = execution?.progressPercent ?? 0;
  const mode = EXECUTION_MODE_LABEL[job.executionMode];
  const logs = execution?.logs.filter((line) => !line.startsWith("RESULT ")) ?? [];
  const visibleLogs = showAllLogs ? logs : logs.slice(-7);
  const output = execution?.output;

  return (
    <Panel>
      <PanelHeader eyebrow="Compute" title={running ? "Workload running" : execution ? "Workload" : "Provisioning compute"} right={<ModeTag real={mode.real}>{mode.label}</ModeTag>} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-3">
        <Telemetry label="Worker" value={execution?.workerId && execution.workerId !== "pending" ? execution.workerId : "allocating…"} mono />
        <Telemetry label="GPU allocation" value={`${job.deal.workload.gpuCount}× ${job.deal.workload.gpuModel.replace(/^NVIDIA\s+/, "")}`} />
        <Telemetry label="Container" value={execution?.containerId ? execution.containerId.slice(0, 12) : job.executionMode === "local-docker" || job.executionMode === "remote" ? "starting…" : "— (process)"} mono />
        <Telemetry label="Runtime" value={clock(runtimeMs)} mono />
        <Telemetry label="Exit code" value={execution?.exitCode ?? (running ? "running" : "—")} mono />
        <Telemetry label="Operations" value={output ? `${(output.operations / 1e9).toFixed(1)} B` : "—"} mono />
      </div>

      <div className="px-5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Progress</span>
          <span className="tabular font-mono text-ink-2">{progress}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={cx("h-full rounded-full transition-[width] duration-500", job.status === "FAILED" && job.failure?.step === "RUNNING" ? "bg-danger" : "bg-compute")}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <AccuracyChart values={accuracySeries(execution?.logs ?? [])} />
        </div>
        <div className="flex min-w-0 flex-col rounded-lg border border-line bg-canvas">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <SquareTerminal className="size-3.5" aria-hidden /> Worker output
            </span>
            {logs.length > 7 && (
              <button type="button" onClick={() => setShowAllLogs((value) => !value)} className="flex items-center gap-1 text-xs text-muted hover:text-ink">
                {showAllLogs ? "Show recent" : `Show all ${logs.length}`}
                <ChevronDown className={cx("size-3.5 transition-transform", showAllLogs && "rotate-180")} aria-hidden />
              </button>
            )}
          </div>
          <pre className={cx("min-h-[128px] overflow-auto px-3 py-2 font-mono text-[11.5px] leading-[18px] text-ink-2", showAllLogs && "max-h-72")}>
            {visibleLogs.length ? (
              visibleLogs.map((line, index) => (
                <div key={index} className={cx("whitespace-pre-wrap break-all", line.includes("ERROR") && "text-danger", line.includes("SpareChange workload") && "text-value")}>
                  {line}
                </div>
              ))
            ) : (
              <span className="text-faint">Waiting for the worker to start…</span>
            )}
          </pre>
        </div>
      </div>
    </Panel>
  );
}

function Telemetry({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-1 truncate text-sm text-ink", mono && "tabular font-mono text-[13px]")}>{value}</div>
    </div>
  );
}
