import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_IDS } from "../src/db/seed-demo.js";
import { createTestContext, TEST_HUMANS, TEST_KEYS } from "./helpers/app.js";

type Context = Awaited<ReturnType<typeof createTestContext>>;

const ACCOUNT_FOR_PARTY: Record<string, { key: string; attested: string }> = {
  [DEMO_IDS.parties.acme]: { key: TEST_KEYS.acme, attested: TEST_HUMANS.acme.userId },
  [DEMO_IDS.parties.brightlane]: { key: TEST_KEYS.brightlane, attested: TEST_HUMANS.brightlane.userId },
  [DEMO_IDS.parties.vertex]: { key: TEST_KEYS.vertex, attested: TEST_HUMANS.vertex.userId },
  [DEMO_IDS.parties.northstar]: { key: TEST_KEYS.northstar, attested: TEST_HUMANS.northstar.userId },
};

async function createApprovedExecution(context: Context, suffix: string) {
  const search = await context.app.inject({
    method: "POST",
    url: "/v1/deals/search",
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: `search-${suffix}` }),
    payload: { workload_id: DEMO_IDS.workloads.brightlane },
  });
  assert.equal(search.statusCode, 201, search.body);
  const deal = search.json().deal;

  for (const [index, request] of deal.approval_requests.entries()) {
    const account = ACCOUNT_FOR_PARTY[request.participant.id];
    assert.ok(account, `missing account for ${request.participant.id}`);
    const approval = await context.app.inject({
      method: "POST",
      url: "/v1/approvals",
      headers: context.headers(account.key, { idempotencyKey: `approve-${suffix}-${index}` }),
      payload: {
        request_id: request.id,
        decision: "approved",
        attested_by: account.attested,
      },
    });
    assert.equal(approval.statusCode, 201, approval.body);
  }

  const handoff = await context.app.inject({
    method: "POST",
    url: `/v1/deals/${deal.deal_id}/handoff`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: `handoff-${suffix}` }),
  });
  assert.equal(handoff.statusCode, 200, handoff.body);

  const authorization = await context.app.inject({
    method: "POST",
    url: `/v1/deals/${deal.deal_id}/execution-authorizations`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: `auth-${suffix}` }),
  });
  assert.equal(authorization.statusCode, 201, authorization.body);
  const auth = authorization.json().authorization;
  assert.equal(auth.status, "active");
  assert.equal(auth.contracts.length, 2);
  return { deal, auth };
}

