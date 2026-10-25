// POST /api/jobs/[id]/retry
// Starts a fresh job for the same deal (used by the Retry button after a failure).

import type { NextRequest } from "next/server";
import { createJob } from "@/lib/server/job-runner";
import { getJob } from "@/lib/server/job-store";

export async function POST(_request: NextRequest, context: RouteContext<"/api/jobs/[id]/retry">) {
  const { id } = await context.params;
  const previous = getJob(id);
  if (!previous) return Response.json({ success: false, error: "Job not found" }, { status: 404 });

  const job = createJob(previous.deal);
  return Response.json({ success: true, jobId: job.jobId, status: job.status }, { status: 201 });
}
