import { CONTRACT_VERSION } from "./contract.js";

export interface ElasticConfig {
  enabled: boolean;
  elasticsearchUrl: string | null;
  kibanaUrl: string | null;
  elasticsearchApiKey: string | null;
  kibanaApiKey: string | null;
  indexName: string;
  agentId: string;
  kibanaSpace: string | null;
  syncIntervalMs: number;
  investigationTimeoutMs: number;
  maxSyncBatch: number;
  maxBackfillPerType: number;
  disabledReason: string | null;
}

export interface MarketBridgeConfig {
  /** Base URL of the Market Intelligence API, e.g. http://127.0.0.1:8099. */
  apiUrl: string;
  /** Optional bearer token; only needed for admin endpoints. */
  token: string | null;
  offerTtlSeconds: number;
  advertisedOfferTtlSeconds: number;
  /** 0 disables the background loop; the manual sync endpoint still works. */
  syncIntervalMs: number;
  maxOffers: number;
}

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  contractVersion: string;
  envAgentKey: string | null;
  allowSimulatedApprovals: boolean;
  timescale: boolean;
  elastic: ElasticConfig | null;
  market: MarketBridgeConfig | null;
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = optional(env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Set it to the Tiger Data/Postgres connection string (see .env.example).",
    );
  }

  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port,
    logLevel: env.LOG_LEVEL?.trim() || "info",
    databaseUrl,
    contractVersion: CONTRACT_VERSION,
    envAgentKey: optional(env.RELAY_API_KEY),
    allowSimulatedApprovals: env.RELAY_ALLOW_SIMULATED_APPROVALS === "1",
    timescale: env.RELAY_TIMESCALE === "1",
    elastic: loadElasticConfig(env),
    market: loadMarketBridgeConfig(env),
  };
}

/**
 * The finance solver reads `relay.market_offers`. Market Intelligence stays the
 * system of record for public listings, so the bridge materializes its fresh
 * reference offers into that table instead of duplicating the ingestion stack.
 * Absence of MARKET_API_URL is a supported degraded mode: finance keeps working
 * with whatever offers are already persisted.
 */
export function loadMarketBridgeConfig(env: NodeJS.ProcessEnv): MarketBridgeConfig | null {
  const apiUrl = optional(env.MARKET_API_URL);
  if (!apiUrl) return null;
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    token: optional(env.MARKET_API_TOKEN),
    offerTtlSeconds: positiveInteger(env.MARKET_OFFER_TTL_SECONDS, 900, 60, 86_400),
    advertisedOfferTtlSeconds: positiveInteger(
      env.MARKET_ADVERTISED_OFFER_TTL_SECONDS,
      21_600,
      300,
      604_800,
    ),
    syncIntervalMs: positiveInteger(env.MARKET_SYNC_INTERVAL_MS, 300_000, 0, 86_400_000),
    maxOffers: positiveInteger(env.MARKET_SYNC_MAX_OFFERS, 1_000, 1, 20_000),
  };
}

function positiveInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function loadElasticConfig(env: NodeJS.ProcessEnv): ElasticConfig | null {
  const rawUrl = optional(env.ELASTICSEARCH_URL);
  const rawKibanaUrl = optional(env.KIBANA_URL);
  const elasticsearchApiKey = optional(env.ELASTICSEARCH_API_KEY);
  const kibanaApiKey = optional(env.KIBANA_API_KEY) ?? elasticsearchApiKey;
  const explicitlyDisabled = env.ELASTIC_ENABLED === "0";
  const explicitlyEnabled = env.ELASTIC_ENABLED === "1";
  const configured = Boolean(rawUrl && rawKibanaUrl && elasticsearchApiKey && kibanaApiKey);

  // Absence of configuration is a supported degraded mode: the finance backend
  // keeps working and the investigation endpoint returns 503.
  if (explicitlyDisabled || (!explicitlyEnabled && !configured)) return null;

  const elasticsearchUrl = rawUrl ? rawUrl.replace(/\/+$/, "") : null;
  const kibanaUrl = rawKibanaUrl ? rawKibanaUrl.replace(/\/+$/, "") : null;
  const disabledReason = configured
    ? null
    : "ELASTICSEARCH_URL, KIBANA_URL, and API keys are required when ELASTIC_ENABLED=1.";

  return {
    enabled: configured && !explicitlyDisabled,
    elasticsearchUrl,
    kibanaUrl,
    elasticsearchApiKey,
    kibanaApiKey,
    indexName: env.ELASTIC_FINANCIAL_INDEX?.trim() || "relay-financial-v1",
    agentId: env.ELASTIC_INVESTIGATOR_AGENT_ID?.trim() || "relay-financial-investigator",
    kibanaSpace: optional(env.ELASTIC_KIBANA_SPACE),
    syncIntervalMs: positiveInteger(env.ELASTIC_SYNC_INTERVAL_MS, 15_000, 1_000, 3_600_000),
    investigationTimeoutMs: positiveInteger(env.ELASTIC_INVESTIGATION_TIMEOUT_MS, 120_000, 5_000, 600_000),
    maxSyncBatch: positiveInteger(env.ELASTIC_MAX_SYNC_BATCH, 200, 1, 2_000),
    maxBackfillPerType: positiveInteger(env.ELASTIC_MAX_BACKFILL_PER_TYPE, 5_000, 1, 50_000),
    disabledReason,
  };
}
