// POST /api/deals/execute
// Duo 1 (or the SpareChange UI) sends an approved deal here.
// We validate it, create a job, and return the job ID immediately.
// Optional for testing: ?simulateFailure=workload|verification|payment

import type { NextRequest } from "next/server";
import { createJob } from "@/lib/server/job-runner";
import { rememberDeal } from "@/lib/server/job-store";
import { validateDeal } from "@/lib/server/validate-deal";
import type { ExecuteOptions } from "@/lib/types";

const FAILURE_OPTIONS = ["workload", "verification", "payment"] as const;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid deal: body must be valid JSON" }, { status: 400 });
  }

  const validation = validateDeal(body);
  if (!validation.ok) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }

  const simulateFailure = request.nextUrl.searchParams.get("simulateFailure");
  const options: ExecuteOptions = FAILURE_OPTIONS.includes(simulateFailure as (typeof FAILURE_OPTIONS)[number])
    ? { simulateFailure: simulateFailure as ExecuteOptions["simulateFailure"] }
    : {};

  rememberDeal(validation.deal);
  const job = createJob(validation.deal, options);

  return Response.json({ success: true, jobId: job.jobId, status: job.status }, { status: 201 });
}
