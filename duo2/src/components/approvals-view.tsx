"use client";
import Link from "next/link";
import { useState } from "react";
import { ApprovalDialog } from "./approval-dialog";
import { display, minor, Notice, object, PageTitle, records, ResourceState, Status, useIdentity, useResource, type RecordData } from "./console-ui";
export function ApprovalsView() {
 const approvals=useResource("/api/workspace/approvals");const financial=useResource("/api/workspace/financial-approvals");
 const {principal}=useIdentity();const [selected,setSelected]=useState<{row:RecordData;financial:boolean}|null>(null);
 const [tab,setTab]=useState("all");
 const decisionButton=(row:RecordData,finance:boolean)=>{
  const pending=!["approved","rejected","expired","stale","superseded"].includes(String(row.status).toLowerCase())&&!row.approval;
  const allowed=principal?.role==="human"&&(finance?row.requested_by!==principal.id:object(row.participant).id===principal.partyId);
  return <button className="sparo-button" disabled={!pending||!allowed} onClick={()=>setSelected({row,financial:finance})}>{pending?"Review decision":"Recorded"}</button>;
 };
 return <div className="workspace-page"><PageTitle eyebrow="01 / OVERVIEW / APPROVALS" title="Approvals inbox" description="One decision at a time, scoped to a party and a version." action={<button className="sparo-button" onClick={()=>{approvals.reload();financial.reload();}}>Refresh</button>}/>
 <div className="workspace-tabs">{["all","deal approvals","financial"].map(t=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t}</button>)}</div>
 <Notice>{principal?"Signed in as "+principal.name+". You can act only for your bound identity and party.":"You are viewing as Observer. Sign in from the workspace access menu to review and sign your own obligations."}</Notice>
 {tab!=="financial"&&<><h3>Deal approvals</h3><ResourceState error={approvals.error} loading={!approvals.data&&approvals.loading} empty={!!approvals.data&&!records(approvals.data.approval_requests).length}/><table className="sparo-table"><thead><tr>{["Request / deal","Party","Amount","Version","Status","Decision"].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{records(approvals.data?.approval_requests).map(r=><tr key={display(r.id)}><td><Link href={"/deals/"+r.deal_id+"?tab=approvals"}>{display(r.obligation)} ↗</Link><small>{display(r.id)}</small></td><td>{display(object(r.participant).name)}</td><td>{minor(r.amount_minor)}</td><td>v{display(r.version)}</td><td><Status value={object(r.approval).decision??r.status}/></td><td>{decisionButton(r,false)}</td></tr>)}</tbody></table></>}
 {tab!=="deal approvals"&&<><h3>Financial approvals</h3><ResourceState error={financial.error} loading={!financial.data&&financial.loading} empty={!!financial.data&&!records(financial.data.financial_approvals).length}/><table className="sparo-table"><thead><tr>{["Action","Requested by","Object","Version","Status","Decision"].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{records(financial.data?.financial_approvals).map(r=><tr key={display(r.id)}><td>{display(r.action)}</td><td>{display(r.requested_by)}</td><td>{display(r.object_type)}<small>{display(r.object_id)}</small></td><td>v{display(r.object_version)}</td><td><Status value={r.status}/></td><td>{decisionButton(r,true)}</td></tr>)}</tbody></table><Notice>Every decision is individual and audited. A different human must approve a restricted action requested by you.</Notice></>}
 {selected&&<ApprovalDialog request={selected.row} financial={selected.financial} close={()=>setSelected(null)} done={()=>{approvals.reload();financial.reload();}}/>}</div>;
}
