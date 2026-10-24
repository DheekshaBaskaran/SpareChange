// ─────────────────────────────────────────────────────────────
// x402 pieces shared by the paying agents (./x402.ts) and the
// paywalled provider endpoints (src/app/api/provider/*).
//
// On-chain amounts are scaled down for testnet: the buyer's payment
// is X402_SETTLEMENT_PRICE (e.g. 0.01 USDC) and the backfill payment
// is the same fraction of it that the backfill is of the deal price.
//   deal: Acme → Atlas 12.60, Atlas → Nova 8.52
//   chain: Acme → Atlas 0.01,  Atlas → Nova 0.0068
// ─────────────────────────────────────────────────────────────

import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { NextResponse, type NextRequest } from "next/server";
import type { Job } from "../../types";
import { getConfig } from "../config";
import { getJob } from "../job-store";
import { plannedLegs } from "./types";

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

export function explorerUrl(network: string, transaction: string): string | undefined {
  return EXPLORERS[network] ? EXPLORERS[network] + transaction : undefined;
}

/** The on-chain USDC amounts for this job's legs (buyer leg first). */
export function onChainAmounts(job: Job): { primary: number; backfill?: number } {
  const primary = Number(getConfig().x402.settlementPrice.replace(/^\$/, ""));
  const [buyerLeg, backfillLeg] = plannedLegs(job);
  if (!backfillLeg) return { primary };
  const ratio = backfillLeg.amount / buyerLeg.amount;
  // USDC has 6 decimals; keep 4 so the numbers stay readable. Never below 0.0001.
  return { primary, backfill: Math.max(0.0001, Math.round(primary * ratio * 10_000) / 10_000) };
}

export const formatUsdc = (amount: number) => `${amount} USDC`;

type RouteHandler = (request: NextRequest) => Promise<NextResponse>;

/**
 * Build a paywalled provider endpoint. Unpaid requests get
 * "402 Payment Required"; paid requests are settled by the facilitator
 * and then `release(job)` runs. Payment is only settled if release
 * returns a status below 400 (withX402 guarantees this).
 */
export function buildPaywall(options: {
  payTo: string;
  price: (job: Job) => number;
  description: string;
  release: (job: Job) => Record<string, unknown>;
}): RouteHandler {
  const { x402 } = getConfig();
  const network = x402.network as `${string}:${string}`;
  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: x402.facilitatorUrl })).register(
    network,
    new ExactEvmScheme(),
  );

  const jobFromUrl = (url: string) => getJob(new URL(url).searchParams.get("jobId") ?? "");

  async function handler(request: NextRequest): Promise<NextResponse> {
    const job = jobFromUrl(request.url);
    if (!job || job.verification?.status !== "VERIFIED") {
      return NextResponse.json({ released: false, error: "No verified result for this job" }, { status: 404 });
    }
    return NextResponse.json({ released: true, jobId: job.jobId, ...options.release(job) });
  }

  return withX402(
    handler,
    {
      accepts: [
        {
          scheme: "exact",
          network,
          payTo: options.payTo,
          // Price depends on the job (e.g. the backfill share), read from ?jobId=.
          price: (context) => {
            const job = jobFromUrl(context.adapter.getUrl());
            return `$${job ? options.price(job) : Number(x402.settlementPrice.replace(/^\$/, ""))}`;
          },
        },
      ],
      description: options.description,
      mimeType: "application/json",
    },
    resourceServer,
  );
}
