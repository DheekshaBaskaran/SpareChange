import { CONTRACT_VERSION } from "./contract.js";

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  contractVersion: string;
  envAgentKey: string | null;
  allowSimulatedApprovals: boolean;
  timescale: boolean;
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
  };
}
