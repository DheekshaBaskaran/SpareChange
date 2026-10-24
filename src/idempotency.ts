import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { IDEMPOTENCY_HEADER } from "./contract.js";
import type { Db } from "./db/client.js";
import { ApiError } from "./errors.js";
import { requirePrincipal } from "./auth/service.js";

interface IdempotencyRow {
  method: string;
  path: string;
  request_hash: string;
  state: "pending" | "completed";
  status_code: number | null;
  response_body: unknown;
}

export interface IdempotentResult {
  statusCode: number;
  body: unknown;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashRequest(body: unknown): string {
  return createHash("sha256").update(stableStringify(body), "utf8").digest("hex");
}

function idempotencyKey(request: FastifyRequest): string {
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new ApiError(
      400,
      "idempotency_key_required",
      "Every write request must include a non-empty Idempotency-Key header.",
      { retryable: false },
    );
  }
  if (key.length > 255) {
    throw new ApiError(400, "idempotency_key_invalid", "Idempotency-Key must be at most 255 characters.");
  }
  return key.trim();
}

/**
 * Inserts a claim before executing the handler. A concurrent duplicate sees
 * `pending` and receives a retryable 409 instead of double-charging or
 * double-recording a decision. Completed responses, including deterministic
 * 4xx errors, are replayed byte-for-byte.
 */
export async function idempotent(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Db,
  handler: () => Promise<IdempotentResult>,
): Promise<FastifyReply> {
  const principal = requirePrincipal(request.principal);
  const key = idempotencyKey(request);
  const method = request.method.toUpperCase();
  const path = request.routeOptions.url ?? request.url.split("?")[0] ?? request.url;
  const requestHash = hashRequest(request.body ?? null);
  await db.query(
    `DELETE FROM idempotency_keys
     WHERE principal_id = $1 AND idempotency_key = $2 AND expires_at <= now()`,
    [principal.id, key],
  );

  const inserted = await db.query<{ principal_id: string }>(
    `INSERT INTO idempotency_keys
       (principal_id, idempotency_key, method, path, request_hash, state, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', now() + interval '24 hours')
     ON CONFLICT (principal_id, idempotency_key) DO NOTHING
     RETURNING principal_id`,
    [principal.id, key, method, path, requestHash],
  );

  if (inserted.rowCount === 0) {
    const existing = await db.query<IdempotencyRow>(
      `SELECT method, path, request_hash, state, status_code, response_body
       FROM idempotency_keys
       WHERE principal_id = $1 AND idempotency_key = $2`,
      [principal.id, key],
    );
    const row = existing.rows[0];
    if (!row) {
      throw new ApiError(409, "idempotency_in_progress", "Retry the request.", { retryable: true });
    }
    if (row.method !== method || row.path !== path || row.request_hash !== requestHash) {
      throw new ApiError(
        409,
        "idempotency_conflict",
        "This Idempotency-Key was already used for a different request.",
        { retryable: false },
      );
    }
    if (row.state !== "completed" || row.status_code === null) {
      throw new ApiError(
        409,
        "idempotency_in_progress",
        "An identical request is still being processed. Retry shortly.",
        { retryable: true },
      );
    }
    reply.header("Idempotency-Replayed", "true");
    return reply.status(row.status_code).send(row.response_body);
  }

  try {
    const result = await handler();
    if (result.statusCode >= 500) {
      // A 5xx is not a durable outcome. Release the key so the caller can retry.
      await db.query(
        `DELETE FROM idempotency_keys WHERE principal_id = $1 AND idempotency_key = $2`,
        [principal.id, key],
      );
      return reply.status(result.statusCode).send(result.body);
    }
    await db.query(
      `UPDATE idempotency_keys
       SET state = 'completed', status_code = $3, response_body = $4::jsonb
       WHERE principal_id = $1 AND idempotency_key = $2`,
      [principal.id, key, result.statusCode, JSON.stringify(result.body)],
    );
    return reply.status(result.statusCode).send(result.body);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode < 500) {
      await db.query(
        `UPDATE idempotency_keys
         SET state = 'completed', status_code = $3, response_body = $4::jsonb
         WHERE principal_id = $1 AND idempotency_key = $2`,
        [principal.id, key, error.statusCode, JSON.stringify(error.toBody())],
      );
    } else {
      await db.query(
        `DELETE FROM idempotency_keys WHERE principal_id = $1 AND idempotency_key = $2`,
        [principal.id, key],
      );
    }
    throw error;
  }
}
