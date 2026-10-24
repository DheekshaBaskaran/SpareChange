import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { iso } from "../db/values.js";
import { ApiError } from "../errors.js";
import type { Principal } from "../contract.js";
import { assertHumanApprover, separationOfDuties } from "../auth/rbac.js";
import { applyExceptionCorrection } from "./exceptions.js";
import { issuePaymentInstructionFromApproval, type PaymentInstructionView } from "./payments.js";
import {
  issueProviderPayoutFromApproval,
  type ProviderPayoutInstructionView,
} from "./payouts.js";

export interface FinancialApprovalView {
  id: string;
  object_type: string;
  object_id: string;
  object_version: number;
  action: string;
  requested_by: string;
  approved_by: string | null;
  status: string;
  note: string | null;
  created_at: string | null;
  decided_at: string | null;
}

export async function listFinancialApprovals(
  db: Db,
  filters: { status?: string | null; objectType?: string | null; objectId?: string | null } = {},
): Promise<FinancialApprovalView[]> {
  const result = await db.query<{
    id: string;
    object_type: string;
    object_id: string;
    object_version: number;
    action: string;
    requested_by: string;
    approved_by: string | null;
    status: string;
    note: string | null;
    created_at: unknown;
    decided_at: unknown;
  }>(
    `SELECT id, object_type, object_id, object_version, action, requested_by, approved_by,
            status, note, created_at, decided_at
     FROM financial_approvals
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::text IS NULL OR object_type = $2)
       AND ($3::uuid IS NULL OR object_id = $3)
     ORDER BY created_at DESC LIMIT 200`,
    [filters.status ?? null, filters.objectType ?? null, filters.objectId ?? null],
  );
  return result.rows.map((row) => ({
    ...row,
    created_at: iso(row.created_at),
    decided_at: iso(row.decided_at),
  }));
}

