import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACT_VERSION } from "../src/contract.js";
import { DEMO_IDS } from "../src/db/seed-demo.js";
import { createTestContext, TEST_KEYS } from "./helpers/app.js";

test("health is public and reports database readiness", async (t) => {
  const { app } = await createTestContext();
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/v1/health" });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.contract, CONTRACT_VERSION);
  assert.equal(body.database, "ok");
});

test("contract header and bearer auth are enforced before handlers", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());
  const url = `/v1/deals/${DEMO_IDS.deal}`;

  const noContract = await app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${TEST_KEYS.agent}` },
  });
  assert.equal(noContract.statusCode, 400);
  assert.equal(noContract.json().code, "contract_header_required");

  const wrongContract = await app.inject({
    method: "GET",
    url,
    headers: headers(TEST_KEYS.agent, { contract: "relay-duo1.v2" }),
  });
  assert.equal(wrongContract.statusCode, 400);
  assert.equal(wrongContract.json().code, "unsupported_contract");

  const noAuth = await app.inject({
    method: "GET",
    url,
    headers: { "x-relay-contract": CONTRACT_VERSION },
  });
  assert.equal(noAuth.statusCode, 401);
  assert.equal(noAuth.json().code, "authentication_required");

  const badKey = await app.inject({ method: "GET", url, headers: headers("not-a-valid-key") });
  assert.equal(badKey.statusCode, 401);

  const ok = await app.inject({ method: "GET", url, headers: headers() });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.headers["x-relay-contract"], CONTRACT_VERSION);
});

test("read endpoints return persisted contract data", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const workload = await app.inject({
    method: "GET",
    url: `/v1/workloads/${DEMO_IDS.workloads.acme}`,
    headers: headers(),
  });
  assert.equal(workload.statusCode, 200, workload.body);
  assert.equal(workload.json().workload.buyer.name, "Acme Compute");
  assert.equal(workload.json().workload.budget_minor, 20000);
  assert.equal(workload.json().workload.resource_constraints.gpu_model, "H100");

  const party = await app.inject({
    method: "GET",
    url: `/v1/parties/${DEMO_IDS.parties.vertex}`,
    headers: headers(),
  });
  assert.equal(party.statusCode, 200, party.body);
  assert.equal(party.json().party.kind, "provider");
  assert.equal(party.json().party.permissions.currently_authorized, true);

  const executable = await app.inject({
    method: "GET",
    url: "/v1/offers?executable=true",
    headers: headers(),
  });
  assert.equal(executable.statusCode, 200, executable.body);
  assert.equal(executable.json().count, 2);
  assert.equal(executable.json().executable_offers.length, 2);
  assert.equal(executable.json().public_references.length, 0);
  assert.ok(executable.json().offers.every((offer: { executable: boolean }) => offer.executable));

  const allOffers = await app.inject({ method: "GET", url: "/v1/offers", headers: headers() });
  assert.equal(allOffers.statusCode, 200, allOffers.body);
  assert.equal(allOffers.json().count, 4);
  const publicOffer = allOffers
    .json()
    .offers.find((offer: { id: string }) => offer.id === DEMO_IDS.offers.publicH100);
  assert.equal(publicOffer.executable, false);
  assert.equal(publicOffer.source, "external_reference");
  assert.equal(publicOffer.authorization.status, "missing");

  const history = await app.inject({
    method: "GET",
    url: "/v1/market/history?gpu_model=H100&window_hours=24",
    headers: headers(),
  });
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().source, "market_observations");
  assert.ok(history.json().history.length >= 1);
  assert.ok(history.json().history.every((point: { gpu_model: string }) => point.gpu_model === "H100"));

  const deal = await app.inject({
    method: "GET",
    url: `/v1/deals/${DEMO_IDS.deal}`,
    headers: headers(),
  });
  assert.equal(deal.statusCode, 200, deal.body);
  const dealBody = deal.json();
  assert.equal(dealBody.terms_version, 1);
  assert.equal(dealBody.deal.status, "awaiting_human_approval");
  assert.equal(dealBody.approval_requests.length, 4);
  assert.equal(dealBody.approval_summary.required, 4);
  assert.equal(dealBody.approval_summary.pending, 4);
  assert.equal(dealBody.approval_summary.complete, false);
  assert.equal(dealBody.approval_summary.expired, 0);
  assert.equal(dealBody.approval_integrity.handoff_permitted, false);
  assert.equal(dealBody.approval_integrity.settlement_authorized, false);
  assert.equal(dealBody.deal_id, DEMO_IDS.deal);
  assert.equal(dealBody.engine.name, "seed-fixture");
  assert.equal(dealBody.proposal.settlement_authorized, false);
});

test("unknown routes return the contract error envelope", async (t) => {
  const { app, headers } = await createTestContext();
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/v1/unknown", headers: headers() });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    code: "not_found",
    detail: "Route not found.",
    retryable: false,
    violations: [],
  });
});