async function recordUsage(
  context: Context,
  contractId: string,
  authorizationId: string,
  suffix: string,
) {
  const response = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/usage",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: `usage-${suffix}` }),
    payload: {
      contract_id: contractId,
      authorization_id: authorizationId,
      gpu_seconds: 8 * 10 * 3600,
      started_at: new Date(Date.now() - 11 * 3600_000).toISOString(),
      ended_at: new Date(Date.now() - 3600_000).toISOString(),
      job_id: `job-${suffix}`,
      worker_id: "duo2-worker-1",
      proof_reference: `proof-${suffix}`,
      evidence: { measured: true, source: "duo2_runtime" },
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().verified_usage;
}

test("verified usage becomes invoices, payables, and a balanced ledger", async (t) => {
  const context = await createTestContext();
  t.after(async () => context.app.close());
  const { auth } = await createApprovedExecution(context, "basic");

  const invoiceTotals = new Map<string, number>();
  for (const [index, contract] of auth.contracts.entries()) {
    const usage = await recordUsage(context, contract.id, auth.id, `basic-${index}`);
    assert.equal(usage.billing.amount_minor, index === 0 ? 18000 : 12800);
    const invoice = await context.app.inject({
      method: "POST",
      url: `/v1/contracts/${contract.id}/invoices`,
      headers: context.headers(TEST_KEYS.finance, { idempotencyKey: `invoice-basic-${index}` }),
    });
    assert.equal(invoice.statusCode, 201, invoice.body);
    invoiceTotals.set(contract.id, invoice.json().invoice.total_minor);
  }
  assert.deepEqual([...invoiceTotals.values()].sort((a, b) => a - b), [14300, 18000]);

  const payables = await context.app.inject({
    method: "GET",
    url: "/v1/provider-payables",
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(payables.statusCode, 200, payables.body);
  assert.equal(payables.json().payables.length, 2);
  assert.ok(payables.json().payables.every((payable: { status: string }) => payable.status === "accrued"));

  const reconciliation = await context.app.inject({
    method: "POST",
    url: "/v1/finance/reconciliations",
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "reconcile-basic" }),
  });
  assert.equal(reconciliation.statusCode, 201, reconciliation.body);
  assert.equal(reconciliation.json().exceptions.length, 0, reconciliation.body);

  const balance = await context.app.inject({
    method: "GET",
    url: "/v1/ledger/trial-balance",
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(balance.statusCode, 200, balance.body);
  assert.equal(balance.json().balanced, true, balance.body);
  assert.equal(balance.json().total_debit_minor, balance.json().total_credit_minor);

  const entries = await context.app.inject({
    method: "GET",
    url: "/v1/ledger/entries",
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(entries.statusCode, 200, entries.body);
  assert.ok(
    entries.json().entries.every(
      (entry: { imbalance_minor: number; total_debit_minor: number; total_credit_minor: number }) =>
        entry.imbalance_minor === 0 && entry.total_debit_minor === entry.total_credit_minor,
    ),
  );
});

test("provider payable is authorized, paid through Duo 2, and reconciled", async (t) => {
  const context = await createTestContext();
  t.after(async () => context.app.close());
  const { auth } = await createApprovedExecution(context, "payout");
  const contract = auth.contracts.find(
    (candidate: { buyer_id: string }) => candidate.buyer_id === DEMO_IDS.parties.brightlane,
  );
  assert.ok(contract);
  await recordUsage(context, contract.id, auth.id, "payout-usage");
  const invoice = await context.app.inject({
    method: "POST",
    url: `/v1/contracts/${contract.id}/invoices`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payout-invoice" }),
  });
  assert.equal(invoice.statusCode, 201, invoice.body);

  const payables = await context.app.inject({
    method: "GET",
    url: `/v1/provider-payables?contract_id=${contract.id}`,
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(payables.statusCode, 200, payables.body);
  assert.equal(payables.json().payables.length, 1);
  const payable = payables.json().payables[0];
  assert.equal(payable.status, "accrued");
  assert.equal(payable.paid_minor, 0);
  assert.ok(payable.amount_minor > 0);

  const agentAttempt = await context.app.inject({
    method: "POST",
    url: `/v1/provider-payables/${payable.id}/payout-instruction`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "payout-agent-attempt" }),
    payload: { chain: "solana-devnet" },
  });
  assert.equal(agentAttempt.statusCode, 403, agentAttempt.body);

  const firstAmount = Math.floor(payable.amount_minor / 2);
  const request = await context.app.inject({
    method: "POST",
    url: `/v1/provider-payables/${payable.id}/payout-instruction`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payout-request-1" }),
    payload: {
      amount_minor: firstAmount,
      chain: "solana-devnet",
      destination: "provider-payout-wallet",
    },
  });
  assert.equal(request.statusCode, 202, request.body);
  const approval = request.json().approval;
  assert.equal(approval.object_type, "provider_payable");

  const decision = await context.app.inject({
    method: "POST",
    url: `/v1/financial-approvals/${approval.id}/decision`,
    headers: context.headers(TEST_KEYS.acme, { idempotencyKey: "payout-approve-1" }),
    payload: { decision: "approved" },
  });
  assert.equal(decision.statusCode, 200, decision.body);
  assert.equal(decision.json().result.type, "provider_payout_instruction");
  const firstInstruction = decision.json().result.instruction;
  assert.equal(firstInstruction.amount_minor, firstAmount);

  const premature = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/provider-settlements",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "payout-settle-premature" }),
    payload: {
      instruction_id: firstInstruction.id,
      status: "confirmed",
      amount_minor: firstAmount,
      transaction_id: "provider-payout-premature",
      provider_reference: "solana:test:provider-payout-premature",
    },
  });
  assert.equal(premature.statusCode, 409, premature.body);
  assert.equal(premature.json().code, "provider_payout_not_submitted");

  const submit = await context.app.inject({
    method: "POST",
    url: `/internal/v1/duo2/provider-payout-instructions/${firstInstruction.id}/submit`,
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "payout-submit-1" }),
  });
  assert.equal(submit.statusCode, 200, submit.body);

  const settled = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/provider-settlements",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "payout-settle-1" }),
    payload: {
      instruction_id: firstInstruction.id,
      status: "confirmed",
      amount_minor: firstAmount,
      transaction_id: "provider-payout-test-1",
      provider_reference: "solana:test:provider-payout-1",
      raw: { cluster: "devnet" },
    },
  });
  assert.equal(settled.statusCode, 200, settled.body);
  assert.equal(settled.json().payable_status, "partially_paid");
  assert.equal(settled.json().paid_minor, firstAmount);

  const afterFirst = await context.app.inject({
    method: "GET",
    url: `/v1/provider-payables/${payable.id}`,
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(afterFirst.statusCode, 200, afterFirst.body);
  assert.equal(afterFirst.json().payable.paid_minor, firstAmount);
  assert.equal(afterFirst.json().payable.outstanding_minor, payable.amount_minor - firstAmount);

  const secondRequest = await context.app.inject({
    method: "POST",
    url: `/v1/provider-payables/${payable.id}/payout-instruction`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payout-request-2" }),
    payload: { chain: "solana-devnet", destination: "provider-payout-wallet" },
  });
  assert.equal(secondRequest.statusCode, 202, secondRequest.body);
  const secondApproval = secondRequest.json().approval;
  const secondDecision = await context.app.inject({
    method: "POST",
    url: `/v1/financial-approvals/${secondApproval.id}/decision`,
    headers: context.headers(TEST_KEYS.acme, { idempotencyKey: "payout-approve-2" }),
    payload: { decision: "approved" },
  });
  assert.equal(secondDecision.statusCode, 200, secondDecision.body);
  const secondInstruction = secondDecision.json().result.instruction;
  assert.equal(secondInstruction.amount_minor, payable.amount_minor - firstAmount);

  const submitSecond = await context.app.inject({
    method: "POST",
    url: `/internal/v1/duo2/provider-payout-instructions/${secondInstruction.id}/submit`,
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "payout-submit-2" }),
  });
  assert.equal(submitSecond.statusCode, 200, submitSecond.body);
  const settledSecond = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/provider-settlements",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "payout-settle-2" }),
    payload: {
      instruction_id: secondInstruction.id,
      status: "confirmed",
      amount_minor: payable.amount_minor - firstAmount,
      transaction_id: "provider-payout-test-2",
      provider_reference: "solana:test:provider-payout-2",
      raw: { cluster: "devnet" },
    },
  });
  assert.equal(settledSecond.statusCode, 200, settledSecond.body);
  assert.equal(settledSecond.json().payable_status, "paid");
  assert.equal(settledSecond.json().outstanding_minor, 0);

  const reconciliation = await context.app.inject({
    method: "POST",
    url: "/v1/finance/reconciliations",
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payout-reconcile" }),
  });
  assert.equal(reconciliation.statusCode, 201, reconciliation.body);
  assert.equal(reconciliation.json().exceptions.length, 0, reconciliation.body);
  assert.ok(reconciliation.json().summary.provider_payables_checked >= 1);
  assert.ok(reconciliation.json().summary.provider_payouts_checked >= 2);

  const trial = await context.app.inject({
    method: "GET",
    url: "/v1/ledger/trial-balance",
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(trial.statusCode, 200, trial.body);
  assert.equal(trial.json().balanced, true);

  const payoutEntries = await context.app.inject({
    method: "GET",
    url: "/v1/ledger/entries?source_type=provider_payout&limit=10",
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(payoutEntries.statusCode, 200, payoutEntries.body);
  assert.equal(payoutEntries.json().entries.length, 2);
  assert.ok(
    payoutEntries.json().entries.every(
      (entry: { imbalance_minor: number }) => entry.imbalance_minor === 0,
    ),
  );
});

test("a failed provider payout blocks retry until the exception is cleared", async (t) => {
  const context = await createTestContext();
  t.after(async () => context.app.close());
  const { auth } = await createApprovedExecution(context, "payout-failure");
  const contract = auth.contracts.find(
    (candidate: { buyer_id: string }) => candidate.buyer_id === DEMO_IDS.parties.brightlane,
  );
  assert.ok(contract);
  await recordUsage(context, contract.id, auth.id, "payout-failure-usage");
  await context.app.inject({
    method: "POST",
    url: `/v1/contracts/${contract.id}/invoices`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payout-failure-invoice" }),
  });
  const payables = await context.app.inject({
    method: "GET",
    url: `/v1/provider-payables?contract_id=${contract.id}`,
    headers: context.headers(TEST_KEYS.finance),
  });
  const payable = payables.json().payables[0];

  const request = await context.app.inject({
    method: "POST",
    url: `/v1/provider-payables/${payable.id}/payout-instruction`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payout-failure-request" }),
    payload: { chain: "solana-devnet", destination: "provider-payout-wallet" },
  });
  assert.equal(request.statusCode, 202, request.body);
  const decision = await context.app.inject({
    method: "POST",
    url: `/v1/financial-approvals/${request.json().approval.id}/decision`,
    headers: context.headers(TEST_KEYS.acme, { idempotencyKey: "payout-failure-approve" }),
    payload: { decision: "approved" },
  });
  assert.equal(decision.statusCode, 200, decision.body);
  const instruction = decision.json().result.instruction;
  await context.app.inject({
    method: "POST",
    url: `/internal/v1/duo2/provider-payout-instructions/${instruction.id}/submit`,
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "payout-failure-submit" }),
  });

  const failed = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/provider-settlements",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "payout-failure-settle" }),
    payload: {
      instruction_id: instruction.id,
      status: "failed",
      amount_minor: payable.amount_minor,
      transaction_id: "provider-payout-failed-test",
      provider_reference: "solana:test:provider-payout-failed",
      failure_code: "rpc_timeout",
      failure_message: "Devnet RPC timed out before provider confirmation.",
      raw: { cluster: "devnet" },
    },
  });
  assert.equal(failed.statusCode, 200, failed.body);
  assert.equal(failed.json().provider_payout_instruction.status, "failed");

  const exceptions = await context.app.inject({
    method: "GET",
    url: "/v1/finance/exceptions?status=open&kind=provider_payout_failed",
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(exceptions.statusCode, 200, exceptions.body);
  assert.equal(exceptions.json().financial_exceptions.length, 1);
  const exceptionId = exceptions.json().financial_exceptions[0].id;

  const blocked = await context.app.inject({
    method: "POST",
    url: `/v1/provider-payout-instructions/${instruction.id}/retry`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payout-failure-retry-blocked" }),
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json().code, "provider_payout_blocked");

  const dismissed = await context.app.inject({
    method: "POST",
    url: `/v1/finance/exceptions/${exceptionId}/dismiss`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payout-failure-dismiss" }),
    payload: { reason: "Transient RPC timeout; provider confirmed no debit." },
  });
  assert.equal(dismissed.statusCode, 200, dismissed.body);

  const retry = await context.app.inject({
    method: "POST",
    url: `/v1/provider-payout-instructions/${instruction.id}/retry`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payout-failure-retry" }),
  });
  assert.equal(retry.statusCode, 201, retry.body);
  const replacement = retry.json().provider_payout_instruction;
  assert.notEqual(replacement.id, instruction.id);
  assert.equal(replacement.amount_minor, payable.amount_minor);

  await context.app.inject({
    method: "POST",
    url: `/internal/v1/duo2/provider-payout-instructions/${replacement.id}/submit`,
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "payout-failure-retry-submit" }),
  });
  const recovered = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/provider-settlements",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "payout-failure-retry-settle" }),
    payload: {
      instruction_id: replacement.id,
      status: "confirmed",
      amount_minor: payable.amount_minor,
      transaction_id: "provider-payout-recovered-test",
      provider_reference: "solana:test:provider-payout-recovered",
      raw: { cluster: "devnet" },
    },
  });
  assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal(recovered.json().payable_status, "paid");

  const audit = await context.app.inject({
    method: "GET",
    url: "/v1/audit?limit=300",
    headers: context.headers(TEST_KEYS.agent),
  });
  const actions = audit.json().audit_events.map((event: { action: string }) => event.action);
  assert.ok(actions.includes("provider_payout.settlement_failed"));
  assert.ok(actions.includes("provider_payout.instruction_retried"));
  assert.ok(actions.includes("provider_payout.settled"));
});

