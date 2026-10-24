import { generateApiKey, upsertApiKey } from "../src/auth/keys.js";
import { PgDb } from "../src/db/client.js";
import type { PrincipalRole } from "../src/contract.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Optional.
}

function value(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1]?.trim() || null;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const name = value("--name");
  if (!name) throw new Error("--name is required.");
  const role = (value("--role") ?? "agent") as PrincipalRole;
  if (!["agent", "human", "finance", "admin", "worker"].includes(role)) {
    throw new Error("--role must be one of agent, human, finance, admin, worker.");
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
