// ─────────────────────────────────────────────────────────────
// Server-side configuration, read from environment variables.
// See .env.example for the full list. Never import this file
// from a "use client" component — it can contain secrets.
// ─────────────────────────────────────────────────────────────

import { privateKeyToAccount } from "viem/accounts";

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
      // Private key of the CAPACITY HOLDER's agent (Atlas). Optional, testnet only.
      // When set, Atlas receives the buyer's payment AND pays the replacement
      // provider (Nova) for the backfill, so every leg of the deal settles on-chain.
      providerPrivateKey: readEnv("X402_PROVIDER_PRIVATE_KEY"),
      // Wallet that receives the buyer's payment. Defaults to the provider agent's address.
      providerWalletAddress: readEnv("X402_PROVIDER_WALLET_ADDRESS") ?? addressOf(readEnv("X402_PROVIDER_PRIVATE_KEY")),
      // Wallet of the replacement provider (Nova) that receives the backfill payment. Optional.
      replacementWalletAddress: readEnv("X402_REPLACEMENT_WALLET_ADDRESS"),
      network: readEnv("X402_NETWORK") ?? "eip155:84532", // Base Sepolia testnet
      facilitatorUrl: readEnv("X402_FACILITATOR_URL") ?? "https://x402.org/facilitator",
      // USD price charged on-chain per settlement, e.g. "0.01". Kept tiny on testnet.
      // (Written without "$" because .env files treat "$" as a variable.)
      settlementPrice: `$${(readEnv("X402_SETTLEMENT_PRICE") ?? "0.01").replace(/^\$/, "")}`,
    },

    // Solana Devnet payout rail. Separate from the Base Sepolia x402 buyer leg:
    // the provider payout is a direct native-SOL transfer on Solana Devnet.
    solana: {
      rpcUrl: readEnv("SOLANA_RPC_URL") ?? "https://api.devnet.solana.com",
      network: readEnv("SOLANA_NETWORK") ?? "solana-devnet",
      payerSecret: readEnv("SOLANA_PAYER_SECRET_KEY"),
      // Only this address may receive a payout; also acts as the allowlist.
      payoutAddress: readEnv("SOLANA_PAYOUT_ADDRESS"),
      // Demonstration-scale amount. The instruction's USD value is accounting only.
      payoutLamports: Number(readEnv("SOLANA_PAYOUT_LAMPORTS") ?? 10_000_000),
    },

    // Duo 1 integration: where to fetch approved deals from (optional).
    duo1DealsUrl: readEnv("DUO1_DEALS_URL"),
    // Duo 1 integration: where to fetch live GPU listings from (optional).
    duo1MarketUrl: readEnv("DUO1_MARKET_URL"),

    // Relay (Duo 1 API) integration. When DUO1_API_URL and DUO1_AGENT_API_KEY
    // are set, deals come from Relay and verified usage is reported back.
    // DUO1_WORKER_API_KEY is the `worker` role used for usage and settlement.
    relay: {
      apiUrl: readEnv("DUO1_API_URL")?.replace(/\/+$/, ""),
      agentKey: readEnv("DUO1_AGENT_API_KEY"),
      workerKey: readEnv("DUO1_WORKER_API_KEY"),
      // Optional shared secret protecting POST /api/relay/pay.
      internalToken: readEnv("DUO2_INTERNAL_TOKEN"),
    },

    // Base URL this app is reachable at (used by the x402 buyer agent to call the provider endpoint).
    appBaseUrl: readEnv("APP_BASE_URL") ?? `http://localhost:${process.env.PORT ?? 3402}`,
  };
}

function addressOf(privateKey: string | undefined): string | undefined {
  if (!privateKey) return undefined;
  try {
    return privateKeyToAccount(privateKey as `0x${string}`).address;
  } catch {
    return undefined;
  }
}

export type AppConfig = ReturnType<typeof getConfig>;
