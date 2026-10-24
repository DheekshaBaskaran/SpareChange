// ─────────────────────────────────────────────────────────────
// X402PaymentProvider: machine-to-machine settlement with Coinbase x402.
//
// The story:
//   1. The buyer's agent asks the compute provider to release the
//      verified result (GET /api/provider/settle?jobId=...).
//   2. The provider answers "402 Payment Required" with its price,
//      network and wallet address.
//   3. The agent signs a USDC payment automatically (@x402/fetch)
//      and retries the request with the payment attached.
//   4. The x402 facilitator verifies and settles it on-chain, and the
//      provider releases the result. We record the transaction hash.
//
// The provider side lives in src/app/api/provider/settle/route.ts.
// The private key never leaves the server.
// ─────────────────────────────────────────────────────────────

import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { getConfig } from "../config";
import { plannedLegs, randomId, type PaymentProvider } from "./types";

const EXPLORERS: Record<string, string> = {
  "eip155:84532": "https://sepolia.basescan.org/tx/",
  "eip155:8453": "https://basescan.org/tx/",
};

const NETWORK_NAMES: Record<string, string> = {
  "eip155:84532": "Base Sepolia",
  "eip155:8453": "Base",
};

export function networkName(network: string): string {
  return NETWORK_NAMES[network] ?? network;
}

export const x402PaymentProvider: PaymentProvider = {
  mode: "x402",
  label: "Coinbase x402",

  isConfigured() {
    const { x402 } = getConfig();
    if (!x402.buyerPrivateKey) return { configured: false, reason: "X402_BUYER_PRIVATE_KEY is not set" };
    if (!x402.providerWalletAddress) return { configured: false, reason: "X402_PROVIDER_WALLET_ADDRESS is not set" };
    return { configured: true };
  },

  async settle(job) {
    const { x402, appBaseUrl } = getConfig();
    const resourceUrl = `${appBaseUrl}/api/provider/settle?jobId=${encodeURIComponent(job.jobId)}`;
    const steps: string[] = [];

    // Step 1: ask without paying, to show the provider's payment requirement.
    const unpaid = await fetch(resourceUrl, { signal: AbortSignal.timeout(10_000) });
    if (unpaid.status !== 402) throw new Error(`Expected 402 from provider, got ${unpaid.status}`);
    steps.push(`Provider responded 402 Payment Required (${x402.settlementPrice.replace(/^\$/, "")} USDC on ${networkName(x402.network)})`);

    // Step 2: the buyer agent pays automatically and retries.
    const account = privateKeyToAccount(x402.buyerPrivateKey as `0x${string}`);
    const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: x402.network as `${string}:${string}`, client: new ExactEvmScheme(account) }],
    });
    steps.push(`Buyer agent ${shortAddress(account.address)} signed USDC payment authorization`);

    const paid = await fetchWithPayment(resourceUrl, { signal: AbortSignal.timeout(60_000) });
    if (!paid.ok) {
      // The provider explains why in the base64 PAYMENT-REQUIRED header
      // (e.g. "insufficient_funds" if the buyer wallet has no test USDC).
      let reason = `status ${paid.status}`;
      try {
        const header = paid.headers.get("PAYMENT-REQUIRED");
        if (header) reason = JSON.parse(Buffer.from(header, "base64").toString()).error ?? reason;
      } catch {
        // keep the generic reason
      }
      throw new Error(`Provider rejected payment: ${reason}`);
    }

    const paymentHeader = paid.headers.get("PAYMENT-RESPONSE");
    if (!paymentHeader) throw new Error("Provider did not return a PAYMENT-RESPONSE header");
    const settlement = decodePaymentResponseHeader(paymentHeader);
    if (!settlement.success) throw new Error(settlement.errorMessage ?? "Facilitator settlement failed");

    steps.push(`Facilitator settled on-chain: ${shortAddress(settlement.transaction)}`);
    steps.push("Provider released verified result to buyer");

    const explorerUrl = EXPLORERS[settlement.network] ? EXPLORERS[settlement.network] + settlement.transaction : undefined;
    const [primaryLeg, ...otherLegs] = plannedLegs(job);

    return {
      status: "SUCCESS",
      paymentMode: "x402",
      transactionId: settlement.transaction,
      amount: job.deal.price.amount,
      currency: job.deal.price.currency,
      timestamp: new Date().toISOString(),
      network: settlement.network,
      explorerUrl,
      settledOnChainAmount: `${x402.settlementPrice.replace(/^\$/, "")} USDC (testnet)`,
      payer: settlement.payer ?? account.address,
      steps,
      legs: [
        { ...primaryLeg, mode: "x402", status: "SUCCESS", transactionId: settlement.transaction, explorerUrl },
        // The backfill leg is between two providers and is recorded, not paid on-chain, in this demo.
        ...otherLegs.map((leg) => ({ ...leg, mode: "mock" as const, status: "SUCCESS" as const, transactionId: randomId("mock_tx_") })),
      ],
    };
  },
};

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
