// ─────────────────────────────────────────────────────────────
// The PaymentProvider abstraction.
//
// The job runner only calls settlePayment(job) (see ./index.ts).
// x402-specific code lives only in ./x402.ts.
// ─────────────────────────────────────────────────────────────

import type { Job, PaymentMode, PaymentResult, SettlementLeg } from "../../types";

export interface PaymentProvider {
  mode: PaymentMode;
  label: string;
  /** Is this provider set up (keys/addresses present)? */
  isConfigured(): { configured: boolean; reason?: string };
  settle(job: Job): Promise<PaymentResult>;
}

/**
 * Who pays whom in a deal.
 *   Leg 1: buyer → provider for the compute it received.
 *   Leg 2 (multi-party only): provider → replacement provider for the backfill.
 */
export function plannedLegs(job: Job): Omit<SettlementLeg, "mode" | "status" | "transactionId">[] {
  const { deal } = job;
  const hours = deal.workload.durationMinutes / 60;
  const legs: Omit<SettlementLeg, "mode" | "status" | "transactionId">[] = [
    { from: deal.buyer.name, to: deal.provider.name, amount: deal.price.amount, currency: deal.price.currency },
  ];
  const replacementRate = deal.impact?.replacementPricePerGpuHour;
  if (deal.replacementProvider && replacementRate) {
    legs.push({
      from: deal.provider.name,
      to: deal.replacementProvider.name,
      amount: Math.round(replacementRate * deal.workload.gpuCount * hours * 100) / 100,
      currency: deal.price.currency,
    });
  }
  return legs;
}

export function randomId(prefix: string, length = 12): string {
  const alphabet = "abcdef0123456789";
  let id = prefix;
  for (let i = 0; i < length; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}