test("duplicate invoices are detected separately from the usage charge", async (t) => {
  const context = await createTestContext();
  t.after(async () => context.app.close());
  const { auth } = await createApprovedExecution(context, "duplicate");
  const contract = auth.contracts.find(
    (candidate: { buyer_id: string }) => candidate.buyer_id === DEMO_IDS.parties.brightlane,
  );
  await recordUsage(context, contract.id, auth.id, "duplicate-usage");
  const first = await context.app.inject({
    method: "POST",
    url: `/v1/contracts/${contract.id}/invoices`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "duplicate-first-invoice" }),
  });
  assert.equal(first.statusCode, 201, first.body);
  const original = first.json().invoice;

  const duplicate = await context.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "duplicate-second-invoice" }),
    payload: {
      contract_id: contract.id,
      source: "external",
      duplicate_of: original.id,
      lines: [
        {
          description: "External system re-sent the same invoice",
          quantity: 1,
          unit_rate_minor: 18000,
          amount_minor: 18000,
        },
      ],
      metadata: { injected_scenario: "duplicate_invoice" },
    },
  });
  assert.equal(duplicate.statusCode, 201, duplicate.body);
  assert.notEqual(duplicate.json().invoice.id, original.id);

  const reconciliation = await context.app.inject({
    method: "POST",
    url: "/v1/finance/reconciliations",
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "reconcile-duplicate" }),
  });
  assert.equal(reconciliation.statusCode, 201, reconciliation.body);
  const kinds = reconciliation.json().exceptions.map((exception: { kind: string }) => exception.kind);
  assert.ok(kinds.includes("duplicate_invoice"), reconciliation.body);
  assert.ok(kinds.includes("invoice_overbilled"), reconciliation.body);

  const blocked = await context.app.inject({
    method: "POST",
    url: `/v1/invoices/${original.id}/payment-instruction`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "duplicate-payment-block" }),
    payload: { chain: "solana-devnet", destination: "duo2-test-wallet" },
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json().code, "payment_blocked");
});

