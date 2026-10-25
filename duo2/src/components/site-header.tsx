"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PersonaButton } from "./console-ui";
const NAV = [["/", "Overview", "38f09.svg"], ["/market", "Market", "3cacf.svg"], ["/deals", "Deals", "d5533.svg"], ["/money", "Money", "4b6e2.svg"], ["/activity", "Activity", "4bb00.svg"]];
export function SiteHeader() {
 const pathname = usePathname();
 const [connected, setConnected] = useState(false);
 const [search, setSearch] = useState(false);
 const [query, setQuery] = useState("");
 useEffect(() => {
  const load = () => fetch("/api/workspace/market/bridge").then(r => setConnected(r.ok)).catch(() => setConnected(false));
  load(); const timer = setInterval(load, 10000);
  const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearch(s => !s); } if (e.key === "Escape") setSearch(false); };
  window.addEventListener("keydown", key);
  return () => { clearInterval(timer); window.removeEventListener("keydown", key); };
 }, []);
 if (pathname === "/welcome") return null;
 const current = NAV.find(([href]) => href === "/" ? pathname === "/" : pathname.startsWith(href));
 return <>
 <aside className="sparo-sidebar"><Link href="/welcome" className="sparo-logo"><img src="/figma/19802.svg" alt="" />sparo</Link><span className="sparo-eyebrow workspace-label">WORKSPACE</span>
 <nav aria-label="Main navigation">{NAV.map(([href, label, icon]) => <Link key={href} href={href} aria-current={current?.[0] === href ? "page" : undefined} className={current?.[0] === href ? "active" : ""}><img src={"/figma/" + icon} alt="" />{label}</Link>)}</nav>
 <div className="sidebar-bottom"><Link href="/system"><img src="/figma/6e1ad.svg" alt="" />System status</Link><hr /><small>DEVELOPMENT WORKSPACE</small><p>Testnet rails · demo-scale settlement</p></div></aside>
 <header className="sparo-header"><span>Workspace / {current?.[1] ?? "Execution & system"}</span><button className="search-trigger" onClick={() => setSearch(true)}><img src="/figma/5576d.svg" alt="" />Search anything <kbd>Ctrl K</kbd></button><span className={"sparo-tag " + (connected ? "green" : "")}>{connected ? "Relay connected" : "Relay offline"}</span><PersonaButton /></header>
 {search && <div className="search-overlay" onClick={() => setSearch(false)}><section role="dialog" aria-modal="true" aria-label="Search workspace" className="search-dialog" onClick={e => e.stopPropagation()}><div className="flex justify-between"><h2>Search or jump to…</h2><button onClick={() => setSearch(false)} aria-label="Close search">✕</button></div><input autoFocus placeholder="Search pages…" value={query} onChange={e => setQuery(e.target.value)} />{[...NAV, ["/executions", "Executions"], ["/system", "System status"]].filter(([, label]) => label.toLowerCase().includes(query.toLowerCase())).map(([href, label]) => <Link key={href} href={href} onClick={() => setSearch(false)}>{label}<span>↗</span></Link>)}</section></div>}</>;
}
export function SiteHeaderFallback() { return <div className="sparo-header">Loading workspace…</div>; }
