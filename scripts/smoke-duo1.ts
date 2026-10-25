/**
 * End-to-end smoke test for a running Duo 1 deployment.
 *
 * Covers the whole internal loop against real infrastructure: solver deal
 * creation, four-party human approvals, handoff, execution authorization,
 * contracts, Duo 2 usage, invoicing, provider payables, a deliberate overbill,
 * reconciliation, a CREAO/Elastic investigation, correction, buyer payment,
 * provider payout, and the final balanced ledger.
 *
 * The PGlite suite proves the logic. This proves a deployed instance, its
 * database, its credentials, and (when configured) its Elastic layer actually
 * work together. Run it after every deployment or credential rotation.
 *
 *   npm run smoke -- https://api.example.com
 *
 * Keys come from the environment (see .env.example):
 *   RELAY_API_KEY             agent      deal search, handoff, authorization
 *   DUO1_FINANCE_API_KEY      finance    invoices, payables, reconciliation
 *   DUO2_WORKER_API_KEY       worker     usage, submit, settlement
 *   RELAY_HUMAN_API_KEY       human      Acme buyer approvals
 *   HUMAN_NORTHSTAR_API_KEY   human      Northstar approvals
 *   HUMAN_VERTEX_API_KEY      human      Vertex approvals
 *   HUMAN_BRIGHTLANE_API_KEY  human      Brightlane approvals
 */

import { randomUUID } from "node:crypto";

const PARTIES = {
  acme: "11111111-1111-4111-8111-111111111111",
  vertex: "22222222-2222-4222-8222-222222222222",
  northstar: "33333333-3333-4333-8333-333333333333",
  brightlane: "44444444-4444-4444-8444-444444444444",
} as const;

const HUMANS = {
  maya: "ffffffff-ffff-4fff-8fff-fffffffff001",
  omar: "ffffffff-ffff-4fff-8fff-fffffffff002",
  priya: "ffffffff-ffff-4fff-8fff-fffffffff003",
  daniel: "ffffffff-ffff-4fff-8fff-fffffffff004",
} as const;

const WORKLOADS = {
  acme: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  brightlane: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
} as const;

interface Account {
  key: string;
  humanUserId: string;
}

function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required for the smoke test.`);
}

function accounts(): Record<string, Account> {
  return {
    [PARTIES.acme]: { key: env("RELAY_HUMAN_API_KEY"), humanUserId: HUMANS.maya },
    [PARTIES.vertex]: { key: env("HUMAN_VERTEX_API_KEY"), humanUserId: HUMANS.omar },
    [PARTIES.northstar]: { key: env("HUMAN_NORTHSTAR_API_KEY"), humanUserId: HUMANS.priya },
    [PARTIES.brightlane]: {
      key: env("HUMAN_BRIGHTLANE_API_KEY"),
      humanUserId: HUMANS.daniel,
    },
  };
}

class Client {
  private readonly baseUrl: string;
  private readonly runId: string;
  private step = 0;

  constructor(baseUrl: string, runId: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.runId = runId;
  }

  key(label: string): string {
    return `${this.runId}-${label}-${this.step++}`;
  }

  async call(
    method: "GET" | "POST",
    path: string,
    options: { key?: string; body?: unknown; idempotent?: boolean } = {},
  ): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-relay-contract": "relay-duo1.v1",
    };
    if (options.key) headers.authorization = `Bearer ${options.key}`;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotent) headers["idempotency-key"] = this.key(path.replace(/\W+/g, "-"));

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${method} ${path} failed before a response: ${message}`);
    }
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: response.status, json };
  }
}

function pass(label: string, detail = ""): void {
  console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label: string, detail: unknown): never {
  const body = typeof detail === "string" ? detail : JSON.stringify(detail);
  throw new Error(`${label}: ${body}`);
}

function expect(
  label: string,
  result: { status: number; json: any },
  allowed: number | number[],
  detail?: string,
): void {
  const codes = Array.isArray(allowed) ? allowed : [allowed];
  if (!codes.includes(result.status)) fail(label, { status: result.status, body: result.json });
  pass(label, detail ?? `HTTP ${result.status}`);
}

function money(value: number): string {
  return `${(value / 100).toFixed(2)} USD`;
}

