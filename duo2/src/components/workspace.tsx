"use client";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Panel } from "@/components/ui";
import { ExecutionHistory } from "@/components/execution-history";
import { MarketTable } from "@/components/market-table";
import { MarketInsights } from "@/components/market-insights";
import type { Deal, GpuListing } from "@/lib/types";
import { usd } from "@/lib/format";
type Row = Record<string, unknown>;
type Feed = { data?: Record<string, unknown>; error?: string };
type Job = { jobId: string; status: string; buyer: string; provider: string };
const TITLES = {
 overview: ["01 / OVERVIEW", "A clearer view of your compute.", "Track the deals, execution, and money that need attention."],
 market: ["02 / MARKET", "Market & capacity", "Compare public reference prices with provider-authorized inventory."],
 deals: ["03 / DEALS", "Deals", "A better arrangement, or a clear reason to stop."],
 money: ["04 / MONEY", "Money, with the evidence attached.", "Trace every invoice, payout, and exception through the ledger."],
 activity: ["05 / ACTIVITY", "Every action leaves a trace.", "Coordinate the work queue and inspect the immutable audit history."],
};
function rows(feed: Feed | undefined, key: string): Row[] { const value = feed?.data?.[key]; return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value); }
export function Workspace({ view = "overview" }: { view?: keyof typeof TITLES }) {
 const [listings, setListings] = useState<GpuListing[]>([]);
 const [deals, setDeals] = useState<Deal[]>([]);
 const [jobs, setJobs] = useState<Job[]>([]);
 const [feeds, setFeeds] = useState<Record<string, Feed>>({});
 const [mode, setMode] = useState("Loading");
 const [error, setError] = useState("");
 const [updated, setUpdated] = useState("");
 const [busy, setBusy] = useState(true);
 const [gpu, setGpu] = useState("");
 const [region, setRegion] = useState("");
 const [query, setQuery] = useState("");
 const [tab, setTab] = useState("invoices");
 const load = useCallback(async () => {
  setBusy(true);
  try {
   const read = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error("Request failed"); return r.json(); };
   const [m, d, j, w] = await Promise.all([read("/api/market"), read("/api/deals"), read("/api/jobs"), read("/api/workspace")]);
   setListings(m.listings ?? []); setDeals(d.deals ?? []); setJobs(j.jobs ?? []); setFeeds(w.feeds ?? {});
   setMode(m.marketDataMode === "duo1-live" ? "Live market" : "Demo fixture");
   setUpdated(new Date().toLocaleTimeString()); setError("");
  } catch { setError("Could not refresh workspace data. Check system status or try again."); }
  finally { setBusy(false); }
 }, []);
 useEffect(() => { const changed = () => { void load(); }; window.addEventListener("sparo-session", changed); const initial = setTimeout(load, 0); const timer = setInterval(load, 10000); return () => { window.removeEventListener("sparo-session", changed); clearTimeout(initial); clearInterval(timer); }; }, [load]);
 const featured = deals.find(d => d.type === "multi_party") ?? deals[0];
 const prices = listings.filter(l => l.gpuModel.includes("A100")).map(l => l.pricePerGpuHour);
 const idle = listings.filter(l => l.listingType === "reserved-resale").reduce((n, l) => n + l.gpusAvailable, 0);
 const exceptions = rows(feeds.exceptions, "financial_exceptions");
 const active = jobs.filter(j => !["COMPLETE", "FAILED"].includes(j.status));
 const savings = featured?.impact?.buyerSavingsPerHour;
 const [eyebrow, title, description] = TITLES[view];
 const filtered = listings.filter(l => (!gpu || l.gpuModel === gpu) && (!region || l.region === region) && (l.providerName + l.gpuModel).toLowerCase().includes(query.toLowerCase()));
 return <div className="workspace-page">
 <div className="workspace-title"><div><div className="sparo-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><Link href="/approvals" className="sparo-button">View approvals</Link><button className="sparo-button" disabled={busy} onClick={load}>{busy ? "Refreshing…" : "Refresh"}</button></div>
 <div className="workspace-meta"><span className="sparo-tag">{mode}</span><span>{updated ? "Updated " + updated + " · Refreshes every 10s" : "Connecting to data sources…"}</span><span>Observer · read-only</span></div>
 {error && <div className="workspace-notice" role="alert">{error} <Link href="/system">System status ↗</Link></div>}
 {view === "overview" && <>
 <div className="metric-grid"><Kpi label="Pending approvals" value={feeds.approvals?.error ? "—" : rows(feeds.approvals, "approval_requests").filter(r => r.status === "pending").length} note="Version-scoped human decisions" /><Kpi label="Active executions" value={active.length} note="Running through verification" /><Kpi label="Open exceptions" value={feeds.exceptions?.error ? "—" : exceptions.filter(e => e.status !== "resolved").length} note={feeds.exceptions?.error ? "Finance connection unavailable" : "Review before settlement"} /><Kpi label="Net savings vs list" value={savings == null ? "—" : usd(savings * (featured?.workload.durationMinutes ?? 0) / 60)} note="Featured deal · reserved window" /></div>
 <div className="workspace-columns"><Panel className="workspace-card"><div className="sparo-eyebrow">FEATURED OPPORTUNITY</div><h2>{featured ? [featured.buyer.name, featured.provider.name, featured.replacementProvider?.name].filter(Boolean).join(" × ") : "No executable deals yet"}</h2>{featured ? <><div className="sparo-deal-graph"><img className="graph-lines" src="/figma/f3902.svg" alt="" /><Party className="buyer" name={featured.buyer.name} detail={"Buyer · needs " + featured.workload.gpuCount + " GPUs"} badge="Demand" /><Party className="holder" name={featured.provider.name} detail={"Holder · " + featured.workload.gpuModel} badge="Capacity" />{featured.replacementProvider && <Party className="provider" name={featured.replacementProvider.name} detail="Provider · backfill" badge="Capacity" />}<span className="graph-caption">Payment after verification</span></div><div className="deal-bottom"><p>{featured.workload.gpuCount} × {featured.workload.gpuModel} · {featured.workload.durationMinutes / 60}h<br />{usd(featured.price.amount)} cleared value</p><Link className="sparo-button primary" href={"/deals/" + featured.dealId}>Open deal →</Link></div></> : <p className="empty-state">Cleared deals will appear here when available.</p>}</Panel>
 <Panel className="workspace-card"><h3>Needs attention</h3>{jobs.filter(j => j.status === "FAILED").map(j => <div className="attention-item" key={j.jobId}><h4>Execution needs review</h4><p>{j.provider} → {j.buyer}</p><Link href={"/jobs/" + j.jobId}>Review ↗</Link></div>)}{exceptions.slice(0, 3).map((e, i) => <div className="attention-item" key={i}><h4>{text(e.kind ?? e.code ?? "Financial exception")}</h4><p>{text(e.status)}</p><Link href="/money">Review ↗</Link></div>)}{!exceptions.length && !jobs.some(j => j.status === "FAILED") && <div className="attention-item"><h4>{feeds.exceptions?.error ? "Finance data unavailable" : "No flagged issues"}</h4><p>{feeds.exceptions?.error ? "Connect Relay to review financial exceptions." : "No failed executions or reported exceptions."}</p><Link href="/system">Inspect system ↗</Link></div>}<div className="attention-item"><h4>Every signature is a human decision.</h4><p>Observer access cannot approve terms or move funds.</p><Link href="/deals">Review deals ↗</Link></div></Panel></div>
 <div className="workspace-columns"><Panel className="workspace-card"><div className="section-title"><h3>Recent executions</h3><Link href="/executions">View all ↗</Link></div><ExecutionHistory limit={4} showDemoRecords={false} /></Panel><Panel className="workspace-card"><h3>Market pulse</h3><div className="pulse-price">{prices.length ? usd(Math.min(...prices)) + " — " + usd(Math.max(...prices)) : "—"}</div><p>A100 reference-price spread</p><p className="accent">{idle} idle reserved GPUs</p><Link href="/market">Explore market ↗</Link></Panel></div>
 </>}
 {view === "market" && <>
 <div className="workspace-notice">△ &nbsp; Reference prices are not executable inventory.<small>Use listings as a baseline. Only explicitly authorized inventory can enter a cleared deal.</small></div>
 <div className="metric-grid"><Kpi label="Reference GPUs" value={listings.reduce((n, l) => n + l.gpusAvailable, 0)} note={"Across " + listings.length + " observed listings"} /><Kpi label="Idle reserved GPUs" value={idle} note="Capacity on the market" /><Kpi label="A100 price spread" value={prices.length ? usd(Math.max(...prices) - Math.min(...prices)) : "—"} note="Per GPU-hour" /><Kpi label="Providers" value={new Set(listings.map(l => l.providerName)).size} note={mode} /></div>
 <div className="market-filters"><input aria-label="Search listings" placeholder="Search providers or GPUs" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="GPU model" value={gpu} onChange={e => setGpu(e.target.value)}><option value="">GPU: All</option>{[...new Set(listings.map(l => l.gpuModel))].map(g => <option key={g}>{g}</option>)}</select><select aria-label="Region" value={region} onChange={e => setRegion(e.target.value)}><option value="">Region: All</option>{[...new Set(listings.map(l => l.region))].map(r => <option key={r}>{r}</option>)}</select><span>{filtered.length} listings</span></div>
 <MarketTable listings={filtered} />{!filtered.length && <p className="empty-state">No listings match these filters.</p>}<MarketInsights /></>}
 {view === "deals" && <><div className="market-filters"><input aria-label="Search deals" placeholder="Search deals or participants" value={query} onChange={e => setQuery(e.target.value)} /><span>{deals.length} executable deals</span><Link className="sparo-button" href="/executions">View executions</Link></div><table className="sparo-table"><thead><tr>{["Deal / ID", "Parties", "Workload", "Value", "Source", ""].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{deals.filter(d => JSON.stringify([d.title, d.buyer.name, d.provider.name]).toLowerCase().includes(query.toLowerCase())).map(d => <tr key={d.dealId}><td>{d.title ?? "Compute deal"}<small>{d.dealId}</small></td><td>{d.buyer.name} · {d.provider.name}</td><td>{d.workload.gpuCount} × {d.workload.gpuModel}<small>{d.workload.durationMinutes / 60} hour window</small></td><td>{usd(d.price.amount)}</td><td><span className="sparo-tag">{d.source === "duo1-live" ? "Relay" : "Demo"}</span></td><td><Link href={"/deals/" + d.dealId}>Review →</Link></td></tr>)}</tbody></table>{!deals.length && <p className="empty-state">No executable deals available.</p>}<div className="workspace-notice">Execution requires an authorized deal. Multi-party exchanges remain separate contracts.</div></>}
 {view === "money" && <><div className="workspace-tabs">{["invoices", "payables", "exceptions", "ledger"].map(t => <button className={tab === t ? "active" : ""} key={t} onClick={() => setTab(t)}>{t === "payables" ? "Payables & payouts" : t}</button>)}</div><DataTable feed={feeds[tab]} data={rows(feeds[tab], ({invoices:"invoices",payables:"payables",exceptions:"financial_exceptions",ledger:"entries"} as Record<string,string>)[tab])} columns={tab === "invoices" ? ["id","contract_id","total_minor","status","created_at"] : tab === "ledger" ? ["id","description","total_debit_minor","total_credit_minor","created_at"] : ["id","status","amount_minor","created_at"]} /><div className="workspace-notice">Invoice value ≠ on-chain value. Settlement uses testnet rails and demo-scale amounts. Financial actions require participant-bound authorization.</div></>}
 {view === "activity" && <><h3>Work queue</h3><DataTable feed={feeds.work} data={rows(feeds.work, "work_items")} columns={["id","kind","status","claimed_by","created_at"]} /><div className="workspace-notice">Work claims are atomic. Observer access cannot claim or complete work.</div><h3>Recent audit trail</h3><DataTable feed={feeds.audit} data={rows(feeds.audit, "audit_events")} columns={["occurred_at","actor_role","action","object_id"]} /></>}
 </div>;
}
function Kpi({label,value,note}:{label:string;value:string|number;note:string}) { return <Panel className="kpi"><span>{label}</span><strong>{value}</strong><small>{note}</small></Panel>; }
function Party({className,name,detail,badge}:{className:string;name:string;detail:string;badge:string}) { return <div className={"graph-party " + className}><strong>{name}</strong><small>{detail}</small><span className="sparo-tag copper">{badge}</span></div>; }
function DataTable({feed,data,columns}:{feed?:Feed;data:Row[];columns:string[]}) {
 if(feed?.error) return <Panel className="empty-state"><h3>Data unavailable</h3><p>{feed.error}</p><Link href="/system">Review system connection ↗</Link></Panel>;
 if(!feed) return <p className="empty-state">Loading records…</p>;
 if(!data.length) return <Panel className="empty-state">No records to show.</Panel>;
 return <div className="overflow-x-auto"><table className="sparo-table"><thead><tr>{columns.map(c=><th key={c}>{c.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{data.map((r,i)=><tr key={text(r.id ?? i)}>{columns.map(c=><td key={c}>{c.endsWith("_minor") && r[c] != null ? usd(Number(r[c])/100) : text(r[c])}</td>)}</tr>)}</tbody></table></div>;
}
