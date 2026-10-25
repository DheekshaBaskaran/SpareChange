// ─────────────────────────────────────────────────────────────
// Solana Devnet payout rail.
//
// This is a direct transfer adapter, not x402: Solana Devnet is used for the
// provider payout leg, while the buyer payment stays on the existing Base
// Sepolia x402 rail. The two networks are deliberately independent — no bridge
// and no shared balance is implied.
//
// Asset: native SOL on Solana Devnet. It is never labelled as USDC.
// Amount: `SOLANA_PAYOUT_LAMPORTS` is a demonstration-scale transfer. The
// Relay payout instruction's USD amount is accounting value; the on-chain
// lamport amount is recorded separately and reported honestly.
//
// Security: the destination must be a valid base58 public key AND must match
// `SOLANA_PAYOUT_ADDRESS`, so a tampered instruction cannot redirect funds.
// The payer key is read server-side only and never returned by an endpoint.
// ─────────────────────────────────────────────────────────────

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getConfig } from "../config";

export interface SolanaPayoutPreflight {
  configured: boolean;
  reason?: string;
  network: string;
  rpcUrl: string;
  payer: string | null;
  payoutAddress: string | null;
  payoutLamports: number;
  payoutSol: number;
  balanceLamports: number | null;
  requiredLamports: number;
  funded: boolean;
}

export interface SolanaPayoutResult {
  signature: string;
  slot: number | null;
  blockTime: number | null;
  network: string;
  asset: "SOL";
  lamports: number;
  sol: number;
  payer: string;
  destination: string;
  explorerUrl: string;
}

export interface SolanaTransferVerification {
  confirmed: boolean;
  signature: string;
  slot: number | null;
  blockTime: number | null;
  destination: string;
  lamportsReceived: number;
  payer: string | null;
  error: string | null;
}

const FEE_BUFFER_LAMPORTS = 10_000;

function connection(): Connection {
  return new Connection(getConfig().solana.rpcUrl, "confirmed");
}

