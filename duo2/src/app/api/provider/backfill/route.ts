// GET /api/provider/backfill?jobId=...
//
// The REPLACEMENT PROVIDER's (Nova's) side of x402. In a multi-party deal,
// the capacity holder (Atlas) released its GPUs to the buyer; here Atlas's
// agent pays Nova to confirm the replacement capacity it will use instead.
//   • without payment → "402 Payment Required"
//   • with a valid x402 payment → settled on-chain, backfill confirmed

import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/server/config";
import { buildPaywall, onChainAmounts } from "@/lib/server/payments/x402-shared";

let paywall: ((request: NextRequest) => Promise<NextResponse>) | undefined;

export async function GET(request: NextRequest) {
  const payTo = getConfig().x402.replacementWalletAddress;
  if (!payTo) {
    return NextResponse.json(
      { error: "x402 backfill is not configured (X402_REPLACEMENT_WALLET_ADDRESS missing)" },
      { status: 503 },
    );
  }
  paywall ??= buildPaywall({
    payTo,
    price: (job) => onChainAmounts(job).backfill ?? onChainAmounts(job).primary,
    description: "SpareChange: confirm backfill capacity reservation",
    release: (job) => ({
      replacementProvider: job.deal.replacementProvider?.name,
      backfillConfirmed: { gpuModel: job.deal.workload.gpuModel, gpuCount: job.deal.workload.gpuCount, for: job.deal.provider.name },
    }),
  });
  return paywall(request);
}
