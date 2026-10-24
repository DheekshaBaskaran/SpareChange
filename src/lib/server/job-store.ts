// ─────────────────────────────────────────────────────────────
// In-memory storage for jobs and received deals.
//
// This is the simplest storage that works for a hackathon demo:
// data lives as long as the server process does. It is stored on
// `globalThis` so it survives Next.js hot reloads during development.
// ─────────────────────────────────────────────────────────────

import type { Deal, Job, JobStatus } from "../types";

interface Store {
  jobs: Map<string, Job>;
  deals: Map<string, Deal>;
}

const globalForStore = globalThis as unknown as { __sparechangeStore?: Store };

const store: Store = (globalForStore.__sparechangeStore ??= {
  jobs: new Map(),
  deals: new Map(),
});

export function saveJob(job: Job): void {
  store.jobs.set(job.jobId, job);
}

export function getJob(jobId: string): Job | undefined {
  return store.jobs.get(jobId);
}

export function listJobs(): Job[] {
  return [...store.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Change a job's status and record it on the timeline. */
export function setJobStatus(job: Job, status: JobStatus, note?: string): void {
  job.status = status;
  job.timeline.push({ status, at: new Date().toISOString(), note });
  saveJob(job);
}

/** Deals that arrived through POST /api/deals/execute (e.g. from Duo 1). */
export function rememberDeal(deal: Deal): void {
  store.deals.set(deal.dealId, deal);
}

export function listReceivedDeals(): Deal[] {
  return [...store.deals.values()];
}
