import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { ElasticConfig } from "../src/config.js";
import { bootstrapElastic } from "../src/elastic/bootstrap.js";

interface CapturedCall {
  method: string;
  path: string;
  authorization: string | undefined;
  xsrf: string | undefined;
  body: Record<string, unknown> | null;
}

test("bootstrap creates the scoped index, tools, and Relay Financial Investigator agent", async (t) => {
  const calls: CapturedCall[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    calls.push({
      method: request.method ?? "GET",
      path,
      authorization: request.headers.authorization,
      xsrf: typeof request.headers["kbn-xsrf"] === "string" ? request.headers["kbn-xsrf"] : undefined,
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
    });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && path !== "/") {
      response.statusCode = 404;
      response.end(JSON.stringify({ statusCode: 404, error: "Not Found" }));
      return;
    }
    response.statusCode = 200;
    response.end(JSON.stringify({ acknowledged: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const config: ElasticConfig = {
    enabled: true,
    elasticsearchUrl: baseUrl,
    kibanaUrl: baseUrl,
    elasticsearchApiKey: "bootstrap-es-key",
    kibanaApiKey: "bootstrap-kibana-key",
    indexName: "relay-financial-test",
    agentId: "relay-financial-investigator",
    kibanaSpace: "default",
    syncIntervalMs: 15_000,
    investigationTimeoutMs: 10_000,
    maxSyncBatch: 200,
    maxBackfillPerType: 5_000,
    disabledReason: null,
  };

  const result = await bootstrapElastic(config);
  assert.equal(result.index, "relay-financial-test");
  assert.equal(result.agent_id, "relay-financial-investigator");
  assert.equal(result.tools.length, 8);

  const indexCreate = calls.find(
    (call) => call.method === "PUT" && call.path === "/relay-financial-test",
  );
  assert.ok(indexCreate);
  const mappings = indexCreate.body?.mappings as { dynamic?: boolean; properties?: Record<string, unknown> };
  assert.equal(mappings.dynamic, false);
  assert.ok(mappings.properties?.document_id);

  const toolCreates = calls.filter(
    (call) => call.method === "POST" && call.path === "/api/agent_builder/tools",
  );
  assert.equal(toolCreates.length, 8);
  for (const call of toolCreates) {
    assert.equal(call.authorization, "ApiKey bootstrap-kibana-key");
    assert.equal(call.xsrf, "true");
    assert.ok(["index_search", "esql"].includes(String(call.body?.type)));
  }
  const exceptionTool = toolCreates.find((call) => call.body?.id === "relay.get_exception_records");
  assert.ok(exceptionTool);
  const exceptionConfig = exceptionTool.body?.configuration as { query?: string };
  assert.match(exceptionConfig.query ?? "", /\?exceptionId/);

  const agentCreate = calls.find(
    (call) => call.method === "POST" && call.path === "/api/agent_builder/agents",
  );
  assert.ok(agentCreate);
  assert.equal(agentCreate.body?.name, "Relay Financial Investigator");
  const configuration = agentCreate.body?.configuration as {
    instructions?: string;
    tools?: Array<{ tool_ids: string[] }>;
  };
  assert.match(configuration.instructions ?? "", /Every finding must cite at least one actual indexed record/);
  assert.deepEqual(configuration.tools, [{ tool_ids: result.tools }]);
  assert.ok(
    result.tools.every((tool) => !tool.startsWith("platform.")),
    "the investigator must not receive broad platform search tools",
  );

  const indexReads = calls.filter(
    (call) => call.method === "GET" && call.path === "/relay-financial-test",
  );
  assert.equal(indexReads.length, 1);
  assert.equal(indexReads[0]?.authorization, "ApiKey bootstrap-es-key");
});
