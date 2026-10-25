// POST /api/relay/pay
//
// Duo 2 is the payment rail for a Relay (Duo 1) invoice. Relay creates and
// approves the instruction; this endpoint submits it, performs the transfer,
// and reports the real outcome back. Duo 2 never decides an amount and never
// approves its own payment.
//
// Body: { "instruction_id": "…", "job_id": "…" (optional) }
//
// Rail selection is explicit in the response and in what Relay stores:
//   * mock  → simulated, no funds move, transaction ids start with `mock_tx_`
//   * x402  → a real testnet transfer through the existing x402 provider
//
// If x402 is configured but the transfer fails, the endpoint reports the
// failure to Relay instead of silently switching to a simulated settlement.

import { getJob, listJobs, saveJob, setJobStatus } from "@/lib/server/job-store";
import { getConfig } from "@/lib/server/config";
import { x402PaymentProvider } from "@/lib/server/payments/x402";
import { randomId } from "@/lib/server/payments/types";
import {
  confirmSettlement,
  getPaymentInstruction,
  relayConfigured,
  submitPaymentInstruction,
} from "@/lib/server/relay";
import type { Job, PaymentResult } from "@/lib/types";

export async function POST(request: Request) {
  const { relay } = getConfig();
  if (!relayConfigured()) {
    return Response.json(
      { success: false, error: "Relay is not configured (DUO1_API_URL / DUO1_AGENT_API_KEY)." },
      { status: 503 },
    );
  }
  if (relay.internalToken && request.headers.get("x-duo2-token") !== relay.internalToken) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { instruction_id?: string; job_id?: string };
  try {
    body = (await request.json()) as { instruction_id?: string; job_id?: string };
  } catch {
    return Response.json({ success: false, error: "body must be valid JSON" }, { status: 400 });
  }
  if (!body.instruction_id) {
    return Response.json({ success: false, error: "instruction_id is required" }, { status: 400 });
  }

  let instruction;
  try {
    instruction = await getPaymentInstruction(body.instruction_id);
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 404 });
  }

  const job = body.job_id ? getJob(body.job_id) : findJobForContract(instruction.contract_id);

  if (instruction.status === "confirmed") {
    // Report the settlement that actually happened. A repeated request must be
    // byte-for-byte safe for the caller and must never trigger a new transfer.
    const recorded = job?.payment?.transactionId ?? null;
    return Response.json({
      success: true,
      already_settled: true,
      instruction_id: instruction.id,
      invoice_id: instruction.invoice_id,
      transaction_id: recorded,
      network: job?.payment?.network ?? null,
      onchain_amount: job?.payment?.settledOnChainAmount ?? null,
      job_id: job?.jobId ?? null,
    });
  }

  let submitted = instruction;
  if (instruction.status === "created") {
    try {
      submitted = await submitPaymentInstruction(instruction.id);
    } catch (error) {
      return Response.json({ success: false, error: (error as Error).message }, { status: 502 });
    }
  }

  // ── Perform the transfer ──────────────────────────────────
  const useX402 =
    getConfig().paymentMode === "x402" &&
    x402PaymentProvider.isConfigured().configured &&
    Boolean(job);
  let transactionId: string;
  let rail: "mock" | "x402";
  let raw: Record<string, unknown>;
  // Kept so the job and the API response carry the real on-chain facts
  // (network, explorer link, amount actually moved) instead of implying the
  // full invoice value left the buyer's wallet.
  let onChain: Awaited<ReturnType<typeof x402PaymentProvider.settle>> | undefined;

  if (useX402 && job) {
    try {
      const result = await x402PaymentProvider.settle(job);
      onChain = result;
      transactionId = result.transactionId;
      rail = "x402";
      raw = {
        rail,
        network: result.network,
        onchain_amount: result.settledOnChainAmount,
        payer: result.payer,
        simulated_value: false,
      };
    } catch (error) {
      // Tell Relay exactly what happened; do not pretend the invoice was paid.
      return Response.json(
        { success: false, error: `x402 settlement failed: ${(error as Error).message}`, rail: "x402" },
        { status: 502 },
      );
    }
  } else {
    transactionId = randomId("mock_tx_");
    rail = "mock";
    raw = {
      rail,
      simulated_value: true,
      note: "Simulated settlement: no funds moved. Amounts mirror the Relay invoice.",
    };
  }

  let settlement;
  try {
    settlement = await confirmSettlement({
      instructionId: submitted.id,
      amountMinor: submitted.amount_minor,
      transactionId,
      providerReference: `duo2:${submitted.id}`,
      raw,
    });
  } catch (error) {
    return Response.json({ success: false, error: (error as Error).message }, { status: 502 });
  }

  // ── Complete the job ──────────────────────────────────────
  if (job) {
    const payment: PaymentResult = {
      status: "SUCCESS",
      paymentMode: rail,
      transactionId,
      amount: submitted.amount_minor / 100,
      currency: submitted.currency,
      timestamp: new Date().toISOString(),
      network: onChain?.network,
      explorerUrl: onChain?.explorerUrl,
      settledOnChainAmount: onChain?.settledOnChainAmount,
      payer: onChain?.payer,
      legs: [
        {
          from: job.deal.buyer.name,
          to: job.deal.provider.name,
          amount: submitted.amount_minor / 100,
          currency: submitted.currency,
          mode: rail,
          status: "SUCCESS",
          transactionId,
          explorerUrl: onChain?.explorerUrl,
          onChainAmount: onChain?.settledOnChainAmount,
        },
      ],
      steps: [
        `Relay instruction ${submitted.id} submitted`,
        ...(onChain?.steps ?? []),
        `Relay recorded the settlement; invoice ${settlement.invoice_status}`,
      ],
      notes:
        rail === "mock"
          ? ["Simulated settlement rail — no funds moved."]
          : [
              ...(onChain?.notes ?? []),
              "Testnet demo settlement: the invoice amount is the ledger value; only the scaled on-chain amount moved.",
            ],
    };
    job.payment = payment;
    job.paymentMode = rail;
    job.completedAt = new Date().toISOString();
    setJobStatus(job, "COMPLETE", `Payment settled through Relay (${rail})`);
    saveJob(job);
  }

  return Response.json({
    success: true,
    instruction_id: submitted.id,
    invoice_id: submitted.invoice_id,
    amount_minor: submitted.amount_minor,
    rail,
    simulated: rail === "mock",
    transaction_id: transactionId,
    network: onChain?.network ?? null,
    onchain_amount: onChain?.settledOnChainAmount ?? null,
    explorer_url: onChain?.explorerUrl ?? null,
    invoice_status: settlement.invoice_status,
    job_id: job?.jobId ?? null,
  });
}

function findJobForContract(contractId: string): Job | undefined {
  return listJobs().find((candidate) => candidate.relay?.contractId === contractId);
}
