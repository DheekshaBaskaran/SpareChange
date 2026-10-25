import { randomBytes } from "node:crypto";

export interface ConsolePrincipal {
  id: string; name: string; role: string; partyId: string | null; humanUserId: string | null;
}
interface Session { key: string; principal: ConsolePrincipal; expires: number }
const globalSessions = globalThis as typeof globalThis & { consoleSessions?: Map<string, Session> };
const sessions = globalSessions.consoleSessions ??= new Map();
export const SESSION_COOKIE = "sparo_session";
export function createConsoleSession(key: string, principal: ConsolePrincipal) {
  for (const [id, s] of sessions) if (s.expires < Date.now()) sessions.delete(id);
  if (sessions.size >= 1000) throw new Error("Session capacity reached. Try again later.");
  const id = randomBytes(32).toString("hex");
  sessions.set(id, { key, principal, expires: Date.now() + 8 * 60 * 60 * 1000 });
  return id;
}
export function readConsoleSession(id?: string) {
  const session = id ? sessions.get(id) : undefined;
  if (!session || session.expires < Date.now()) { if (id) sessions.delete(id); return null; }
  return session;
}
export function deleteConsoleSession(id?: string) { if (id) sessions.delete(id); }
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}
