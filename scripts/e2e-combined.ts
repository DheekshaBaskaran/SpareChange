/**
 * Cross-duo end-to-end test: Relay (Duo 1) + SpareChange (Duo 2).
 *
 * Unlike scripts/smoke-duo1.ts, this run hands execution to Duo 2. Duo 2 pulls
 * the cleared deal, obtains Relay's execution authorization, runs real compute,
 * reports verified usage back, and settles the Relay-approved payment
 * instruction through its own rail.
 *
 *   Relay:  deal → approvals → handoff → authorization → usage → invoice →
 *           reconciliation → payment approval
 *   Duo 2:  execute → verify → report usage → submit + settle payment
 *
 * Everything asserted here is read back from the services; nothing is faked.
 * The payment rail is reported honestly (`rail: mock` means no funds moved).
 *
 *   npm run e2e -- http://127.0.0.1:4000 http://127.0.0.1:3402
 */

import { randomUUID } from "node:crypto";

const RELAY = (process.argv[2] ?? process.env.DUO1_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const DUO2 = (process.argv[3] ?? process.env.DUO2_BASE_URL ?? "http://127.0.0.1:3402").replace(/\/+$/, "");

const WORKLOAD_ACME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
interface HumanAccount {
  key: string | undefined;
  humanUserId: string;
}

const HUMANS: Record<string, HumanAccount> = {
  "11111111-1111-4111-8111-111111111111": {
    key: process.env.RELAY_HUMAN_API_KEY,
    humanUserId: "ffffffff-ffff-4fff-8fff-fffffffff001",
  },
  "22222222-2222-4222-8222-222222222222": {
    key: process.env.HUMAN_VERTEX_API_KEY,
    humanUserId: "ffffffff-ffff-4fff-8fff-fffffffff002",
  },
  "33333333-3333-4333-8333-333333333333": {
    key: process.env.HUMAN_NORTHSTAR_API_KEY,
    humanUserId: "ffffffff-ffff-4fff-8fff-fffffffff003",
  },
  "44444444-4444-4444-8444-444444444444": {
    key: process.env.HUMAN_BRIGHTLANE_API_KEY,
    humanUserId: "ffffffff-ffff-4fff-8fff-fffffffff004",
  },
};

const runId = `e2e-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
let step = 0;

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the combined end-to-end test.`);
  return value;
}

interface Result {
  status: number;
  json: any;
}

async function relay(
  method: "GET" | "POST",
  path: string,
  key: string,
  body?: unknown,
): Promise<Result> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-relay-contract": "relay-duo1.v1",
    authorization: `Bearer ${key}`,
    "idempotency-key": `${runId}-${step++}`,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${RELAY}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  return { status: response.status, json: await parse(response) };
}

