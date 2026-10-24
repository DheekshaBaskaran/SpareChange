import { upsertApiKey } from "../auth/keys.js";
import { PgDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { DEMO_IDS, seedDemo } from "./seed-demo.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Optional.
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const db = new PgDb(databaseUrl);
  try {
    const applied = await runMigrations(db);
    if (applied.length) console.log(`Applied ${applied.length} migration(s).`);
    await seedDemo(db);

    const agentKey = process.env.RELAY_API_KEY?.trim();
    if (agentKey) {
      await upsertApiKey(db, {
        name: "CREAO Deal Coordinator",
        key: agentKey,
        role: "agent",
      });
      console.log("Agent API key seeded (CREAO Deal Coordinator).");
    } else {
      console.warn("RELAY_API_KEY is not set; no agent credential was seeded.");
    }

    const humanKey = process.env.RELAY_HUMAN_API_KEY?.trim();
    if (humanKey) {
      await upsertApiKey(db, {
        name: "Acme Demo Approver",
        key: humanKey,
        role: "human",
        partyId: DEMO_IDS.parties.acme,
        humanUserId: DEMO_IDS.humans.maya,
      });
      console.log("Human API key seeded (Acme Demo Approver / Maya Chen).");
    } else {
      console.warn(
        "RELAY_HUMAN_API_KEY is not set; create a human key with `npm run key:create -- --name \"Acme Approver\" --role human --party-id 11111111-1111-4111-8111-111111111111 --human-user-id ffffffff-ffff-4fff-8fff-fffffffff001`.",
      );
    }

    const counts = await db.query<{ parties: number; offers: number; deals: number }>(
      `SELECT
         (SELECT count(*)::int FROM parties) AS parties,
         (SELECT count(*)::int FROM market_offers) AS offers,
         (SELECT count(*)::int FROM deals) AS deals`,
    );
    console.log(`Seed complete: ${JSON.stringify(counts.rows[0])}`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
