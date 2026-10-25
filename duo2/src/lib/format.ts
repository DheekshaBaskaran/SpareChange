// Small formatting helpers shared by the UI.

export function usd(amount: number, digits = 2): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function money(amount: number, currency: string): string {
  return currency === "USD" ? usd(amount) : `${amount.toFixed(2)} ${currency}`;
}

/** 17_400 ms → "00:00:17" */
export function clock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

/** 6400 ms → "6.4s" */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 4320 minutes → "3 days", 90 → "1.5 hrs", 2 → "2 min" */
export function waitTime(minutes: number): string {
  if (minutes >= 24 * 60) {
    const days = minutes / (24 * 60);
    return `${Number.isInteger(days) ? days : days.toFixed(1)} day${days === 1 ? "" : "s"}`;
  }
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} min`;
}

/** "deal_7f3a21" → "#7f3a21" */
export function dealNumber(dealId: string): string {
  return `#${dealId.replace(/^deal_/, "")}`;
}

/** Shorten long hashes/ids: "0x1234567890abcdef" → "0x123456…abcdef" */
export function shortHash(value: string, head = 8, tail = 6): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diffMinutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
