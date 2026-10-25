import type { ElasticConfig } from "../config.js";
import { ElasticHttpError, requestJson } from "./http.js";
import type {
  AgentBuilderPort,
  BulkAction,
  BulkResult,
  ConverseInput,
  ConverseResponse,
  ConverseStep,
  ElasticsearchPort,
  FinancialDocument,
} from "./types.js";

interface BulkResponseItem {
  index?: { _id?: string; status?: number; error?: { reason?: string; type?: string } };
  delete?: { _id?: string; status?: number; error?: { reason?: string; type?: string } };
}

interface BulkResponse {
  errors?: boolean;
  items?: BulkResponseItem[];
}

interface MgetResponse {
  docs?: Array<{
    _id?: string;
    found?: boolean;
    _source?: FinancialDocument;
    error?: unknown;
  }>;
}

function documentFromSource(source: FinancialDocument): FinancialDocument {
  return source;
}

export class ElasticHttpClient implements ElasticsearchPort, AgentBuilderPort {
  private readonly config: ElasticConfig;

  constructor(config: ElasticConfig) {
    this.config = config;
  }

  private searchUrl(): string {
    if (!this.config.elasticsearchUrl) {
      throw new ElasticHttpError(503, "elastic_not_configured", "ELASTICSEARCH_URL is not configured.");
    }
    return this.config.elasticsearchUrl;
  }

  private kibanaUrl(): string {
    if (!this.config.kibanaUrl) {
      throw new ElasticHttpError(503, "elastic_not_configured", "KIBANA_URL is not configured.");
    }
    return this.config.kibanaUrl;
  }

  private searchKey(): string {
    if (!this.config.elasticsearchApiKey) {
      throw new ElasticHttpError(503, "elastic_not_configured", "ELASTICSEARCH_API_KEY is not configured.");
    }
    return this.config.elasticsearchApiKey;
  }

  private kibanaKey(): string {
    if (!this.config.kibanaApiKey) {
      throw new ElasticHttpError(503, "elastic_not_configured", "KIBANA_API_KEY is not configured.");
    }
    return this.config.kibanaApiKey;
  }

  private kibanaPath(): string {
    const space = this.config.kibanaSpace;
    const prefix = space && space !== "default" ? `/s/${encodeURIComponent(space)}` : "";
    return `${prefix}/api/agent_builder`;
  }

  async bulk(actions: BulkAction[]): Promise<BulkResult> {
    if (actions.length === 0) return { indexed: [], deleted: [], failures: [] };
    const lines: string[] = [];
    for (const action of actions) {
      if (action.action === "delete") {
        lines.push(JSON.stringify({ delete: { _index: this.config.indexName, _id: action.id } }));
      } else {
        lines.push(JSON.stringify({ index: { _index: this.config.indexName, _id: action.id } }));
        lines.push(JSON.stringify(action.document ?? {}));
      }
    }
    const raw = await requestJson(this.searchUrl(), "/_bulk", {
      method: "POST",
      apiKey: this.searchKey(),
      timeoutMs: this.config.investigationTimeoutMs,
      headers: { "content-type": "application/x-ndjson" },
      body: `${lines.join("\n")}\n`,
    });
    const response = (raw ?? {}) as BulkResponse;
    const indexed: string[] = [];
    const deleted: string[] = [];
    const failures: BulkResult["failures"] = [];
    for (const [position, action] of actions.entries()) {
      const item = response.items?.[position];
      const operation = action.action === "index" ? item?.index : item?.delete;
      const status = operation?.status ?? 500;
      if (status >= 200 && status < 300) {
        if (action.action === "index") indexed.push(action.id);
        else deleted.push(action.id);
      } else if (action.action === "delete" && status === 404) {
        // Deleting a document that is already absent is idempotent.
        deleted.push(action.id);
      } else {
        const reason = operation?.error?.reason ?? operation?.error?.type ?? `bulk item failed with ${status}`;
        failures.push({ id: action.id, action: action.action, error: reason });
      }
    }
    if (response.errors && failures.length === 0) {
      failures.push({ id: "unknown", action: "index", error: "Elasticsearch bulk response reported errors." });
    }
    return { indexed, deleted, failures };
  }

  async deleteDocuments(ids: string[]): Promise<BulkResult> {
    return this.bulk(ids.map((id) => ({ action: "delete" as const, id })));
  }

  async getDocuments(ids: string[]): Promise<Map<string, FinancialDocument>> {
    const result = new Map<string, FinancialDocument>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return result;
    let raw: unknown;
    try {
      raw = await requestJson(this.searchUrl(), `/${encodeURIComponent(this.config.indexName)}/_mget`, {
        method: "POST",
        apiKey: this.searchKey(),
        timeoutMs: this.config.investigationTimeoutMs,
        body: {
          docs: unique.map((id) => ({ _index: this.config.indexName, _id: id })),
        },
      });
    } catch (error) {
      if (error instanceof ElasticHttpError && error.status === 404) return result;
      throw error;
    }
    const response = (raw ?? {}) as MgetResponse;
    for (const doc of response.docs ?? []) {
      if (doc.found && doc._source && doc._id) result.set(doc._id, documentFromSource(doc._source));
    }
    return result;
  }

  async refresh(): Promise<void> {
    await requestJson(this.searchUrl(), `/${encodeURIComponent(this.config.indexName)}/_refresh`, {
      method: "POST",
      apiKey: this.searchKey(),
      timeoutMs: this.config.investigationTimeoutMs,
    });
  }

  async ping(): Promise<void> {
    // Index-level health check. A cluster-level `GET /` requires the broad
    // `monitor` cluster privilege, which the scoped investigation key must not
    // need. Reading the mapping proves the index exists and is reachable.
    await requestJson(this.searchUrl(), `/${encodeURIComponent(this.config.indexName)}/_mapping`, {
      method: "GET",
      apiKey: this.searchKey(),
      timeoutMs: 10_000,
    });
  }

  async converse(input: ConverseInput): Promise<ConverseResponse> {
    if (input.conversationId) {
      throw new ElasticHttpError(
        409,
        "conversation_reuse_not_supported",
        "A fresh Agent Builder conversation is required for each investigation.",
      );
    }
    const raw = (await requestJson(this.kibanaUrl(), `${this.kibanaPath()}/converse`, {
      method: "POST",
      apiKey: this.kibanaKey(),
      timeoutMs: this.config.investigationTimeoutMs,
      headers: { "kbn-xsrf": "true" },
      body: { input: input.prompt, agent_id: input.agentId },
    })) as {
      conversation_id?: string;
      round_id?: string;
      status?: string;
      steps?: ConverseStep[];
      response?: { message?: string; prompts?: unknown[] };
      model_usage?: unknown;
      token_usage?: unknown;
    };
    const message = typeof raw.response?.message === "string" ? raw.response.message : "";
    if (!message) {
      throw new ElasticHttpError(
        502,
        "elastic_agent_empty_response",
        `Agent Builder returned no final message (status ${raw.status ?? "unknown"}).`,
      );
    }
    return {
      conversationId: raw.conversation_id ?? null,
      roundId: raw.round_id ?? null,
      status: raw.status ?? "unknown",
      message,
      steps: Array.isArray(raw.steps) ? raw.steps : [],
      modelUsage: raw.model_usage ?? raw.token_usage ?? null,
    };
  }
}
