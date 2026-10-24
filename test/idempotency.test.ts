import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_IDS } from "../src/db/seed-demo.js";
import { createTestContext, TEST_KEYS } from "./helpers/app.js";

const eventBody = {
  event_type: "terms_conveyed",
  round: 1,
  payload: { participant_id: DEMO_IDS.parties.acme, channel: "api" },
};

test("negotiation events replay an identical idempotent request", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());
  const url = `/v1/deals/${DEMO_IDS.deal}/negotiation-events`;

  const first = await app.inject({
    method: "POST",
    url,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-event-1" }),
    payload: eventBody,
  });
  assert.equal(first.statusCode, 201, first.body);
  const eventId = first.json().event.id;
  assert.ok(eventId);

  const replay = await app.inject({
    method: "POST",
    url,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-event-1" }),
    payload: eventBody,
  });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(replay.headers["idempotency-replayed"], "true");
  assert.equal(replay.json().event.id, eventId);

  const conflict = await app.inject({
    method: "POST",
    url,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-event-1" }),
    payload: { ...eventBody, event_type: "counteroffer_requested" },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "idempotency_conflict");

  const missing = await app.inject({
    method: "POST",
    url,
    headers: headers(TEST_KEYS.agent),
    payload: { ...eventBody, event_type: "terms_conveyed_again" },
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().code, "idempotency_key_required");
});

test("solver writes are idempotent and agent counteroffers stay governed", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const search = await app.inject({
    method: "POST",
    url: "/v1/deals/search",
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-search-1" }),
    payload: { workload_id: DEMO_IDS.workloads.brightlane },
  });
  assert.equal(search.statusCode, 201, search.body);
  assert.equal(search.json().status, "feasible");

  const replay = await app.inject({
    method: "POST",
    url: "/v1/deals/search",
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-search-1" }),
    payload: { workload_id: DEMO_IDS.workloads.brightlane },
  });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(replay.headers["idempotency-replayed"], "true");
  assert.equal(replay.json().deal.deal_id, search.json().deal.deal_id);

  const counteroffer = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/counteroffers`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-counter-1" }),
    payload: { terms_version: 1, ask_price_minor_per_gpu_hour: 200 },
  });
  assert.equal(counteroffer.statusCode, 422, counteroffer.body);
  assert.equal(counteroffer.json().code, "participant_required");

  const stale = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/counteroffers`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-counter-stale" }),
    payload: {
      terms_version: 99,
      ask_price_minor_per_gpu_hour: 200,
      participant_id: DEMO_IDS.parties.northstar,
      mandate_id: "00000000-0000-4000-8000-000000000001",
    },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "terms_version_stale");

  const deal = await app.inject({
    method: "GET",
    url: `/v1/deals/${DEMO_IDS.deal}`,
    headers: headers(),
  });
  assert.equal(deal.json().deal.current_version, 1);
});

test("handoff is blocked while approvals are outstanding", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const handoff = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/handoff`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-handoff-blocked" }),
  });
  assert.equal(handoff.statusCode, 409);
  assert.equal(handoff.json().code, "handoff_not_permitted");
  assert.ok(handoff.json().violations.some((v: string) => v.startsWith("approval_not_approved:")));
});

test("escalation persists and moves the deal to escalated", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/escalations`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-escalation-1" }),
    payload: {
      reason: "provider_authorization_expired",
      details: { provider_id: DEMO_IDS.parties.vertex },
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().escalation.reason, "provider_authorization_expired");

  const deal = await app.inject({
    method: "GET",
    url: `/v1/deals/${DEMO_IDS.deal}`,
    headers: headers(),
  });
  assert.equal(deal.json().deal.status, "escalated");
});
