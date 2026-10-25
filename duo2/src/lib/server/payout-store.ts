// ─────────────────────────────────────────────────────────────
// Durable record of Solana payouts that were already signed and sent.
//
// The Relay payout instruction is the source of truth for authorization, but a
// crash between broadcasting and reporting would otherwise allow a second
// transfer on retry. This store is written *before* Relay is notified, so a
// retry re-uses the signature instead of sending again.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

export interface PayoutRecord {
  instructionId: string;
  signature: string;
  network: string;
  asset: "SOL";
  lamports: number;
  destination: string;
  payer: string;
  slot: number | null;
  blockTime: number | null;
  createdAt: string;
  /** Set once Relay has confirmed the payout, so a retry can complete quickly. */
  reportedAt?: string;
  payableStatus?: string;
}

interface Store {
  payouts: Map<string, PayoutRecord>;
}

const DATA_FILE = path.join(process.cwd(), ".data", "payouts.json");

function load(): Store {
  const store: Store = { payouts: new Map() };
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as { payouts?: PayoutRecord[] };
    for (const record of saved.payouts ?? []) store.payouts.set(record.instructionId, record);
  } catch {
    // No file yet, or unreadable: an empty store is safe; Relay still guards
    // the instruction state, and a duplicate signature is impossible to hide.
  }
  return store;
}

const globalForStore = globalThis as unknown as { __solanaPayoutStore?: Store };
const store: Store = (globalForStore.__solanaPayoutStore ??= load());

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ payouts: [...store.payouts.values()] }));
    fs.renameSync(tmp, DATA_FILE);
  } catch (error) {
    console.warn("[payout-store] could not persist payouts:", (error as Error).message);
  }
}

export function getPayoutRecord(instructionId: string): PayoutRecord | undefined {
  return store.payouts.get(instructionId);
}

export function savePayoutRecord(record: PayoutRecord): void {
  store.payouts.set(record.instructionId, record);
  persist();
}
