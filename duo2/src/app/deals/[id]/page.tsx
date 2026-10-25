import { Suspense } from "react";
import { DealDetailView } from "@/components/deal-detail-view";
export default function DealPage({params}:{params:Promise<{id:string}>}) {
 return <Suspense fallback={<div className="empty-state">Loading deal…</div>}><Detail params={params}/></Suspense>;
}
async function Detail({params}:{params:Promise<{id:string}>}) { const {id}=await params;return <DealDetailView id={id}/>; }
