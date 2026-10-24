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

async function approvedExecutionWithInvoice(context: Context) {
  const search = await context.app.inject({
    method: "POST",
    url: "/v1/deals/search",
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "recovery-search" }),
    payload: { workload_id: DEMO_IDS.workloads.brightlane },
  });
  assert.equal(search.statusCode, 201, search.body);
  const deal = search.json().deal;
  for (const [index, request] of deal.approval_requests.entries()) {
    const account = ACCOUNT_FOR_PARTY[request.participant.id];
    const approval = await context.app.inject({
      method: "POST",
      url: "/v1/approvals",
      headers: context.headers(account.key, { idempotencyKey: `recovery-approve-${index}` }),
      payload: { request_id: request.id, decision: "approved", attested_by: account.attested },
    });
    assert.equal(approval.statusCode, 201, approval.body);
  }
  const handoff = await context.app.inject({
    method: "POST",
    url: `/v1/deals/${deal.deal_id}/handoff`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "recovery-handoff" }),
  });
  assert.equal(handoff.statusCode, 200, handoff.body);
  const authResponse = await context.app.inject({
    method: "POST",
    url: `/v1/deals/${deal.deal_id}/execution-authorizations`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "recovery-auth" }),
  });
  assert.equal(authResponse.statusCode, 201, authResponse.body);
  const auth = authResponse.json().authorization;
  const contract = auth.contracts.find(
    (candidate: { buyer_id: string }) => candidate.buyer_id === DEMO_IDS.parties.brightlane,
  );
  const usage = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/usage",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "recovery-usage" }),
    payload: {
      contract_id: contract.id,
      authorization_id: auth.id,
      gpu_seconds: 8 * 10 * 3600,
      started_at: new Date(Date.now() - 11 * 3600_000).toISOString(),
      ended_at: new Date(Date.now() - 3600_000).toISOString(),
      proof_reference: "recovery-proof",
      evidence: { measured: true },
    },
  });
  assert.equal(usage.statusCode, 201, usage.body);
  const invoice = await context.app.inject({
    method: "POST",
    url: `/v1/contracts/${contract.id}/invoices`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "recovery-invoice" }),
  });
  assert.equal(invoice.statusCode, 201, invoice.body);
  return { deal, contract, invoice: invoice.json().invoice };
}

