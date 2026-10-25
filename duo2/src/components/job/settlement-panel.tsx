// Settlement: the x402 handshake (or mock settlement) and who got paid.

import { Check, ExternalLink, LoaderCircle } from "lucide-react";
import { money, shortHash } from "@/lib/format";
import { PAYMENT_MODE_LABEL } from "@/lib/status";
import type { Job } from "@/lib/types";
import { Badge, ModeTag, Panel, PanelHeader, cx } from "../ui";

const X402_PLANNED_STEPS = [
  "Buyer agent requests the verified result from the provider",
  "Provider responds 402 Payment Required",
  "Buyer agent signs a USDC payment automatically",
  "x402 facilitator settles on-chain",
  "Provider releases the result (and pays its backfill, in multi-party deals)",
];

const MOCK_PLANNED_STEPS = ["Buyer accepts verified result", "Settlement legs recorded"];

export function SettlementPanel({ job }: { job: Job }) {
  const payment = job.payment;
  const pending = job.status === "PAYMENT_PENDING";
  const failed = job.status === "FAILED" && job.failure?.step === "PAYMENT_PENDING";
  const mode = PAYMENT_MODE_LABEL[payment?.paymentMode ?? job.paymentMode];
  const steps = payment?.steps ?? (job.paymentMode === "x402" ? X402_PLANNED_STEPS : MOCK_PLANNED_STEPS);
  const isX402 = (payment?.paymentMode ?? job.paymentMode) === "x402";

  return (
    <Panel>
      <PanelHeader
        eyebrow="Settlement"
        title={isX402 ? "x402 autonomous settlement" : "Payment settlement"}
        right={<ModeTag real={mode.real} planned={!payment}>{mode.label}</ModeTag>}
      />

      <ul className="space-y-2.5 px-5 py-4">
        {steps.map((step, index) => (
          <li key={index} className="flex items-start gap-3 text-sm">
            {payment ? (
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-value/15 text-value">
                <Check className="size-3" strokeWidth={3} aria-label="done" />
              </span>
            ) : pending ? (
              <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-pending" aria-label="in progress" />
            ) : (
              <span className={cx("mt-0.5 size-4 shrink-0 rounded-full border-2", failed ? "border-danger" : "border-line-strong")} aria-hidden />
            )}
            <span className={payment ? "text-ink" : "text-muted"}>{step}</span>
          </li>
        ))}
      </ul>

      {job.relay?.usageId && (
        <div className="border-t border-line px-5 py-3 text-xs text-muted">
          Relay settled this invoice · contract{" "}
          <code className="font-mono text-ink">{shortHash(job.relay.contractId ?? "")}</code> · usage{" "}
          <code className="font-mono text-ink">{shortHash(job.relay.usageId)}</code>
        </div>
      )}

      {payment && (
        <>
          <div className="border-t border-line px-5 py-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Transaction ID</div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="truncate font-mono text-[13px] text-ink">{payment.transactionId}</code>
              {payment.explorerUrl && (
                <a href={payment.explorerUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-xs text-compute hover:underline">
                  View on explorer <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>
            {payment.settledOnChainAmount && (
              <div className="mt-1 text-xs text-muted">On-chain amount: {payment.settledOnChainAmount}</div>
            )}
          </div>
          <div className="border-t border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Settlement legs</caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.12em] text-faint">
                  <th className="px-5 py-2 font-medium">From → To</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-5 py-2 text-right font-medium">Method</th>
                </tr>
              </thead>
              <tbody>
                {payment.legs.map((leg) => (
                  <tr key={leg.transactionId} className="border-t border-line/70">
                    <td className="px-5 py-2.5 text-ink-2">
                      {leg.from} <span className="text-faint">→</span> {leg.to}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-ink">
                      {money(leg.amount, leg.currency)}
                      {leg.onChainAmount && <div className="text-[11px] text-faint">on-chain {leg.onChainAmount}</div>}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {leg.mode === "x402" && leg.explorerUrl ? (
                        <a href={leg.explorerUrl} target="_blank" rel="noreferrer" title="View this payment on the block explorer">
                          <Badge tone="value" className="whitespace-nowrap">x402 · {shortHash(leg.transactionId, 6, 4)} ↗</Badge>
                        </a>
                      ) : (
                        <Badge tone={leg.mode === "x402" ? "value" : "neutral"}>{leg.mode === "x402" ? `x402 · ${shortHash(leg.transactionId, 6, 4)}` : "mock"}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
