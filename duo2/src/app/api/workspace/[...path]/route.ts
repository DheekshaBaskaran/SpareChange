import { consoleErrorResponse, consoleIdentity, consoleRelay, ConsoleError } from "@/lib/server/console-relay";
import { sameOrigin } from "@/lib/server/console-session";
const ID = "[a-zA-Z0-9_-]+";
const READ = [
  "^deals$", "^deals/" + ID + "$", "^deals/" + ID + "/execution-authorizations$",
  "^approvals$", "^financial-approvals$", "^contracts$", "^contracts/" + ID + "$",
  "^invoices$", "^invoices/" + ID + "$", "^payment-instructions$", "^provider-payables$", "^provider-payables/" + ID + "$",
  "^provider-payouts$", "^provider-payout-instructions$", "^ledger/(trial-balance|entries)$",
  "^finance/exceptions$", "^finance/exceptions/" + ID + "(/evidence)?$",
  "^creao/work-items$", "^creao/investigations/" + ID + "/runs$", "^audit$",
  "^market/(history|bridge)$", "^offers$",
].map(pattern => new RegExp(pattern));
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await context.params).path.join("/");
    if (!READ.some(pattern => pattern.test(path))) throw new ConsoleError(404, "not_found", "Resource not found.");
    const query = new URL(request.url).searchParams;
    const safe = new URLSearchParams();
    for (const key of ["deal_id","contract_id","invoice_id","status","limit","gpu_model","window_hours","participant_id","version","object_id","object_type"]) {
      const value = query.get(key); if (value && value.length <= 200) safe.set(key, value);
    }
    const data = await consoleRelay("/v1/" + path + (safe.size ? "?" + safe.toString() : ""));
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return consoleErrorResponse(error); }
}
export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (!sameOrigin(request)) throw new ConsoleError(403, "origin_forbidden", "Open this action from the workspace.");
    const path = (await context.params).path.join("/");
    const allowed = path === "approvals" || path === "deals/search" ||
      new RegExp("^financial-approvals/" + ID + "/decision$").test(path) ||
      new RegExp("^creao/investigations/" + ID + "/run$").test(path) ||
      new RegExp("^invoices/" + ID + "/payment-instruction$").test(path) ||
      new RegExp("^provider-payables/" + ID + "/payout-instruction$").test(path) ||
      new RegExp("^finance/exceptions/" + ID + "/propose-correction$").test(path);
    if (!allowed) throw new ConsoleError(403, "action_forbidden", "This action is not available in the console.");
    const session = await consoleIdentity();
    if (!session) throw new ConsoleError(401, "sign_in_required", "Sign in to perform this action.");
    let body = await request.json();
    if (path === "approvals") {
      if (session.principal.role !== "human" || !session.principal.humanUserId) throw new ConsoleError(403, "human_attestation_required", "Only a verified human participant can sign terms.");
      if (!["approved", "rejected"].includes(body.decision)) throw new ConsoleError(400, "invalid_decision", "Choose approve or reject.");
      body = { request_id: body.request_id, decision: body.decision, attested_by: session.principal.humanUserId, channel: "sparo-console", note: body.note };
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 200) throw new ConsoleError(400, "idempotency_key_required", "A valid idempotency key is required.");
    return Response.json(await consoleRelay("/v1/" + path, { method: "POST", body, idempotencyKey, requireSession: true }));
  } catch (error) { return consoleErrorResponse(error); }
}
