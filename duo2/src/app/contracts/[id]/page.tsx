import { Suspense } from "react";
import { ContractView } from "@/components/contract-view";
export default function Page({params}:{params:Promise<{id:string}>}){return <Suspense fallback={<div className="empty-state">Loading contract…</div>}><Detail params={params}/></Suspense>;}
async function Detail({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ContractView id={id}/>;}
