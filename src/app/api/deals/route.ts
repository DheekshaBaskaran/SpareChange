// GET /api/deals
// Approved deals to show in the UI: live from Duo 1 when available, demo deals otherwise.

import { connection } from "next/server";
import { getDealFeed } from "@/lib/server/deal-source";

export async function GET() {
  await connection();
  const feed = await getDealFeed();
  return Response.json({ success: true, ...feed });
}
