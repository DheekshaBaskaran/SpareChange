import { cookies } from "next/headers";
import { getConfig } from "./config";
import { readConsoleSession, SESSION_COOKIE } from "./console-session";

export class ConsoleError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function consoleIdentity() {
  return readConsoleSession((await cookies()).get(SESSION_COOKIE)?.value);
}
export async function consoleRelay(path: string, options: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string; credential?: string; requireSession?: boolean } = {}) {
  const { relay } = getConfig();
  const session = await consoleIdentity();
  if (options.requireSession && !session) throw new ConsoleError(401, "sign_in_required", "Sign in with your participant credential before making this decision.");
  const key = options.credential ?? session?.key ?? relay.agentKey;
  if (!relay.apiUrl || !key) throw new ConsoleError(503, "relay_unavailable", "Relay is not connected. Configure the server connection to load this data.");
  let response: Response;
  try {
    response = await fetch(relay.apiUrl + path, {
      method: options.method ?? "GET", cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: { authorization: "Bearer " + key, "x-relay-contract": "relay-duo1.v1",
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch { throw new ConsoleError(503, "relay_unavailable", "Relay could not be reached. Try again or inspect system status."); }
  const data = await response.json();
  if (!response.ok) throw new ConsoleError(response.status, data.code ?? "relay_error", data.detail ?? "The request could not be completed.");
  return data;
}
export function consoleErrorResponse(error: unknown) {
  const known = error instanceof ConsoleError;
  return Response.json({ error: known ? error.message : "The request could not be completed.", code: known ? error.code : "internal_error" },
    { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}
