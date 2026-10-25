import { connection } from "next/server";
import { consoleRelay } from "@/lib/server/console-relay";
const RESOURCES = { invoices: "/v1/invoices", payables: "/v1/provider-payables", exceptions: "/v1/finance/exceptions", ledger: "/v1/ledger/entries", work: "/v1/creao/work-items", audit: "/v1/audit", approvals: "/v1/approvals", financial: "/v1/financial-approvals", trial: "/v1/ledger/trial-balance", deals: "/v1/deals" };
export async function GET() {
 await connection();
 const entries = await Promise.all(Object.entries(RESOURCES).map(async ([name, path]) => {
  try {
   return [name, { data: await consoleRelay(path) }];
  } catch(error) { return [name, { error: (error as Error).message }]; }
 }));
 return Response.json({ feeds: Object.fromEntries(entries) }, { headers: { "Cache-Control": "no-store" } });
}
