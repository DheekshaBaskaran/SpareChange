/**
 * Financial-exception scenario: discrepancy → CREAO coordination → correction
 * → human approval → settlement.
 *
 * This is the local, reproducible proof of Relay's exception controls. It
 * deliberately overbills a real executed contract, then drives the SAME APIs a
 * hosted CREAO agent uses:
 *
 *   claim financial_exception work item → read persisted evidence → record
 *   findings → attempt the Elastic investigation (expected to degrade) →
 *   propose the correction → require a human approval → apply it → settle.
 *
 * It is NOT proof that the hosted CREAO agent ran. Hosted evidence still
 * requires a public Relay URL, the CREAO agent configuration, a 14/14 probe and
 * an agent run id, none of which exist in this workspace.
 *
 *   npm run e2e:exception -- http://127.0.0.1:4000 http://127.0.0.1:3402
 *
 * Reset the demo first: `npm run db:reset-demo -- --confirm`.
 */

const RELAY = (process.argv[2] ?? process.env.DUO1_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const DUO2 = (process.argv[3] ?? process.env.DUO2_BASE_URL ?? "http://127.0.0.1:3402").replace(/\/+$/, "");

const WORKLOAD_ACME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HUMANS: Record<string, { key: string | undefined; humanUserId: string }> = {
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
    "idempotency-key": `exc-${Date.now().toString(36)}-${step++}`,
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
  if (!value) throw new Error(`${name} is required for the exception scenario.`);
  return value;
}

async function main(): Promise<void> {
  const agentKey = env("RELAY_API_KEY");
  const financeKey = env("DUO1_FINANCE_API_KEY");
  const humanKey = env("RELAY_HUMAN_API_KEY");
  const runId = `exc-${Date.now().toString(36)}`;

  console.log(`financial exception run ${runId}`);
  console.log(`  relay: ${RELAY}\n  duo2 : ${DUO2}\n`);

  const health = await relay("GET", "/v1/health", "");
  check("relay health", health, 200);
  if (health.json?.database !== "ok") throw new Error("Relay database is not ready");

  // ── A real executed contract to overbill ────────────────────
  const search = await relay("POST", "/v1/deals/search", agentKey, { workload_id: WORKLOAD_ACME });
  check("deal search", search, [200, 201]);
  const deal = search.json?.deal;
  if (!deal) throw new Error("no feasible deal; reset the demo state and retry");
  const proposal = deal.proposal;
  const approvals: any[] = deal.approval_requests ?? proposal.approval_requests ?? [];
  for (const request of approvals) {
    const human = HUMANS[request.participant.id];
    if (!human?.key) throw new Error(`no human credential for ${request.participant.name}`);
    const approval = await relay("POST", "/v1/approvals", human.key, {
      request_id: request.id,
      decision: "approved",
      attested_by: human.humanUserId,
    });
    check(`approve ${request.participant.name}`, approval, 201);
  }

  const workload = (await relay("GET", `/v1/workloads/${deal.deal.workload_id}`, agentKey)).json?.workload;
  if (!workload) throw new Error("workload not found");
  const parties: any[] = proposal.parties;
  const buyer = parties.find((party) => party.role === "buyer");
  const provider = parties.find((party) => party.role === "provider");
  const hours = proposal.window?.hours ?? 10;
  if (!buyer || !provider) throw new Error("proposal is missing a buyer or provider");

  const execute = await duo2("POST", "/api/deals/execute", {
    dealId: deal.deal_id,
    title: proposal.title,
    buyer: { id: buyer.id, name: buyer.name, role: "buyer", situation: buyer.obligation },
    provider: { id: provider.id, name: provider.name, role: "capacity_holder", situation: provider.obligation },
    workload: {
      gpuModel: workload.gpu_model,
      gpuCount: workload.gpu_count,
      durationMinutes: Math.round(hours * 60),
      description: `Exception scenario ${deal.deal_id.slice(0, 8)}`,
    },
    price: { amount: (buyer.amount_minor ?? proposal.total_cost_minor) / 100, currency: "USD" },
    approvedAt: new Date().toISOString(),
    relay: { dealId: deal.deal_id },
  });
  check("duo2 accepted the deal", execute, 201);
  const jobId = execute.json.jobId as string;

  let job: any = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const poll = await duo2("GET", `/api/jobs/${jobId}`);
    job = poll.json?.job;
    if (job?.status === "FAILED") throw new Error(`job failed: ${job.failure?.step} ${job.failure?.message}`);
    if (job?.status === "PAYMENT_PENDING" && job.relay?.usageId) break;
    await sleep(1000);
  }
  if (!job?.relay?.usageId) throw new Error("job never reported verified usage");
  const contractId = job.relay.contractId as string;
  pass("real compute + verified usage", `${job.execution?.executionMode} · ${job.execution?.runtimeMs}ms`);

  const invoiceResponse = await relay("POST", `/v1/contracts/${contractId}/invoices`, financeKey);
  check("invoice issued", invoiceResponse, 201, money(invoiceResponse.json.invoice.total_minor));
  const invoice = invoiceResponse.json.invoice;
  const cleanTotal = invoice.total_minor as number;

  // ── Deliberate discrepancy ─────────────────────────────────
  const overbill = await relay("POST", `/v1/invoices/${invoice.id}/lines`, financeKey, {
    description: "Duplicate capacity surcharge (deliberate demo discrepancy)",
    quantity: 1,
    unit_rate_minor: 1000,
    amount_minor: 1000,
    reason: "Introduced to exercise the CREAO financial-exception workflow",
  });
  check("discrepancy added", overbill, 201, money(overbill.json.invoice.total_minor));
  if (overbill.json.invoice.total_minor !== cleanTotal + 1000) throw new Error("overbill was not applied");

  const reconciliation = await relay("POST", "/v1/finance/reconciliations", financeKey);
  check("reconciliation detects the discrepancy", reconciliation, 201);
  const exceptions: any[] = reconciliation.json.exceptions ?? [];
  const exception = exceptions.find((entry) => entry.kind === "invoice_overbilled");
  if (!exception) throw new Error(`expected invoice_overbilled, got ${JSON.stringify(exceptions)}`);
  pass("financial exception opened", `${exception.id} · difference ${money(exception.evidence?.difference_minor ?? 0)}`);

  const blocked = await relay("POST", `/v1/invoices/${invoice.id}/payment-instruction`, financeKey, {
    chain: "base-sepolia",
    destination: "duo2-payment-rail",
  });
  check("payment blocked while the exception is open", blocked, 409);
  if (blocked.json?.code !== "payment_blocked") throw new Error("payment was not blocked by the exception control");

  // ── CREAO work item: claim and read persisted evidence ─────
  const workItems = await relay("GET", "/v1/creao/work-items?status=pending&kind=financial_exception", agentKey);
  check("creao work queue", workItems, 200);
  const item = (workItems.json.work_items ?? []).find(
    (candidate: any) => candidate.payload?.exception_id === exception.id,
  );
  if (!item) throw new Error("no CREAO work item was created for the exception");
  pass("creao work item discovered", item.id);

  const claim = await relay("POST", `/v1/creao/work-items/${item.id}/claim`, agentKey);
  check("creao claims the work item", claim, 200);
  if (claim.json?.work_item?.status && claim.json.work_item.status !== "claimed") {
    throw new Error(`work item status is ${claim.json.work_item.status}`);
  }

  const evidence = await relay("GET", `/v1/creao/investigations/${exception.id}`, agentKey);
  check("creao reads evidence", evidence, 200);
  if (evidence.json?.evidence?.source !== "persisted_records") {
    throw new Error("evidence did not come from persisted records");
  }
  const evidenceInvoice = evidence.json.evidence.invoices?.[0];
  if (evidenceInvoice?.total_minor !== cleanTotal + 1000) {
    throw new Error("evidence does not show the overbilled invoice total");
  }
  const usageEvidence = evidence.json.evidence.verified_usage?.[0];
  pass(
    "evidence is persisted, not narrated",
    `invoice ${money(evidenceInvoice.total_minor)} · usage ${money(usageEvidence?.amount_minor ?? usageEvidence?.billing_amount_minor ?? 0)}`,
  );

  const findings = await relay("POST", `/v1/creao/investigations/${exception.id}/findings`, agentKey, {
    findings: `The manual 1000 minor surcharge has no matching verified usage or contract rate line; the verified charge is ${cleanTotal} minor.`,
    sources: [
      { type: "invoice", id: invoice.id },
      { type: "verified_usage", id: job.relay.usageId },
    ],
  });
  check("creao records evidence-backed findings", findings, 201);
  if (findings.json?.financial_exception?.status !== "investigating") {
    throw new Error(`exception status is ${findings.json?.financial_exception?.status}, expected investigating`);
  }

  // ── Elastic investigator: one attempt, expected to degrade ─
  // Quota-blocked is a known condition; do not retry it. The point is that a
  // failure cannot approve, correct or settle anything.
  const investigation = await relay("POST", `/v1/creao/investigations/${exception.id}/run`, agentKey, {});
  if (investigation.status === 200) {
    pass("elastic investigation returned", investigation.json?.investigation?.status ?? "completed");
  } else {
    check("elastic investigation degrades safely", investigation, [502, 503]);
  }
  const afterInvestigation = await relay("GET", `/v1/finance/exceptions/${exception.id}`, financeKey);
  if (afterInvestigation.json?.financial_exception?.status === "resolved") {
    throw new Error("a failed investigation resolved the exception; controls are broken");
  }
  pass("failure did not resolve or authorize anything", afterInvestigation.json?.financial_exception?.status);

  // ── Correction requires a human approval ───────────────────
  const correction = await relay("POST", `/v1/finance/exceptions/${exception.id}/propose-correction`, financeKey, {
    corrected_total_minor: cleanTotal,
    reason: "Remove the unsupported surcharge",
  });
  check("correction proposed", correction, 201);
  if (correction.json?.exception?.status !== "awaiting_approval") {
    throw new Error("correction did not enter awaiting_approval");
  }
  const correctionApprovalId = correction.json.approval.id as string;

  const selfApproval = await relay(
    "POST",
    `/v1/financial-approvals/${correctionApprovalId}/decision`,
    financeKey,
    { decision: "approved" },
  );
  check("finance cannot approve its own correction", selfApproval, [403, 409]);

  const humanApproval = await relay(
    "POST",
    `/v1/financial-approvals/${correctionApprovalId}/decision`,
    humanKey,
    { decision: "approved", note: "Verified against usage and contract" },
  );
  check("human approves the correction", humanApproval, 200);

  const corrected = await relay("GET", `/v1/invoices/${invoice.id}`, financeKey);
  if (corrected.json?.invoice?.total_minor !== cleanTotal) {
    throw new Error(`invoice total is ${corrected.json?.invoice?.total_minor}, expected ${cleanTotal}`);
  }
  const resolved = await relay("GET", `/v1/finance/exceptions/${exception.id}`, financeKey);
  if (resolved.json?.financial_exception?.status !== "resolved") {
    throw new Error(`exception is ${resolved.json?.financial_exception?.status}, expected resolved`);
  }
  pass("correction applied and exception resolved", money(cleanTotal));

  // ── Settlement only after resolution ───────────────────────
  const instructionRequest = await relay("POST", `/v1/invoices/${invoice.id}/payment-instruction`, financeKey, {
    chain: "base-sepolia",
    destination: "duo2-payment-rail",
  });
  check("payment allowed after resolution", instructionRequest, 202);
  const paymentApproval = await relay(
    "POST",
    `/v1/financial-approvals/${instructionRequest.json.approval.id}/decision`,
    humanKey,
    { decision: "approved", note: "Corrected invoice only" },
  );
  check("human approves the corrected payment", paymentApproval, 200);
  const instruction = paymentApproval.json.result.instruction;

  const settled = await duo2("POST", "/api/relay/pay", { instruction_id: instruction.id, job_id: jobId });
  check("settled after correction", settled, 200);
  if (settled.json.rail !== "x402" || settled.json.simulated !== false) {
    throw new Error(`expected real x402, got ${settled.json.rail} simulated=${settled.json.simulated}`);
  }
  pass("real x402 settlement", settled.json.transaction_id);

  const finalReconciliation = await relay("POST", "/v1/finance/reconciliations", financeKey);
  check("final reconciliation", finalReconciliation, 201);
  if ((finalReconciliation.json.exceptions ?? []).length !== 0) {
    throw new Error(`final reconciliation is not clean: ${JSON.stringify(finalReconciliation.json.exceptions)}`);
  }
  const balance = await relay("GET", "/v1/ledger/trial-balance", financeKey);
  if (balance.json?.balanced !== true) throw new Error("ledger does not balance");
  pass("ledger balanced", `${money(balance.json.total_debit_minor)} = ${money(balance.json.total_credit_minor)}`);

  const audit = await relay("GET", "/v1/audit?limit=400", agentKey);
  const actions: string[] = (audit.json?.audit_events ?? []).map((event: any) => event.action);
  for (const action of [
    "usage.verified",
    "invoice.issued",
    "financial_exception.correction_proposed",
    "financial_exception.correction_applied",
    "payment.settled",
  ]) {
    if (!actions.includes(action)) throw new Error(`audit is missing ${action}`);
  }
  const settlementEvent = (audit.json?.audit_events ?? []).find(
    (event: any) =>
      event.action === "payment.settled" && event.after_state?.transaction_id === settled.json.transaction_id,
  );
  if (!settlementEvent) throw new Error("audit does not name the settlement transaction");
  pass("audit trail complete", `${actions.length} events`);

  console.log("\nHOSTED CREAO: not exercised. This run proves the Relay-side workflow and controls.");
  console.log("  Required for hosted proof: public HTTPS Relay URL, CREAO agent configured with");
  console.log("  RELAY_API_BASE_URL + RELAY_API_KEY, 14/14 contract probe, and a CREAO run id with backend.is_mock=false.");

  console.log(
    "\nSUMMARY " +
      JSON.stringify(
        {
          run: runId,
          deal_id: deal.deal_id,
          job_id: jobId,
          contract_id: contractId,
          invoice_id: invoice.id,
          clean_total_minor: cleanTotal,
          overbilled_total_minor: cleanTotal + 1000,
          exception_id: exception.id,
          work_item_id: item.id,
          investigation_status: investigation.status,
          settlement_transaction: settled.json.transaction_id,
          balanced: balance.json.balanced,
          hosted_creao: "not_verified",
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
