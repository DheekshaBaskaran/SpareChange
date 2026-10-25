import { Suspense } from "react";
import { MoneyView } from "@/components/money-view";
export default function Page(){ return <Suspense fallback={<div className="empty-state">Loading money…</div>}><MoneyView/></Suspense>; }
