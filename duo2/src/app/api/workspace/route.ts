import { connection } from "next/server";
import { getConfig } from "@/lib/server/config";
const RESOURCES = { invoices: "/v1/invoices", payables: "/v1/provider-payables", exceptions: "/v1/finance/exceptions", ledger: "/v1/ledger/entries", work: "/v1/creao/work-items", audit: "/v1/audit" };
export async function GET() {
 await connection();
 const { relay } = getConfig();
 const entries = await Promise.all(Object.entries(RESOURCES).map(async ([name, path]) => {
  if (!relay.apiUrl || !relay.agentKey) return [name, { error: "Relay is not connected. Configure the server-side Relay connection to view these records." }];
  try {
   const response = await fetch(relay.apiUrl + path, { headers: { authorization: "Bearer " + relay.agentKey, "x-relay-contract": "relay-duo1.v1" }, cache: "no-store", signal: AbortSignal.timeout(4000) });
   if (!response.ok) return [name, { error: response.status === 403 ? "This connection does not have permission to read these records." : "Relay is unavailable (" + response.status + ")." }];
   return [name, { data: await response.json() }];
  } catch { return [name, { error: "Relay could not be reached. Try refreshing or inspect system status." }]; }
 }));
 return Response.json({ feeds: Object.fromEntries(entries) }, { headers: { "Cache-Control": "no-store" } });
}
