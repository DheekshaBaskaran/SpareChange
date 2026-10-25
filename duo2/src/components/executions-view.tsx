"use client";
import { useState } from "react";
import { FieldTable, Notice, PageTitle, records, ResourceState, useResource } from "./console-ui";
export function ExecutionsView(){
 const resource=useResource("/api/jobs",2000);const [status,setStatus]=useState("All");
 const jobs=records(resource.data?.jobs);const statuses=["All","RUNNING","VERIFYING","PAYMENT_PENDING","COMPLETE","FAILED"];
 const visible=status==="All"?jobs:jobs.filter(j=>j.status===status);
 return <div className="workspace-page"><PageTitle eyebrow="03 / DEALS / EXECUTIONS" title="Executions" description="Follow each workload from authorization to verified settlement." action={<button className="sparo-button" onClick={()=>resource.reload()}>Refresh jobs</button>}/><div className="workspace-tabs">{statuses.map(s=><button className={status===s?"active":""} key={s} onClick={()=>setStatus(s)}>{s.replaceAll("_"," ")} {s==="All"?jobs.length:jobs.filter(j=>j.status===s).length}</button>)}</div><ResourceState error={resource.error} loading={!resource.data&&resource.loading} empty={!!resource.data&&!visible.length}/><FieldTable data={visible} columns={[{key:"jobId",label:"Job / deal leg"},{key:"status",label:"Status"},{key:"executionMode",label:"Executor"},{key:"createdAt",label:"Started"},{key:"verificationStatus",label:"Verification"},{key:"settlementLabel",label:"Settlement"}]} link={r=>"/jobs/"+r.jobId}/><Notice>Active jobs refresh every 2 seconds. Mock settlement means no funds moved. Open a job to inspect its execution, verification, and payment evidence.</Notice></div>;
}
