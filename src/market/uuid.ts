import { createHash } from "node:crypto";

/**
 * Deterministic UUIDs let the bridge upsert provider parties without adding a
 * unique constraint to the existing schema. The namespace is fixed forever:
 * changing it would create duplicate provider parties.
 */
const NAMESPACE = Buffer.from("9f2c1f5a6d7e4b8c9a0d3e6f1b2c4d5e", "hex");

export function uuidv5(name: string, namespace: Buffer = NAMESPACE): string {
  const hash = createHash("sha1").update(namespace).update(Buffer.from(name, "utf8")).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function providerPartyId(provider: string): string {
  return uuidv5(`market-provider:${provider}`);
}

/**
 * A published market offer keeps one Duo 1 row for its whole lifetime, so
 * repeated syncs update price/capacity in place instead of inserting history.
 * Price history stays in Market Intelligence where it belongs.
 */
export function marketOfferId(provider: string, providerOfferId: string): string {
  return uuidv5(`market-offer:${provider}:${providerOfferId}`);
}
