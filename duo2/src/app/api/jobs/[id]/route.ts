// GET /api/jobs/[id]
// Returns the full, current state of a job. The UI polls this while a job runs.

import type { NextRequest } from "next/server";
import { getJob } from "@/lib/server/job-store";

export async function GET(_request: NextRequest, context: RouteContext<"/api/jobs/[id]">) {
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) return Response.json({ success: false, error: "Job not found" }, { status: 404 });
  return Response.json({ success: true, job });
}
