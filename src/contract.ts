export const CONTRACT_VERSION = "relay-duo1.v1";
export const CONTRACT_HEADER = "x-relay-contract";
export const IDEMPOTENCY_HEADER = "idempotency-key";

export const SUPPORTED_CONTRACTS = new Set([CONTRACT_VERSION]);

export type PrincipalRole = "agent" | "human" | "finance" | "admin" | "worker";

export interface Principal {
  /** Stable principal identifier used for idempotency scoping and audit. */
  id: string;
  name: string;
  role: PrincipalRole;
  partyId: string | null;
  humanUserId: string | null;
  apiKeyId: string | null;
}

export function isAgent(principal: Principal): boolean {
  return principal.role === "agent";
}
