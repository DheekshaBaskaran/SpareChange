import type { Db } from "../db/client.js";
import { asObject, iso, minor } from "../db/values.js";
import type { FinancialDocument } from "./types.js";

type Row = Record<string, unknown>;

export const DOCUMENT_TYPES: Record<string, string> = {
  parties: "party",
  workloads: "workload",
  deals: "deal",
  contracts: "contract",
  contract_rate_lines: "contract_rate_line",
  invoices: "invoice",
  invoice_lines: "invoice_line",
  invoice_adjustments: "invoice_adjustment",
  payment_obligations: "payment_obligation",
  billing_calculations: "billing_calculation",
  verified_usage: "verified_usage",
  execution_events: "execution_event",
  execution_authorizations: "execution_authorization",
  payments: "payment",
  payment_instructions: "payment_instruction",
  provider_payables: "provider_payable",
  provider_payout_instructions: "provider_payout_instruction",
  provider_payouts: "provider_payout",
  financial_exceptions: "financial_exception",
  exception_actions: "exception_action",
  financial_approvals: "financial_approval",
  journal_entries: "journal_entry",
  journal_lines: "journal_line",
  audit_events: "audit_event",
};

export const PROJECTED_TABLES = Object.keys(DOCUMENT_TYPES);

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  try {
    return minor(value);
  } catch {
    return null;
  }
}

function ids(...values: unknown[]): string[] {
  return [...new Set(values.map(text).filter((value): value is string => Boolean(value)))];
}

function searchable(part: unknown): string | null {
  if (part === null || part === undefined) return null;
  if (typeof part === "string") return part;
  if (typeof part === "number" || typeof part === "boolean" || typeof part === "bigint") return String(part);
  try {
    return JSON.stringify(part);
  } catch {
    return null;
  }
}

function build(
  table: string,
  id: string,
  fields: Omit<FinancialDocument, "document_id" | "entity_type" | "entity_id" | "search_text">,
  searchParts: unknown[],
): FinancialDocument {
  const entityType = DOCUMENT_TYPES[table] ?? table;
  return {
    document_id: `${entityType}:${id}`,
    entity_type: entityType,
    entity_id: id,
    ...fields,
    search_text: searchParts
      .map(searchable)
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .slice(0, 20_000),
  };
}

async function one(db: Db, sql: string, values: unknown[]): Promise<Row | null> {
  const result = await db.query<Row>(sql, values);
  return result.rows[0] ?? null;
}

