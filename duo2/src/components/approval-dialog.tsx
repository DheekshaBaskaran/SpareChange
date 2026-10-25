"use client";
import { useState } from "react";
import { Dialog, display, minor, object, requestJson, type RecordData } from "./console-ui";
export function ApprovalDialog({ request, financial=false, currentVersion, close, done }: {
 request:RecordData;financial?:boolean;currentVersion?:number;close:()=>void;done:()=>void;
}) {
 const [ack,setAck]=useState("");const [note,setNote]=useState("");const [decision,setDecision]=useState("approved");
 const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const [idempotency]=useState(()=>crypto.randomUUID());
 const version=Number(request.version??request.object_version??currentVersion??1);
 const phrase=(decision==="approved"?"APPROVE":"REJECT")+" V"+version;
 async function submit(e:React.FormEvent) {
  e.preventDefault();if(ack!==phrase)return;setBusy(true);setError("");
  try {
   if(!financial) {
    const latest=await requestJson("/api/workspace/deals/"+request.deal_id);
    if(Number(object(latest.deal).current_version)!==version)throw new Error("The terms changed. Close this dialog and refresh before signing the new version.");
   }
   await requestJson("/api/workspace/"+(financial?"financial-approvals/"+request.id+"/decision":"approvals"),{
    method:"POST",headers:{"content-type":"application/json","idempotency-key":idempotency},
    body:JSON.stringify(financial?{decision,note:note||null}:{request_id:request.id,decision,note:note||null}),
   });done();close();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <Dialog title={(financial?"Financial decision":"Review participant terms")+" · v"+version} close={close}>
 <p>Review the exact obligation and version before recording your decision. Every decision is audited.</p>
 <dl className="approval-summary"><div><dt>Party / object</dt><dd>{display(object(request.participant).name??request.object_type)}</dd></div><div><dt>Deal / object ID</dt><dd>{display(request.deal_id??request.object_id)}</dd></div><div><dt>Obligation</dt><dd>{display(request.obligation??request.action)}</dd></div><div><dt>Amount</dt><dd>{minor(request.amount_minor)}</dd></div><div><dt>Terms version</dt><dd>{version}</dd></div></dl>
 <form onSubmit={submit}><label>Decision<select value={decision} onChange={e=>{setDecision(e.target.value);setAck("");}}><option value="approved">Approve</option><option value="rejected">Reject</option></select></label><label>Note (optional)<textarea value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label><label>Type <strong>{phrase}</strong> to acknowledge these terms.<input autoComplete="off" value={ack} onChange={e=>setAck(e.target.value)} /></label>{error&&<p role="alert" className="error-text">{error}</p>}<button className="sparo-button primary" disabled={busy||ack!==phrase}>{busy?"Recording…":"Confirm "+(decision==="approved"?"approval":"rejection")}</button><p className="help-text">A version change invalidates earlier approvals. Requesters cannot approve their own financial requests.</p></form>
 </Dialog>;
}