test("a failed settlement creates an exception, blocks retry, and recovers after dismissal", async (t) => {
  const context = await createTestContext();
  t.after(async () => context.app.close());
  const { invoice } = await approvedExecutionWithInvoice(context);

  const request = await context.app.inject({
    method: "POST",
    url: `/v1/invoices/${invoice.id}/payment-instruction`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "recovery-payment-request" }),
    payload: { chain: "solana-devnet", destination: "duo2-test-wallet" },
  });
  assert.equal(request.statusCode, 202, request.body);
  const decision = await context.app.inject({
    method: "POST",
    url: `/v1/financial-approvals/${request.json().approval.id}/decision`,
    headers: context.headers(TEST_KEYS.acme, { idempotencyKey: "recovery-payment-approve" }),
    payload: { decision: "approved" },
  });
  assert.equal(decision.statusCode, 200, decision.body);
  const instruction = decision.json().result.instruction;

  const premature = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/settlements",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "recovery-premature-settlement" }),
    payload: {
      instruction_id: instruction.id,
      status: "confirmed",
      amount_minor: instruction.amount_minor,
      transaction_id: "premature-test-signature",
      provider_reference: "solana:test:premature-1",
    },
  });
  assert.equal(premature.statusCode, 409, premature.body);
  assert.equal(premature.json().code, "settlement_not_submitted");

  const submit = await context.app.inject({
    method: "POST",
    url: `/internal/v1/duo2/payment-instructions/${instruction.id}/submit`,
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "recovery-submit" }),
  });
  assert.equal(submit.statusCode, 200, submit.body);

  const failed = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/settlements",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "recovery-failed-settlement" }),
    payload: {
      instruction_id: instruction.id,
      status: "failed",
      amount_minor: 18000,
      transaction_id: "failed-test-signature",
      provider_reference: "solana:test:failed-1",
      failure_code: "rpc_timeout",
      failure_message: "Devnet RPC timed out before confirmation.",
      raw: { cluster: "devnet" },
    },
  });
  assert.equal(failed.statusCode, 200, failed.body);
  assert.equal(failed.json().payment_instruction.status, "failed");

  const exceptions = await context.app.inject({
    method: "GET",
    url: "/v1/finance/exceptions?status=open&kind=payment_failed",
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(exceptions.statusCode, 200, exceptions.body);
  assert.equal(exceptions.json().financial_exceptions.length, 1);
  const exceptionId = exceptions.json().financial_exceptions[0].id;

  const blockedRetry = await context.app.inject({
    method: "POST",
    url: `/v1/payment-instructions/${instruction.id}/retry`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "recovery-retry-blocked" }),
  });
  assert.equal(blockedRetry.statusCode, 409, blockedRetry.body);
  assert.equal(blockedRetry.json().code, "payment_blocked");

  const dismissed = await context.app.inject({
    method: "POST",
    url: `/v1/finance/exceptions/${exceptionId}/dismiss`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "recovery-dismiss" }),
    payload: { reason: "Transient devnet RPC failure confirmed; safe to retry the same obligation." },
  });
  assert.equal(dismissed.statusCode, 200, dismissed.body);
  assert.equal(dismissed.json().financial_exception.status, "dismissed");

  const retry = await context.app.inject({
    method: "POST",
    url: `/v1/payment-instructions/${instruction.id}/retry`,
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "recovery-retry" }),
  });
  assert.equal(retry.statusCode, 201, retry.body);
  const replacement = retry.json().payment_instruction;
  assert.notEqual(replacement.id, instruction.id);
  assert.equal(replacement.amount_minor, 18000);

  const submitRetry = await context.app.inject({
    method: "POST",
    url: `/internal/v1/duo2/payment-instructions/${replacement.id}/submit`,
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "recovery-retry-submit" }),
  });
  assert.equal(submitRetry.statusCode, 200, submitRetry.body);

  const settled = await context.app.inject({
    method: "POST",
    url: "/internal/v1/duo2/settlements",
    headers: context.headers(TEST_KEYS.worker, { idempotencyKey: "recovery-retry-settle" }),
    payload: {
      instruction_id: replacement.id,
      status: "confirmed",
      amount_minor: 18000,
      transaction_id: "recovered-test-signature",
      provider_reference: "solana:test:recovered-1",
      raw: { cluster: "devnet" },
    },
  });
  assert.equal(settled.statusCode, 200, settled.body);
  assert.equal(settled.json().invoice_status, "paid");

  const audit = await context.app.inject({
    method: "GET",
    url: "/v1/audit?limit=300",
    headers: context.headers(TEST_KEYS.agent),
  });
  const actions = audit.json().audit_events.map((event: { action: string }) => event.action);
  assert.ok(actions.includes("payment.settlement_failed"));
  assert.ok(actions.includes("payment.instruction_retried"));
  assert.ok(actions.includes("payment.settled"));
});

test("agents cannot request payments or read audit without explicit permission", async (t) => {
  const context = await createTestContext();
  t.after(async () => context.app.close());
  const { invoice } = await approvedExecutionWithInvoice(context);

  const agentPayment = await context.app.inject({
    method: "POST",
    url: `/v1/invoices/${invoice.id}/payment-instruction`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "agent-payment-attempt" }),
    payload: { chain: "solana-devnet", destination: "agent-attempt" },
  });
  assert.equal(agentPayment.statusCode, 403, agentPayment.body);
  assert.equal(agentPayment.json().code, "permission_forbidden");

  const financeApproval = await context.app.inject({
    method: "POST",
    url: "/v1/financial-approvals/00000000-0000-4000-8000-000000000001/decision",
    headers: context.headers(TEST_KEYS.finance, { idempotencyKey: "finance-approval-attempt" }),
    payload: { decision: "approved" },
  });
  assert.equal(financeApproval.statusCode, 403, financeApproval.body);
  assert.equal(financeApproval.json().code, "human_approval_required");

  const workerAudit = await context.app.inject({
    method: "GET",
    url: "/v1/audit",
    headers: context.headers(TEST_KEYS.worker),
  });
  assert.equal(workerAudit.statusCode, 403);
  assert.equal(workerAudit.json().code, "permission_forbidden");
});
