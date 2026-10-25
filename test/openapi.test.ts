import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTestContext } from "./helpers/app.js";

const spec = JSON.parse(
  readFileSync(new URL("../contracts/relay-duo1.v1.openapi.json", import.meta.url), "utf8"),
) as {
  openapi: string;
  paths: Record<string, Record<string, { operationId?: string; parameters?: unknown[] }>>;
  components: { parameters: Record<string, unknown> };
};

const methods = new Set(["get", "post", "put", "patch", "delete"]);

test("OpenAPI declares the expanded contract with unique operation IDs", () => {
  assert.match(spec.openapi, /^3\.1\./);
  const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => methods.has(method))
      .map(([method, operation]) => ({ method, path, operationId: operation.operationId })),
  );
  assert.equal(operations.length, 71);
  const ids = operations.map((operation) => operation.operationId);
  assert.ok(ids.every(Boolean), "every operation needs an operationId");
  assert.equal(new Set(ids).size, ids.length);
  for (const operationId of [
    "searchDeals",
    "createCounteroffer",
    "createHandoff",
    "authorizeExecution",
    "generateInvoice",
    "requestPaymentInstruction",
    "requestProviderPayout",
    "runReconciliation",
    "ingestVerifiedUsage",
    "ingestDuo2Settlement",
    "ingestDuo2ProviderSettlement",
    "runElasticInvestigation",
    "listElasticInvestigations",
    "getElasticInvestigation",
  ]) {
    assert.ok(ids.includes(operationId), `missing operation ${operationId}`);
  }
});

test("every declared OpenAPI operation is registered in the Fastify app", async (t) => {
  const { app } = await createTestContext();
  t.after(async () => app.close());
  const missing: string[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      const route = path.replace(/\{[^}]+\}/g, ":param");
      if (!app.hasRoute({ method: method.toUpperCase(), url: route })) {
        missing.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("every write operation requires an idempotency key and contract header", () => {
  const contractHeader = "#/components/parameters/ContractHeader";
  const idempotencyKey = "#/components/parameters/IdempotencyKey";
  for (const [path, item] of Object.entries(spec.paths)) {
    if (path === "/v1/health") continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      const refs = (operation.parameters ?? []).map((parameter) =>
        typeof parameter === "object" && parameter && "$ref" in parameter
          ? (parameter as { $ref: string }).$ref
          : null,
      );
      assert.ok(refs.includes(contractHeader), `${method.toUpperCase()} ${path} is missing the contract header`);
      if (method === "post") {
        assert.ok(refs.includes(idempotencyKey), `${method.toUpperCase()} ${path} is missing Idempotency-Key`);
      }
    }
  }
});
