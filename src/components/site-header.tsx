"use client";

// Top navigation bar plus a small "system" indicator that shows which
// integrations are live right now (execution + payment modes).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./logo";
import { cx } from "./ui";

interface SystemSummary {
  executor: string;
  executorReal: boolean;
  payment: string;
  paymentReal: boolean;
}

const NAV = [
  { href: "/", label: "Market" },
  { href: "/deals/deal_7f3a21", label: "Deals", match: "/deals" },
  { href: "/executions", label: "Executions", match: "/jobs" },
  { href: "/system", label: "System" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [system, setSystem] = useState<SystemSummary | null>(null);

  useEffect(() => {
    fetch("/api/system")
      .then((response) => response.json())
      .then((data) => {
        const firstAvailable = data.executors.find((executor: { available: boolean }) => executor.available);
        const x402Live = data.payments.paymentMode === "x402" && data.payments.x402.configured;
        setSystem({
          executor: firstAvailable?.label ?? "Simulated worker",
          executorReal: firstAvailable?.mode !== "mock",
          payment: x402Live ? "x402" : "Mock settlement",
          paymentReal: x402Live,
        });
      })
      .catch(() => undefined);
  }, []);

  return <HeaderLayout pathname={pathname} system={system} />;
}

/** Static version shown while the header loads (no hooks, so it can be prerendered). */
export function SiteHeaderFallback() {
  return <HeaderLayout pathname="" system={null} />;
}

function HeaderLayout({ pathname, system }: { pathname: string; system: SystemSummary | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-8 px-5 lg:px-8">
        <Link href="/" aria-label="SpareChange home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.match ?? item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cx(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  active ? "bg-surface-3 text-ink" : "text-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/system"
          className="ml-auto hidden items-center gap-3 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:border-line-strong sm:flex"
          title="Which integrations are live"
        >
          {system ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className={cx("size-1.5 rounded-full", system.executorReal ? "bg-value" : "bg-muted")} aria-hidden />
                {system.executor}
              </span>
              <span className="h-3 w-px bg-line-strong" aria-hidden />
              <span className="flex items-center gap-1.5">
                <span className={cx("size-1.5 rounded-full", system.paymentReal ? "bg-value" : "bg-muted")} aria-hidden />
                {system.payment}
              </span>
            </>
          ) : (
            <span>Checking system…</span>
          )}
        </Link>
      </div>
    </header>
  );
}