async function main(): Promise<void> {
  const baseUrl = (process.argv[2] ?? process.env.DUO1_BASE_URL ?? "http://127.0.0.1:4000").trim();
  const runId = `smoke-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const client = new Client(baseUrl, runId);
  const humanFor = accounts();
  const agentKey = env("RELAY_API_KEY");
  const financeKey = env("DUO1_FINANCE_API_KEY");
  const workerKey = env("DUO2_WORKER_API_KEY");

  console.log(`Duo 1 smoke test against ${baseUrl} (run ${runId})\n`);

  const health = await client.call("GET", "/v1/health");
  expect("health", health, 200);
  if (health.json?.database !== "ok") fail("health: database", health.json);
  pass("database ready", health.json.database);

  // Acme's batch-inference job is the seeded workload that has a feasible
  // direct offer once real mirrored prices are used as the baseline. The
  // Brightlane fine-tuning exchange is covered by unit tests; it is correctly
  // rejected here when the live market makes its transfer price uneconomic.
  const search = await client.call("POST", "/v1/deals/search", {
    key: agentKey,
    idempotent: true,
    body: { workload_id: WORKLOADS.acme },
  });
  expect("POST /v1/deals/search", search, [200, 201]);
  const deal = search.json?.deal;
  if (!deal) {
    if (search.json?.status === "no_feasible_deal") {
      fail(
        "deal search produced no deal",
        `${JSON.stringify(search.json.rejected)} — demo capacity is probably reserved by an earlier run; this smoke test expects a freshly seeded demo database`,
      );
    }
    fail("deal search produced no deal", search.json);
  }
  pass("deal created", `${deal.deal_id} — ${deal.proposal?.title ?? "untitled"}`);

  const approvals = deal.approval_requests ?? deal.proposal?.approval_requests ?? [];
  if (approvals.length === 0) fail("deal has no approval requests", deal);
  for (const request of approvals) {
    const account = humanFor[request.participant.id];
    if (!account) fail("no human account for participant", request.participant);
    const approval = await client.call("POST", "/v1/approvals", {
      key: account.key,
      idempotent: true,
      body: {
        request_id: request.id,
        decision: "approved",
        attested_by: account.humanUserId,
      },
    });
    expect(`approve ${request.participant.name}`, approval, 201, money(request.amount_minor));
  }

  const handoff = await client.call("POST", `/v1/deals/${deal.deal_id}/handoff`, {
    key: agentKey,
    idempotent: true,
  });
  expect("handoff", handoff, 200);

  const authorization = await client.call(
    "POST",
    `/v1/deals/${deal.deal_id}/execution-authorizations`,
    { key: agentKey, idempotent: true },
  );
  expect("execution authorization", authorization, 201);
  const auth = authorization.json.authorization;
  const contracts: Array<{ id: string; buyer_id: string; provider_id: string }> =
    auth.contracts ?? [];
  if (contracts.length < 1) fail("authorization created no contracts", auth);
  pass("contracts created", contracts.map((contract) => contract.id).join(", "));

  const invoices: Array<{ id: string; contract_id: string; total_minor: number }> = [];
  const usages: Record<string, { id: string; amount_minor: number }> = {};
  for (const contract of contracts) {
    const usage = await client.call("POST", "/internal/v1/duo2/usage", {
      key: workerKey,
      idempotent: true,
      body: {
        contract_id: contract.id,
        authorization_id: auth.id,
        gpu_seconds: 8 * 10 * 3600,
        started_at: new Date(Date.now() - 11 * 3600_000).toISOString(),
        ended_at: new Date(Date.now() - 3600_000).toISOString(),
        job_id: `${runId}-${contract.id.slice(0, 8)}`,
        worker_id: "duo2-smoke-worker",
        proof_reference: `proof:${runId}:${contract.id}`,
        evidence: { measured: true, source: "duo2_runtime" },
      },
    });
    expect(`usage ${contract.id.slice(0, 8)}`, usage, 201);
    usages[contract.id] = {
      id: usage.json.verified_usage.id,
      amount_minor: usage.json.verified_usage.billing.amount_minor,
    };

    const invoice = await client.call("POST", `/v1/contracts/${contract.id}/invoices`, {
      key: financeKey,
      idempotent: true,
    });
    expect(`invoice ${contract.id.slice(0, 8)}`, invoice, 201);
    invoices.push({
      id: invoice.json.invoice.id,
      contract_id: contract.id,
      total_minor: invoice.json.invoice.total_minor,
    });
  }

  const payables = await client.call("GET", "/v1/provider-payables", { key: financeKey });
  expect("provider payables", payables, 200);
  if (!Array.isArray(payables.json.payables) || payables.json.payables.length === 0) {
    fail("no provider payables accrued", payables.json);
  }
  pass("payables accrued", `${payables.json.payables.length} payable(s)`);

  const cleanRun = await client.call("POST", "/v1/finance/reconciliations", {
    key: financeKey,
    idempotent: true,
  });
  expect("reconciliation (clean)", cleanRun, 201);
  if ((cleanRun.json.exceptions ?? []).length !== 0) {
    fail("clean reconciliation reported exceptions", cleanRun.json.exceptions);
  }

  // Deliberate discrepancy so the investigation path runs against live data.
  const target = invoices.find((invoice) => invoice.contract_id) ?? invoices[0]!;
  const usage = usages[target.contract_id]!;
  const overbill = await client.call("POST", `/v1/invoices/${target.id}/lines`, {
    key: financeKey,
    idempotent: true,
    body: {
      description: "Smoke-test discrepancy line",
      quantity: 1,
      unit_rate_minor: 1_000,
      amount_minor: 1_000,
      reason: "Deliberate overbilling to exercise investigation and correction",
    },
  });
  expect("overbill line added", overbill, 201, money(1_000));

  const dirtyRun = await client.call("POST", "/v1/finance/reconciliations", {
    key: financeKey,
    idempotent: true,
  });
  expect("reconciliation (discrepancy)", dirtyRun, 201);
  const exception = (dirtyRun.json.exceptions ?? [])[0];
  if (!exception) fail("reconciliation did not raise the expected exception", dirtyRun.json);
  pass("exception raised", `${exception.kind} ${exception.id}`);

  const blocked = await client.call("POST", `/v1/invoices/${target.id}/payment-instruction`, {
    key: financeKey,
    idempotent: true,
    body: { chain: "solana-devnet", destination: "duo2-smoke-wallet" },
  });
  expect("payment blocked while exception open", blocked, 409);
  if (blocked.json?.code !== "payment_blocked") fail("wrong block code", blocked.json);

  const investigation = await client.call(
    "POST",
    `/v1/creao/investigations/${exception.id}/run`,
    { key: agentKey, idempotent: true },
  );
  if (
    investigation.status === 503 &&
    ["elastic_not_configured", "elastic_rate_limited"].includes(investigation.json?.code)
  ) {
    // A deployment without Elastic, or one whose provider quota is exhausted, is
    // a supported degraded mode: the exception must stay open and unchanged.
    const stillOpen = await client.call("GET", `/v1/finance/exceptions/${exception.id}`, {
      key: financeKey,
    });
    expect("exception still open after investigation failure", stillOpen, 200);
    const status = stillOpen.json?.financial_exception?.status ?? stillOpen.json?.status;
    if (status !== "open") fail("investigation failure changed the exception", stillOpen.json);
    pass("Elastic investigation", `skipped — ${investigation.json.code}, exception unchanged`);
  } else {
    expect("Elastic investigation", investigation, 200);
    const run = investigation.json.investigation ?? investigation.json;
    pass(
      "Elastic investigation",
      `${run.status ?? "recorded"} — ${run.findings?.length ?? 0} finding(s)`,
    );
  }

  const correction = await client.call(
    "POST",
    `/v1/finance/exceptions/${exception.id}/propose-correction`,
    {
      key: financeKey,
      idempotent: true,
      body: { corrected_total_minor: usage.amount_minor, reason: "Remove smoke-test surcharge" },
    },
  );
  expect("propose correction", correction, 201);

  const correctionApproval = await client.call(
    "POST",
    `/v1/financial-approvals/${correction.json.approval.id}/decision`,
    {
      key: env("RELAY_HUMAN_API_KEY"),
      idempotent: true,
      body: { decision: "approved", note: "Verified against usage and contract" },
    },
  );
  expect("human approves correction", correctionApproval, 200);

  const paymentRequest = await client.call(
    "POST",
    `/v1/invoices/${target.id}/payment-instruction`,
    {
      key: financeKey,
      idempotent: true,
      body: { chain: "solana-devnet", destination: "duo2-smoke-wallet" },
    },
  );
  expect("buyer payment requested", paymentRequest, 202);
  if (paymentRequest.json?.status !== "approval_required") {
    fail("payment instruction was not gated on approval", paymentRequest.json);
  }

  const paymentApproval = await client.call(
    "POST",
    `/v1/financial-approvals/${paymentRequest.json.approval.id}/decision`,
    {
      key: env("RELAY_HUMAN_API_KEY"),
      idempotent: true,
      body: { decision: "approved", note: "Smoke-test settlement" },
    },
  );
  expect("human approves payment", paymentApproval, 200);
  const instruction = paymentApproval.json.result.instruction;

  const submit = await client.call(
    "POST",
    `/internal/v1/duo2/payment-instructions/${instruction.id}/submit`,
    { key: workerKey, idempotent: true },
  );
  expect("Duo 2 submits payment", submit, 200);

  const settlement = await client.call("POST", "/internal/v1/duo2/settlements", {
    key: workerKey,
    idempotent: true,
    body: {
      instruction_id: instruction.id,
      status: "confirmed",
      amount_minor: instruction.amount_minor,
      transaction_id: `${runId}-signature`,
      provider_reference: `solana:test:${runId}`,
      raw: { cluster: "devnet", simulated_value: true },
    },
  });
  expect("Duo 2 confirms settlement", settlement, 200);
  if (settlement.json?.invoice_status !== "paid") {
    fail("invoice is not paid after settlement", settlement.json);
  }

  // Provider payout round trip on the first accrued payable.
  const payable = payables.json.payables[0];
  const payoutRequest = await client.call(
    "POST",
    `/v1/provider-payables/${payable.id}/payout-instruction`,
    {
      key: financeKey,
      idempotent: true,
      body: { chain: "solana-devnet", destination: "provider-smoke-wallet" },
    },
  );
  expect("provider payout requested", payoutRequest, 202);

  const payoutApproval = await client.call(
    "POST",
    `/v1/financial-approvals/${payoutRequest.json.approval.id}/decision`,
    {
      key: env("RELAY_HUMAN_API_KEY"),
      idempotent: true,
      body: { decision: "approved" },
    },
  );
  expect("human approves payout", payoutApproval, 200);
  const payout = payoutApproval.json.result.instruction;

  const payoutSubmit = await client.call(
    "POST",
    `/internal/v1/duo2/provider-payout-instructions/${payout.id}/submit`,
    { key: workerKey, idempotent: true },
  );
  expect("Duo 2 submits payout", payoutSubmit, 200);

  const payoutSettlement = await client.call("POST", "/internal/v1/duo2/provider-settlements", {
    key: workerKey,
    idempotent: true,
    body: {
      instruction_id: payout.id,
      status: "confirmed",
      amount_minor: payout.amount_minor,
      transaction_id: `${runId}-payout-signature`,
      provider_reference: `solana:test:payout:${runId}`,
      raw: { cluster: "devnet", simulated_value: true },
    },
  });
  expect("Duo 2 confirms payout", payoutSettlement, 200);
  pass("payable status", payoutSettlement.json?.payable_status ?? "unknown");

  const finalRun = await client.call("POST", "/v1/finance/reconciliations", {
    key: financeKey,
    idempotent: true,
  });
  expect("reconciliation (final)", finalRun, 201);
  if ((finalRun.json.exceptions ?? []).length !== 0) {
    fail("final reconciliation is not clean", finalRun.json.exceptions);
  }

  const balance = await client.call("GET", "/v1/ledger/trial-balance", { key: financeKey });
  expect("trial balance", balance, 200);
  if (balance.json.balanced !== true) fail("ledger does not balance", balance.json);
  pass(
    "ledger balanced",
    `debit ${money(balance.json.total_debit_minor)} = credit ${money(balance.json.total_credit_minor)}`,
  );

  const audit = await client.call("GET", "/v1/audit?limit=300", { key: agentKey });
  expect("audit trail", audit, 200);
  const actions: string[] = (audit.json.audit_events ?? []).map(
    (event: { action: string }) => event.action,
  );
  for (const expected of [
    "execution.authorized",
    "usage.verified",
    "invoice.issued",
    "reconciliation.completed",
    "financial_exception.correction_applied",
    "payment.instruction_created",
    "payment.settled",
    "provider_payout.settled",
  ]) {
    if (!actions.includes(expected)) fail(`audit is missing ${expected}`, actions.slice(0, 20));
  }
  pass("audit trail complete", `${actions.length} events`);

  console.log(
    "\nSUMMARY " +
      JSON.stringify(
        {
          run: runId,
          base_url: baseUrl,
          deal_id: deal.deal_id,
          contracts: contracts.length,
          invoices: invoices.length,
          exception_id: exception.id,
          investigation: investigation.status,
          invoice_total_minor: usage.amount_minor,
          settlement: "confirmed",
          payout: payoutSettlement.json?.payable_status ?? null,
          balanced: balance.json.balanced,
        },
        null,
        2,
      ),
  );
}

main().catch((error) => {
  console.error(`\nFAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
