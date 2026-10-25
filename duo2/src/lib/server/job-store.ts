// ─────────────────────────────────────────────────────────────
// Storage for jobs and received deals.
//
// Kept in memory (on `globalThis`, so it survives Next.js hot reloads)
// and mirrored to a small JSON file, .data/jobs.json, so job history
// survives server restarts. No database needed for the demo.
// The .data folder is gitignored.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import type { Deal, Job, JobStatus } from "../types";

interface Store {
  jobs: Map<string, Job>;
  deals: Map<string, Deal>;
}

const DATA_FILE = path.join(process.cwd(), ".data", "jobs.json");
const TERMINAL: JobStatus[] = ["COMPLETE", "FAILED"];

/** Load saved jobs/deals from disk (once per server start). */
function loadFromDisk(): Store {
  const store: Store = { jobs: new Map(), deals: new Map() };
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as { jobs: Job[]; deals: Deal[] };
    for (const deal of saved.deals ?? []) store.deals.set(deal.dealId, deal);
    for (const job of saved.jobs ?? []) {
      // A job that was mid-run when the server stopped can never finish: say so honestly.
      if (!TERMINAL.includes(job.status)) {
        const step = job.status;
        job.failure = { step, message: "The server restarted while this job was running. No funds were released." };
        job.status = "FAILED";
        job.timeline.push({ status: "FAILED", at: new Date().toISOString(), note: "Interrupted by server restart" });
      }
      store.jobs.set(job.jobId, job);
    }
  } catch {
    // No file yet (first run) or unreadable: start empty.
  }
  return store;
}

const globalForStore = globalThis as unknown as { __sparechangeStore?: Store };
const store: Store = (globalForStore.__sparechangeStore ??= loadFromDisk());

let writeTimer: ReturnType<typeof setTimeout> | undefined;

/** Write the store to disk shortly after a change (batched, so it never slows jobs down). */
function persistSoon(): void {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const data = { jobs: [...store.jobs.values()], deals: [...store.deals.values()] };
      fs.writeFileSync(DATA_FILE, JSON.stringify(data));
    } catch (error) {
      console.warn("[job-store] could not save jobs to disk:", (error as Error).message);
    }
  }, 300);
}

export function saveJob(job: Job): void {
  store.jobs.set(job.jobId, job);
  persistSoon();
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
  persistSoon();
}

export function listReceivedDeals(): Deal[] {
  return [...store.deals.values()];
}
