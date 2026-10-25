// ─────────────────────────────────────────────────────────────
// settlePayment(job): the only payment function the job runner calls.
//
// PAYMENT_MODE=x402 → try Coinbase x402, fall back to mock if it is
//                     not configured or the call fails.
// PAYMENT_MODE=mock → always use the mock provider.
// ─────────────────────────────────────────────────────────────

import type { ExecuteOptions, Job, PaymentResult } from "../../types";
import { getConfig } from "../config";
import { listJobs } from "../job-store";
import { mockPaymentProvider } from "./mock";
import { x402PaymentProvider } from "./x402";

export interface SettlementOutcome {
  result: PaymentResult;
  fallbackNote?: string;
}

export async function settlePayment(job: Job, options: ExecuteOptions = {}): Promise<SettlementOutcome> {
  if (options.simulateFailure === "payment") {
    throw new Error("Payment authorization was declined (simulated failure)");
  }

  if (getConfig().paymentMode === "x402") {
    const { configured, reason } = x402PaymentProvider.isConfigured();
    if (!configured) {
      return { result: await mockPaymentProvider.settle(job), fallbackNote: `x402 not configured (${reason}), used mock settlement` };
    }
    try {
      const result = await x402PaymentProvider.settle(job);
      // Partial fallbacks (e.g. only the backfill leg) are reported, never hidden.
      return { result, fallbackNote: result.notes?.length ? result.notes.join("; ") : undefined };
    } catch (error) {
      console.error("[payments] x402 settlement failed, falling back to mock:", error);
      return {
        result: await mockPaymentProvider.settle(job),
        fallbackNote: `x402 settlement failed (${(error as Error).message}), used mock settlement`,
      };
    }
  }

  return { result: await mockPaymentProvider.settle(job) };
}

/**
 * What payment ACTUALLY did most recently, for the header pill.
 * We only ever say "live" after a real x402 transaction succeeded.
 *   planned   – x402 is configured but no payment has happened yet
 *   live      – the most recent settlement really went through x402
 *   simulated – the most recent settlement was mock (or mock mode is on)
 */
export function lastPaymentOutcome(): { state: "planned" | "live" | "simulated"; label: string; transactionId?: string } {
  const latestPaid = listJobs().find((job) => job.payment?.status === "SUCCESS");
  if (latestPaid?.payment?.paymentMode === "x402") {
    return { state: "live", label: "x402 · live", transactionId: latestPaid.payment.transactionId };
  }
  if (latestPaid) return { state: "simulated", label: "Mock settlement · simulated" };
  if (getConfig().paymentMode === "x402") return { state: "planned", label: "Payment: planned" };
  return { state: "simulated", label: "Mock settlement · simulated" };
}

/** Payment status for the System panel in the UI. */
export function describePayments() {
  const { paymentMode, x402 } = getConfig();
  const x402Status = x402PaymentProvider.isConfigured();
  return {
    paymentMode,
    x402: { ...x402Status, network: x402.network, settlementPrice: x402.settlementPrice },
    lastOutcome: lastPaymentOutcome(),
  };
}
