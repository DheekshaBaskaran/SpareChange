import type { QueryResultRow } from "pg";

export interface JsonObject {
  [key: string]: unknown;
}

export function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return asObject(parsed);
    } catch {
      return {};
    }
  }
  return {};
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export function minor(value: unknown): number {
  const number = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isSafeInteger(number)) {
    throw new Error("money value exceeds JavaScript safe integer range");
  }
  return number;
}

export function integer(value: unknown): number {
  return Number(value ?? 0);
}

export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export interface PartyRow extends QueryResultRow {
  id: string;
  kind: string;
  name: string;
  status: string;
  created_at: unknown;
  hardware?: unknown;
  allowed_workloads?: string[] | null;
  regions?: string[] | null;
  price_model?: unknown;
  authorized_at?: unknown;
  authorization_expires_at?: unknown;
}

export interface WorkloadRow extends QueryResultRow {
  id: string;
  buyer_id: string;
  buyer_name: string;
  buyer_kind: string;
  type: string;
  gpu_model: string;
  gpu_count: number;
  cpu_cores: number;
  memory_gb: number;
  budget_minor: unknown;
  deadline: unknown;
  earliest_start: unknown;
  flexibility: unknown;
  state: string;
  created_at: unknown;
  updated_at: unknown;
}

export interface OfferRow extends QueryResultRow {
  id: string;
  provider_id: string;
  provider_name: string;
  source: string;
  external_ref: string | null;
  gpu_model: string;
  gpu_count: number;
  cpu_cores: number;
  memory_gb: number;
  rate_minor_per_gpu_hour: unknown;
  currency: string;
  location: string | null;
  available_from: unknown;
  available_until: unknown;
  observed_at: unknown;
  expires_at: unknown;
  executable: boolean;
  executable_now: boolean;
  authorization_id: string | null;
  auth_expires_at: unknown;
  revoked_at: unknown;
  metadata: unknown;
}

export interface DealRow extends QueryResultRow {
  id: string;
  workload_id: string;
  title: string | null;
  status: string;
  current_version: number;
  created_at: unknown;
  updated_at: unknown;
}

export interface DealVersionRow extends QueryResultRow {
  deal_id: string;
  version: number;
  status: string;
  proposal: unknown;
  engine: unknown;
  created_at: unknown;
  created_by: string | null;
}

export interface ApprovalRequestRow extends QueryResultRow {
  request_id: string;
  deal_id: string;
  version: number;
  participant_id: string;
  participant_name: string;
  obligation: string;
  amount_minor: unknown;
  currency: string;
  channel: string;
  status: string;
  expires_at: unknown;
  created_at: unknown;
  approval_id: string | null;
  decision: string | null;
  attested_by: string | null;
  attestation_channel: string | null;
  simulated: boolean | null;
  note: string | null;
  approval_created_at: unknown;
}

export interface NegotiationEventRow extends QueryResultRow {
  id: string;
  deal_id: string;
  version: number;
  round: number;
  event_type: string;
  actor_id: string;
  payload: unknown;
  created_at: unknown;
}

export interface EscalationRow extends QueryResultRow {
  id: string;
  deal_id: string;
  version: number;
  reason: string;
  details: unknown;
  status: string;
  created_at: unknown;
  resolved_at: unknown;
}

export interface HandoffRow extends QueryResultRow {
  id: string;
  deal_id: string;
  version: number;
  status: string;
  reservation_status: string;
  settlement_authorized: boolean;
  package: unknown;
  created_at: unknown;
}

export interface PricePointRow extends QueryResultRow {
  bucket: unknown;
  gpu_model: string;
  min_minor: unknown;
  avg_minor: unknown;
  max_minor: unknown;
  sample_count: number;
}
