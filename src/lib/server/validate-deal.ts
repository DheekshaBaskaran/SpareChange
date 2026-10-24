// ─────────────────────────────────────────────────────────────
// Checks that an incoming deal (usually from Duo 1) has every
// required field before we create a job for it.
// Required fields are documented in docs/API_CONTRACT.md.
// ─────────────────────────────────────────────────────────────

import type { Deal } from "../types";

type ValidationResult = { ok: true; deal: Deal } | { ok: false; error: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function validateDeal(input: unknown): ValidationResult {
  if (!isObject(input)) return { ok: false, error: "Invalid deal: request body must be a JSON object" };

  const { dealId, buyer, provider, workload, price, replacementProvider } = input;

  if (!isNonEmptyString(dealId)) return { ok: false, error: "Invalid deal: dealId is required" };

  for (const [field, party] of [["buyer", buyer], ["provider", provider]] as const) {
    if (!isObject(party) || !isNonEmptyString(party.id) || !isNonEmptyString(party.name)) {
      return { ok: false, error: `Invalid deal: ${field}.id and ${field}.name are required` };
    }
  }

  if (replacementProvider !== undefined) {
    if (!isObject(replacementProvider) || !isNonEmptyString(replacementProvider.id) || !isNonEmptyString(replacementProvider.name)) {
      return { ok: false, error: "Invalid deal: replacementProvider needs id and name" };
    }
  }

  if (!isObject(workload)) return { ok: false, error: "Invalid deal: workload is required" };
  if (!isNonEmptyString(workload.gpuModel)) return { ok: false, error: "Invalid deal: workload.gpuModel is required" };
  if (!isPositiveNumber(workload.gpuCount) || !Number.isInteger(workload.gpuCount)) {
    return { ok: false, error: "Invalid deal: workload.gpuCount must be a positive whole number" };
  }
  if (!isPositiveNumber(workload.durationMinutes)) {
    return { ok: false, error: "Invalid deal: workload.durationMinutes must be a positive number" };
  }

  if (!isObject(price) || !isPositiveNumber(price.amount)) {
    return { ok: false, error: "Invalid deal: price.amount must be a positive number" };
  }
  if (price.currency !== "USDC" && price.currency !== "USD") {
    return { ok: false, error: "Invalid deal: price.currency must be USDC or USD" };
  }

  const deal = input as unknown as Deal;
  return {
    ok: true,
    deal: {
      ...deal,
      type: deal.type ?? (deal.replacementProvider ? "multi_party" : "direct"),
      source: deal.source ?? "duo1-live",
      approvedAt: deal.approvedAt ?? new Date().toISOString(),
    },
  };
}
