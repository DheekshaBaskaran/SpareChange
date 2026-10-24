"use client";

// Live status of the executor fallback chain, payments and Duo 1 feeds.

import { useEffect, useState } from "react";
import { Badge, Panel, PanelHeader, cx } from "@/components/ui";

interface SystemData {
  executionModeSetting: string;
  executors: { mode: string; label: string; available: boolean; reason?: string }[];
  payments: {
    paymentMode: string;
    x402: { configured: boolean; reason?: string; network: string; settlementPrice: string };
  };
  duo1: { dealsFeedConfigured: boolean; marketFeedConfigured: boolean };
}

export function SystemStatus() {
  const [data, setData] = useState<SystemData | null>(null);

  useEffect(() => {
    fetch("/api/system")
      .then((response) => response.json())
      .then(setData)
      .catch(() => undefined);
  }, []);

  if (!data) return <div className="h-64 animate-pulse rounded-xl bg-surface" aria-busy />;

  const activeExecutor = data.executors.find((executor) => executor.available);
  const x402Active = data.payments.paymentMode === "x402" && data.payments.x402.configured;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Panel>
        <PanelHeader eyebrow={`EXECUTION_MODE=${data.executionModeSetting}`} title="Compute executor chain" />
        <ol className="divide-y divide-line/70">
          {data.executors.map((executor, index) => {
            const active = executor === activeExecutor;
            return (
              <li key={executor.mode} className="flex items-center gap-3 px-5 py-3">
                <span className="w-4 font-mono text-xs text-faint">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className={cx("text-sm", executor.available ? "text-ink" : "text-muted")}>{executor.label}</div>
                  <div className="font-mono text-[11.5px] text-faint">{executor.available ? executor.mode : executor.reason}</div>
                </div>
                {active ? (
                  <Badge tone="value" dot>
                    In use
                  </Badge>
                ) : executor.available ? (
                  <Badge>Fallback</Badge>
                ) : (
                  <Badge tone="neutral">Unavailable</Badge>
                )}
              </li>
            );
          })}
        </ol>
      </Panel>

      <div className="flex flex-col gap-6">
        <Panel>
          <PanelHeader eyebrow={`PAYMENT_MODE=${data.payments.paymentMode}`} title="Payment settlement" />
          <div className="space-y-3 px-5 py-4 text-sm">
            <Row label="Active provider" value={x402Active ? "Coinbase x402" : "Mock settlement"} live={x402Active} />
            <Row
              label="x402"
              value={data.payments.x402.configured ? `Configured · ${data.payments.x402.network} · ${data.payments.x402.settlementPrice}` : data.payments.x402.reason ?? "Not configured"}
              live={data.payments.x402.configured}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Duo 1" title="Market & deal feeds" />
          <div className="space-y-3 px-5 py-4 text-sm">
            <Row label="Deals feed (DUO1_DEALS_URL)" value={data.duo1.dealsFeedConfigured ? "Configured" : "Not set · demo deals"} live={data.duo1.dealsFeedConfigured} />
            <Row label="Market feed (DUO1_MARKET_URL)" value={data.duo1.marketFeedConfigured ? "Configured" : "Not set · demo listings"} live={data.duo1.marketFeedConfigured} />
            <Row label="Push endpoint" value="POST /api/deals/execute" live />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value, live }: { label: string; value: string; live: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2 text-right text-ink-2">
        <span className={cx("size-1.5 shrink-0 rounded-full", live ? "bg-value" : "bg-faint")} aria-hidden />
        {value}
      </span>
    </div>
  );
}
