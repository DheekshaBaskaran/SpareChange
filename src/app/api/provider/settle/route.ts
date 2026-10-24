// GET /api/provider/settle?jobId=...
//
// The COMPUTE PROVIDER's side of x402. This endpoint releases a verified
// workload result, but only after it has been paid:
//   • a request without payment gets "402 Payment Required" + price info
//   • a request with a valid x402 payment is verified and settled by the
//     facilitator, then the result is returned
//
// In a real deployment this would run on the provider's own server.
// For the demo it lives inside SpareChange so one `npm run dev` runs everything.

import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/server/config";
import { getJob } from "@/lib/server/job-store";

type RouteHandler = (request: NextRequest) => Promise<NextResponse>;
let protectedHandler: RouteHandler | undefined;

async function releaseResult(request: NextRequest): Promise<NextResponse> {
  const jobId = request.nextUrl.searchParams.get("jobId") ?? "";
  const job = getJob(jobId);
  if (!job || job.verification?.status !== "VERIFIED") {
    // Status >= 400 means withX402 will NOT settle the payment.
    return NextResponse.json({ released: false, error: "No verified result for this job" }, { status: 404 });
  }
  return NextResponse.json({
    released: true,
    jobId,
    provider: job.deal.provider.name,
    result: job.execution?.output,
  });
}

function buildProtectedHandler(): RouteHandler {
  const { x402 } = getConfig();
  const facilitator = new HTTPFacilitatorClient({ url: x402.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitator).register(
    x402.network as `${string}:${string}`,
    new ExactEvmScheme(),
  );

  return withX402(
    releaseResult,
    {
      accepts: [
        {
          scheme: "exact",
          price: x402.settlementPrice,
          network: x402.network as `${string}:${string}`,
          payTo: x402.providerWalletAddress!,
        },
      ],
      description: "SpareChange: release verified compute result",
      mimeType: "application/json",
    },
    resourceServer,
  );
}

export async function GET(request: NextRequest) {
  if (!getConfig().x402.providerWalletAddress) {
    return NextResponse.json(
      { error: "x402 is not configured on this provider (X402_PROVIDER_WALLET_ADDRESS missing)" },
      { status: 503 },
    );
  }
  protectedHandler ??= buildProtectedHandler();
  return protectedHandler(request);
}
