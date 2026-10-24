import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { Principal, PrincipalRole } from "../contract.js";
import type { Db } from "../db/client.js";
import { ApiError } from "../errors.js";
import { hashApiKey } from "./keys.js";

interface ApiKeyRow {
  id: string;
  name: string;
  role: PrincipalRole;
  party_id: string | null;
  human_user_id: string | null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function authenticate(
  db: Db,
  config: AppConfig,
  authorization: string | undefined,
): Promise<Principal | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const key = authorization.slice("Bearer ".length).trim();
  if (key.length < 8 || key.length > 512) return null;

  const result = await db.query<ApiKeyRow>(
    `SELECT id, name, role, party_id, human_user_id
     FROM api_keys
     WHERE key_hash = $1
       AND active = true
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [hashApiKey(key)],
  );

  const row = result.rows[0];
  if (row) {
    void db
      .query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id])
      .catch(() => undefined);
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      partyId: row.party_id,
      humanUserId: row.human_user_id,
      apiKeyId: row.id,
    };
  }

  // The bootstrap agent key is a deliberate local/staging convenience. It is
  // still compared as a hash and never grants human approval rights.
  if (config.envAgentKey && safeEqual(hashApiKey(key), hashApiKey(config.envAgentKey))) {
    return {
      id: "env:agent",
      name: "CREAO Deal Coordinator",
      role: "agent",
      partyId: null,
      humanUserId: null,
      apiKeyId: null,
    };
  }

  return null;
}

export function requirePrincipal(principal: Principal | null | undefined): Principal {
  if (!principal) {
    throw new ApiError(401, "authentication_required", "A valid Bearer API key is required.");
  }
  return principal;
}

export function requireRole(principal: Principal, roles: PrincipalRole[]): void {
  if (!roles.includes(principal.role)) {
    throw new ApiError(403, "role_forbidden", `This action requires one of: ${roles.join(", ")}.`);
  }
}

/**
 * A human decision is only accepted from a human credential. The agent can
 * create requests and read decisions, but it can never attest on a participant's
 * behalf.
 */
export function assertHumanAttestation(
  principal: Principal,
  attestedBy: string,
  simulated: boolean,
  allowSimulated: boolean,
): void {
  if (principal.role !== "human") {
    throw new ApiError(
      403,
      "human_attestation_required",
      "Participant approvals must be submitted by a human credential, not an agent or service credential.",
    );
  }
  if (simulated && !allowSimulated) {
    throw new ApiError(
      403,
      "simulated_approval_forbidden",
      "Simulated approvals are only accepted when RELAY_ALLOW_SIMULATED_APPROVALS=1 in a non-live environment.",
    );
  }
  if (principal.humanUserId && attestedBy !== principal.humanUserId) {
    throw new ApiError(
      403,
      "attestation_mismatch",
      "attested_by must match the human user bound to this credential.",
    );
  }
  if (!principal.humanUserId && attestedBy !== principal.name && attestedBy !== principal.id) {
    throw new ApiError(
      403,
      "attestation_mismatch",
      "attested_by must identify the credential holder.",
    );
  }
}
