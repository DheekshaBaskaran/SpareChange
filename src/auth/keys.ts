import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import type { PrincipalRole } from "../contract.js";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(): string {
  return `relay_${randomBytes(32).toString("base64url")}`;
}

export interface ApiKeyInput {
  name: string;
  key: string;
  role: PrincipalRole;
  partyId?: string | null;
  humanUserId?: string | null;
}

/**
 * Upsert by key name so rotating RELAY_API_KEY invalidates the previous key
 * instead of leaving an old credential active.
 */
export async function upsertApiKey(db: Db, input: ApiKeyInput): Promise<string> {
  if (input.role === "human" && !input.humanUserId) {
    throw new Error("human API keys require a humanUserId");
  }
  const id = randomUUID();
  const result = await db.query<{ id: string }>(
    `INSERT INTO api_keys (id, name, key_hash, role, party_id, human_user_id, active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (name) DO UPDATE SET
       key_hash = EXCLUDED.key_hash,
       role = EXCLUDED.role,
       party_id = EXCLUDED.party_id,
       human_user_id = EXCLUDED.human_user_id,
       active = true,
       expires_at = NULL
     RETURNING id`,
    [
      id,
      input.name,
      hashApiKey(input.key),
      input.role,
      input.partyId ?? null,
      input.humanUserId ?? null,
    ],
  );
  return result.rows[0]!.id;
}
