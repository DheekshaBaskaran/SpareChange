"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ConsolePrincipal } from "@/lib/server/console-session";

export type RecordData = Record<string, unknown>;
export function object(value: unknown): RecordData { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordData : {}; }
export function records(value: unknown): RecordData[] { return Array.isArray(value) ? value.map(object) : []; }
export function display(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") { const row = object(value); return String(row.name ?? row.label ?? row.id ?? "Recorded evidence"); }
  return String(value);
}
export function minor(value: unknown): string { return value == null ? "—" : new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(Number(value) / 100); }
export async function requestJson(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache:"no-store", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.code === "terms_version_stale" ? "The terms changed. Refresh and review the current version before signing." : body.error ?? body.detail ?? "The request failed.");
  return body;
}
export function useResource(path: string | null, interval = 10000) {
  const [data, setData] = useState<RecordData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    if (!path) { setLoading(false); return; }
    setLoading(true);
    try { const body = await requestJson(path); if(current === sequence.current) { setData(body); setError(""); } }
    catch(e) { if(current === sequence.current) setError((e as Error).message); }
    finally { if(current === sequence.current) setLoading(false); }
  }, [path]);
  useEffect(() => { const first = setTimeout(reload, 0); const timer = setInterval(reload, interval); const changed=()=>{void reload();}; window.addEventListener("sparo-session",changed); return () => { sequence.current++; clearTimeout(first); clearInterval(timer); window.removeEventListener("sparo-session",changed); }; }, [reload, interval]);
  return { data, error, loading, reload };
}
export function useIdentity() {
  const resource = useResource("/api/session", 60000);
  return { ...resource, principal: resource.data?.principal as ConsolePrincipal | null | undefined };
}
export function Dialog({ title, children, close }: {title:string;children:ReactNode;close:()=>void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog=ref.current; const previous=document.activeElement as HTMLElement; dialog?.showModal(); return ()=>{dialog?.close();previous?.focus();}; }, []);
  return <dialog ref={ref} className="console-dialog" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}><div className="section-title"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog">✕</button></div>{children}</dialog>;
}
export function PersonaButton() {
  const {principal,reload}=useIdentity();
  const [open,setOpen]=useState(false);const [key,setKey]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  async function signIn(e:React.FormEvent) { e.preventDefault();setBusy(true);setError("");try { await requestJson("/api/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key})});setKey("");setOpen(false);await reload();window.dispatchEvent(new Event("sparo-session")); }catch(e){setError((e as Error).message);}finally{setBusy(false);} }
  async function signOut(){await requestJson("/api/session",{method:"DELETE"});await reload();window.dispatchEvent(new Event("sparo-session"));setOpen(false);}
  return <><button className="sparo-button" onClick={()=>setOpen(true)}>{principal?.name ?? "Observer"} ⌄</button>{open&&<Dialog title="Choose your workspace access" close={()=>{setOpen(false);setKey("");setError("");}}><p>Observer can explore records. Signing terms requires a credential bound to your party and human identity.</p>{principal ? <><div className="identity-card"><strong>{principal.name}</strong><p>{principal.role} · {principal.partyId ?? "Finance workspace"}</p></div><button className="sparo-button" onClick={signOut}>Return to Observer</button></> : <form onSubmit={signIn}><label>Participant credential<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} required minLength={8} maxLength={512}/></label><p className="help-text">Your credential is kept in a server session and never returned to browser storage. Sessions expire after 8 hours.</p>{error&&<p role="alert" className="error-text">{error}</p>}<button className="sparo-button primary" disabled={busy}>{busy?"Connecting…":"Sign in securely"}</button></form>}</Dialog>}</>;
}
export function PageTitle({eyebrow,title,description,action}:{eyebrow:string;title:string;description?:string;action?:ReactNode}) { return <div className="workspace-title"><div><div className="sparo-eyebrow">{eyebrow}</div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{action}</div>; }
export function Notice({children,error=false}:{children:ReactNode;error?:boolean}) { return <div className={"workspace-notice "+(error?"error":"")} role={error?"alert":"status"}>{children}</div>; }
export function ResourceState({error,loading,empty=false}:{error:string;loading:boolean;empty?:boolean}) {
  if(error)return <Notice error>{error} <Link href="/system">Review system status ↗</Link></Notice>;
  if(loading)return <div className="empty-state" aria-busy="true">Loading current records…</div>;
  if(empty)return <div className="empty-state">No records to show.</div>;
  return null;
}
export function FieldTable({data,columns,link}:{data:RecordData[];columns:{key:string;label:string;money?:boolean}[];link?:(row:RecordData)=>string}) { return <div className="overflow-x-auto"><table className="sparo-table"><thead><tr>{columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{data.map((r,i)=><tr key={display(r.id??i)}>{columns.map((c,j)=><td key={c.key}>{j===0&&link?<Link href={link(r)}>{display(r[c.key])} ↗</Link>:c.money?minor(r[c.key]):c.key==="status"?<Status value={r[c.key]}/>:display(r[c.key])}</td>)}</tr>)}</tbody></table></div>; }
export function Status({value}:{value:unknown}) {const s=display(value);return <span className={"sparo-tag "+(/approved|complete|paid|authorized|resolved|confirmed/i.test(s)?"green":/failed|blocked|rejected/i.test(s)?"red":"copper")}>{s.replaceAll("_"," ")}</span>;}
export function Evidence({value}:{value:unknown}) {
 if(value==null)return <p className="help-text">No evidence recorded.</p>;
 if(Array.isArray(value))return <div className="evidence-list">{value.map((v,i)=><Evidence key={i} value={v}/>)}</div>;
 if(typeof value==="object")return <dl className="evidence-fields">{Object.entries(object(value)).map(([k,v])=><div key={k}><dt>{k.replaceAll("_"," ")}</dt><dd>{v && typeof v==="object"?<Evidence value={v}/>:k.endsWith("_minor")?minor(v):display(v)}</dd></div>)}</dl>;
 return <span>{display(value)}</span>;
}
