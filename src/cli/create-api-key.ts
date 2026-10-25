import { generateApiKey, upsertApiKey } from "../auth/keys.js";
import { PgDb } from "../db/client.js";
import type { PrincipalRole } from "../contract.js";

/**
 * Provision a credential without shipping dev dependencies into the runtime
 * image. The key is printed exactly once; only its hash is persisted.
 *
 *   node dist/cli/create-api-key.js --name "CREAO Deal Coordinator" --role agent
 *   node dist/cli/create-api-key.js --name "Duo 2 Worker" --role worker
 *   node dist/cli/create-api-key.js --name "Acme Approver" --role human \
 *     --party-id <party-uuid> --human-user-id <human-uuid>
 */

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional; containers receive variables directly.
}

function value(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1]?.trim() || null;
}

const ROLES: PrincipalRole[] = ["agent", "human", "finance", "admin", "worker"];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const name = value("--name");
  if (!name) throw new Error("--name is required.");
  const role = (value("--role") ?? "agent") as PrincipalRole;
  if (!ROLES.includes(role)) {
    throw new Error(`--role must be one of ${ROLES.join(", ")}.`);
  }
  const partyId = value("--party-id");
  const humanUserId = value("--human-user-id");
  if (role === "human" && !humanUserId) {
    throw new Error("--human-user-id is required for a human key.");
  }

  const key = generateApiKey();
  const db = new PgDb(databaseUrl);
  try {
    const id = await upsertApiKey(db, {
      name,
      key,
      role,
      partyId,
      humanUserId,
    });
    console.log(`Created ${role} key '${name}' (${id}).`);
    console.log("Store this key now; it will not be shown again:");
    console.log(key);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
