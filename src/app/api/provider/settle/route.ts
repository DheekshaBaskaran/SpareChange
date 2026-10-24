// GET /api/provider/settle?jobId=...
//
// The COMPUTE PROVIDER's (Atlas's) side of x402. This endpoint releases a
// verified workload result, but only after it has been paid:
//   • a request without payment gets "402 Payment Required" + price info
//   • a request with a valid x402 payment is verified and settled by the
//     facilitator, then the result is returned
//
// In a real deployment this would run on the provider's own server.
// For the demo it lives inside SpareChange so one `npm run dev` runs everything.

import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/server/config";
import { buildPaywall, onChainAmounts } from "@/lib/server/payments/x402-shared";

let paywall: ((request: NextRequest) => Promise<NextResponse>) | undefined;

export async function GET(request: NextRequest) {
  const payTo = getConfig().x402.providerWalletAddress;
  if (!payTo) {
    return NextResponse.json(
      { error: "x402 is not configured on this provider (X402_PROVIDER_WALLET_ADDRESS missing)" },
      { status: 503 },
    );
  }
  paywall ??= buildPaywall({
    payTo,
    price: (job) => onChainAmounts(job).primary,
    description: "SpareChange: release verified compute result",
    release: (job) => ({ provider: job.deal.provider.name, result: job.execution?.output }),
  });
  return paywall(request);
}
