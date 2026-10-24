import type { Principal, PrincipalRole } from "../contract.js";
import { ApiError } from "../errors.js";

export type Permission =
  | "deal:read"
  | "deal:search"
  | "deal:negotiate"
  | "deal:approve"
  | "deal:handoff"
  | "execution:authorize"
  | "finance:read"
  | "invoice:generate"
  | "invoice:adjust"
  | "payment:request"
  | "payment:approve"
  | "payment:execute"
  | "usage:verify"
  | "settlement:confirm"
  | "exception:investigate"
  | "exception:propose"
  | "ledger:read"
  | "audit:read"
  | "creao:work";

const ROLE_PERMISSIONS: Record<PrincipalRole, Permission[]> = {
  agent: [
    "deal:read",
    "deal:search",
    "deal:negotiate",
    "deal:handoff",
    "execution:authorize",
    "finance:read",
    "invoice:generate",
    "usage:verify",
    "exception:investigate",
    "exception:propose",
    "ledger:read",
    "audit:read",
    "creao:work",
  ],
  human: [
    "deal:read",
    "deal:negotiate",
    "deal:approve",
    "deal:handoff",
    "finance:read",
    "payment:approve",
    "ledger:read",
    "audit:read",
  ],
  finance: [
    "deal:read",
    "execution:authorize",
    "finance:read",
    "invoice:generate",
    "invoice:adjust",
    "payment:request",
    "exception:investigate",
    "exception:propose",
    "ledger:read",
    "audit:read",
  ],
  admin: [
    "deal:read",
    "deal:search",
    "deal:negotiate",
    "deal:handoff",
    "execution:authorize",
    "finance:read",
    "invoice:generate",
    "invoice:adjust",
    "payment:request",
    "payment:execute",
    "usage:verify",
    "settlement:confirm",
    "exception:investigate",
    "exception:propose",
    "ledger:read",
    "audit:read",
    "creao:work",
  ],
  worker: [
    "usage:verify",
    "settlement:confirm",
    "payment:execute",
    "finance:read",
  ],
};

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return ROLE_PERMISSIONS[principal.role].includes(permission);
}

export function assertPermission(principal: Principal, permission: Permission): void {
  if (!hasPermission(principal, permission)) {
    throw new ApiError(
      403,
      "permission_forbidden",
      `This action requires the ${permission} permission.`,
      { violations: [`permission:${permission}`] },
    );
  }
}

/**
 * Human approval is a credential property, not a role label. A service key with
 * the finance role can prepare a payment, but only a human credential bound to a
 * human user can approve it.
 */
export function assertHumanApprover(principal: Principal): void {
  if (principal.role !== "human" || !principal.humanUserId) {
    throw new ApiError(
      403,
      "human_approval_required",
      "This decision requires a human credential bound to a human user.",
    );
  }
}

export function separationOfDuties(
  requester: string,
  approver: string,
): void {
  if (requester === approver) {
    throw new ApiError(
      403,
      "separation_of_duties_violation",
      "The requester cannot approve their own restricted action.",
    );
  }
}
