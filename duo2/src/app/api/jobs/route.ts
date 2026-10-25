// GET /api/jobs
// Lists recent jobs (newest first) without their logs, for the dashboard history.

import { connection } from "next/server";
import { listJobs } from "@/lib/server/job-store";

export async function GET() {
  await connection(); // always run at request time, never prerender
  const jobs = listJobs().map((job) => ({
    jobId: job.jobId,
    dealId: job.dealId,
    title: job.deal.title,
    buyer: job.deal.buyer.name,
    provider: job.deal.provider.name,
    gpuModel: job.deal.workload.gpuModel,
    gpuCount: job.deal.workload.gpuCount,
    amount: job.deal.price.amount,
    currency: job.deal.price.currency,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    executionMode: job.executionMode,
    paymentMode: job.paymentMode,
  }));
  return Response.json({ success: true, jobs });
}
