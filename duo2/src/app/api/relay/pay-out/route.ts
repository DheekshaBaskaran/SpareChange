// POST /api/relay/pay-out
//
// Executes an already human-approved Relay provider payout instruction on
// Solana Devnet. Relay remains the authority: this endpoint never creates an
// instruction, never approves one, and never changes an amount.
//
// Body: { "payout_instruction_id": "…" }
//
// Asset is native SOL on Solana Devnet (never presented as USDC). The transfer
// is demonstration-scale (`SOLANA_PAYOUT_LAMPORTS`); the instruction's USD
// amount is accounting value, and both are recorded separately.
//
// Retries are safe: the signature is persisted before Relay is notified, so a
// repeated request reports the same transaction instead of sending again.

import { getConfig } from "@/lib/server/config";
import { getPayoutRecord, savePayoutRecord } from "@/lib/server/payout-store";
import {
  confirmProviderPayoutSettlement,
  findPayoutInstruction,
  relayConfigured,
  submitProviderPayout,
} from "@/lib/server/relay";
import {
  isValidSolanaAddress,
  sendSolanaPayout,
  solanaPreflight,
  verifySolanaTransfer,
} from "@/lib/server/payments/solana";

export async function POST(request: Request) {
  const config = getConfig();
  if (!relayConfigured()) {
    return Response.json(
      { success: false, error: "Relay is not configured (DUO1_API_URL / DUO1_AGENT_API_KEY)." },
      { status: 503 },
    );
  }
  if (config.relay.internalToken && request.headers.get("x-duo2-token") !== config.relay.internalToken) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { payout_instruction_id?: string };
  try {
    body = (await request.json()) as { payout_instruction_id?: string };
  } catch {
    return Response.json({ success: false, error: "body must be valid JSON" }, { status: 400 });
  }
  if (!body.payout_instruction_id) {
    return Response.json({ success: false, error: "payout_instruction_id is required" }, { status: 400 });
  }

  let instruction;
  try {
    instruction = await findPayoutInstruction(body.payout_instruction_id);
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 404 });
  }

  // Relay already has this payout: report it, never send again.
  if (instruction.status === "confirmed") {
    const existing = getPayoutRecord(instruction.id);
    return Response.json({
      success: true,
      already_settled: true,
      payout_instruction_id: instruction.id,
      signature: existing?.signature ?? null,
      explorer_url: existing ? solanaExplorer(existing.signature) : null,
      payable_status: existing?.payableStatus ?? null,
    });
  }
  if (instruction.status !== "created" && instruction.status !== "submitted") {
    return Response.json(
      { success: false, error: `Payout instruction is ${instruction.status}; only a created or submitted instruction can be paid.` },
      { status: 409 },
    );
  }

  const preflight = await solanaPreflight();
  if (!preflight.configured) {
    return Response.json(
      { success: false, error: `Solana payout rail is not configured: ${preflight.reason}`, blocker: "solana_not_configured" },
      { status: 503 },
    );
  }

  // Secure recipient validation: the instruction may only pay the allowlisted
  // devnet address. A placeholder or a tampered destination is rejected.
  if (instruction.destination && instruction.destination !== preflight.payoutAddress) {
    return Response.json(
      {
        success: false,
        error:
          "Payout destination does not match SOLANA_PAYOUT_ADDRESS. Refusing to send to an unapproved recipient.",
        blocker: "destination_not_allowlisted",
      },
      { status: 409 },
    );
  }
  if (!isValidSolanaAddress(preflight.payoutAddress)) {
    return Response.json(
      { success: false, error: "SOLANA_PAYOUT_ADDRESS is not a valid Solana address.", blocker: "invalid_destination" },
      { status: 503 },
    );
  }

  let submitted = instruction;
  if (instruction.status === "created") {
    try {
      submitted = await submitProviderPayout(instruction.id);
    } catch (error) {
      return Response.json({ success: false, error: (error as Error).message }, { status: 502 });
    }
  }

  // A previous attempt may have broadcast without reaching Relay. Reuse it.
  const existing = getPayoutRecord(submitted.id);
  if (existing) {
    const verification = await verifySolanaTransfer(existing.signature, {
      destination: existing.destination,
      minLamports: existing.lamports,
    });
    if (!verification.confirmed) {
      return Response.json(
        {
          success: false,
          error: `A previous transfer exists but is not confirmed: ${verification.error}`,
          signature: existing.signature,
          blocker: "unconfirmed_previous_transfer",
        },
        { status: 502 },
      );
    }
    const settled = await reportToRelay(submitted, existing.signature, {
      lamports: existing.lamports,
      slot: existing.slot,
      blockTime: existing.blockTime,
      payer: existing.payer,
      destination: existing.destination,
    });
    savePayoutRecord({ ...existing, reportedAt: new Date().toISOString(), payableStatus: settled.payable_status });
    return Response.json({
      success: true,
      already_settled: true,
      payout_instruction_id: submitted.id,
      signature: existing.signature,
      explorer_url: solanaExplorer(existing.signature),
      ...settled,
    });
  }

  if (!preflight.funded) {
    return Response.json(
      {
        success: false,
        error: `Solana payer ${preflight.payer} needs ${preflight.requiredLamports} lamports but has ${preflight.balanceLamports ?? 0}. Fund the devnet wallet, then retry.`,
        blocker: "payer_unfunded",
        payer: preflight.payer,
        balance_lamports: preflight.balanceLamports,
        required_lamports: preflight.requiredLamports,
        network: preflight.network,
      },
      { status: 503 },
    );
  }

  let payout;
  try {
    payout = await sendSolanaPayout({ destination: preflight.payoutAddress!, lamports: preflight.payoutLamports });
  } catch (error) {
    return Response.json(
      { success: false, error: `Solana transfer failed: ${(error as Error).message}`, blocker: "transfer_failed" },
      { status: 502 },
    );
  }

  // Persist before notifying Relay: a crash now can only lead to a retry that
  // reuses this signature.
  savePayoutRecord({
    instructionId: submitted.id,
    signature: payout.signature,
    network: payout.network,
    asset: "SOL",
    lamports: payout.lamports,
    destination: payout.destination,
    payer: payout.payer,
    slot: payout.slot,
    blockTime: payout.blockTime,
    createdAt: new Date().toISOString(),
  });

  // Independent confirmation through RPC before Relay records anything.
  const verification = await verifySolanaTransfer(payout.signature, {
    destination: payout.destination,
    minLamports: payout.lamports,
  });
  if (!verification.confirmed) {
    return Response.json(
      {
        success: false,
        error: `Transfer was sent but could not be verified: ${verification.error}`,
        signature: payout.signature,
        explorer_url: payout.explorerUrl,
        blocker: "verification_failed",
      },
      { status: 502 },
    );
  }

  const settled = await reportToRelay(submitted, payout.signature, {
    lamports: payout.lamports,
    slot: payout.slot,
    blockTime: payout.blockTime,
    payer: payout.payer,
    destination: payout.destination,
  });
  savePayoutRecord({
    instructionId: submitted.id,
    signature: payout.signature,
    network: payout.network,
    asset: "SOL",
    lamports: payout.lamports,
    destination: payout.destination,
    payer: payout.payer,
    slot: payout.slot,
    blockTime: payout.blockTime,
    createdAt: new Date().toISOString(),
    reportedAt: new Date().toISOString(),
    payableStatus: settled.payable_status,
  });

  return Response.json({
    success: true,
    already_settled: false,
    payout_instruction_id: submitted.id,
    signature: payout.signature,
    network: payout.network,
    asset: payout.asset,
    lamports: payout.lamports,
    sol: payout.sol,
    destination: payout.destination,
    payer: payout.payer,
    slot: payout.slot,
    block_time: payout.blockTime,
    explorer_url: payout.explorerUrl,
    verification,
    ...settled,
  });
}

async function reportToRelay(
  instruction: { id: string; amount_minor: number; currency: string; chain: string | null },
  signature: string,
  onchain: { lamports: number; slot: number | null; blockTime: number | null; payer: string; destination: string },
): Promise<{ payable_status: string; paid_minor: number; outstanding_minor: number }> {
  return confirmProviderPayoutSettlement({
    instructionId: instruction.id,
    // Accounting amount from Relay's authorized instruction, not the on-chain
    // demo amount. The two are recorded separately and never conflated.
    amountMinor: instruction.amount_minor,
    transactionId: signature,
    providerReference: `solana-devnet:${signature}`,
    raw: {
      rail: "solana",
      network: getConfig().solana.network,
      asset: "SOL",
      decimals: 9,
      lamports: onchain.lamports,
      onchain_amount_sol: onchain.lamports / 1_000_000_000,
      slot: onchain.slot,
      block_time: onchain.blockTime,
      payer: onchain.payer,
      destination: onchain.destination,
      explorer_url: solanaExplorer(signature),
      demo_scale: true,
      note: "Demonstration-scale native SOL transfer on Solana Devnet. The instruction's USD amount is accounting value, not the amount moved on-chain.",
    },
  });
}

function solanaExplorer(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