test("overbilling is investigated, corrected on approval, and settled with a balanced audit trail", async (t) => {
  const context = await createTestContext();
  t.after(async () => context.app.close());
  const { auth, deal } = await createApprovedExecution(context, "full");

  const brightlaneContract = auth.contracts.find(
    (contract: { buyer_id: string }) => contract.buyer_id === DEMO_IDS.parties.brightlane,
  );
  assert.ok(brightlaneContract);
  const usage = await recordUsage(context, brightlaneContract.id, auth.id, "full-brightlane");
  assert.equal(usage.billing.amount_minor, 18000);

  const invoiceResponse = await context.app.inject({
    method: "POST",
    url: `/v1/contracts/${brightlaneContract.id}/invoices`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "invoice-full-brightlane" }),
  });
  assert.equal(invoiceResponse.statusCode, 201, invoiceResponse.body);
  const invoice = invoiceResponse.json().invoice;
  assert.equal(invoice.total_minor, 18000);

  const overbill = await context.app.inject({
    method: "POST",
    url: `/v1/invoices/${invoice.id}/lines`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "overbill-line" }),
    payload: {
      description: "Duplicate capacity surcharge (deliberate discrepancy)",
      quantity: 1,
      unit_rate_minor: 1000,
      amount_minor: 1000,
      reason: "Deliberately introduced overbilling for the demo scenario",
    },
  });
  assert.equal(overbill.statusCode, 201, overbill.body);
  assert.equal(overbill.json().invoice.total_minor, 19000);

  const reconciliation = await context.app.inject({
    method: "POST",
    url: "/v1/finance/reconciliations",
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "reconcile-overbill" }),
  });
  assert.equal(reconciliation.statusCode, 201, reconciliation.body);
  const exceptions = reconciliation.json().exceptions;
  assert.equal(exceptions.length, 1, reconciliation.body);
  assert.equal(exceptions[0].kind, "invoice_overbilled");
  assert.equal(exceptions[0].evidence.difference_minor, 1000);
  const exceptionId = exceptions[0].id;

  const blocked = await context.app.inject({
    method: "POST",
    url: `/v1/invoices/${invoice.id}/payment-instruction`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "blocked-payment" }),
    payload: { chain: "solana-devnet", destination: "test-settlement-account" },
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json().code, "payment_blocked");
  assert.ok(
    blocked.json().violations.includes(`financial_exception:invoice_overbilled:${exceptionId}`),
  );

  const workItems = await context.app.inject({
    method: "GET",
    url: `/v1/creao/work-items?status=pending&kind=financial_exception`,
    headers: context.headers(TEST_KEYS.agent),
  });
  assert.equal(workItems.statusCode, 200, workItems.body);
  const workItem = workItems
    .json()
    .work_items.find((item: { payload: { exception_id: string } }) => item.payload.exception_id === exceptionId);
  assert.ok(workItem);

  const claim = await context.app.inject({
    method: "POST",
    url: `/v1/creao/work-items/${workItem.id}/claim`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "claim-exception" }),
  });
  assert.equal(claim.statusCode, 200, claim.body);

  const evidence = await context.app.inject({
    method: "GET",
    url: `/v1/creao/investigations/${exceptionId}`,
    headers: context.headers(TEST_KEYS.agent),
  });
  assert.equal(evidence.statusCode, 200, evidence.body);
  assert.equal(evidence.json().evidence.verified_usage[0].amount_minor, 18000);
  assert.equal(evidence.json().evidence.source, "persisted_records");
  assert.equal(evidence.json().evidence.invoices[0].id, invoice.id);
  assert.equal(evidence.json().evidence.invoices[0].total_minor, 19000);

  const findings = await context.app.inject({
    method: "POST",
    url: `/v1/creao/investigations/${exceptionId}/findings`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "findings-exception" }),
    payload: {
      findings:
        "The manual 1000 minor surcharge has no matching verified usage or contract rate line; the verified charge is 18000 minor.",
      sources: [{ type: "invoice", id: invoice.id }, { type: "verified_usage", id: usage.id }],
    },
  });
  assert.equal(findings.statusCode, 201, findings.body);
  assert.equal(findings.json().financial_exception.status, "investigating");

  const correction = await context.app.inject({
    method: "POST",
    url: `/v1/finance/exceptions/${exceptionId}/propose-correction`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "propose-correction" }),
    payload: { corrected_total_minor: 18000, reason: "Remove unsupported surcharge" },
  });
  assert.equal(correction.statusCode, 201, correction.body);
  const correctionApprovalId = correction.json().approval.id;
  assert.equal(correction.json().exception.status, "awaiting_approval");

  const selfApproval = await context.app.inject({
    method: "POST",
    url: `/v1/financial-approvals/${correctionApprovalId}/decision`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "self-approve-correction" }),
    payload: { decision: "approved" },
  });
  assert.equal(selfApproval.statusCode, 403, selfApproval.body);
  assert.equal(selfApproval.json().code, "human_approval_required");

  const correctionDecision = await context.app.inject({
    method: "POST",
    url: `/v1/financial-approvals/${correctionApprovalId}/decision`,
    headers: context.headers(TEST_KEYS.acme, { idempotencyKey: "approve-correction" }),
    payload: { decision: "approved", note: "Verified against usage and contract" },
  });
  assert.equal(correctionDecision.statusCode, 200, correctionDecision.body);
  assert.equal(correctionDecision.json().result.type, "invoice_correction");

  const corrected = await context.app.inject({
    method: "GET",
    url: `/v1/invoices/${invoice.id}`,
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(corrected.json().invoice.total_minor, 18000);
  assert.equal(corrected.json().invoice.lines.length, 2);

  const resolved = await context.app.inject({
    method: "GET",
    url: `/v1/finance/exceptions/${exceptionId}`,
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(resolved.json().financial_exception.status, "resolved");
  assert.ok(
    resolved
      .json()
      .financial_exception.actions.some((action: { action: string }) => action.action === "correction_applied"),
  );

  const paymentRequest = await context.app.inject({
    method: "POST",
    url: `/v1/invoices/${invoice.id}/payment-instruction`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "payment-after-correction" }),
    payload: { chain: "solana-devnet", destination: "duo2-test-wallet" },
  });
  assert.equal(paymentRequest.statusCode, 202, paymentRequest.body);
  assert.equal(paymentRequest.json().status, "approval_required");
  const paymentApprovalId = paymentRequest.json().approval.id;

  const paymentDecision = await context.app.inject({
    method: "POST",
    url: `/v1/financial-approvals/${paymentApprovalId}/decision`,
    headers: context.headers(TEST_KEYS.acme, { idempotencyKey: "approve-payment" }),
    payload: { decision: "approved", note: "Corrected invoice only" },
  });
  assert.equal(paymentDecision.statusCode, 200, paymentDecision.body);
  assert.equal(paymentDecision.json().result.type, "payment_instruction");
  const instruction = paymentDecision.json().result.instruction;
  assert.equal(instruction.amount_minor, 18000);
  assert.equal(instruction.status, "created");
  assert.equal(instruction.chain, "solana-devnet");

  const submit = await context.app.inject({
    method: "POST",
    url: `/internal/v1/duo2/payment-instructions/${instruction.id}/submit`,
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "submit-payment" }),
  });
  assert.equal(submit.statusCode, 200, submit.body);
  assert.equal(submit.json().payment_instruction.status, "submitted");

  const settlement = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/settlements",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "settle-payment" }),
    payload: {
      instruction_id: instruction.id,
      status: "confirmed",
      amount_minor: 18000,
      transaction_id: "solana-devnet-signature-test-1",
      provider_reference: "solana:test:signature-1",
      raw: { cluster: "devnet", simulated_value: true },
    },
  });
  assert.equal(settlement.statusCode, 200, settlement.body);
  assert.equal(settlement.json().invoice_status, "paid");

  const paidInvoice = await context.app.inject({
    method: "GET",
    url: `/v1/invoices/${invoice.id}`,
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(paidInvoice.json().invoice.status, "paid");
  assert.equal(paidInvoice.json().invoice.outstanding_minor, 0);

  const finalReconciliation = await context.app.inject({
    method: "POST",
    url: "/v1/finance/reconciliations",
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "reconcile-final" }),
  });
  assert.equal(finalReconciliation.statusCode, 201, finalReconciliation.body);
  assert.equal(finalReconciliation.json().exceptions.length, 0, finalReconciliation.body);

  const balance = await context.app.inject({
    method: "GET",
    url: "/v1/ledger/trial-balance",
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(balance.json().balanced, true, balance.body);

  const audit = await context.app.inject({
    method: "GET",
    url: `/v1/audit?limit=300`,
    headers: context.headers(TEST_KEYS.agent),
  });
  assert.equal(audit.statusCode, 200, audit.body);
  const actions = audit.json().audit_events.map((event: { action: string }) => event.action);
  for (const expected of [
    "execution.authorized",
    "usage.verified",
    "invoice.issued",
    "financial_exception.correction_proposed",
    "financial_exception.correction_applied",
    "financial_approval.approved",
    "payment.instruction_created",
    "payment.settled",
  ]) {
    assert.ok(actions.includes(expected), `missing audit action ${expected}`);
  }
});
