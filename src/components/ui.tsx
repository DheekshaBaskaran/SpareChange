// Small building blocks used across every screen, so panels,
// labels and badges look identical everywhere.

import type { ReactNode } from "react";
import { STATUS_META, TONE_CLASSES, type Tone } from "@/lib/status";
import type { JobStatus } from "@/lib/types";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function Panel({ children, className, as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={cx("rounded-xl border border-line bg-surface", className)}>{children}</Tag>;
}

export function PanelHeader({ title, eyebrow, right, className }: { title: ReactNode; eyebrow?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">{eyebrow}</div>}
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-[11px] font-medium uppercase tracking-[0.14em] text-faint", className)}>{children}</div>;
}

export function Badge({ tone = "neutral", children, dot = false, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  const toneClasses = TONE_CLASSES[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClasses.text,
        toneClasses.bg,
        toneClasses.border,
        className,
      )}
    >
      {dot && <span className={cx("size-1.5 rounded-full", toneClasses.dot)} aria-hidden />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  );
}

/** Small tag that says whether a piece of the system is real or simulated. */
export function ModeTag({ real, children }: { real: boolean; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide",
        real ? "border-value/25 text-value" : "border-line-strong text-muted",
      )}
      title={real ? "This runs for real" : "Simulated for the demo"}
    >
      {real ? "live" : "simulated"} · {children}
    </span>
  );
}

export function Metric({
  label,
  value,
  sub,
  tone,
  size = "md",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "value" | "compute" | "default";
  size?: "md" | "lg";
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={cx(
          "tabular mt-1 font-semibold tracking-tight",
          size === "lg" ? "text-[28px] leading-8" : "text-xl",
          tone === "value" ? "text-value" : tone === "compute" ? "text-compute" : "text-ink",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function KeyValue({ label, value, mono = false }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cx("text-right text-sm text-ink", mono && "font-mono text-[13px]")}>{value}</dd>
    </div>
  );
}
