import { upsertApiKey } from "../../src/auth/keys.js";
import { buildApp } from "../../src/app.js";
import type { AppConfig, MarketBridgeConfig } from "../../src/config.js";
import { CONTRACT_VERSION } from "../../src/contract.js";
import { runMigrations } from "../../src/db/migrate.js";
import { DEMO_IDS, seedDemo } from "../../src/db/seed-demo.js";
import type { Db } from "../../src/db/client.js";
import type { ElasticInvestigationService } from "../../src/elastic/types.js";
import { PGliteDb } from "./db.js";

export const TEST_KEYS = {
  agent: "test-agent-key-1234567890",
  acme: "test-human-acme-1234567890",
  brightlane: "test-human-brightlane-1234567890",
  vertex: "test-human-vertex-1234567890",
  northstar: "test-human-northstar-1234567890",
  finance: "test-finance-key-1234567890",
  worker: "test-worker-key-1234567890",
} as const;

export const TEST_HUMANS = {
  acme: { userId: DEMO_IDS.humans.maya, partyId: DEMO_IDS.parties.acme },
  brightlane: { userId: DEMO_IDS.humans.daniel, partyId: DEMO_IDS.parties.brightlane },
  vertex: { userId: DEMO_IDS.humans.omar, partyId: DEMO_IDS.parties.vertex },
  northstar: { userId: DEMO_IDS.humans.priya, partyId: DEMO_IDS.parties.northstar },
} as const;

export async function createTestContext(options: {
  elasticFactory?: (db: Db) => ElasticInvestigationService;
  market?: MarketBridgeConfig | null;
} = {}) {
  const db = new PGliteDb();
  await runMigrations(db);
  await seedDemo(db);

  await upsertApiKey(db, { name: "test-agent", key: TEST_KEYS.agent, role: "agent" });
  await upsertApiKey(db, {
    name: "test-human-acme",
    key: TEST_KEYS.acme,
    role: "human",
    partyId: TEST_HUMANS.acme.partyId,
    humanUserId: TEST_HUMANS.acme.userId,
  });
  await upsertApiKey(db, {
    name: "test-human-brightlane",
    key: TEST_KEYS.brightlane,
    role: "human",
    partyId: TEST_HUMANS.brightlane.partyId,
    humanUserId: TEST_HUMANS.brightlane.userId,
  });
  await upsertApiKey(db, {
    name: "test-human-vertex",
    key: TEST_KEYS.vertex,
    role: "human",
    partyId: TEST_HUMANS.vertex.partyId,
    humanUserId: TEST_HUMANS.vertex.userId,
  });
  await upsertApiKey(db, {
    name: "test-human-northstar",
    key: TEST_KEYS.northstar,
    role: "human",
    partyId: TEST_HUMANS.northstar.partyId,
    humanUserId: TEST_HUMANS.northstar.userId,
  });
  await upsertApiKey(db, {
    name: "test-finance",
    key: TEST_KEYS.finance,
    role: "finance",
  });
  await upsertApiKey(db, {
    name: "test-duo2-worker",
    key: TEST_KEYS.worker,
    role: "worker",
  });

  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    databaseUrl: "pglite://test",
    contractVersion: CONTRACT_VERSION,
    envAgentKey: null,
    allowSimulatedApprovals: false,
    timescale: false,
    elastic: null,
    market: options.market ?? null,
  };
  const app = buildApp({
    db,
    config,
    logger: false,
    elastic: options.elasticFactory ? options.elasticFactory(db) : undefined,
  });
  await app.ready();

  function headers(
    key: string = TEST_KEYS.agent,
    options: { contract?: string; idempotencyKey?: string } = {},
  ): Record<string, string> {
    const result: Record<string, string> = {
      authorization: `Bearer ${key}`,
      "x-relay-contract": options.contract ?? CONTRACT_VERSION,
    };
    if (options.idempotencyKey) result["idempotency-key"] = options.idempotencyKey;
    return result;
  }

  return { db, app, config, headers };
}