async function duo2(method: "GET" | "POST", path: string, body?: unknown): Promise<Result> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const token = process.env.DUO2_INTERNAL_TOKEN?.trim();
  if (token) headers["x-duo2-token"] = token;
  const response = await fetch(`${DUO2}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  return { status: response.status, json: await parse(response) };
}

async function parse(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

function pass(label: string, detail = ""): void {
  console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

function check(label: string, result: Result, allowed: number | number[], detail?: string): void {
  const codes = Array.isArray(allowed) ? allowed : [allowed];
  if (!codes.includes(result.status)) {
    throw new Error(`${label}: HTTP ${result.status} ${JSON.stringify(result.json).slice(0, 1200)}`);
  }
  pass(label, detail ?? `HTTP ${result.status}`);
}

const money = (minor: number) => `${(minor / 100).toFixed(2)} USD`;

/** Confirm a Solana transfer through RPC and measure the recipient's lamport delta. */
async function verifySolanaTransfer(
  signature: string,
  destination: string,
  minLamports: number,
): Promise<{ slot: number | null; lamportsReceived: number; payer: string | null }> {
  const rpc = process.env.SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com";
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json()) as {
    result?: {
      slot: number;
      meta?: { err: unknown; preBalances: number[]; postBalances: number[] } | null;
      transaction: { message: { accountKeys: Array<string | { pubkey: string }> } };
    };
    error?: { message?: string };
  };
  if (!body.result) throw new Error(`Solana RPC could not find ${signature}: ${body.error?.message ?? "no result"}`);
  if (body.result.meta?.err) throw new Error(`Solana transaction failed: ${JSON.stringify(body.result.meta.err)}`);
  const keys = body.result.transaction.message.accountKeys.map((key) => (typeof key === "string" ? key : key.pubkey));
  const index = keys.indexOf(destination);
  if (index === -1) throw new Error("Payout destination is not part of the Solana transaction");
  const received = (body.result.meta?.postBalances[index] ?? 0) - (body.result.meta?.preBalances[index] ?? 0);
  if (received < minLamports) {
    throw new Error(`Solana recipient received ${received} lamports, expected at least ${minLamports}`);
  }
  return { slot: body.result.slot, lamportsReceived: received, payer: keys[0] ?? null };
}

async function main(): Promise<void> {
  const agentKey = env("RELAY_API_KEY");
  const financeKey = env("DUO1_FINANCE_API_KEY");
  const humanKey = env("RELAY_HUMAN_API_KEY");

  console.log(`combined end-to-end run ${runId}`);
  console.log(`  relay: ${RELAY}\n  duo2 : ${DUO2}\n`);

  // ── Preflight ───────────────────────────────────────────────
  const relayHealth = await relay("GET", "/v1/health", "");
  check("relay health", relayHealth, 200);
  if (relayHealth.json?.database !== "ok") throw new Error("Relay database is not ready");

  const duo2System = await duo2("GET", "/api/system");
  check("duo2 system", duo2System, 200);
  if (duo2System.json?.duo1?.relayConfigured !== true) {
    throw new Error("Duo 2 is not configured against Relay (DUO1_API_URL / DUO1_AGENT_API_KEY)");
  }
  pass("duo2 relay link", `${duo2System.json.duo1.relayApiUrl} · rail ${duo2System.json.duo1.settlementRail}`);

  // ── Deal discovery (real market data) ───────────────────────
  const search = await relay("POST", "/v1/deals/search", agentKey, { workload_id: WORKLOAD_ACME });
  check("deal search", search, [200, 201]);
  const deal = search.json?.deal;
  if (!deal) {
    throw new Error(
      `no feasible deal: ${JSON.stringify(search.json?.rejected ?? search.json).slice(0, 800)} — reset the demo state first`,
    );
  }
  const proposal = deal.proposal;
  const baseline = proposal.comparison?.independent;
  console.log(`      deal ${deal.deal_id} — ${proposal.title}`);
  console.log(`      baseline ${money(proposal.baseline_cost_minor)} (${baseline?.note ?? "n/a"})`);
  console.log(
    `      direct   ${money(proposal.total_cost_minor)} — savings ${money(proposal.projected_savings_minor)} after ${money(proposal.coordination_fee_minor)} fee`,
  );

  // ── Participant approvals ───────────────────────────────────
  const approvals: any[] = deal.approval_requests ?? proposal.approval_requests ?? [];
  if (approvals.length === 0) throw new Error("deal has no approval requests");
  for (const request of approvals) {
    const account = HUMANS[request.participant.id];
    if (!account?.key) throw new Error(`no human credential for ${request.participant.name}`);
    const approval = await relay("POST", "/v1/approvals", account.key, {
      request_id: request.id,
      decision: "approved",
      attested_by: account.humanUserId,
    });
    check(`approve ${request.participant.name}`, approval, 201, money(request.amount_minor));
  }

  // ── Hand the deal to Duo 2 (it obtains Relay's authorization) ──
  const workload = (await relay("GET", `/v1/workloads/${deal.deal.workload_id}`, agentKey)).json?.workload;
  if (!workload) throw new Error("workload not found");
  const parties: any[] = proposal.parties;
  const buyer = parties.find((party) => party.role === "buyer");
  const provider = parties.find((party) => party.role === "provider");
  const hours = proposal.window?.hours ?? 10;

  const executePayload = {
    dealId: deal.deal_id,
    title: proposal.title,
    buyer: { id: buyer.id, name: buyer.name, role: "buyer", situation: buyer.obligation },
    provider: { id: provider.id, name: provider.name, role: "capacity_holder", situation: provider.obligation },
    workload: {
      gpuModel: workload.gpu_model,
      gpuCount: workload.gpu_count,
      durationMinutes: Math.round(hours * 60),
      description: `Relay deal ${deal.deal_id.slice(0, 8)}`,
    },
    price: { amount: (buyer.amount_minor ?? proposal.total_cost_minor) / 100, currency: "USD" },
    approvedAt: new Date().toISOString(),
    relay: { dealId: deal.deal_id },
  };
  console.log(
    `      handing ${workload.gpu_count}x ${workload.gpu_model} for ${hours}h to Duo 2 (${money(executePayload.price.amount * 100)})`,
  );

  const execute = await duo2("POST", "/api/deals/execute", executePayload);
  check("duo2 accepted the deal", execute, 201);
  const jobId = execute.json.jobId as string;
  console.log(`      job ${jobId} status ${execute.json.status}`);

  // ── Watch the real execution ────────────────────────────────
  let job: any = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const poll = await duo2("GET", `/api/jobs/${jobId}`);
    if (poll.status !== 200) throw new Error(`job poll failed: ${JSON.stringify(poll.json)}`);
    job = poll.json.job;
    if (job.status === "FAILED") {
      throw new Error(`duo2 job failed at ${job.failure?.step}: ${job.failure?.message}`);
    }
    // PAYMENT_PENDING is used twice: while usage is reported, then while the
    // Relay payment is authorized. Only the second one has a usage id.
    if (job.status === "COMPLETE" || (job.status === "PAYMENT_PENDING" && job.relay?.usageId)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!job) throw new Error("job never reported a status");
  if (job.status === "PAYMENT_PENDING" && job.relay?.usageId) {
    pass("compute verified, usage reported", `${job.execution?.executionMode} · accuracy ${job.execution?.output?.accuracy}`);
  } else {
    throw new Error(`unexpected job state: ${JSON.stringify(job.status)}`);
  }
  console.log(
    `      executor ${job.execution?.executionMode}, runtime ${job.execution?.runtimeMs}ms, exit ${job.execution?.exitCode}`,
  );
  console.log(`      verification ${job.verification?.status} (${job.verification?.checks?.length ?? 0} checks)`);
  console.log(`      relay contract ${job.relay.contractId}, usage ${job.relay.usageId}, amount ${money(job.relay.amountMinor ?? 0)}`);

  // ── Relay side: authorization, contract and verified usage ──
  const authorizations = await relay("GET", `/v1/deals/${deal.deal_id}/execution-authorizations`, agentKey);
  check("relay authorization exists", authorizations, 200);
  const authorization = Array.isArray(authorizations.json.authorization)
    ? authorizations.json.authorization[0]
    : authorizations.json.authorization;
  if (!authorization) throw new Error("Duo 2 did not create an execution authorization");
  if (authorization.id !== job.relay.authorizationId) {
    throw new Error("Duo 2 reported a different authorization than Relay stored");
  }
  const contract = authorization.contracts?.[0];
  if (!contract) throw new Error("authorization has no contract");
  pass("contract under Relay authorization", `${contract.id} (${authorization.contracts.length} contract(s))`);

  const usage = await relay("GET", `/internal/v1/duo2/contracts/${contract.id}/usage`, financeKey);
  check("relay recorded verified usage", usage, 200);
  const recorded = (usage.json.verified_usage ?? [])[0];
  if (!recorded) throw new Error("Relay has no verified usage for the contract");
  console.log(
    `      usage ${recorded.id}: ${recorded.gpu_seconds} contracted GPU-seconds on contract ${contract.id}`,
  );
  console.log(
    `      basis ${recorded.billing_basis}; worker-measured ${recorded.measured_gpu_seconds ?? "n/a"} GPU-seconds (${job.execution?.runtimeMs}ms runtime)`,
  );
  if (recorded.billing_basis !== "contracted_capacity_window") {
    throw new Error(`Relay recorded the basis as ${recorded.billing_basis}; contracted capacity must not be labelled measured hardware time`);
  }
  if (recorded.measured_gpu_seconds == null) {
    throw new Error("Relay did not store the worker-measured GPU-seconds alongside the contracted window");
  }

  // ── Invoice + reconciliation ────────────────────────────────
  const invoice = await relay("POST", `/v1/contracts/${contract.id}/invoices`, financeKey);
  check("invoice issued from verified usage", invoice, 201, money(invoice.json.invoice.total_minor));
  const invoiceId = invoice.json.invoice.id as string;

  const reconcile = await relay("POST", "/v1/finance/reconciliations", financeKey);
  check("reconciliation", reconcile, 201);
  if ((reconcile.json.exceptions ?? []).length !== 0) {
    throw new Error(`reconciliation raised exceptions: ${JSON.stringify(reconcile.json.exceptions)}`);
  }

  // ── Payment authorization (human control) ───────────────────
  const instructionRequest = await relay("POST", `/v1/invoices/${invoiceId}/payment-instruction`, financeKey, {
    // Declare the rail Duo 2 actually uses, so the human approval is for the
    // transfer that will really happen (Base Sepolia, USDC).
    chain: "base-sepolia",
    destination: "duo2-payment-rail",
  });
  check("payment requested", instructionRequest, 202);
  if (instructionRequest.json?.status !== "approval_required") {
    throw new Error("payment instruction was not gated on human approval");
  }

  const selfApprove = await relay(
    "POST",
    `/v1/financial-approvals/${instructionRequest.json.approval.id}/decision`,
    financeKey,
    { decision: "approved" },
  );
  check("finance cannot approve its own payment", selfApprove, [403, 409]);

  const approval = await relay(
    "POST",
    `/v1/financial-approvals/${instructionRequest.json.approval.id}/decision`,
    humanKey,
    { decision: "approved", note: "Combined end-to-end verification" },
  );
  check("human approves payment", approval, 200);
  const instruction = approval.json.result.instruction;

  // ── Duo 2 settles the Relay instruction ─────────────────────
  const settle = await duo2("POST", "/api/relay/pay", {
    instruction_id: instruction.id,
    job_id: jobId,
  });
  check("duo2 settled the instruction", settle, 200);
  console.log(
    `      rail ${settle.json.rail}${settle.json.simulated ? " (simulated, no funds moved)" : " (real transfer)"} · tx ${settle.json.transaction_id}`,
  );
  if (settle.json.rail === "x402") {
    if (settle.json.simulated !== false) throw new Error("x402 settlement was reported as simulated");
    if (String(settle.json.transaction_id).startsWith("mock_tx_")) {
      throw new Error("x402 settlement returned a mock transaction id");
    }
    if (!settle.json.network || !settle.json.onchain_amount) {
      throw new Error("x402 settlement did not report its network and on-chain amount");
    }
    console.log(`      network ${settle.json.network} · on-chain ${settle.json.onchain_amount}`);
    pass("real on-chain settlement", `${settle.json.transaction_id} on ${settle.json.network}`);
  } else {
    pass("simulated settlement recorded", "relay + duo2 both label it simulated");
  }

  // Idempotency: asking again must not move a second payment.
  const settleAgain = await duo2("POST", "/api/relay/pay", {
    instruction_id: instruction.id,
    job_id: jobId,
  });
  check("duplicate settlement request is idempotent", settleAgain, 200);
  if (settleAgain.json.already_settled !== true || settleAgain.json.transaction_id !== settle.json.transaction_id) {
    throw new Error("a repeated settlement request produced a different result");
  }

  const paidInvoice = await relay("GET", `/v1/invoices/${invoiceId}`, financeKey);
  check("invoice paid", paidInvoice, 200);
  if (paidInvoice.json.invoice.status !== "paid") {
    throw new Error(`invoice is ${paidInvoice.json.invoice.status}, expected paid`);
  }

  // The job should have completed once the rail settled.
  const finalJob = await duo2("GET", `/api/jobs/${jobId}`);
  check("duo2 job complete", finalJob, 200);
  if (finalJob.json.job.status !== "COMPLETE") {
    throw new Error(`duo2 job is ${finalJob.json.job.status}, expected COMPLETE`);
  }
  if (finalJob.json.job.payment?.transactionId !== settle.json.transaction_id) {
    throw new Error("the job's payment transaction does not match the settled instruction");
  }
  if (settle.json.rail === "x402" && !finalJob.json.job.payment?.settledOnChainAmount) {
    throw new Error("the job did not record the on-chain amount that actually moved");
  }
  console.log(
    `      duo2 payment ${finalJob.json.job.payment?.paymentMode} · ${finalJob.json.job.payment?.transactionId} · ${finalJob.json.job.payment?.settledOnChainAmount ?? "n/a"}`,
  );

  // ── Provider payable and settlement ─────────────────────────
  const payables = await relay("GET", "/v1/provider-payables", financeKey);
  check("provider payables", payables, 200);
  const payable = (payables.json.payables ?? [])[0];
  if (!payable) throw new Error("no provider payable accrued from the invoice");

  const solana = duo2System.json?.payments?.solanaPayout as
    | { configured: boolean; funded: boolean; payoutAddress: string | null; reason: string | null; network: string }
    | undefined;
  const solanaLive = Boolean(solana?.configured && solana.funded && solana.payoutAddress);
  console.log(
    solanaLive
      ? `      solana payout rail ready: ${solana!.payoutAddress} on ${solana!.network}`
      : `      SOLANA PAYOUT BLOCKED: ${solana?.reason ?? (solana?.funded === false ? "payer wallet is unfunded" : "not configured")}`,
  );
  const payoutRequest = await relay("POST", `/v1/provider-payables/${payable.id}/payout-instruction`, financeKey, {
    chain: "solana-devnet",
    destination: solanaLive ? solana!.payoutAddress! : "provider-combined-wallet",
  });
  check("provider payout requested", payoutRequest, 202);

  const payoutApproval = await relay(
    "POST",
    `/v1/financial-approvals/${payoutRequest.json.approval.id}/decision`,
    humanKey,
    { decision: "approved", note: "Combined payout leg" },
  );
  check("human approves payout", payoutApproval, 200);
  const payout = payoutApproval.json.result.instruction;

  let payoutEvidence: Record<string, unknown>;
  if (solanaLive) {
    const paid = await duo2("POST", "/api/relay/pay-out", { payout_instruction_id: payout.id });
    check("provider payout sent on Solana Devnet", paid, 200);
    const signature = paid.json.signature as string;
    if (!signature) throw new Error("Solana payout returned no signature");
    if (paid.json.network !== "solana-devnet" || paid.json.asset !== "SOL") {
      throw new Error(`Unexpected Solana payout asset/network: ${paid.json.asset} ${paid.json.network}`);
    }
    console.log(
      `      sol ${paid.json.sol} (${paid.json.lamports} lamports) → ${paid.json.destination} · sig ${signature}`,
    );
    console.log(`      explorer ${paid.json.explorer_url}`);

    // Independent confirmation through Solana RPC: never trust the sender's
    // own response as proof of an on-chain transfer.
    const verified = await verifySolanaTransfer(signature, paid.json.destination, paid.json.lamports);
    pass("independent Solana confirmation", `slot ${verified.slot} · ${verified.lamportsReceived} lamports received`);

    // Idempotency: the durable payout record must return the same signature
    // instead of broadcasting a second transfer.
    const payoutAgain = await duo2("POST", "/api/relay/pay-out", { payout_instruction_id: payout.id });
    check("duplicate payout request is idempotent", payoutAgain, 200);
    if (payoutAgain.json.already_settled !== true || payoutAgain.json.signature !== signature) {
      throw new Error("a repeated payout request produced a different signature");
    }
    payoutEvidence = {
      payout_rail: "solana-devnet",
      payout_asset: "SOL",
      payout_signature: signature,
      payout_lamports: paid.json.lamports,
      payout_slot: verified.slot,
      payout_payer: verified.payer,
      payout_destination: paid.json.destination,
      payout_simulated: false,
      payout_status: paid.json.payable_status,
    };
  } else {
    const workerKey = env("DUO2_WORKER_API_KEY");
    const payoutSubmit = await relay(
      "POST",
      `/internal/v1/duo2/provider-payout-instructions/${payout.id}/submit`,
      workerKey,
    );
    check("provider payout submitted", payoutSubmit, 200);
    const payoutSettlement = await relay("POST", "/internal/v1/duo2/provider-settlements", workerKey, {
      instruction_id: payout.id,
      status: "confirmed",
      amount_minor: payout.amount_minor,
      transaction_id: `${runId}-payout`,
      provider_reference: `combined:payout:${payout.id}`,
      raw: { rail: "mock", simulated_value: true, blocker: solana?.reason ?? "solana payout rail unavailable" },
    });
    check("provider payout recorded as simulated", payoutSettlement, 200, payoutSettlement.json?.payable_status);
    payoutEvidence = {
      payout_rail: "mock",
      payout_asset: null,
      payout_signature: null,
      payout_simulated: true,
      payout_status: payoutSettlement.json?.payable_status,
      payout_blocker: solana?.reason ?? "solana payout rail unavailable",
    };
  }

  // ── Final integrity checks ──────────────────────────────────
  const finalReconcile = await relay("POST", "/v1/finance/reconciliations", financeKey);
  check("final reconciliation", finalReconcile, 201);
  if ((finalReconcile.json.exceptions ?? []).length !== 0) {
    throw new Error(`final reconciliation is not clean: ${JSON.stringify(finalReconcile.json.exceptions)}`);
  }

  const balance = await relay("GET", "/v1/ledger/trial-balance", financeKey);
  check("trial balance", balance, 200);
  if (balance.json.balanced !== true) throw new Error("ledger does not balance");
  console.log(
    `      ledger balanced: debit ${money(balance.json.total_debit_minor)} = credit ${money(balance.json.total_credit_minor)}`,
  );

  const audit = await relay("GET", "/v1/audit?limit=400", agentKey);
  check("audit trail", audit, 200);
  const auditEvents: any[] = audit.json.audit_events ?? [];
  const actions: string[] = auditEvents.map((event: any) => event.action);
  const required = [
    "deal.proposed_by_solver",
    "approval.approved",
    "handoff.provisional_created",
    "execution.authorized",
    "usage.verified",
    "invoice.issued",
    "reconciliation.completed",
    "financial_approval.approved",
    "payment.instruction_created",
    "payment.settled",
    "provider_payout.settled",
  ];
  const missing = required.filter((action) => !actions.includes(action));
  if (missing.length) throw new Error(`audit is missing: ${missing.join(", ")}`);

  // The audit event must point at the transaction that really settled, so an
  // auditor can go from the ledger entry to the chain without trusting Duo 2.
  const settledEvent = auditEvents.find(
    (event: any) =>
      event.action === "payment.settled" &&
      event.after_state?.transaction_id === settle.json.transaction_id,
  );
  if (!settledEvent) {
    throw new Error("audit has no payment.settled event for the real transaction");
  }
  if (settledEvent.after_state?.invoice_id !== invoiceId) {
    throw new Error("the settled audit event points at a different invoice");
  }
  pass(
    "audit names the settlement transaction",
    `${settledEvent.after_state.transaction_id} · ${money(settledEvent.after_state.amount_minor)}`, 
  );
  pass("audit trail complete", `${actions.length} events`);

  console.log(
    "\nSUMMARY " +
      JSON.stringify(
        {
          run: runId,
          deal_id: deal.deal_id,
          job_id: jobId,
          executor: job.execution?.executionMode,
          authorization_id: authorization.id,
          contract_id: contract.id,
          usage_gpu_seconds: recorded.gpu_seconds,
          usage_billing_basis: recorded.billing_basis,
          usage_measured_gpu_seconds: recorded.measured_gpu_seconds,
          invoice_id: invoiceId,
          invoice_total_minor: paidInvoice.json.invoice.total_minor,
          settlement_rail: settle.json.rail,
          settlement_simulated: settle.json.simulated,
          settlement_network: settle.json.network ?? null,
          settlement_onchain_amount: settle.json.onchain_amount ?? null,
          settlement_transaction: settle.json.transaction_id,
          ...payoutEvidence,
          balanced: balance.json.balanced,
        },
        null,
        2,
      ),
  );
}

main().catch((error) => {
  console.error("\nFAIL ", error instanceof Error ? error.message : error);
  process.exit(1);
});
