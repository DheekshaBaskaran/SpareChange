// ─────────────────────────────────────────────────────────────
// X402PaymentProvider: machine-to-machine settlement with Coinbase x402.
//
// Leg 1 — buyer agent (Acme) pays the compute provider (Atlas):
//   1. The agent asks Atlas to release the verified result
//      (GET /api/provider/settle?jobId=...).
//   2. Atlas answers "402 Payment Required" with price, network and wallet.
//   3. The agent signs a USDC payment automatically (@x402/fetch) and retries.
//   4. The x402 facilitator settles it on-chain; Atlas releases the result.
//
// Leg 2 — multi-party deals only, if X402_PROVIDER_PRIVATE_KEY and
// X402_REPLACEMENT_WALLET_ADDRESS are set: Atlas's agent pays the
// replacement provider (Nova) for the backfill, the same way
// (GET /api/provider/backfill?jobId=...). Atlas pays out of what it just
// received, so money flows exactly like the deal graph shows.
//
// The provider side lives in src/lib/server/payments/x402-shared.ts.
// Private keys never leave the server.
// ─────────────────────────────────────────────────────────────

import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import type { SettlementLeg } from "../../types";
import { getConfig } from "../config";
import { plannedLegs, randomId, type PaymentProvider } from "./types";
import { explorerUrl, formatUsdc, networkName, onChainAmounts } from "./x402-shared";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface X402Payment {
  transaction: string;
  network: string;
  payer: string;
  steps: string[];
}

/**
 * One complete x402 purchase: request → 402 → sign → retry → settled.
 * `payerName` / `payeeName` are only used for the step descriptions.
 */