/** The devnet payer keypair, parsed from a JSON byte array in the environment. */
export function loadSolanaPayer(): Keypair | null {
  const secret = getConfig().solana.payerSecret;
  if (!secret) return null;
  try {
    const bytes = JSON.parse(secret) as number[];
    if (!Array.isArray(bytes) || bytes.length !== 64) return null;
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

export function solanaExplorerUrl(signature: string): string {
  const cluster = getConfig().solana.network.includes("devnet") ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

/** Validate a base58 address without touching the network. */
export function isValidSolanaAddress(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

/**
 * Check configuration, the allowlisted destination and the payer balance.
 * Safe to call on every request; it never signs or sends anything.
 */
export async function solanaPreflight(): Promise<SolanaPayoutPreflight> {
  const { solana } = getConfig();
  const payer = loadSolanaPayer();
  const base: SolanaPayoutPreflight = {
    configured: false,
    network: solana.network,
    rpcUrl: solana.rpcUrl,
    payer: payer?.publicKey.toBase58() ?? null,
    payoutAddress: solana.payoutAddress ?? null,
    payoutLamports: solana.payoutLamports,
    payoutSol: solana.payoutLamports / LAMPORTS_PER_SOL,
    balanceLamports: null,
    requiredLamports: solana.payoutLamports + FEE_BUFFER_LAMPORTS,
    funded: false,
  };
  if (!solana.payerSecret) return { ...base, reason: "SOLANA_PAYER_SECRET_KEY is not set" };
  if (!payer) return { ...base, reason: "SOLANA_PAYER_SECRET_KEY is not a valid 64-byte JSON array" };
  if (!isValidSolanaAddress(solana.payoutAddress)) {
    return { ...base, reason: "SOLANA_PAYOUT_ADDRESS is not a valid base58 address" };
  }
  if (!Number.isSafeInteger(solana.payoutLamports) || solana.payoutLamports <= 0) {
    return { ...base, reason: "SOLANA_PAYOUT_LAMPORTS must be a positive whole number" };
  }
  try {
    const balance = await connection().getBalance(payer.publicKey);
    return {
      ...base,
      configured: true,
      balanceLamports: balance,
      funded: balance >= base.requiredLamports,
    };
  } catch (error) {
    return { ...base, configured: true, reason: `RPC unavailable: ${(error as Error).message}` };
  }
}

/**
 * Send the demonstration-scale SOL payout and wait for confirmation.
 * The caller must already have checked the Relay instruction is authorized.
 */
export async function sendSolanaPayout(input: {
  destination: string;
  lamports?: number;
}): Promise<SolanaPayoutResult> {
  const { solana } = getConfig();
  const payer = loadSolanaPayer();
  if (!payer) throw new Error("SOLANA_PAYER_SECRET_KEY is not configured");
  if (!isValidSolanaAddress(input.destination)) {
    throw new Error("Payout destination is not a valid Solana address");
  }
  if (!solana.payoutAddress || input.destination !== solana.payoutAddress) {
    throw new Error("Payout destination does not match the configured SOLANA_PAYOUT_ADDRESS allowlist");
  }
  const lamports = input.lamports ?? solana.payoutLamports;
  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    throw new Error("Payout amount must be a positive whole number of lamports");
  }

  const conn = connection();
  const balance = await conn.getBalance(payer.publicKey, "confirmed");
  if (balance < lamports + FEE_BUFFER_LAMPORTS) {
    throw new Error(
      `Solana payer ${payer.publicKey.toBase58()} has ${balance} lamports; ${lamports + FEE_BUFFER_LAMPORTS} required. ` +
        "Fund the devnet wallet before retrying.",
    );
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(input.destination),
      lamports,
    }),
  );
  const signature = await sendAndConfirmTransaction(conn, transaction, [payer], {
    commitment: "confirmed",
    maxRetries: 3,
  });
  const tx = await conn.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  return {
    signature,
    slot: tx?.slot ?? null,
    blockTime: tx?.blockTime ?? null,
    network: solana.network,
    asset: "SOL",
    lamports,
    sol: lamports / LAMPORTS_PER_SOL,
    payer: payer.publicKey.toBase58(),
    destination: input.destination,
    explorerUrl: solanaExplorerUrl(signature),
  };
}

/**
 * Independently verify a transfer through the RPC: the transaction must be
 * successful and the destination's lamport balance delta must cover the
 * expected amount. This is what the E2E and the demo use as proof, instead of
 * trusting the sending adapter's own return value.
 */
export async function verifySolanaTransfer(
  signature: string,
  expected: { destination: string; minLamports: number },
): Promise<SolanaTransferVerification> {
  const empty: SolanaTransferVerification = {
    confirmed: false,
    signature,
    slot: null,
    blockTime: null,
    destination: expected.destination,
    lamportsReceived: 0,
    payer: null,
    error: null,
  };
  try {
    const conn = connection();
    const tx = await conn.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) return { ...empty, error: "Transaction was not found on Solana Devnet" };
    const meta = tx.meta;
    if (!meta) return { ...empty, slot: tx.slot, blockTime: tx.blockTime ?? null, error: "Transaction has no metadata" };
    if (meta.err) return { ...empty, error: `Transaction failed: ${JSON.stringify(meta.err)}` };

    const keys = tx.transaction.message.getAccountKeys({
      accountKeysFromLookups: meta.loadedAddresses,
    });
    const index = keys.staticAccountKeys.findIndex((key) => key.toBase58() === expected.destination);
    if (index === -1) {
      return { ...empty, slot: tx.slot, blockTime: tx.blockTime ?? null, error: "Destination is not in the transaction" };
    }
    const received = (meta.postBalances[index] ?? 0) - (meta.preBalances[index] ?? 0);
    const payerKey = keys.staticAccountKeys[0]?.toBase58() ?? null;

    return {
      confirmed: received >= expected.minLamports,
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      destination: expected.destination,
      lamportsReceived: received,
      payer: payerKey,
      error: received >= expected.minLamports ? null : `Received ${received} lamports, expected at least ${expected.minLamports}`,
    };
  } catch (error) {
    return { ...empty, error: (error as Error).message };
  }
}
