import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CONTRACT_VERSION } from "../src/contract.js";
import { DEMO_IDS } from "../src/db/seed-demo.js";
import { createTestContext, TEST_HUMANS, TEST_KEYS } from "./helpers/app.js";

const HANDOFF_OPERATIONS = [
  ["get", "/v1/health"],
  ["get", "/v1/workloads/{workload_id}"],
  ["get", "/v1/parties/{party_id}"],
  ["get", "/v1/offers"],
  ["get", "/v1/market/history"],
  ["post", "/v1/deals/search"],
  ["get", "/v1/deals/{deal_id}"],
  ["post", "/v1/deals/{deal_id}/counteroffers"],
  ["post", "/v1/deals/{deal_id}/negotiation-events"],
  ["post", "/v1/approval-requests"],
  ["get", "/v1/approvals"],
  ["post", "/v1/approvals"],
  ["post", "/v1/deals/{deal_id}/handoff"],
  ["post", "/v1/deals/{deal_id}/escalations"],
] as const;

const spec = JSON.parse(
  readFileSync(new URL("../contracts/relay-duo1.v1.openapi.json", import.meta.url), "utf8"),
) as {
  paths: Record<string, Record<string, { operationId?: string }>>;
};

test("the hosted agent's 14 preserved operations remain contract-compatible", () => {
  for (const [method, path] of HANDOFF_OPERATIONS) {
    const operation = spec.paths[path]?.[method];
    assert.ok(operation, `missing preserved operation ${method.toUpperCase()} ${path}`);
    assert.ok(operation.operationId, `missing operationId for ${method.toUpperCase()} ${path}`);
  }
  assert.equal(
    new Set(HANDOFF_OPERATIONS.map(([method, path]) => spec.paths[path]?.[method]?.operationId)).size,
    14,
  );
});

test("the preserved deal-coordinator workflow is reachable and returns the expected shapes", async (t) => {
  const { app, db, headers } = await createTestContext();
  t.after(async () => app.close());

  const health = await app.inject({ method: "GET", url: "/v1/health" });
  assert.equal(health.statusCode, 200, health.body);
  assert.equal(health.headers["x-relay-contract"], CONTRACT_VERSION);

  const reads = [
    `/v1/workloads/${DEMO_IDS.workloads.acme}`,
    `/v1/parties/${DEMO_IDS.parties.vertex}`,
    "/v1/offers",
    "/v1/market/history?gpu_model=H100&window_hours=24",
  ];
  for (const url of reads) {
    const response = await app.inject({ method: "GET", url, headers: headers() });
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
  }

  const search = await app.inject({
    method: "POST",
    url: "/v1/deals/search",
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "creao-contract-search" }),
    payload: { workload_id: DEMO_IDS.workloads.brightlane },
  });
  assert.equal(search.statusCode, 201, search.body);
  const searchBody = search.json();
  assert.equal(searchBody.status, "feasible");
  assert.ok(searchBody.proposal, "search must return the persisted `proposal` alias");
  assert.equal(searchBody.proposal.terms_version, 1);
  assert.equal(searchBody.proposal.settlement_authorized, false);
  assert.ok(Array.isArray(searchBody.proposal.required_commitments));
  assert.equal(searchBody.deal.deal.status, "awaiting_human_approval");
  const dealId = searchBody.deal.deal_id;

  const deal = await app.inject({
    method: "GET",
    url: `/v1/deals/${dealId}`,
    headers: headers(),
  });
  assert.equal(deal.statusCode, 200, deal.body);
  assert.equal(deal.json().approval_requests.length, 4);
  assert.equal(deal.json().approval_integrity.handoff_permitted, false);
  assert.equal(deal.json().approval_integrity.settlement_authorized, false);

  // Remove one generated request so the agent's request-creation operation is
  // exercised as a successful write rather than a duplicate conflict.
  await db.query(
    `DELETE FROM deal_approval_requests
     WHERE deal_id = $1 AND version = 1 AND participant_id = $2`,
    [dealId, DEMO_IDS.parties.vertex],
  );
  const createdRequest = await app.inject({
    method: "POST",
    url: "/v1/approval-requests",
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "creao-contract-request" }),
    payload: {
      deal_id: dealId,
      version: 1,
      participant_id: DEMO_IDS.parties.vertex,
      obligation: "Authorize reassignment of the held Vertex window.",
      amount_minor: 0,
      currency: "USD",
    },
  });
  assert.equal(createdRequest.statusCode, 201, createdRequest.body);

  const approvals = await app.inject({
    method: "GET",
    url: `/v1/approvals?deal_id=${dealId}`,
    headers: headers(),
  });
  assert.equal(approvals.statusCode, 200, approvals.body);
  assert.equal(approvals.json().approval_requests.length, 4);
  assert.equal(approvals.json().summary.required, 4);
  assert.equal(approvals.json().summary.complete, false);

  const acmeRequest = approvals
    .json()
    .approval_requests.find(
      (request: { participant: { id: string } }) =>
        request.participant.id === DEMO_IDS.parties.acme,
    );
  const decision = await app.inject({
    method: "POST",
    url: "/v1/approvals",
    headers: headers(TEST_KEYS.acme, { idempotencyKey: "creao-contract-approval" }),
    payload: {
      request_id: acmeRequest.id,
      decision: "approved",
      attested_by: TEST_HUMANS.acme.userId,
      channel: "creao",
    },
  });
  assert.equal(decision.statusCode, 201, decision.body);

  const counter = await app.inject({
    method: "POST",
    url: `/v1/deals/${dealId}/counteroffers`,
    headers: headers(TEST_KEYS.northstar, { idempotencyKey: "creao-contract-counter" }),
    payload: {
      terms_version: 1,
      ask_price_minor_per_gpu_hour: 165,
      rationale: "Preserved deal-coordinator contract probe",
    },
  });
  assert.equal(counter.statusCode, 201, counter.body);
  assert.equal(counter.json().deal.deal.current_version, 2);

  const negotiation = await app.inject({
    method: "POST",
    url: `/v1/deals/${dealId}/negotiation-events`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "creao-contract-negotiation" }),
    payload: {
      version: 2,
      round: 1,
      event_type: "terms_conveyed",
      payload: { channel: "creao", participant_count: 4 },
    },
  });
  assert.equal(negotiation.statusCode, 201, negotiation.body);

  const handoff = await app.inject({
    method: "POST",
    url: `/v1/deals/${dealId}/handoff`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "creao-contract-handoff" }),
  });
  assert.equal(handoff.statusCode, 409, handoff.body);
  assert.equal(handoff.json().code, "handoff_not_permitted");
  assert.equal(handoff.json().retryable, false);
  assert.ok(Array.isArray(handoff.json().violations));

  const escalation = await app.inject({
    method: "POST",
    url: `/v1/deals/${dealId}/escalations`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "creao-contract-escalation" }),
    payload: {
      version: 2,
      reason: "Approval round is incomplete after the version bump.",
      details: { contract_probe: true },
    },
  });
  assert.equal(escalation.statusCode, 201, escalation.body);
});
