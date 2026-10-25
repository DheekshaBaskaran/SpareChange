// Live execution screen for one job.

import { Suspense } from "react";
import { JobView } from "@/components/job/job-view";

export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <Suspense fallback={<div className="mx-auto h-[70vh] max-w-[1320px] px-8 pt-10" aria-busy />}>
      <JobLoader params={params} />
    </Suspense>
  );
}

async function JobLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobView jobId={id} />;
}
