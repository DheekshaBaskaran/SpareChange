// GET /api/system
// Which integrations are real vs. mocked right now. Shown in the System panel
// so the team can honestly explain the demo. Contains no secrets.

import { connection } from "next/server";
import { getConfig } from "@/lib/server/config";
import { describeExecutors } from "@/lib/server/executors";
import { describePayments } from "@/lib/server/payments";
import { solanaPreflight } from "@/lib/server/payments/solana";

export async function GET() {
  await connection();
  const config = getConfig();
  const solana = await solanaPreflight();
  return Response.json({
    success: true,
    executionModeSetting: config.executionMode,
    executors: await describeExecutors(),
    payments: {
      ...describePayments(),
      solanaPayout: {
        configured: solana.configured,
        reason: solana.reason ?? null,
        network: solana.network,
        asset: "SOL",
        payer: solana.payer,
        payoutAddress: solana.payoutAddress,
        payoutSol: solana.payoutSol,
        balanceLamports: solana.balanceLamports,
        funded: solana.funded,
      },
    },
    duo1: {
      relayApiUrl: config.relay.apiUrl ?? null,
      relayConfigured: Boolean(config.relay.apiUrl && config.relay.agentKey),
      settlementRail: config.relay.workerKey ? "relay" : "standalone",
      dealsFeedConfigured: !!config.duo1DealsUrl,
      marketFeedConfigured: !!config.duo1MarketUrl,
    },
  });
}
