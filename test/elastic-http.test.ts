import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { ElasticConfig } from "../src/config.js";
import { ElasticHttpClient } from "../src/elastic/client.js";
import { ElasticHttpError } from "../src/elastic/http.js";

interface CapturedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  contentType: string | undefined;
  xsrf: string | undefined;
  body: string;
}

test("the Elastic client writes, reads, and invokes Agent Builder with the documented wire shapes", async (t) => {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method ?? "GET",
      path: request.url ?? "/",
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
      xsrf: typeof request.headers["kbn-xsrf"] === "string" ? request.headers["kbn-xsrf"] : undefined,
      body,
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/_bulk") {
      response.end(
        JSON.stringify({
          errors: false,
          items: [
            { index: { _id: "invoice:1", status: 201 } },
            { delete: { _id: "invoice:gone", status: 404 } },
          ],
        }),
      );
      return;
    }
    if (request.url === "/relay-financial-test/_mget") {
      response.end(
        JSON.stringify({
          docs: [
            {
              _id: "invoice:1",
              found: true,
              _source: {
                document_id: "invoice:1",
                entity_type: "invoice",
                entity_id: "1",
                amount_minor: 5800,
              },
            },
          ],
        }),
      );
      return;
    }
    if (request.url === "/api/agent_builder/converse") {
      response.end(
        JSON.stringify({
          conversation_id: "conversation-1",
          round_id: "round-1",
          status: "completed",
          steps: [{ type: "tool_call", tool_id: "relay.get_invoice_records", params: { invoiceId: "1" } }],
          response: { message: "{\"summary\":\"ok\",\"findings\":[],\"missing_evidence\":[],\"recommended_next_actions\":[]}" },
          model_usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );
      return;
    }
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
    elasticsearchApiKey: "es-key",
    kibanaApiKey: "kibana-key",
    indexName: "relay-financial-test",
    agentId: "relay-financial-investigator",
    kibanaSpace: null,
    syncIntervalMs: 15_000,
    investigationTimeoutMs: 10_000,
    maxSyncBatch: 200,
    maxBackfillPerType: 5_000,
    disabledReason: null,
  };
  const client = new ElasticHttpClient(config);

  const bulk = await client.bulk([
    {
      action: "index",
      id: "invoice:1",
      document: { document_id: "invoice:1", entity_type: "invoice", entity_id: "1", amount_minor: 5800 },
    },
    { action: "delete", id: "invoice:gone" },
  ]);
  assert.deepEqual(bulk.indexed, ["invoice:1"]);
  assert.deepEqual(bulk.deleted, ["invoice:gone"]);
  assert.deepEqual(bulk.failures, []);
  const bulkRequest = requests.find((request) => request.path === "/_bulk");
  assert.ok(bulkRequest);
  assert.equal(bulkRequest.authorization, "ApiKey es-key");
  assert.equal(bulkRequest.contentType, "application/x-ndjson");
  assert.match(bulkRequest.body, /"_index":"relay-financial-test","_id":"invoice:1"/);
  assert.match(bulkRequest.body, /"_index":"relay-financial-test","_id":"invoice:gone"/);

  const documents = await client.getDocuments(["invoice:1"]);
  assert.equal(documents.get("invoice:1")?.amount_minor, 5800);

  await client.refresh();
  await client.ping();
  assert.ok(
    requests.some(
      (request) =>
        request.method === "GET" &&
        request.path === "/relay-financial-test/_mapping" &&
        request.authorization === "ApiKey es-key",
    ),
  );

  const converse = await client.converse({
    agentId: "relay-financial-investigator",
    prompt: "Investigate exception 1",
  });
  assert.equal(converse.conversationId, "conversation-1");
  assert.equal(converse.roundId, "round-1");
  assert.equal(converse.steps[0]?.tool_id, "relay.get_invoice_records");
  assert.match(converse.message, /"summary":"ok"/);
  const converseRequest = requests.find((request) => request.path === "/api/agent_builder/converse");
  assert.ok(converseRequest);
  assert.equal(converseRequest.authorization, "ApiKey kibana-key");
  assert.equal(converseRequest.xsrf, "true");
  assert.deepEqual(JSON.parse(converseRequest.body), {
    input: "Investigate exception 1",
    agent_id: "relay-financial-investigator",
  });

  await assert.rejects(
    () =>
      client.converse({
        agentId: "relay-financial-investigator",
        prompt: "force an error",
        conversationId: "not-allowed",
      }),
    (error: unknown) => error instanceof ElasticHttpError && error.code === "conversation_reuse_not_supported",
  );
});

test("Elastic HTTP errors preserve status, error type, and retryability", async (t) => {
  const server = createServer((_request, response) => {
    response.statusCode = 429;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: { type: "too_many_requests", reason: "slow down" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ElasticHttpClient({
    enabled: true,
    elasticsearchUrl: `http://127.0.0.1:${address.port}`,
    kibanaUrl: `http://127.0.0.1:${address.port}`,
    elasticsearchApiKey: "es-key",
    kibanaApiKey: "kibana-key",
    indexName: "relay-financial-test",
    agentId: "relay-financial-investigator",
    kibanaSpace: null,
    syncIntervalMs: 15_000,
    investigationTimeoutMs: 10_000,
    maxSyncBatch: 200,
    maxBackfillPerType: 5_000,
    disabledReason: null,
  });
  await assert.rejects(
    () => client.ping(),
    (error: unknown) =>
      error instanceof ElasticHttpError &&
      error.status === 429 &&
      error.code === "too_many_requests" &&
      error.retryable === true,
  );
});
