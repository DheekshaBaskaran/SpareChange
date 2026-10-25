// GET /api/deals/[id]
// One approved deal by ID.

import type { NextRequest } from "next/server";
import { findDeal } from "@/lib/server/deal-source";

export async function GET(_request: NextRequest, context: RouteContext<"/api/deals/[id]">) {
  const { id } = await context.params;
  const deal = await findDeal(id);
  if (!deal) return Response.json({ success: false, error: "Deal not found" }, { status: 404 });
  return Response.json({ success: true, deal });
}
