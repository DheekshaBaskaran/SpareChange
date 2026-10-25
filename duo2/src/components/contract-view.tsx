"use client";
import Link from "next/link";
import type { Deal } from "@/lib/types";
import { ExecuteButton } from "./execute-button";
import { Panel } from "./ui";
import { display, Evidence, FieldTable, object, PageTitle, records, ResourceState, Status, useResource } from "./console-ui";
export function ContractView({id}:{id:string}) {
 const resource=useResource("/api/workspace/contracts/"+encodeURIComponent(id));const contract=object(resource.data?.contract);const terms=object(contract.terms);
 const dealResource=useResource(contract.deal_id?"/api/workspace/deals/"+contract.deal_id:null);
 const parties=records(object(dealResource.data?.proposal).parties);
 const name=(id:unknown)=>display(parties.find(p=>p.id===id)?.name??id);
 const executable:Deal={dealId:display(contract.deal_id),title:"Contract "+id,type:"direct",buyer:{id:display(contract.buyer_id),name:name(contract.buyer_id)},provider:{id:display(contract.provider_id),name:name(contract.provider_id)},workload:{gpuModel:display(terms.gpu_model),gpuCount:Number(terms.gpu_count),durationMinutes:Number(terms.duration_hours)*60},price:{amount:Number(terms.compute_amount_minor)/100,currency:"USD"},source:"duo1-live",relay:{dealId:display(contract.deal_id),contractId:id}};
 const valid=contract.status==="active"&&Number.isFinite(executable.price.amount)&&executable.workload.gpuCount>0&&executable.workload.durationMinutes>0;
 return <div className="workspace-page"><PageTitle eyebrow="03 / DEALS / CONTRACT" title={"Contract "+id} description="The explicit execution leg and its contracted capacity."/><ResourceState error={resource.error} loading={!resource.data&&resource.loading}/>{resource.data&&<><div className="workspace-meta"><Status value={contract.status}/><span>Terms v{display(contract.deal_version)}</span><Link href={"/deals/"+contract.deal_id+"?tab=execution"}>View deal ↗</Link></div><div className="workspace-columns"><Panel className="workspace-card"><h3>{name(contract.buyer_id)} → {name(contract.provider_id)}</h3><Evidence value={terms}/></Panel><Panel className="workspace-card"><h3>Execute this contract</h3><p>Only this leg will run. Authorization and binding are checked by the executor. Payment remains subject to verification and financial approval.</p>{valid?<ExecuteButton deal={executable} label="Execute selected contract" className="mt-6"/>:<p className="help-text">An active, complete contract is required before execution.</p>}</Panel></div><Panel className="workspace-card"><h3>Rate lines</h3><FieldTable data={records(contract.rate_lines)} columns={[{key:"description",label:"Description"},{key:"gpu_model",label:"GPU"},{key:"gpu_count",label:"GPUs"},{key:"rate_minor_per_gpu_hour",label:"GPU-hour rate",money:true}]}/></Panel></>}</div>;
}
