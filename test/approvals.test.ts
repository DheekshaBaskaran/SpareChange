import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_IDS } from "../src/db/seed-demo.js";
import { createTestContext, TEST_HUMANS, TEST_KEYS } from "./helpers/app.js";

test("agents cannot record participant approvals", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/approvals",
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-agent-approval" }),
    payload: {
      request_id: DEMO_IDS.requests.acme,
      decision: "approved",
      attested_by: TEST_HUMANS.acme.userId,
    },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, "human_attestation_required");
});

test("attestation mismatch and simulated approvals are rejected", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const mismatch = await app.inject({
    method: "POST",
    url: "/v1/approvals",
    headers: headers(TEST_KEYS.acme, { idempotencyKey: "idem-mismatch-1" }),
    payload: {
      request_id: DEMO_IDS.requests.acme,
      decision: "approved",
      attested_by: TEST_HUMANS.brightlane.userId,
    },
  });
  assert.equal(mismatch.statusCode, 403);
  assert.equal(mismatch.json().code, "attestation_mismatch");

  const wrongParticipant = await app.inject({
    method: "POST",
    url: "/v1/approvals",
    headers: headers(TEST_KEYS.brightlane, { idempotencyKey: "idem-wrong-party-1" }),
    payload: {
      request_id: DEMO_IDS.requests.acme,
      decision: "approved",
      attested_by: TEST_HUMANS.brightlane.userId,
    },
  });
  assert.equal(wrongParticipant.statusCode, 403);
  assert.equal(wrongParticipant.json().code, "participant_forbidden");

  const simulated = await app.inject({
    method: "POST",
    url: "/v1/approvals",
    headers: headers(TEST_KEYS.acme, { idempotencyKey: "idem-simulated-1" }),
    payload: {
      request_id: DEMO_IDS.requests.acme,
      decision: "approved",
      attested_by: TEST_HUMANS.acme.userId,
      simulated: true,
    },
  });
  assert.equal(simulated.statusCode, 403);
  assert.equal(simulated.json().code, "simulated_approval_forbidden");

  const valid = await app.inject({
    method: "POST",
    url: "/v1/approvals",
    headers: headers(TEST_KEYS.acme, { idempotencyKey: "idem-acme-valid" }),
    payload: {
      request_id: DEMO_IDS.requests.acme,
      decision: "approved",
      attested_by: TEST_HUMANS.acme.userId,
    },
  });
  assert.equal(valid.statusCode, 201, valid.body);
  assert.equal(valid.json().approval.decision, "approved");
  assert.equal(valid.json().deal_status, "awaiting_human_approval");

  const duplicate = await app.inject({
    method: "POST",
    url: "/v1/approvals",
    headers: headers(TEST_KEYS.acme, { idempotencyKey: "idem-acme-duplicate" }),
    payload: {
      request_id: DEMO_IDS.requests.acme,
      decision: "approved",
      attested_by: TEST_HUMANS.acme.userId,
    },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().code, "approval_request_not_pending");
});

test("all four human approvals permit a provisional, non-settling handoff", async (t) => {
  const { app, db, headers } = await createTestContext();
  t.after(async () => app.close());

  const decisions = [
    { key: TEST_KEYS.acme, request: DEMO_IDS.requests.acme, attested: TEST_HUMANS.acme.userId },
    {
      key: TEST_KEYS.brightlane,
      request: DEMO_IDS.requests.brightlane,
      attested: TEST_HUMANS.brightlane.userId,
    },
    { key: TEST_KEYS.vertex, request: DEMO_IDS.requests.vertex, attested: TEST_HUMANS.vertex.userId },
    {
      key: TEST_KEYS.northstar,
      request: DEMO_IDS.requests.northstar,
      attested: TEST_HUMANS.northstar.userId,
    },
  ];
  for (const [index, decision] of decisions.entries()) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/approvals",
      headers: headers(decision.key, { idempotencyKey: `idem-approve-${index}` }),
      payload: {
        request_id: decision.request,
        decision: "approved",
        attested_by: decision.attested,
      },
    });
    assert.equal(response.statusCode, 201, response.body);
  }

  const deal = await app.inject({
    method: "GET",
    url: `/v1/deals/${DEMO_IDS.deal}`,
    headers: headers(),
  });
  assert.equal(deal.json().deal.status, "approved");
  assert.equal(deal.json().approval_summary.approved, 4);
  assert.equal(deal.json().approval_summary.complete, true);

  const handoff = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/handoff`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-handoff-ok" }),
  });
  assert.equal(handoff.statusCode, 200, handoff.body);
  assert.equal(handoff.json().settlement_authorized, false);
  assert.equal(handoff.json().reservation_status, "not_reserved");
  assert.equal(handoff.json().handoff.status, "provisional");
  assert.equal(handoff.json().handoff.package.settlement_authorized, false);

  const replay = await app.inject({
    method: "POST",
    url: `/v1/deals/${DEMO_IDS.deal}/handoff`,
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-handoff-ok" }),
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.headers["idempotency-replayed"], "true");

  const audits = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_events WHERE action = 'handoff.provisional_created'`,
  );
  assert.equal(audits.rows[0]?.count, 1);
});

test("a version bump invalidates an old approval request", async (t) => {
  const { app, db, headers } = await createTestContext();
  t.after(async () => app.close());

  const version = await db.query<{ proposal: Record<string, unknown> }>(
    `SELECT proposal FROM deal_versions WHERE deal_id = $1 AND version = 1`,
    [DEMO_IDS.deal],
  );
  const proposal = { ...version.rows[0]!.proposal, terms_version: 2 };
  await db.query(
    `INSERT INTO deal_versions (deal_id, version, status, proposal, engine, created_by)
     VALUES ($1, 2, 'awaiting_human_approval', $2::jsonb, $3::jsonb, 'test')`,
    [DEMO_IDS.deal, JSON.stringify(proposal), JSON.stringify({ name: "test", version: "0" })],
  );
  await db.query(`UPDATE deals SET current_version = 2 WHERE id = $1`, [DEMO_IDS.deal]);

  const response = await app.inject({
    method: "POST",
    url: "/v1/approvals",
    headers: headers(TEST_KEYS.acme, { idempotencyKey: "idem-stale-approval" }),
    payload: {
      request_id: DEMO_IDS.requests.acme,
      decision: "approved",
      attested_by: TEST_HUMANS.acme.userId,
    },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "terms_version_stale");

  const historical = await app.inject({
    method: "GET",
    url: `/v1/approvals?deal_id=${DEMO_IDS.deal}&version=1`,
    headers: headers(),
  });
  assert.equal(historical.statusCode, 200, historical.body);
  assert.equal(historical.json().approval_requests.length, 4);
  assert.equal(historical.json().summary.stale, 4);
});

test("approval request creation is persisted and duplicate-safe", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const duplicate = await app.inject({
    method: "POST",
    url: "/v1/approval-requests",
    headers: headers(TEST_KEYS.agent, { idempotencyKey: "idem-duplicate-request" }),
    payload: {
      deal_id: DEMO_IDS.deal,
      participant_id: DEMO_IDS.parties.acme,
      obligation: "duplicate request",
    },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().code, "approval_request_exists");

  const list = await app.inject({
    method: "GET",
    url: `/v1/approvals?deal_id=${DEMO_IDS.deal}`,
    headers: headers(),
  });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().approval_requests.length, 4);
});
