export class ElasticHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ElasticHttpError";
    this.status = status;
    this.code = code;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

function errorCode(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; reason?: string } | string; code?: string };
    if (typeof parsed.error === "object" && parsed.error?.type) return parsed.error.type;
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.code === "string") return parsed.code;
  } catch {
    // Fall through to an HTTP status code.
  }
  return `http_${status}`;
}

function errorDetail(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 1_000 ? `${trimmed.slice(0, 1_000)}…` : trimmed;
}

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  apiKey: string;
  body?: unknown;
  timeoutMs: number;
  headers?: Record<string, string>;
}

export async function requestJson(
  baseUrl: string,
  path: string,
  options: HttpRequestOptions,
): Promise<unknown> {
  if (!baseUrl) throw new ElasticHttpError(503, "elastic_not_configured", "Elastic is not configured.");
  const url = `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    authorization: `ApiKey ${options.apiKey}`,
    accept: "application/json",
    ...options.headers,
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === "string") {
      body = options.body;
    } else {
      body = JSON.stringify(options.body);
      headers["content-type"] = "application/json";
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ElasticHttpError(503, "elastic_network_error", `Elastic request failed: ${message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new ElasticHttpError(
      response.status,
      errorCode(response.status, text),
      `Elastic returned HTTP ${response.status}: ${errorDetail(text)}`,
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ElasticHttpError(502, "elastic_invalid_json", "Elastic returned a non-JSON response.");
  }
}

export async function requestText(
  baseUrl: string,
  path: string,
  options: HttpRequestOptions,
): Promise<string> {
  if (!baseUrl) throw new ElasticHttpError(503, "elastic_not_configured", "Elastic is not configured.");
  const url = `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    authorization: `ApiKey ${options.apiKey}`,
    accept: "text/plain",
    ...options.headers,
  };
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: typeof options.body === "string" ? options.body : options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ElasticHttpError(503, "elastic_network_error", `Elastic request failed: ${message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ElasticHttpError(
      response.status,
      errorCode(response.status, text),
      `Elastic returned HTTP ${response.status}: ${errorDetail(text)}`,
    );
  }
  return text;
}
