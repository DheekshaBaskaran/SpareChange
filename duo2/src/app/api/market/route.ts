// GET /api/market
// GPU marketplace listings (live from Duo 1 when configured, demo listings otherwise).

import { connection } from "next/server";
import { getMarketFeed } from "@/lib/server/market-source";

export async function GET() {
  await connection();
  return Response.json({ success: true, ...(await getMarketFeed()) });
}
