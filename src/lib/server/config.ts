// ─────────────────────────────────────────────────────────────
// Server-side configuration, read from environment variables.
// See .env.example for the full list. Never import this file
// from a "use client" component — it can contain secrets.
// ─────────────────────────────────────────────────────────────

export type ExecutionModeSetting = "auto" | "remote" | "local-docker" | "local-process" | "mock";
export type PaymentModeSetting = "mock" | "x402";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function getConfig() {
  return {
    // Which executor to try first. "auto" = remote → local-docker → local-process → mock.
    executionMode: (readEnv("EXECUTION_MODE") ?? "auto") as ExecutionModeSetting,
    // How long the demo workload trains for, in seconds.
    workloadSeconds: Number(readEnv("WORKLOAD_SECONDS") ?? 6),
    dockerImage: readEnv("DOCKER_IMAGE") ?? "sparechange-worker:latest",
    remoteWorkerUrl: readEnv("REMOTE_WORKER_URL"),
    remoteWorkerToken: readEnv("REMOTE_WORKER_TOKEN"),

    // Payment settings.
    paymentMode: (readEnv("PAYMENT_MODE") ?? "mock") as PaymentModeSetting,
    x402: {
      // Private key of the BUYER AGENT wallet (testnet only!). Server-side only.
      buyerPrivateKey: readEnv("X402_BUYER_PRIVATE_KEY"),
      // Wallet address of the compute provider that receives payment.
      providerWalletAddress: readEnv("X402_PROVIDER_WALLET_ADDRESS"),
      network: readEnv("X402_NETWORK") ?? "eip155:84532", // Base Sepolia testnet
      facilitatorUrl: readEnv("X402_FACILITATOR_URL") ?? "https://x402.org/facilitator",
      // USD price charged on-chain per settlement, e.g. "0.01". Kept tiny on testnet.
      // (Written without "$" because .env files treat "$" as a variable.)
      settlementPrice: `$${(readEnv("X402_SETTLEMENT_PRICE") ?? "0.01").replace(/^\$/, "")}`,
    },

    // Duo 1 integration: where to fetch approved deals from (optional).
    duo1DealsUrl: readEnv("DUO1_DEALS_URL"),
    // Duo 1 integration: where to fetch live GPU listings from (optional).
    duo1MarketUrl: readEnv("DUO1_MARKET_URL"),

    // Base URL this app is reachable at (used by the x402 buyer agent to call the provider endpoint).
    appBaseUrl: readEnv("APP_BASE_URL") ?? `http://localhost:${process.env.PORT ?? 3402}`,
  };
}

export type AppConfig = ReturnType<typeof getConfig>;
