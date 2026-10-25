"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Deal } from "@/lib/types";
import { DealGraph } from "./deal-graph";
import { ExecuteButton } from "./execute-button";
import { Panel } from "./ui";
import { ApprovalDialog } from "./approval-dialog";
import { display, Evidence, FieldTable, minor, Notice, object, PageTitle, records, ResourceState, Status, useIdentity, useResource, type RecordData } from "./console-ui";
export function DealDetailView({id}:{id:string}) {
 const search=useSearchParams();const [tab,setTab]=useState(search.get("tab")??"terms");
 const live=useResource("/api/workspace/deals/"+encodeURIComponent(id));
 const executable=useResource("/api/deals/"+encodeURIComponent(id));
 const contracts=useResource("/api/workspace/contracts?deal_id="+encodeURIComponent(id));
 const jobs=useResource("/api/jobs");
 const {principal}=useIdentity();
 const [selected,setSelected]=useState<RecordData|null>(null);const [baseline,setBaseline]=useState(false);
 const deal=object(live.data?.deal);const proposal=object(live.data?.proposal);
 const demo=executable.data?.deal as Deal|undefined;
 const version=Number(deal.current_version??1);
 const participants=records(proposal.parties);
 const approvals=records(live.data?.approval_requests);
 const contractRows=records(contracts.data?.contracts);
 const title=display(deal.title??demo?.title??"Deal");
 const currentJobs=records(jobs.data?.jobs).filter(j=>j.dealId===id);
 const ready=!!live.data||!!demo;
 return <div className="workspace-page"><Link className="back-link" href="/deals">← All deals</Link><PageTitle eyebrow={"03 / DEALS / "+id} title={tab==="approvals"?"Review the same terms. Sign your part.":title} description={tab==="approvals"?"Each participant attests to the obligations in the current terms version.":"Review the arrangement, economics, approvals, and execution evidence."} action={<Link href="/approvals" className="sparo-button">View approvals</Link>}/>
 <div className="workspace-meta"><Status value={deal.status??(demo?"Demo fixture":"Loading")}/>{live.data&&<span className="sparo-tag copper">Terms v{version}</span>}<span>{live.data?"Relay record":"Labeled demonstration · no participant signatures inferred"}</span></div>
 <div className="workspace-tabs">{["terms","approvals","execution"].map(t=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t}</button>)}</div>
 {!ready&&<ResourceState error={!live.loading&&!executable.loading?live.error||executable.error:""} loading={live.loading||executable.loading}/>}
 {tab==="terms"&&ready&&<><div className="workspace-columns"><Panel className="workspace-card"><div className="section-title"><h3>The arrangement</h3><button className="sparo-button" onClick={()=>setBaseline(!baseline)}>{baseline?"Sparo cleared":"Independent rental"}</button></div>{demo?<DealGraph deal={demo}/>:<div className="party-grid">{participants.map(p=><div className="identity-card" key={display(p.id)}><div className="sparo-eyebrow">{display(p.role)}</div><h3>{display(p.name)}</h3><p>{display(p.obligation)}</p><strong>{minor(p.amount_minor)}</strong></div>)}</div>}{baseline&&<Notice>Independent baseline: {minor(proposal.baseline_cost_minor??(demo?.impact?.marketPricePerGpuHour!=null?demo.impact.marketPricePerGpuHour*demo.workload.gpuCount*demo.workload.durationMinutes/60*100:undefined))}. This comparison does not modify the cleared terms.</Notice>}<FieldTable data={participants} columns={[{key:"name",label:"Participant"},{key:"role",label:"Role"},{key:"amount_minor",label:"Amount",money:true}]}/>{demo&&<p>{demo.workload.gpuCount} × {demo.workload.gpuModel} · {demo.workload.durationMinutes/60}h · {demo.workload.region??demo.provider.region}</p>}</Panel>
 <Panel className="workspace-card"><h3>Economics</h3><dl className="evidence-fields">{[["Independent baseline",proposal.baseline_cost_minor],["Cleared buyer cost",proposal.total_cost_minor??(demo?demo.price.amount*100:undefined)],["Coordination fee",proposal.coordination_fee_minor],["Projected savings",proposal.projected_savings_minor??(demo?.impact?.buyerSavingsPerHour!=null?demo.impact.buyerSavingsPerHour*demo.workload.durationMinutes/60*100:undefined)]].map(([label,value])=><div key={String(label)}><dt>{display(label)}</dt><dd>{minor(value)}</dd></div>)}</dl><div className="sparo-eyebrow">CURRENT WINDOW</div><Evidence value={proposal.window??(demo?{gpu:demo.workload.gpuModel,count:demo.workload.gpuCount,duration_minutes:demo.workload.durationMinutes}:null)}/></Panel></div>
 <Panel className="workspace-card"><h3>Terms & integrity</h3><Evidence value={live.data?.approval_integrity??{source:"Demo fixture",execution:"Demo workloads can be run; Relay signatures are not fabricated."}}/></Panel></>}
 {tab==="approvals"&&<><Notice>Handoff does not authorize settlement. Execution authorization and payment approval are separate steps.</Notice>{!live.data?<ResourceState error={live.error} loading={live.loading}/>:<><div className="party-grid">{approvals.map(r=><Panel className="workspace-card" key={display(r.id)}><div className="sparo-eyebrow">PARTICIPANT</div><h2>{display(object(r.participant).name)}</h2><Status value={object(r.approval).decision??r.status}/><hr/><p>{display(r.obligation)}</p><div className="pulse-price">{minor(r.amount_minor)}</div><p>Terms version {display(r.version)}</p><p>{display(object(r.approval).attested_by??"Human participant approval required")}</p><button className="sparo-button primary" disabled={principal?.role!=="human"||principal.partyId!==object(r.participant).id||Number(r.version)!==version||!!r.approval||String(r.status)!=="pending"} onClick={()=>setSelected(r)}>Review v{display(r.version)}</button><p className="help-text">{principal?.partyId===object(r.participant).id?"Review your obligation before signing.":"Sign in as the matching party to attest."}</p></Panel>)}</div>{!approvals.length&&<Notice>No approval requests exist for this version.</Notice>}<div className="workspace-columns"><Panel className="workspace-card"><h3>Version history</h3><FieldTable data={records(live.data?.negotiation_events)} columns={[{key:"version",label:"Version"},{key:"event_type",label:"Change"},{key:"created_at",label:"Recorded"}]}/></Panel><Panel className="workspace-card"><h3>Every signature is a human decision.</h3><p>Agents and service credentials cannot record participant approvals. Your acknowledgment is bound to the current version and your participant identity.</p></Panel></div></>}</>}
 {tab==="execution"&&<><Notice>Each deal leg runs under its own contract. Choose an explicit contract for a multi-party exchange. Contracted capacity and measured runtime remain separate.</Notice>
 <ResourceState error={live.data?contracts.error:""} loading={!!live.data&&contracts.loading&&!contracts.data}/>
 {contractRows.length>0&&<FieldTable data={contractRows} columns={[{key:"id",label:"Contract"},{key:"buyer_id",label:"Buyer"},{key:"provider_id",label:"Provider"},{key:"status",label:"Status"}]} link={r=>"/contracts/"+r.id}/>}
 <h3>Executions for this deal</h3><FieldTable data={currentJobs} columns={[{key:"jobId",label:"Job"},{key:"status",label:"Status"},{key:"executionMode",label:"Executor"},{key:"createdAt",label:"Started"}]} link={r=>"/jobs/"+r.jobId}/>{!currentJobs.length&&<p className="empty-state">No executions recorded for this deal.</p>}
 {demo&&<Panel className="workspace-card"><h3>Start authorized execution</h3><p>Provision, run, verify, then follow the configured settlement rail. The executor validates Relay authorization before running linked workloads.</p><ExecuteButton deal={demo} label="Start execution" size="md" className="mt-4 max-w-xs"/></Panel>}
 </>}
 {selected&&<ApprovalDialog request={selected} currentVersion={version} close={()=>setSelected(null)} done={()=>{live.reload();}}/>}</div>;
}

