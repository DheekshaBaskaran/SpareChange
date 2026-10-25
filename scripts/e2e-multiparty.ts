/**
 * Multi-party clearing end-to-end: a genuinely interdependent exchange.
 *
 * The seeded deal moves Acme off Vertex's H100 window and onto Northstar, while
 * Vertex's released window is reassigned to Brightlane. Nothing clears unless
 * all four participants approve, and the two compensation flows become separate
 * contracts. Each contract is executed by Duo 2 as real compute, invoiced from
 * its own verified usage, and paid on Base Sepolia x402.
 *
 * This is deliberately NOT "one rental with four approvals": the capacity
 * transfer and the compensation graph are two linked legs, and each leg has its
 * own buyer, provider, contract, invoice and payment.
 *
 *   npm run e2e:multiparty -- http://127.0.0.1:4000 http://127.0.0.1:3402
 *
 * Run `npm run db:reset-demo -- --confirm` first. The script reads the seeded
 * deal `dddddddd-…`; it does not fabricate inventory.
 */

const RELAY = (process.argv[2] ?? process.env.DUO1_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const DUO2 = (process.argv[3] ?? process.env.DUO2_BASE_URL ?? "http://127.0.0.1:3402").replace(/\/+$/, "");

const MULTIPARTY_DEAL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const HUMANS: Record<string, { key: string | undefined; humanUserId: string; name: string }> = {
  "11111111-1111-4111-8111-111111111111": {
    key: process.env.RELAY_HUMAN_API_KEY,
    humanUserId: "ffffffff-ffff-4fff-8fff-fffffffff001",
    name: "Acme Compute",
  },
  "22222222-2222-4222-8222-222222222222": {
    key: process.env.HUMAN_VERTEX_API_KEY,
    humanUserId: "ffffffff-ffff-4fff-8fff-fffffffff002",
    name: "Vertex Labs",
  },
  "33333333-3333-4333-8333-333333333333": {
    key: process.env.HUMAN_NORTHSTAR_API_KEY,
    humanUserId: "ffffffff-ffff-4fff-8fff-fffffffff003",
    name: "Northstar GPU",
  },
  "44444444-4444-4444-8444-444444444444": {
    key: process.env.HUMAN_BRIGHTLANE_API_KEY,
    humanUserId: "ffffffff-ffff-4fff-8fff-fffffffff004",
    name: "Brightlane AI",
  },
};

let step = 0;
const money = (minor: number) => `${(minor / 100).toFixed(2)} USD`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Result {
  status: number;
  json: any;
}

async function relay(method: "GET" | "POST", path: string, key: string, body?: unknown): Promise<Result> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-relay-contract": "relay-duo1.v1",
    authorization: `Bearer ${key}`,
    "idempotency-key": `mp-${Date.now().toString(36)}-${step++}`,
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
    throw new Error(`${label}: HTTP ${result.status} ${JSON.stringify(result.json).slice(0, 1500)}`);
  }
  pass(label, detail ?? `HTTP ${result.status}`);
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the multi-party scenario.`);
  return value;
}

async function main(): Promise<void> {
  const agentKey = env("RELAY_API_KEY");
  const financeKey = env("DUO1_FINANCE_API_KEY");
  const runId = `mp-${Date.now().toString(36)}`;

  console.log(`multi-party clearing run ${runId}`);
  console.log(`  relay: ${RELAY}\n  duo2 : ${DUO2}\n`);

  const health = await relay("GET", "/v1/health", "");
  check("relay health", health, 200);
  if (health.json?.database !== "ok") throw new Error("Relay database is not ready");

  const dealResponse = await relay("GET", `/v1/deals/${MULTIPARTY_DEAL}`, agentKey);
  check("seeded multi-party deal", dealResponse, 200);
  const view = dealResponse.json;
  const proposal = view.proposal;
  if (!proposal) throw new Error("seeded deal has no proposal");
  if (proposal.parties?.length !== 4) throw new Error(`expected 4 parties, got ${proposal.parties?.length}`);
  if (proposal.compensation?.length !== 2) throw new Error("expected two compensation flows");
  if (proposal.proposed_transfers?.length !== 2) {
    throw new Error("expected two linked capacity transfers; this is not a multi-party exchange");
  }
  console.log(`      ${proposal.title}`);
  console.log(
    `      transfers ${proposal.proposed_transfers.map((t: any) => `${t.from_party_id.slice(0, 4)}→${t.to_party_id.slice(0, 4)}`).join(", ")}`,
  );
  console.log(
    `      compensation ${proposal.compensation.map((c: any) => `${money(c.amount_minor)}`).join(" + ")} · surplus ${money(proposal.projected_surplus_minor)}`,
  );

  // ── All four participants must approve ──────────────────────
  const requests: any[] = view.approval_requests ?? [];
  if (requests.length !== 4) throw new Error(`expected 4 approval requests, got ${requests.length}`);
  for (const request of requests) {
    const human = HUMANS[request.participant.id];
    if (!human?.key) throw new Error(`no human credential for ${request.participant.name}`);
    const approval = await relay("POST", "/v1/approvals", human.key, {
      request_id: request.id,
      decision: "approved",
      attested_by: human.humanUserId,
    });
    check(`approve ${request.participant.name}`, approval, 201, money(request.amount_minor));
  }

  // ── Handoff creates one contract per compensation flow ──────
  const handoff = await relay("POST", `/v1/deals/${MULTIPARTY_DEAL}/handoff`, agentKey);
  check("handoff", handoff, [200, 201]);
  if (handoff.json?.settlement_authorized === true) {
    throw new Error("handoff authorized settlement; execution authorization must be explicit");
  }

  const authorize = await relay("POST", `/v1/deals/${MULTIPARTY_DEAL}/execution-authorizations`, agentKey);
  check("execution authorization", authorize, [200, 201]);
  const contracts: any[] = authorize.json?.authorization?.contracts ?? [];
  if (contracts.length !== 2) throw new Error(`expected 2 contracts (one per compensation flow), got ${contracts.length}`);
  pass(
    "independent contracts",
    contracts
      .map((c: any) => {
        const line = proposal.compensation.find(
          (entry: any) => entry.from_party_id === c.buyer_id && entry.to_party_id === c.provider_id,
        );
        return `${c.buyer_id.slice(0, 4)}→${c.provider_id.slice(0, 4)} ${money(line?.amount_minor ?? 0)}`;
      })
      .join(" · "),
  );

  const workloadResponse = await relay("GET", `/v1/workloads/${view.deal.workload_id}`, agentKey);
  const workload = workloadResponse.json?.workload;
  if (!workload) throw new Error("workload not found");
  const hours = proposal.window?.hours ?? 10;

  const results: any[] = [];
  for (const contract of contracts) {
    const compensation = proposal.compensation.find(
      (line: any) => line.from_party_id === contract.buyer_id && line.to_party_id === contract.provider_id,
    );
    if (!compensation) throw new Error("contract has no matching compensation line");
    const buyer = proposal.parties.find((party: any) => party.id === contract.buyer_id);
    const provider = proposal.parties.find((party: any) => party.id === contract.provider_id);
    if (!buyer || !provider) throw new Error("contract party is missing from the proposal");

    console.log(
      `\n      leg ${buyer.name} → ${provider.name}: ${money(compensation.amount_minor)} for ${workload.gpu_count}x ${workload.gpu_model} / ${hours}h`,
    );

    // The contract selector is explicit: the same deal has two contracts, so
    // Duo 2 must execute the one this compensation line authorizes.
    const execute = await duo2("POST", "/api/deals/execute", {
      dealId: MULTIPARTY_DEAL,
      title: `${proposal.title} — ${provider.name} leg`,
      buyer: { id: buyer.id, name: buyer.name, role: "buyer", situation: buyer.obligation },
      provider: { id: provider.id, name: provider.name, role: "capacity_holder", situation: provider.obligation },
      workload: {
        gpuModel: workload.gpu_model,
        gpuCount: workload.gpu_count,
        durationMinutes: Math.round(hours * 60),
        description: `Multi-party leg ${contract.id.slice(0, 8)}`,
      },
      price: { amount: compensation.amount_minor / 100, currency: "USD" },
      approvedAt: new Date().toISOString(),
      relay: { dealId: MULTIPARTY_DEAL, contractId: contract.id },
    });
    check("duo2 accepted the leg", execute, 201);
    const jobId = execute.json.jobId as string;

    let job: any = null;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const poll = await duo2("GET", `/api/jobs/${jobId}`);
      if (poll.status !== 200) throw new Error(`job poll failed: ${JSON.stringify(poll.json)}`);
      job = poll.json.job;
      if (job.status === "FAILED") throw new Error(`leg failed at ${job.failure?.step}: ${job.failure?.message}`);
      if (job.status === "PAYMENT_PENDING" && job.relay?.usageId) break;
      await sleep(1000);
    }
    if (!job?.relay?.usageId) throw new Error(`leg ${contract.id} never reported usage`);
    if (job.relay.contractId !== contract.id) {
      throw new Error(`duo2 executed contract ${job.relay.contractId}, expected ${contract.id}`);
    }
    if (job.verification?.status !== "VERIFIED") throw new Error("leg was not verified");
    pass(
      "real compute + verified usage",
      `${job.execution?.executionMode} · ${job.execution?.runtimeMs}ms · usage ${job.relay.usageId.slice(0, 8)}`,
    );

    // The invoice is compensation plus that buyer's approved switching cost.
    const switchingMinor = Number(
      proposal.participant_costs?.find((cost: any) => cost.party_id === buyer.id)?.switching_minor ?? 0,
    );
    const expectedInvoiceMinor = compensation.amount_minor + switchingMinor;
    const invoice = await relay("POST", `/v1/contracts/${contract.id}/invoices`, financeKey);
    check("invoice for this leg", invoice, 201, money(invoice.json.invoice.total_minor));
    if (invoice.json.invoice.total_minor !== expectedInvoiceMinor) {
      throw new Error(
        `invoice ${invoice.json.invoice.total_minor} does not match compensation ${compensation.amount_minor}` +
          (switchingMinor ? ` + switching ${switchingMinor}` : ""),
      );
    }
    const invoiceId = invoice.json.invoice.id as string;

    const reconciliation = await relay("POST", "/v1/finance/reconciliations", financeKey);
    check("reconciliation before payment", reconciliation, 201);
    if ((reconciliation.json.exceptions ?? []).length !== 0) {
      throw new Error(`reconciliation raised exceptions: ${JSON.stringify(reconciliation.json.exceptions)}`);
    }

    const instructionRequest = await relay("POST", `/v1/invoices/${invoiceId}/payment-instruction`, financeKey, {
      chain: "base-sepolia",
      destination: "duo2-payment-rail",
    });
    check("payment requested", instructionRequest, 202);
    const approval = await relay(
      "POST",
      `/v1/financial-approvals/${instructionRequest.json.approval.id}/decision`,
      HUMANS[buyer.id].key!,
      { decision: "approved", note: `Multi-party leg approval for ${provider.name}` },
    );
    check(`human approves ${buyer.name} payment`, approval, 200);
    const instruction = approval.json.result.instruction;

    const settled = await duo2("POST", "/api/relay/pay", {
      instruction_id: instruction.id,
      job_id: jobId,
    });
    check("leg settled", settled, 200);
    if (settled.json.rail !== "x402" || settled.json.simulated !== false) {
      throw new Error(`expected a real x402 transfer, got rail=${settled.json.rail} simulated=${settled.json.simulated}`);
    }
    if (!String(settled.json.transaction_id).startsWith("0x")) {
      throw new Error("x402 settlement did not return an EVM transaction hash");
    }
    pass("real x402 leg payment", `${money(instruction.amount_minor)} · ${settled.json.transaction_id.slice(0, 18)}…`);

    const paid = await relay("GET", `/v1/invoices/${invoiceId}`, financeKey);
    if (paid.json?.invoice?.status !== "paid") throw new Error(`invoice ${invoiceId} is not paid`);

    results.push({
      buyer: buyer.name,
      provider: provider.name,
      contract_id: contract.id,
      job_id: jobId,
      usage_id: job.relay.usageId,
      invoice_id: invoiceId,
      amount_minor: invoice.json.invoice.total_minor,
      compensation_minor: compensation.amount_minor,
      switching_minor: switchingMinor,
      transaction_id: settled.json.transaction_id,
      execution: job.execution?.executionMode,
      measured_gpu_seconds: job.execution?.runtimeMs ? Math.round(job.execution.runtimeMs / 1000) * workload.gpu_count : null,
    });
  }

  // ── Cross-leg integrity ─────────────────────────────────────
  const finalReconciliation = await relay("POST", "/v1/finance/reconciliations", financeKey);
  check("final reconciliation", finalReconciliation, 201);
  if ((finalReconciliation.json.exceptions ?? []).length !== 0) {
    throw new Error(`final reconciliation is not clean: ${JSON.stringify(finalReconciliation.json.exceptions)}`);
  }
  const balance = await relay("GET", "/v1/ledger/trial-balance", financeKey);
  if (balance.json?.balanced !== true) throw new Error("ledger does not balance");
  pass("ledger balanced", `${money(balance.json.total_debit_minor)} debit = ${money(balance.json.total_credit_minor)} credit`);

  const audit = await relay("GET", "/v1/audit?limit=400", agentKey);
  const events: any[] = audit.json?.audit_events ?? [];
  for (const result of results) {
    const recorded = events.find(
      (event: any) => event.action === "payment.settled" && event.after_state?.transaction_id === result.transaction_id,
    );
    if (!recorded) throw new Error(`audit has no settlement event for ${result.transaction_id}`);
  }
  pass("both settlements are in the audit trail", `${results.length} legs`);

  console.log(
    "\nSUMMARY " +
      JSON.stringify(
        {
          run: runId,
          deal_id: MULTIPARTY_DEAL,
          parties: proposal.parties.length,
          transfers: proposal.proposed_transfers.length,
          contracts: contracts.length,
          legs: results,
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
