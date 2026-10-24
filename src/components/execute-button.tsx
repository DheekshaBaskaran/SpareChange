"use client";

// The primary call to action. Sends the approved deal to
// POST /api/deals/execute (the same endpoint Duo 1 uses), then
// opens the live execution screen for the new job.

import { ArrowRight, LoaderCircle, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Deal, ExecuteOptions } from "@/lib/types";
import { cx } from "./ui";

export function ExecuteButton({
  deal,
  simulateFailure,
  size = "lg",
  className,
}: {
  deal: Deal;
  simulateFailure?: ExecuteOptions["simulateFailure"];
  size?: "md" | "lg";
  className?: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function execute() {
    setSubmitting(true);
    setError(null);
    try {
      const query = simulateFailure ? `?simulateFailure=${simulateFailure}` : "";
      const response = await fetch(`/api/deals/execute${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deal),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error ?? "Could not start execution");
      router.push(`/jobs/${data.jobId}`);
    } catch (caught) {
      setError((caught as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={execute}
        disabled={submitting}
        className={cx(
          "group flex w-full items-center justify-center gap-2 rounded-lg bg-value font-semibold tracking-tight text-canvas transition-all",
          "hover:brightness-110 active:scale-[0.99] disabled:cursor-wait disabled:opacity-80",
          size === "lg" ? "h-12 text-[15px]" : "h-10 text-sm",
        )}
      >
        {submitting ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Starting execution…
          </>
        ) : (
          <>
            <Zap className="size-4" aria-hidden /> EXECUTE DEAL
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </>
        )}
      </button>
      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
