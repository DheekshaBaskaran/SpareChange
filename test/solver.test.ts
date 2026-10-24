import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_IDS } from "../src/db/seed-demo.js";
import { createTestContext, TEST_HUMANS, TEST_KEYS } from "./helpers/app.js";

test("solver finds a conditional exchange for capacity held by another buyer", async (t) => {
  const { app, db, headers } = await createTestContext();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/deals/search",
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-solver-exchange" }),
    payload: { workload_id: DEMO_IDS.workloads.brightlane },
  });
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  assert.equal(body.status, "feasible");
  assert.equal(body.recommended.strategy, "exchange");
  assert.equal(body.recommended.required_commitments.length, 2);
  assert.equal(body.recommended.parties.length, 4);
  assert.ok(body.recommended.projected_savings_minor > 0);
  assert.equal(body.recommended.proposed_transfers.length, 2);
  assert.ok(
    body.recommended.required_commitments.some(
      (commitment: { offer_id: string }) => commitment.offer_id === DEMO_IDS.offers.vertex,
    ),
  );
  assert.ok(
    body.recommended.required_commitments.some(
      (commitment: { offer_id: string }) => commitment.offer_id === DEMO_IDS.offers.northstar,
    ),
  );
  assert.equal(body.deal.approval_requests.length, 4);
  assert.equal(body.deal.deal.status, "awaiting_human_approval");
  assert.equal(body.engine.name, "relay-deterministic-solver");

  const workItems = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM agent_work_items
     WHERE kind = 'deal_opportunity' AND deal_id = $1`,
    [body.deal.deal_id],
  );
  assert.equal(workItems.rows[0]?.count, 1);
});

test("solver rejects a deal that cannot clear the buyer mandate", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/deals/search",
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-solver-no-surplus" }),
    payload: {
      workload_id: DEMO_IDS.workloads.brightlane,
      mandate: { min_savings_minor: 999_999 },
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, "no_feasible_deal");
  assert.equal(response.json().deal, null);
  assert.ok(
    response.json().rejected.some((option: { violations: string[] }) =>
      option.violations.includes("no_economic_surplus"),
    ),
  );
});

test("a hosted agent negotiates only inside a participant mandate", async (t) => {
  const { app, db, headers } = await createTestContext();
  t.after(async () => app.close());
  const agentKey = await db.query<{ id: string }>(
    `SELECT id FROM api_keys WHERE name = 'test-agent'`,
  );
  const agentId = agentKey.rows[0]!.id;

  const mandate = await app.inject({
    method: "POST",
    url: "/v1/negotiation-mandates",
    headers: headers(TEST_KEYS.northstar, { idempotencyKey: "mandate-create" }),
    payload: {
      party_id: DEMO_IDS.parties.northstar,
      agent_id: agentId,
      role: "provider",
      min_rate_minor_per_gpu_hour: 160,
      max_rate_minor_per_gpu_hour: 170,
      max_delta_minor: 500,
    },
  });
  assert.equal(mandate.statusCode, 201, mandate.body);
  const mandateId = mandate.json().negotiation_mandate.id;

  const accepted = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/counteroffers`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "mandated-counter" }),
    payload: {
      terms_version: 1,
      ask_price_minor_per_gpu_hour: 165,
      participant_id: DEMO_IDS.parties.northstar,
      mandate_id: mandateId,
      rationale: "Inside the participant ceiling",
    },
  });
  assert.equal(accepted.statusCode, 201, accepted.body);
  assert.equal(accepted.json().deal.deal.current_version, 2);

  const aboveCeiling = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/counteroffers`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "mandated-counter-above" }),
    payload: {
      terms_version: 2,
      ask_price_minor_per_gpu_hour: 180,
      participant_id: DEMO_IDS.parties.northstar,
      mandate_id: mandateId,
    },
  });
  assert.equal(aboveCeiling.statusCode, 422, aboveCeiling.body);
  assert.equal(aboveCeiling.json().code, "counteroffer_above_mandate");

  const audit = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_events WHERE action = 'negotiation_mandate.created'`,
  );
  assert.equal(audit.rows[0]?.count, 1);
});

test("an economically infeasible counteroffer returns the hosted-agent error code", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/counteroffers`,
    headers: headers(TEST_KEYS.northstar, { idempotencyKey: "idem-counter-infeasible" }),
    payload: {
      terms_version: 1,
      ask_price_minor_per_gpu_hour: 300,
      rationale: "Deliberately beyond the buyer's budget",
    },
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "counteroffer_infeasible");
  assert.ok(response.json().violations.includes("counteroffer_exceeds_buyer_budget"));
});

test("agent counteroffers require a mandate and human providers can reprice", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const unmandated = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/counteroffers`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-counter-no-mandate" }),
    payload: {
      terms_version: 1,
      ask_price_minor_per_gpu_hour: 220,
      participant_id: DEMO_IDS.parties.northstar,
    },
  });
  assert.equal(unmandated.statusCode, 403, unmandated.body);
  assert.equal(unmandated.json().code, "negotiation_mandate_required");

  const counter = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/counteroffers`,
    headers: headers(TEST_KEYS.northstar, { idempotencyKey: "idem-counter-human" }),
    payload: {
      terms_version: 1,
      ask_price_minor_per_gpu_hour: 165,
      rationale: "Tight window premium",
    },
  });
  assert.equal(counter.statusCode, 201, counter.body);
  const deal = counter.json().deal;
  assert.equal(deal.deal.current_version, 2);
  assert.equal(deal.approval_requests.length, 4);
  assert.ok(deal.approval_requests.every((request: { status: string }) => request.status === "pending"));
  assert.equal(deal.proposal.terms_version, 2);
  assert.ok(deal.proposal.compensation.some((line: { amount_minor: number }) => line.amount_minor === 13200));

  const stale = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/counteroffers`,
    headers: headers(TEST_KEYS.northstar, { idempotencyKey: "idem-counter-stale" }),
    payload: { terms_version: 1, ask_price_minor_per_gpu_hour: 170 },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "terms_version_stale");

  const approval = await app.inject({
    method: "POST",
    url: "/v1/approvals",
    headers: headers(TEST_KEYS.acme, { idempotencyKey: "idem-counter-approval" }),
    payload: {
      request_id: DEMO_IDS.requests.acme,
      decision: "approved",
      attested_by: TEST_HUMANS.acme.userId,
    },
  });
  assert.equal(approval.statusCode, 409, approval.body);
  assert.equal(approval.json().code, "terms_version_stale");
});