async function payViaX402(options: { url: string; payerKey: string; payerName: string; payeeName: string; amount: number }): Promise<X402Payment> {
  const { x402 } = getConfig();
  const steps: string[] = [];

  // Ask without paying first, to show the payee's payment requirement.
  const unpaid = await fetch(options.url, { signal: AbortSignal.timeout(10_000) });
  if (unpaid.status !== 402) throw new Error(`Expected 402 from ${options.payeeName}, got ${unpaid.status}`);
  steps.push(`${options.payeeName} responded 402 Payment Required (${formatUsdc(options.amount)} on ${networkName(x402.network)})`);

  const account = privateKeyToAccount(options.payerKey as `0x${string}`);
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: x402.network as `${string}:${string}`, client: new ExactEvmScheme(account) }],
  });
  steps.push(`${options.payerName} agent ${shortAddress(account.address)} signed USDC payment authorization`);

  // A rejection WITHOUT a reason is usually transient (e.g. the payee's x402
  // middleware still syncing with the facilitator right after a restart).
  // A rejected payment was never settled, so retrying cannot double-charge.
  let paid = await fetchWithPayment(options.url, { signal: AbortSignal.timeout(60_000) });
  for (let retry = 1; retry <= 2 && paid.status === 402 && !rejectionReason(paid); retry++) {
    console.warn(`[payments] ${options.payeeName} rejected payment without a reason, retrying (${retry}/2)`);
    await wait(1500);
    paid = await fetchWithPayment(options.url, { signal: AbortSignal.timeout(60_000) });
  }
  if (!paid.ok) {
    throw new Error(`${options.payeeName} rejected payment: ${rejectionReason(paid) ?? `status ${paid.status}`}`);
  }

  const paymentHeader = paid.headers.get("PAYMENT-RESPONSE");
  if (!paymentHeader) throw new Error(`${options.payeeName} did not return a PAYMENT-RESPONSE header`);
  const settlement = decodePaymentResponseHeader(paymentHeader);
  if (!settlement.success) throw new Error(settlement.errorMessage ?? "Facilitator settlement failed");

  steps.push(`Facilitator settled on-chain: ${shortAddress(settlement.transaction)}`);
  return { transaction: settlement.transaction, network: settlement.network, payer: settlement.payer ?? account.address, steps };
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
    const { deal } = job;
    const amounts = onChainAmounts(job);
    const [buyerLeg, backfillLeg] = plannedLegs(job);
    const query = `jobId=${encodeURIComponent(job.jobId)}`;

    // ── Leg 1: buyer → provider (must succeed, or the whole payment falls back to mock) ──
    const primary = await payViaX402({
      url: `${appBaseUrl}/api/provider/settle?${query}`,
      payerKey: x402.buyerPrivateKey!,
      payerName: deal.buyer.name,
      payeeName: deal.provider.name,
      amount: amounts.primary,
    });
    const steps = [...primary.steps, `${deal.provider.name} released verified result to ${deal.buyer.name}`];
    const notes: string[] = [];
    const legs: SettlementLeg[] = [
      {
        ...buyerLeg,
        mode: "x402",
        status: "SUCCESS",
        transactionId: primary.transaction,
        explorerUrl: explorerUrl(primary.network, primary.transaction),
        onChainAmount: formatUsdc(amounts.primary),
      },
    ];

    // ── Leg 2: provider → replacement provider (multi-party deals) ──
    if (backfillLeg && deal.replacementProvider) {
      const canPayBackfill = x402.providerPrivateKey && x402.replacementWalletAddress;
      let backfill: X402Payment | undefined;
      if (canPayBackfill) {
        // Retry briefly: Atlas pays out of the leg-1 funds, which may need a block to land.
        for (let attempt = 1; attempt <= 3 && !backfill; attempt++) {
          try {
            backfill = await payViaX402({
              url: `${appBaseUrl}/api/provider/backfill?${query}`,
              payerKey: x402.providerPrivateKey!,
              payerName: deal.provider.name,
              payeeName: deal.replacementProvider.name,
              amount: amounts.backfill!,
            });
          } catch (error) {
            console.warn(`[payments] backfill attempt ${attempt} failed:`, (error as Error).message);
            if (attempt === 3) notes.push(`Backfill payment via x402 failed (${(error as Error).message}); recorded as mock`);
            else await wait(3000);
          }
        }
      } else {
        notes.push("Backfill leg recorded as mock (X402_PROVIDER_PRIVATE_KEY / X402_REPLACEMENT_WALLET_ADDRESS not set)");
      }

      if (backfill) {
        steps.push(...backfill.steps, `${deal.replacementProvider.name} confirmed backfill capacity for ${deal.provider.name}`);
        legs.push({
          ...backfillLeg,
          mode: "x402",
          status: "SUCCESS",
          transactionId: backfill.transaction,
          explorerUrl: explorerUrl(backfill.network, backfill.transaction),
          onChainAmount: formatUsdc(amounts.backfill!),
        });
      } else {
        legs.push({ ...backfillLeg, mode: "mock", status: "SUCCESS", transactionId: randomId("mock_tx_") });
      }
    }

    const onChainTotal = legs.filter((leg) => leg.mode === "x402").length > 1 ? amounts.primary + (amounts.backfill ?? 0) : amounts.primary;
    return {
      status: "SUCCESS",
      paymentMode: "x402",
      transactionId: primary.transaction,
      amount: deal.price.amount,
      currency: deal.price.currency,
      timestamp: new Date().toISOString(),
      network: primary.network,
      explorerUrl: explorerUrl(primary.network, primary.transaction),
      settledOnChainAmount: `${formatUsdc(Math.round(onChainTotal * 10_000) / 10_000)} (testnet, scaled down from the deal value)`,
      payer: primary.payer,
      steps,
      legs,
      notes,
    };
  },
};

/** The payee's reason for rejecting a payment, from the base64 PAYMENT-REQUIRED header (e.g. "insufficient_balance"). */
function rejectionReason(response: Response): string | undefined {
  try {
    const header = response.headers.get("PAYMENT-REQUIRED");
    return header ? JSON.parse(Buffer.from(header, "base64").toString()).error : undefined;
  } catch {
    return undefined;
  }
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