export async function loadDocument(
  db: Db,
  table: string,
  id: string,
): Promise<FinancialDocument | null> {
  switch (table) {
    case "parties": {
      const row = await one(
        db,
        `SELECT p.id, p.kind, p.name, p.status, p.created_at, p.updated_at,
                pp.hardware, pp.allowed_workloads, pp.regions, pp.price_model,
                pp.authorized_at, pp.authorization_expires_at
         FROM parties p LEFT JOIN provider_profiles pp ON pp.party_id = p.id
         WHERE p.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          party_ids: [id],
          status: text(row.status),
          title: `Party ${row.name}`,
          summary: `${row.kind} party ${row.name} is ${row.status}.`,
          occurred_at: iso(row.created_at),
          updated_at: iso(row.updated_at),
          payload: row,
        },
        [row.name, row.kind, row.status, row.hardware, row.allowed_workloads, row.regions],
      );
    }

    case "workloads": {
      const row = await one(
        db,
        `SELECT w.*, p.name AS buyer_name,
                (SELECT d.id FROM deals d WHERE d.workload_id = w.id
                 ORDER BY d.created_at DESC LIMIT 1) AS latest_deal_id
         FROM workloads w JOIN parties p ON p.id = w.buyer_id
         WHERE w.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.latest_deal_id),
          workload_id: id,
          party_ids: ids(row.buyer_id),
          status: text(row.state),
          amount_minor: numberOrNull(row.budget_minor),
          title: `${row.gpu_count}x ${row.gpu_model} ${row.type}`,
          summary: `Workload for ${row.buyer_name} needs ${row.gpu_count}x ${row.gpu_model} for ${row.type}, state ${row.state}.`,
          occurred_at: iso(row.created_at),
          updated_at: iso(row.updated_at),
          payload: row,
        },
        [row.type, row.gpu_model, row.buyer_name, row.state, row.flexibility],
      );
    }

    case "deals": {
      const row = await one(
        db,
        `SELECT d.*, w.type AS workload_type, w.buyer_id, w.gpu_model, w.gpu_count,
                w.budget_minor, p.name AS buyer_name, dv.proposal, dv.status AS version_status
         FROM deals d
         JOIN workloads w ON w.id = d.workload_id
         JOIN parties p ON p.id = w.buyer_id
         LEFT JOIN deal_versions dv ON dv.deal_id = d.id AND dv.version = d.current_version
         WHERE d.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: id,
          workload_id: text(row.workload_id),
          party_ids: ids(row.buyer_id),
          status: text(row.status),
          amount_minor: numberOrNull(row.budget_minor),
          title: text(row.title) ?? `Deal ${id.slice(0, 8)}`,
          summary: `Deal ${row.status} at version ${row.current_version} for ${row.workload_type} workload (${row.gpu_count}x ${row.gpu_model}).`,
          occurred_at: iso(row.created_at),
          updated_at: iso(row.updated_at),
          payload: { deal: row, current_proposal: row.proposal },
        },
        [row.title, row.status, row.workload_type, row.gpu_model, row.buyer_name, row.proposal],
      );
    }

    case "contracts": {
      const row = await one(
        db,
        `SELECT c.*, d.workload_id, bp.name AS buyer_name, pp.name AS provider_name
         FROM contracts c
         JOIN deals d ON d.id = c.deal_id
         JOIN parties bp ON bp.id = c.buyer_id
         JOIN parties pp ON pp.id = c.provider_id
         WHERE c.id = $1`,
        [id],
      );
      if (!row) return null;
      const rateLines = await db.query<Row>(
        `SELECT id, description, gpu_model, gpu_count, rate_minor_per_gpu_hour,
                minimum_charge_minor, metadata, created_at
         FROM contract_rate_lines WHERE contract_id = $1 ORDER BY created_at, id`,
        [id],
      );
      const terms = asObject(row.terms);
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: id,
          workload_id: text(row.workload_id),
          party_ids: ids(row.buyer_id, row.provider_id),
          status: text(row.status),
          currency: text(row.currency),
          amount_minor: numberOrNull(terms.compute_amount_minor),
          title: `Agreement ${row.buyer_name} → ${row.provider_name}`,
          summary: `Contract ${row.status}: ${row.buyer_name} buys ${terms.gpu_count ?? ""}x ${terms.gpu_model ?? "GPU"} from ${row.provider_name} at ${terms.rate_minor_per_gpu_hour ?? "?"} minor/GPU-hour, ${terms.duration_hours ?? "?"} hours.`,
          occurred_at: iso(row.approved_at ?? row.created_at),
          updated_at: iso(row.updated_at),
          payload: { contract: row, terms, rate_lines: rateLines.rows },
        },
        [
          row.buyer_name,
          row.provider_name,
          row.status,
          row.currency,
          terms.gpu_model,
          terms.compute_amount_minor,
          terms.rate_minor_per_gpu_hour,
          rateLines.rows.map((line) => line.description).join(" "),
        ],
      );
    }

    case "contract_rate_lines": {
      const row = await one(
        db,
        `SELECT l.*, c.deal_id FROM contract_rate_lines l
         JOIN contracts c ON c.id = l.contract_id WHERE l.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          amount_minor: numberOrNull(row.rate_minor_per_gpu_hour),
          currency: "USD",
          title: `Rate line ${row.gpu_model}`,
          summary: `${row.gpu_count}x ${row.gpu_model} at ${row.rate_minor_per_gpu_hour} minor/GPU-hour: ${row.description}`,
          occurred_at: iso(row.created_at),
          payload: row,
        },
        [row.description, row.gpu_model, row.rate_minor_per_gpu_hour, row.minimum_charge_minor],
      );
    }

    case "invoices": {
      const row = await one(
        db,
        `SELECT i.*, c.deal_id, c.buyer_id, c.provider_id
         FROM invoices i JOIN contracts c ON c.id = i.contract_id
         WHERE i.id = $1`,
        [id],
      );
      if (!row) return null;
      const total = numberOrNull(row.total_minor) ?? 0;
      const paid = numberOrNull(row.paid_minor) ?? 0;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: id,
          party_ids: ids(row.buyer_id, row.provider_id),
          status: text(row.status),
          currency: text(row.currency),
          amount_minor: total,
          paid_minor: paid,
          difference_minor: total - paid,
          title: `Invoice ${row.invoice_number}`,
          summary: `Invoice ${row.invoice_number} is ${row.status}; total ${total} minor, paid ${paid} minor, outstanding ${total - paid} minor.`,
          occurred_at: iso(row.issued_at ?? row.created_at),
          updated_at: iso(row.updated_at),
          payload: row,
        },
        [row.invoice_number, row.status, row.source, row.currency, row.metadata],
      );
    }

    case "invoice_lines": {
      const row = await one(
        db,
        `SELECT l.*, i.invoice_number, i.contract_id, c.deal_id
         FROM invoice_lines l
         JOIN invoices i ON i.id = l.invoice_id
         JOIN contracts c ON c.id = i.contract_id
         WHERE l.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          invoice_line_id: id,
          usage_id: text(row.usage_id),
          amount_minor: numberOrNull(row.amount_minor),
          currency: "USD",
          title: `Invoice line: ${row.description}`,
          summary: `Invoice ${row.invoice_number} line "${row.description}" is ${row.amount_minor} minor for quantity ${row.quantity} at ${row.unit_rate_minor} minor/unit.`,
          occurred_at: iso(row.created_at),
          payload: row,
        },
        [row.description, row.invoice_number, row.amount_minor, row.quantity, row.metadata],
      );
    }

    case "invoice_adjustments": {
      const row = await one(
        db,
        `SELECT a.*, i.invoice_number, i.contract_id, c.deal_id
         FROM invoice_adjustments a
         JOIN invoices i ON i.id = a.invoice_id
         JOIN contracts c ON c.id = i.contract_id
         WHERE a.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          adjustment_id: id,
          approval_id: text(row.financial_approval_id),
          status: text(row.status),
          currency: "USD",
          amount_minor: numberOrNull(row.amount_minor),
          title: `Invoice adjustment ${row.invoice_number}`,
          summary: `Invoice adjustment for ${row.invoice_number} is ${row.status}; ${row.amount_minor} minor because ${row.reason}. Created by ${row.created_by}.`,
          occurred_at: iso(row.applied_at ?? row.created_at),
          updated_at: iso(row.applied_at),
          payload: row,
        },
        [row.invoice_number, row.reason, row.status, row.created_by, row.amount_minor],
      );
    }

    case "payment_obligations": {
      const row = await one(
        db,
        `SELECT o.*, i.invoice_number, c.deal_id, c.buyer_id, c.provider_id
         FROM payment_obligations o
         JOIN invoices i ON i.id = o.invoice_id
         JOIN contracts c ON c.id = o.contract_id
         WHERE o.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          obligation_id: id,
          party_ids: ids(row.buyer_id, row.provider_id),
          status: text(row.status),
          currency: text(row.currency),
          amount_minor: numberOrNull(row.amount_minor),
          title: `Payment obligation ${row.invoice_number}`,
          summary: `Payment obligation for invoice ${row.invoice_number} is ${row.status}; ${row.amount_minor} minor, authorized ${row.authorized_at ?? "not authorized"}.`,
          occurred_at: iso(row.authorized_at ?? row.created_at),
          payload: row,
        },
        [row.invoice_number, row.status, row.amount_minor, row.authorization_id, row.metadata],
      );
    }

    case "billing_calculations": {
      const row = await one(
        db,
        `SELECT b.*, u.gpu_seconds, u.gpu_model, u.gpu_count, u.verified_at,
                c.deal_id, u.execution_event_id, u.workload_id
         FROM billing_calculations b
         JOIN verified_usage u ON u.id = b.usage_id
         JOIN contracts c ON c.id = b.contract_id
         WHERE b.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          usage_id: text(row.usage_id),
          execution_event_id: text(row.execution_event_id),
          workload_id: text(row.workload_id),
          amount_minor: numberOrNull(row.amount_minor),
          currency: text(row.currency),
          title: `Billing calculation ${row.gpu_count}x ${row.gpu_model}`,
          summary: `Verified usage produced ${row.amount_minor} minor using ${row.basis}; ${row.gpu_seconds} GPU-seconds at ${row.gpu_model}.`,
          occurred_at: iso(row.verified_at ?? row.created_at),
          payload: row,
        },
        [row.basis, row.breakdown, row.gpu_model, row.calculation_version],
      );
    }

    case "verified_usage": {
      const row = await one(
        db,
        `SELECT u.*, c.deal_id, c.buyer_id, c.provider_id,
                b.id AS billing_calculation_id, b.amount_minor, b.currency, b.basis,
                b.breakdown, b.calculation_version, e.job_id, e.worker_id,
                e.proof_reference, e.payload AS execution_payload
         FROM verified_usage u
         JOIN contracts c ON c.id = u.contract_id
         LEFT JOIN billing_calculations b ON b.usage_id = u.id
         LEFT JOIN execution_events e ON e.id = u.execution_event_id
         WHERE u.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          workload_id: text(row.workload_id),
          usage_id: id,
          execution_event_id: text(row.execution_event_id),
          party_ids: ids(row.buyer_id, row.provider_id),
          amount_minor: numberOrNull(row.amount_minor),
          currency: text(row.currency),
          gpu_seconds: Number(row.gpu_seconds ?? 0),
          title: `Verified ${row.gpu_count}x ${row.gpu_model} usage`,
          summary: `Duo 2 verified ${row.gpu_seconds} GPU-seconds on ${row.gpu_count}x ${row.gpu_model}; billed ${row.amount_minor ?? "?"} minor from ${row.basis ?? "billing"}. Proof ${row.proof_reference ?? "missing"}.`,
          occurred_at: iso(row.verified_at),
          payload: row,
        },
        [
          row.gpu_model,
          row.proof_reference,
          row.job_id,
          row.worker_id,
          row.breakdown,
          row.execution_payload,
        ],
      );
    }

    case "execution_events": {
      const row = await one(
        db,
        `SELECT e.*, u.id AS usage_id, u.contract_id, c.deal_id, c.buyer_id, c.provider_id
         FROM execution_events e
         LEFT JOIN verified_usage u ON u.execution_event_id = e.id
         LEFT JOIN contracts c ON c.id = u.contract_id
         WHERE e.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          workload_id: text(row.workload_id),
          usage_id: text(row.usage_id),
          execution_event_id: id,
          party_ids: ids(row.buyer_id, row.provider_id),
          status: text(row.event_type),
          gpu_seconds: Number(row.gpu_seconds ?? 0),
          title: `Execution event ${row.event_type}`,
          summary: `Duo 2 execution event ${row.event_type} for job ${row.job_id ?? "unknown"} on worker ${row.worker_id ?? "unknown"}; measured ${row.gpu_seconds ?? 0} GPU-seconds, proof ${row.proof_reference ?? "missing"}.`,
          occurred_at: iso(row.measured_at),
          payload: row,
        },
        [row.event_type, row.job_id, row.worker_id, row.proof_reference, row.payload],
      );
    }

    case "execution_authorizations": {
      const row = await one(
        db,
        `SELECT a.*, d.workload_id, d.title AS deal_title
         FROM execution_authorizations a JOIN deals d ON d.id = a.deal_id
         WHERE a.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          workload_id: text(row.workload_id),
          execution_authorization_id: id,
          status: text(row.status),
          title: `Execution authorization v${row.version}`,
          summary: `Execution authorization ${row.status} for deal ${row.deal_title ?? row.deal_id}, expires ${row.expires_at ?? "never"}.`,
          occurred_at: iso(row.authorized_at),
          payload: row,
        },
        [row.deal_title, row.status, row.payload],
      );
    }

    case "payments": {
      const row = await one(
        db,
        `SELECT p.*, i.invoice_number, i.contract_id, c.deal_id, c.provider_id, c.buyer_id
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN contracts c ON c.id = i.contract_id
         WHERE p.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          payment_id: id,
          party_ids: ids(row.buyer_id, row.provider_id),
          status: text(row.status),
          currency: text(row.currency),
          amount_minor: numberOrNull(row.amount_minor),
          title: `Payment ${row.provider_reference ?? id.slice(0, 8)}`,
          summary: `Payment for invoice ${row.invoice_number} is ${row.status}; ${row.amount_minor} minor, reference ${row.provider_reference ?? "missing"}, confirmed ${row.confirmed_at ?? "not confirmed"}.`,
          occurred_at: iso(row.confirmed_at ?? row.created_at),
          payload: row,
        },
        [row.provider_reference, row.status, row.raw],
      );
    }

    case "payment_instructions": {
      const row = await one(
        db,
        `SELECT pi.*, po.invoice_id, po.contract_id, c.deal_id, c.buyer_id, c.provider_id
         FROM payment_instructions pi
         JOIN payment_obligations po ON po.id = pi.obligation_id
         JOIN contracts c ON c.id = po.contract_id
         WHERE pi.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          payment_instruction_id: id,
          party_ids: ids(row.buyer_id, row.provider_id),
          status: text(row.status),
          currency: text(row.currency),
          amount_minor: numberOrNull(row.amount_minor),
          title: `Payment instruction ${id.slice(0, 8)}`,
          summary: `Payment instruction is ${row.status} for ${row.amount_minor} minor on ${row.chain ?? "unknown chain"}; submitted ${row.submitted_at ?? "not submitted"}, confirmed ${row.confirmed_at ?? "not confirmed"}.`,
          occurred_at: iso(row.created_at),
          payload: row,
        },
        [row.chain, row.destination, row.status, row.failure_code, row.failure_message],
      );
    }

    case "provider_payables": {
      const row = await one(
        db,
        `SELECT pp.*, c.deal_id, c.buyer_id, i.invoice_number
         FROM provider_payables pp
         JOIN contracts c ON c.id = pp.contract_id
         JOIN invoices i ON i.id = pp.invoice_id
         WHERE pp.id = $1`,
        [id],
      );
      if (!row) return null;
      const amount = numberOrNull(row.amount_minor) ?? 0;
      const paid = numberOrNull(row.paid_minor) ?? 0;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          payable_id: id,
          party_ids: ids(row.provider_id, row.buyer_id),
          status: text(row.status),
          currency: text(row.currency),
          amount_minor: amount,
          paid_minor: paid,
          difference_minor: amount - paid,
          title: `Provider payable for ${row.invoice_number}`,
          summary: `Provider payable is ${row.status}; accrued ${amount} minor, paid ${paid} minor, outstanding ${amount - paid} minor.`,
          occurred_at: iso(row.created_at),
          updated_at: iso(row.paid_at),
          payload: row,
        },
        [row.invoice_number, row.status, row.provider_id, row.metadata],
      );
    }

    case "provider_payout_instructions": {
      const row = await one(
        db,
        `SELECT pi.*, pp.contract_id, pp.invoice_id, pp.provider_id, pp.paid_minor,
                c.deal_id, i.invoice_number
         FROM provider_payout_instructions pi
         JOIN provider_payables pp ON pp.id = pi.payable_id
         JOIN contracts c ON c.id = pp.contract_id
         JOIN invoices i ON i.id = pp.invoice_id
         WHERE pi.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          payable_id: text(row.payable_id),
          payout_instruction_id: id,
          party_ids: ids(row.provider_id),
          status: text(row.status),
          currency: text(row.currency),
          amount_minor: numberOrNull(row.amount_minor),
          title: `Provider payout instruction ${id.slice(0, 8)}`,
          summary: `Provider payout instruction for ${row.invoice_number} is ${row.status}; ${row.amount_minor} minor on ${row.chain ?? "unknown chain"}, requested by ${row.requested_by}, approved by ${row.approved_by}.`,
          occurred_at: iso(row.created_at),
          payload: row,
        },
        [row.status, row.chain, row.destination, row.failure_code, row.failure_message],
      );
    }

    case "provider_payouts": {
      const row = await one(
        db,
        `SELECT p.*, pi.payable_id, pi.chain, pi.destination, pp.contract_id, pp.invoice_id,
                pp.provider_id, c.deal_id, i.invoice_number
         FROM provider_payouts p
         JOIN provider_payout_instructions pi ON pi.id = p.instruction_id
         JOIN provider_payables pp ON pp.id = p.payable_id
         JOIN contracts c ON c.id = pp.contract_id
         JOIN invoices i ON i.id = pp.invoice_id
         WHERE p.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          payable_id: text(row.payable_id),
          payout_id: id,
          payout_instruction_id: text(row.instruction_id),
          party_ids: ids(row.provider_id),
          status: text(row.status),
          currency: text(row.currency),
          amount_minor: numberOrNull(row.amount_minor),
          title: `Provider payout ${row.provider_reference ?? id.slice(0, 8)}`,
          summary: `Provider payout for ${row.invoice_number} is ${row.status}; ${row.amount_minor} minor, reference ${row.provider_reference ?? "missing"}, transaction ${row.transaction_id ?? "missing"}.`,
          occurred_at: iso(row.confirmed_at ?? row.created_at),
          payload: row,
        },
        [row.status, row.provider_reference, row.transaction_id, row.failure_code, row.failure_message],
      );
    }

    case "financial_exceptions": {
      const row = await one(
        db,
        `SELECT e.*, c.buyer_id, c.provider_id FROM financial_exceptions e
         LEFT JOIN contracts c ON c.id = e.contract_id WHERE e.id = $1`,
        [id],
      );
      if (!row) return null;
      const evidence = asObject(row.evidence);
      return build(
        table,
        id,
        {
          exception_id: id,
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          party_ids: ids(row.buyer_id, row.provider_id),
          kind: text(row.kind),
          severity: text(row.severity),
          status: text(row.status),
          difference_minor: numberOrNull(evidence.difference_minor),
          title: `Financial exception: ${row.kind}`,
          summary: text(row.summary) ?? `Financial exception ${row.kind}.`,
          occurred_at: iso(row.created_at),
          updated_at: iso(row.resolved_at),
          payload: row,
        },
        [row.kind, row.severity, row.status, row.summary, row.evidence, row.proposed_correction],
      );
    }

    case "exception_actions": {
      const row = await one(
        db,
        `SELECT a.*, e.kind, e.deal_id, e.contract_id, e.invoice_id, e.status AS exception_status
         FROM exception_actions a JOIN financial_exceptions e ON e.id = a.exception_id
         WHERE a.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          exception_id: text(row.exception_id),
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          action: text(row.action),
          status: text(row.exception_status),
          title: `Exception action ${row.action}`,
          summary: `Exception ${row.kind} action ${row.action} by ${row.actor_id}.`,
          occurred_at: iso(row.created_at),
          payload: row,
        },
        [row.action, row.actor_id, row.details],
      );
    }

    case "financial_approvals": {
      const row = await one(
        db,
        `SELECT a.*,
                CASE WHEN a.object_type = 'financial_exception' THEN a.object_id END AS exception_id,
                CASE WHEN a.object_type = 'provider_payable' THEN a.object_id END AS payable_id,
                CASE WHEN a.object_type = 'payment_obligation' THEN a.object_id END AS obligation_id,
                COALESCE(pp.contract_id, po.contract_id) AS contract_id,
                COALESCE(pp.invoice_id, po.invoice_id) AS invoice_id,
                c.deal_id
         FROM financial_approvals a
         LEFT JOIN provider_payables pp
           ON a.object_type = 'provider_payable' AND pp.id = a.object_id
         LEFT JOIN payment_obligations po
           ON a.object_type = 'payment_obligation' AND po.id = a.object_id
         LEFT JOIN contracts c ON c.id = COALESCE(pp.contract_id, po.contract_id)
         WHERE a.id = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          approval_id: id,
          exception_id: text(row.exception_id),
          payable_id: text(row.payable_id),
          obligation_id: text(row.obligation_id),
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          object_type: text(row.object_type),
          object_id: text(row.object_id),
          action: text(row.action),
          status: text(row.status),
          title: `Financial approval: ${row.action}`,
          summary: `Financial approval for ${row.object_type} ${row.object_id} is ${row.status}; requested by ${row.requested_by}, approved by ${row.approved_by ?? "nobody"}.`,
          occurred_at: iso(row.created_at),
          updated_at: iso(row.decided_at),
          payload: row,
        },
        [row.action, row.object_type, row.object_id, row.status, row.note, row.payable_id, row.invoice_id],
      );
    }

    case "journal_entries": {
      const row = await one(
        db,
        `SELECT e.*, COALESCE(SUM(l.debit_minor), 0)::bigint AS debit_total,
                COALESCE(SUM(l.credit_minor), 0)::bigint AS credit_total,
                (SELECT l.metadata FROM journal_lines l WHERE l.entry_id = e.id LIMIT 1) AS first_line_metadata
         FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id = e.id
         WHERE e.id = $1 GROUP BY e.id`,
        [id],
      );
      if (!row) return null;
      const metadata = asObject(row.first_line_metadata);
      return build(
        table,
        id,
        {
          deal_id: text(metadata.deal_id),
          contract_id: text(metadata.contract_id),
          invoice_id: text(metadata.invoice_id),
          journal_entry_id: id,
          status: text(row.status),
          amount_minor: numberOrNull(row.debit_total),
          title: `Journal entry ${row.entry_number}`,
          summary: `Journal entry ${row.entry_number}: ${row.description}; debits ${row.debit_total} minor, credits ${row.credit_total} minor, source ${row.source_type}.`,
          occurred_at: iso(row.posted_at ?? row.created_at),
          payload: row,
        },
        [row.entry_number, row.description, row.source_type, row.source_id],
      );
    }

    case "journal_lines": {
      const row = await one(
        db,
        `SELECT l.*, e.entry_number, e.description AS entry_description, e.source_type,
                e.source_id, e.status AS entry_status,
                NULLIF(l.metadata->>'contract_id', '') AS contract_id,
                NULLIF(l.metadata->>'invoice_id', '') AS invoice_id,
                (SELECT c.deal_id FROM contracts c
                 WHERE c.id::text = NULLIF(l.metadata->>'contract_id', '') LIMIT 1) AS deal_id
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.id = $1`,
        [id],
      );
      if (!row) return null;
      const amount = numberOrNull(row.debit_minor) ?? 0;
      const credit = numberOrNull(row.credit_minor) ?? 0;
      return build(
        table,
        id,
        {
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          journal_entry_id: text(row.entry_id),
          party_ids: ids(row.party_id),
          amount_minor: amount > 0 ? amount : credit,
          title: `Ledger line ${row.entry_number} ${row.account_code}`,
          summary: `Ledger ${row.entry_number} ${row.entry_description}: account ${row.account_code} ${amount > 0 ? "debit" : "credit"} ${amount > 0 ? amount : credit} minor.`,
          occurred_at: iso(row.created_at),
          payload: row,
        },
        [row.account_code, row.entry_description, row.metadata],
      );
    }

    case "audit_events": {
      const row = await one(
        db,
        `SELECT a.*,
                CASE WHEN a.object_type = 'financial_exception' THEN a.object_id END AS exception_id,
                CASE WHEN a.object_type = 'invoice' THEN a.object_id END AS invoice_id,
                CASE WHEN a.object_type = 'contract' THEN a.object_id END AS contract_id,
                CASE WHEN a.object_type = 'provider_payout' THEN a.object_id END AS payout_id,
                CASE WHEN a.object_type = 'provider_payout_instruction' THEN a.object_id END AS payout_instruction_id
         FROM audit_events a WHERE a.id::text = $1`,
        [id],
      );
      if (!row) return null;
      return build(
        table,
        id,
        {
          exception_id: text(row.exception_id),
          deal_id: text(row.deal_id),
          contract_id: text(row.contract_id),
          invoice_id: text(row.invoice_id),
          payout_id: text(row.payout_id),
          payout_instruction_id: text(row.payout_instruction_id),
          object_type: text(row.object_type),
          object_id: text(row.object_id),
          action: text(row.action),
          title: `Audit ${row.action}`,
          summary: `Audit event ${row.action} on ${row.object_type} ${row.object_id} by ${row.actor_id} (${row.actor_role}).`,
          occurred_at: iso(row.occurred_at),
          payload: row,
        },
        [
          row.action,
          row.object_type,
          row.object_id,
          row.actor_id,
          row.actor_role,
          row.before_state,
          row.after_state,
          row.metadata,
        ],
      );
    }

    default:
      return null;
  }
}

export async function listEntityIds(db: Db, table: string, limit: number): Promise<string[]> {
  if (!PROJECTED_TABLES.includes(table)) return [];
  const result = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM ${table} ORDER BY id LIMIT $1`,
    [Math.min(Math.max(limit, 1), 50_000)],
  );
  return result.rows.map((row) => row.id);
}