export async function decideFinancialApproval(
  db: Db,
  options: {
    approvalId: string;
    decision: "approved" | "rejected";
    principal: Principal;
    note?: string | null;
    idempotencyKey: string | null;
  },
): Promise<{
  approval: FinancialApprovalView;
  result:
    | { type: "invoice_correction"; exception_id: string; invoice_id: string }
    | { type: "payment_instruction"; instruction: PaymentInstructionView }
    | { type: "provider_payout_instruction"; instruction: ProviderPayoutInstructionView }
    | { type: "rejected"; object_type: string; object_id: string };
}> {
  assertHumanApprover(options.principal);
  const approver = options.principal.humanUserId!;
  return db.transaction(async (tx) => {
    const result = await tx.query<{
      id: string;
      object_type: string;
      object_id: string;
      object_version: number;
      action: string;
      requested_by: string;
      approved_by: string | null;
      status: string;
      note: string | null;
      created_at: unknown;
      decided_at: unknown;
    }>(
      `SELECT id, object_type, object_id, object_version, action, requested_by, approved_by,
              status, note, created_at, decided_at
       FROM financial_approvals WHERE id = $1 FOR UPDATE`,
      [options.approvalId],
    );
    const approval = result.rows[0];
    if (!approval) throw new ApiError(404, "financial_approval_not_found", "Financial approval not found.");
    if (approval.status !== "pending") {
      throw new ApiError(409, "financial_approval_decided", `Approval is already ${approval.status}.`);
    }
    separationOfDuties(approval.requested_by, approver);

    if (options.decision === "rejected") {
      await tx.query(
        `UPDATE financial_approvals SET status = 'rejected', approved_by = $2, decided_at = now() WHERE id = $1`,
        [approval.id, approver],
      );
      if (approval.object_type === "financial_exception") {
        await tx.query(
          `UPDATE financial_exceptions SET status = 'investigating' WHERE id = $1 AND status = 'awaiting_approval'`,
          [approval.object_id],
        );
        await tx.query(
          `INSERT INTO exception_actions (id, exception_id, action, actor_id, details)
           VALUES ($1, $2, 'correction_rejected', $3, $4::jsonb)`,
          [
            randomUUID(),
            approval.object_id,
            approver,
            JSON.stringify({ approval_id: approval.id, note: options.note ?? null }),
          ],
        );
      } else if (approval.object_type === "payment_obligation") {
        await tx.query(
          `INSERT INTO audit_events
             (actor_id, actor_role, action, object_type, object_id, idempotency_key, after_state)
           VALUES ($1, 'human', 'payment.approval_rejected', 'financial_approval', $2, $3, $4::jsonb)`,
          [approver, approval.id, options.idempotencyKey, JSON.stringify({ note: options.note ?? null })],
        );
      }
      await appendAudit(tx, {
        actorId: approver,
        actorRole: "human",
        action: "financial_approval.rejected",
        objectType: "financial_approval",
        objectId: approval.id,
        idempotencyKey: options.idempotencyKey,
        after: { object_type: approval.object_type, object_id: approval.object_id, note: options.note ?? null },
      });
      const updated = await tx.query<{
        id: string;
        object_type: string;
        object_id: string;
        object_version: number;
        action: string;
        requested_by: string;
        approved_by: string | null;
        status: string;
        note: string | null;
        created_at: unknown;
        decided_at: unknown;
      }>(
        `SELECT id, object_type, object_id, object_version, action, requested_by, approved_by,
                status, note, created_at, decided_at
         FROM financial_approvals WHERE id = $1`,
        [approval.id],
      );
      return {
        approval: {
          ...updated.rows[0]!,
          created_at: iso(updated.rows[0]!.created_at),
          decided_at: iso(updated.rows[0]!.decided_at),
        },
        result: {
          type: "rejected",
          object_type: approval.object_type,
          object_id: approval.object_id,
        },
      };
    }

    let dispatch:
      | { type: "invoice_correction"; exception_id: string; invoice_id: string }
      | { type: "payment_instruction"; instruction: PaymentInstructionView }
      | { type: "provider_payout_instruction"; instruction: ProviderPayoutInstructionView };

    if (approval.object_type === "financial_exception") {
      const correction = await applyExceptionCorrection(tx, {
        exceptionId: approval.object_id,
        approvalId: approval.id,
        approver,
        note: options.note,
      });
      dispatch = {
        type: "invoice_correction",
        exception_id: correction.exception.id,
        invoice_id: correction.invoice.id,
      };
    } else if (approval.object_type === "payment_obligation") {
      const instruction = await issuePaymentInstructionFromApproval(tx, {
        approvalId: approval.id,
        approver,
        approverRole: "human",
      });
      dispatch = { type: "payment_instruction", instruction };
    } else if (approval.object_type === "provider_payable") {
      const instruction = await issueProviderPayoutFromApproval(tx, {
        approvalId: approval.id,
        approver,
        approverRole: "human",
      });
      dispatch = { type: "provider_payout_instruction", instruction };
    } else {
      throw new ApiError(409, "financial_approval_unsupported", "Unknown financial approval object type.");
    }

    await tx.query(
      `UPDATE financial_approvals SET status = 'approved', approved_by = $2, decided_at = now() WHERE id = $1`,
      [approval.id, approver],
    );
    await appendAudit(tx, {
      actorId: approver,
      actorRole: "human",
      action: "financial_approval.approved",
      objectType: "financial_approval",
      objectId: approval.id,
      idempotencyKey: options.idempotencyKey,
      after: {
        object_type: approval.object_type,
        object_id: approval.object_id,
        action: approval.action,
        note: options.note ?? null,
        dispatch,
      },
    });
    const updated = await tx.query<{
      id: string;
      object_type: string;
      object_id: string;
      object_version: number;
      action: string;
      requested_by: string;
      approved_by: string | null;
      status: string;
      note: string | null;
      created_at: unknown;
      decided_at: unknown;
    }>(
      `SELECT id, object_type, object_id, object_version, action, requested_by, approved_by,
              status, note, created_at, decided_at
       FROM financial_approvals WHERE id = $1`,
      [approval.id],
    );
    return {
      approval: {
        ...updated.rows[0]!,
        created_at: iso(updated.rows[0]!.created_at),
        decided_at: iso(updated.rows[0]!.decided_at),
      },
      result: dispatch,
    };
  });
}
