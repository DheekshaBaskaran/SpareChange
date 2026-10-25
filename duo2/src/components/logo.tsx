// SpareChange mark: a coin split into an allocated and a released segment.

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--color-value)" strokeWidth="2" strokeLinecap="round" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5 text-ink">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">SpareChange</span>
    </span>
  );
}
