"use client";

// Recent executions: jobs run in this session (live from /api/jobs)
// plus a seeded historical record so the list is never empty.

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DEMO_HISTORY } from "@/lib/demo-data";
import { money, relativeTime } from "@/lib/format";
import type { JobStatus } from "@/lib/types";
import { StatusBadge } from "./ui";

interface JobSummary {
  jobId: string;
  dealId: string;
  title?: string;
  buyer: string;
  provider: string;
  gpuModel: string;
  gpuCount: number;
  amount: number;
  currency: string;
  status: JobStatus;
  createdAt: string;
}

export function ExecutionHistory({ limit = 5, showDemoRecords = true }: { limit?: number; showDemoRecords?: boolean }) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [now, setNow] = useState(0); // set after the first fetch (Date.now() is not allowed during prerender)

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/jobs")
        .then((response) => response.json())
        .then((data) => {
          if (!cancelled) {
            setJobs(data.jobs);
            setNow(Date.now());
          }
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const liveRows = (jobs ?? []).slice(0, limit);

  return (
    <ul className="divide-y divide-line/70">
      {liveRows.map((job) => (
        <li key={job.jobId}>
          <Link href={`/jobs/${job.jobId}`} className="group flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">
                {job.provider} → {job.buyer}
              </div>
              <div className="mt-0.5 font-mono text-[11.5px] text-faint">
                {job.jobId} · {relativeTime(job.createdAt, now)}
              </div>
            </div>
            <span className="tabular hidden text-[13px] text-ink-2 sm:block">{money(job.amount, job.currency)}</span>
            <StatusBadge status={job.status} />
            <ChevronRight className="size-4 text-faint group-hover:text-ink" aria-hidden />
          </Link>
        </li>
      ))}
      {showDemoRecords &&
        DEMO_HISTORY.map((record) => (
          <li key={record.dealId} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink-2">
                {record.provider} → {record.buyer}
              </div>
              <div className="mt-0.5 font-mono text-[11.5px] text-faint">demo record · yesterday</div>
            </div>
            <span className="tabular hidden text-[13px] text-ink-2 sm:block">{money(record.amount, record.currency)}</span>
            <StatusBadge status={record.status} />
            <span className="size-4" aria-hidden />
          </li>
        ))}
      {jobs !== null && liveRows.length === 0 && !showDemoRecords && (
        <li className="px-5 py-8 text-center text-sm text-muted">No executions yet. Open a deal and click Execute Deal.</li>
      )}
    </ul>
  );
}
