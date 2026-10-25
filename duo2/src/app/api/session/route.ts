import { cookies } from "next/headers";
import { consoleErrorResponse, consoleIdentity, consoleRelay, ConsoleError } from "@/lib/server/console-relay";
import { createConsoleSession, deleteConsoleSession, sameOrigin, SESSION_COOKIE } from "@/lib/server/console-session";
export async function GET() {
  return Response.json({ principal: (await consoleIdentity())?.principal ?? null }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new ConsoleError(403, "origin_forbidden", "Open this form from the workspace.");
    const { key } = await request.json();
    if (typeof key !== "string" || key.length < 8 || key.length > 512) throw new ConsoleError(400, "invalid_credential", "Enter your participant credential.");
    const { principal } = await consoleRelay("/v1/session", { credential: key });
    if (!["human", "finance"].includes(principal.role)) throw new ConsoleError(403, "human_credential_required", "Use a human participant or finance operator credential.");
    const jar = await cookies();
    deleteConsoleSession(jar.get(SESSION_COOKIE)?.value);
    jar.set(SESSION_COOKIE, createConsoleSession(key, principal), { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "strict", path: "/", maxAge: 28800 });
    return Response.json({ principal });
  } catch (error) { return consoleErrorResponse(error); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin forbidden." }, { status: 403 });
  const jar = await cookies();
  deleteConsoleSession(jar.get(SESSION_COOKIE)?.value); jar.delete(SESSION_COOKIE);
  return Response.json({ principal: null });
}
