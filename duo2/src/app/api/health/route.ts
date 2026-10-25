// GET /api/health
//
// Liveness only. Container orchestrators must not depend on Solana RPC or any
// other external payment provider to decide whether this process is up: a
// provider outage would otherwise mark a healthy service unhealthy and block
// startup ordering. Funding/configuration truth stays on GET /api/system.

import { connection } from "next/server";

export async function GET() {
  await connection();
  return Response.json({ ok: true, service: "duo2-sparechange" });
}
