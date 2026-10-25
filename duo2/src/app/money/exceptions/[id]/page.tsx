import { Suspense } from "react";
import { MoneyDetail } from "@/components/money-view";
export default function Page({params}:{params:Promise<{id:string}>}){return <Suspense fallback={<div className="empty-state">Loading record…</div>}><Detail params={params}/></Suspense>;}
async function Detail({params}:{params:Promise<{id:string}>}){const {id}=await params;return <MoneyDetail kind="exceptions" id={id}/>;}
