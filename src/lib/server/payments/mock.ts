// ─────────────────────────────────────────────────────────────
// MockPaymentProvider: records a settlement without moving any money.
// Transaction IDs start with "mock_tx_" so they can never be mistaken
// for real on-chain transactions.
// ─────────────────────────────────────────────────────────────

import { plannedLegs, randomId, type PaymentProvider } from "./types";

export const mockPaymentProvider: PaymentProvider = {
  mode: "mock",
  label: "Mock settlement",

  isConfigured() {
    return { configured: true };
  },

  async settle(job) {
    await new Promise((resolve) => setTimeout(resolve, 900)); // feels like a real network call
    const legs = plannedLegs(job).map((leg) => ({
      ...leg,
      mode: "mock" as const,
      status: "SUCCESS" as const,
      transactionId: randomId("mock_tx_"),
    }));

    return {
      status: "SUCCESS",
      paymentMode: "mock",
      transactionId: legs[0].transactionId,
      amount: job.deal.price.amount,
      currency: job.deal.price.currency,
      timestamp: new Date().toISOString(),
      legs,
      steps: [
        "Verified result accepted by buyer",
        `${legs.length} settlement leg${legs.length > 1 ? "s" : ""} recorded (simulated, no funds moved)`,
      ],
    };
  },
};
