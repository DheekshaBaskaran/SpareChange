import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { asObject, iso, minor } from "../db/values.js";
import { accountBalance } from "./ledger.js";
import { getException, type FinancialExceptionView } from "./exceptions.js";

interface ReconciliationSummary {
  contracts_checked: number;
  invoices_checked: number;
  payments_checked: number;
  provider_payables_checked: number;
  provider_payouts_checked: number;
  matches: number;
  mismatches: number;
  exceptions_created: number;
  exceptions_reused: number;
  exception_ids: string[];
}

export interface ReconciliationResult {
  run_id: string;
  status: "completed";
  started_at: string | null;
  completed_at: string | null;
  summary: ReconciliationSummary;
  exceptions: FinancialExceptionView[];
}

async function ensureException(
  tx: Db,
  input: {
    kind: string;
    severity: "low" | "medium" | "high" | "critical";
    dealId: string | null;
    contractId: string | null;
    invoiceId: string | null;
    summary: string;
    evidence: unknown;
    actorId: string;
  },
): Promise<{ id: string; created: boolean }> {
  if (input.invoiceId) {
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM financial_exceptions
       WHERE kind = $1 AND invoice_id = $2 AND status NOT IN ('resolved', 'dismissed')
       ORDER BY created_at DESC LIMIT 1`,
      [input.kind, input.invoiceId],
    );
    if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  }
  const id = randomUUID();
  await tx.query(
    `INSERT INTO financial_exceptions
       (id, kind, status, severity, deal_id, contract_id, invoice_id, summary, evidence)
     VALUES ($1, $2, 'open', $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      id,
      input.kind,
      input.severity,
      input.dealId,
      input.contractId,
      input.invoiceId,
      input.summary,
      JSON.stringify(input.evidence),
    ],
  );
  await tx.query(
    `INSERT INTO agent_work_items (id, kind, deal_id, status, payload)
     VALUES ($1, 'financial_exception', $2, 'pending', $3::jsonb)`,
    [
      randomUUID(),
      input.dealId,
      JSON.stringify({
        exception_id: id,
        kind: input.kind,
        severity: input.severity,
        summary: input.summary,
        invoice_id: input.invoiceId,
        contract_id: input.contractId,
        next_step: "investigate_using_persisted_records",
      }),
    ],
  );
  return { id, created: true };
}

export async function runReconciliation(
  db: Db,
  options: {
    actorId: string;
    actorRole: string;
    idempotencyKey: string | null;
  },
): Promise<ReconciliationResult> {
  const runId = randomUUID();
  await db.query(
    `INSERT INTO reconciliation_runs (id, status) VALUES ($1, 'running')`,
    [runId],
  );
  const summary: ReconciliationSummary = {
    contracts_checked: 0,
    invoices_checked: 0,
    payments_checked: 0,
    provider_payables_checked: 0,
    provider_payouts_checked: 0,
    matches: 0,
    mismatches: 0,
    exceptions_created: 0,
    exceptions_reused: 0,
    exception_ids: [],
  };
  const exceptionIds = new Set<string>();

  try {
    const contracts = await db.query<{
      id: string;
      deal_id: string;
      buyer_id: string;
      provider_id: string;
      status: string;
      terms: unknown;
    }>(
      `SELECT id, deal_id, buyer_id, provider_id, status, terms FROM contracts
       WHERE status IN ('active', 'completed', 'suspended') ORDER BY created_at`,
    );

    for (const contract of contracts.rows) {
      summary.contracts_checked += 1;
      const expectedResult = await db.query<{ expected: unknown }>(
        `SELECT COALESCE(sum(b.amount_minor), 0)::bigint AS expected
         FROM billing_calculations b
         JOIN verified_usage u ON u.id = b.usage_id
         WHERE b.contract_id = $1`,
        [contract.id],
      );
      const terms = asObject(contract.terms);
      const approvedFees = Math.max(0, Number(terms.switching_cost_minor ?? 0));
      const expected = minor(expectedResult.rows[0]?.expected) + approvedFees;

      const invoices = await db.query<{
        id: string;
        total_minor: unknown;
        paid_minor: unknown;
        status: string;
        due_at: unknown;
        duplicate_of: string | null;
      }>(
        `SELECT id, total_minor, paid_minor, status, due_at, duplicate_of
         FROM invoices WHERE contract_id = $1 AND status <> 'void'
         ORDER BY created_at`,
        [contract.id],
      );
      const invoiced = invoices.rows.reduce((sum, invoice) => sum + minor(invoice.total_minor), 0);
      summary.invoices_checked += invoices.rows.length;

      const payments = await db.query<{
        id: string;
        invoice_id: string;
        amount_minor: unknown;
        status: string;
        provider_reference: string | null;
      }>(
        `SELECT p.id, p.invoice_id, p.amount_minor, p.status, p.provider_reference
         FROM payments p JOIN invoices i ON i.id = p.invoice_id
         WHERE i.contract_id = $1 AND p.status = 'confirmed' ORDER BY p.created_at`,
        [contract.id],
      );
      const paid = payments.rows.reduce((sum, payment) => sum + minor(payment.amount_minor), 0);
      summary.payments_checked += payments.rows.length;

      const usage = await db.query<{ id: string }>(
        `SELECT id FROM verified_usage WHERE contract_id = $1 ORDER BY verified_at`,
        [contract.id],
      );

      if (invoices.rows.length > 0) {
        const difference = invoiced - expected;
        await db.query(
          `INSERT INTO reconciliation_matches
             (id, run_id, match_type, object_a_type, object_a_id, object_b_type, object_b_id,
              status, difference_minor, details)
           VALUES ($1, $2, 'contract_invoice', 'contract', $3, 'invoice', $4, $5, $6, $7::jsonb)`,
          [
            randomUUID(),
            runId,
            contract.id,
            invoices.rows[0]!.id,
            difference === 0 ? "matched" : "mismatched",
            difference,
            JSON.stringify({
              expected_usage_minor: expected - approvedFees,
              approved_fees_minor: approvedFees,
              expected_total_minor: expected,
              invoiced_minor: invoiced,
              invoice_ids: invoices.rows.map((invoice) => invoice.id),
            }),
          ],
        );
        if (difference === 0) summary.matches += 1;
        else summary.mismatches += 1;

        if (usage.rows.length > 0) {
          await db.query(
            `INSERT INTO reconciliation_matches
               (id, run_id, match_type, object_a_type, object_a_id, object_b_type, object_b_id,
                status, difference_minor, details)
             VALUES ($1, $2, 'invoice_usage', 'invoice', $3, 'verified_usage', $4, $5, $6, $7::jsonb)`,
            [
              randomUUID(),
              runId,
              invoices.rows[0]!.id,
              usage.rows[0]!.id,
              difference === 0 ? "matched" : "mismatched",
              difference,
              JSON.stringify({
                expected_usage_minor: expected - approvedFees,
                approved_fees_minor: approvedFees,
                expected_total_minor: expected,
                invoiced_minor: invoiced,
              }),
            ],
          );
          if (difference === 0) summary.matches += 1;
          else summary.mismatches += 1;
        }

        if (difference > 0) {
          const largestInvoice = [...invoices.rows].sort(
            (a, b) => minor(b.total_minor) - minor(a.total_minor),
          )[0]!;
          const exception = await ensureException(db, {
            kind: "invoice_overbilled",
            severity: "high",
            dealId: contract.deal_id,
            contractId: contract.id,
            invoiceId: largestInvoice.id,
            summary: `Invoiced ${invoiced} minor exceeds verified usage ${expected} minor by ${difference} minor.`,
            evidence: {
              contract_id: contract.id,
              invoice_ids: invoices.rows.map((invoice) => invoice.id),
              invoice_total_minor: invoiced,
              expected_verified_usage_minor: expected,
              difference_minor: difference,
              invoice_lines: invoices.rows.map((invoice) => ({
                invoice_id: invoice.id,
                total_minor: minor(invoice.total_minor),
                status: invoice.status,
              })),
              rule: "invoice_total_must_equal_verified_usage_plus_approved_fees",
            },
            actorId: options.actorId,
          });
          exceptionIds.add(exception.id);
          if (exception.created) summary.exceptions_created += 1;
          else summary.exceptions_reused += 1;
        } else if (difference < 0) {
          const exception = await ensureException(db, {
            kind: "invoice_underbilled",
            severity: "medium",
            dealId: contract.deal_id,
            contractId: contract.id,
            invoiceId: invoices.rows[0]!.id,
            summary: `Invoiced ${invoiced} minor is below verified usage ${expected} minor by ${Math.abs(difference)} minor.`,
            evidence: {
              contract_id: contract.id,
              invoice_total_minor: invoiced,
              expected_verified_usage_minor: expected,
              difference_minor: difference,
            },
            actorId: options.actorId,
          });
          exceptionIds.add(exception.id);
          if (exception.created) summary.exceptions_created += 1;
          else summary.exceptions_reused += 1;
        }

        for (const invoice of invoices.rows) {
          const invoicePayments = payments.rows
            .filter((payment) => payment.invoice_id === invoice.id)
            .reduce((sum, payment) => sum + minor(payment.amount_minor), 0);
          const invoiceDifference = minor(invoice.total_minor) - invoicePayments;
          await db.query(
            `INSERT INTO reconciliation_matches
               (id, run_id, match_type, object_a_type, object_a_id, object_b_type, object_b_id,
                status, difference_minor, details)
             VALUES ($1, $2, 'invoice_payment', 'invoice', $3, 'payment', $4, $5, $6, $7::jsonb)`,
            [
              randomUUID(),
              runId,
              invoice.id,
              payments.rows.find((payment) => payment.invoice_id === invoice.id)?.id ?? invoice.id,
              invoiceDifference === 0 ? "matched" : "unmatched",
              invoiceDifference,
              JSON.stringify({
                invoice_total_minor: minor(invoice.total_minor),
                paid_minor: invoicePayments,
                instruction_references: payments.rows
                  .filter((payment) => payment.invoice_id === invoice.id)
                  .map((payment) => payment.provider_reference),
              }),
            ],
          );
          if (invoiceDifference === 0) summary.matches += 1;
          else summary.mismatches += 1;

          if (invoice.status === "issued" && invoice.due_at && new Date(iso(invoice.due_at) ?? 0) < new Date()) {
            const exception = await ensureException(db, {
              kind: "missing_payment",
              severity: "medium",
              dealId: contract.deal_id,
              contractId: contract.id,
              invoiceId: invoice.id,
              summary: `Invoice ${invoice.id} is past due with ${invoiceDifference} minor outstanding.`,
              evidence: {
                invoice_id: invoice.id,
                due_at: iso(invoice.due_at),
                outstanding_minor: invoiceDifference,
                payment_obligation_status: "pending_or_partial",
              },
              actorId: options.actorId,
            });
            exceptionIds.add(exception.id);
            if (exception.created) summary.exceptions_created += 1;
            else summary.exceptions_reused += 1;
          }
        }

        const duplicateGroups = await db.query<{ total_minor: unknown; count: number; ids: string[] }>(
          `SELECT total_minor, count(*)::int AS count, array_agg(id) AS ids
           FROM invoices
           WHERE contract_id = $1 AND status <> 'void'
           GROUP BY total_minor HAVING count(*) > 1`,
          [contract.id],
        );
        for (const group of duplicateGroups.rows) {
          const duplicate = await ensureException(db, {
            kind: "duplicate_invoice",
            severity: "high",
            dealId: contract.deal_id,
            contractId: contract.id,
            invoiceId: group.ids[0] ?? null,
            summary: `${group.count} invoices for contract ${contract.id} have the same total ${minor(group.total_minor)} minor.`,
            evidence: {
              contract_id: contract.id,
              invoice_ids: group.ids,
              duplicate_total_minor: minor(group.total_minor),
              rule: "one issued invoice per contract/usage period unless explicitly marked as a correction",
            },
            actorId: options.actorId,
          });
          exceptionIds.add(duplicate.id);
          if (duplicate.created) summary.exceptions_created += 1;
          else summary.exceptions_reused += 1;
        }
      }

      const receivables = await accountBalance(db, "1100", { contractId: contract.id });
      const expectedReceivable = invoiced - paid;
      const ledgerDifference = receivables - expectedReceivable;
      await db.query(
        `INSERT INTO reconciliation_matches
           (id, run_id, match_type, object_a_type, object_a_id, object_b_type, object_b_id,
            status, difference_minor, details)
         VALUES ($1, $2, 'ledger_payment', 'ledger_account', '1100', 'contract', $3, $4, $5, $6::jsonb)`,
        [
          randomUUID(),
          runId,
          contract.id,
          ledgerDifference === 0 ? "matched" : "mismatched",
          ledgerDifference,
          JSON.stringify({
            accounts_receivable_balance_minor: receivables,
            expected_receivable_minor: expectedReceivable,
            invoiced_minor: invoiced,
            paid_minor: paid,
          }),
        ],
      );
      if (ledgerDifference === 0) summary.matches += 1;
      else {
        summary.mismatches += 1;
        const exception = await ensureException(db, {
          kind: "ledger_mismatch",
          severity: "critical",
          dealId: contract.deal_id,
          contractId: contract.id,
          invoiceId: invoices.rows[0]?.id ?? null,
          summary: `Accounts receivable for contract ${contract.id} differs from invoice/payment records by ${ledgerDifference} minor.`,
          evidence: {
            contract_id: contract.id,
            accounts_receivable_balance_minor: receivables,
            expected_receivable_minor: expectedReceivable,
            difference_minor: ledgerDifference,
          },
          actorId: options.actorId,
        });
        exceptionIds.add(exception.id);
        if (exception.created) summary.exceptions_created += 1;
        else summary.exceptions_reused += 1;
      }
    }

    const providerPayables = await db.query<{
      id: string;
      contract_id: string;
      invoice_id: string;
      provider_id: string;
      amount_minor: unknown;
      paid_minor: unknown;
      status: string;
      deal_id: string | null;
    }>(
      `SELECT pp.id, pp.contract_id, pp.invoice_id, pp.provider_id,
              pp.amount_minor, pp.paid_minor, pp.status, c.deal_id
       FROM provider_payables pp
       JOIN contracts c ON c.id = pp.contract_id
       ORDER BY pp.created_at`,
    );

    for (const payable of providerPayables.rows) {
      summary.provider_payables_checked += 1;
      const confirmedPayouts = await db.query<{ id: string; amount_minor: unknown }>(
        `SELECT id, amount_minor FROM provider_payouts
         WHERE payable_id = $1 AND status = 'confirmed'
         ORDER BY created_at, id`,
        [payable.id],
      );
      summary.provider_payouts_checked += confirmedPayouts.rows.length;
      const accrued = minor(payable.amount_minor);
      const recordedPaid = minor(payable.paid_minor);
      const confirmedPaid = confirmedPayouts.rows.reduce(
        (sum, payout) => sum + minor(payout.amount_minor),
        0,
      );
      const payoutDifference = recordedPaid - confirmedPaid;
      await db.query(
        `INSERT INTO reconciliation_matches
           (id, run_id, match_type, object_a_type, object_a_id, object_b_type, object_b_id,
            status, difference_minor, details)
         VALUES ($1, $2, 'provider_payable_payout', 'provider_payable', $3,
                 'provider_payout', $4, $5, $6, $7::jsonb)`,
        [
          randomUUID(),
          runId,
          payable.id,
          confirmedPayouts.rows[confirmedPayouts.rows.length - 1]?.id ?? payable.id,
          payoutDifference === 0 ? "matched" : "mismatched",
          payoutDifference,
          JSON.stringify({
            payable_id: payable.id,
            amount_minor: accrued,
            recorded_paid_minor: recordedPaid,
            confirmed_payouts_minor: confirmedPaid,
            payout_ids: confirmedPayouts.rows.map((payout) => payout.id),
            rule: "provider payable paid_minor must equal confirmed provider payouts",
          }),
        ],
      );
      if (payoutDifference === 0) summary.matches += 1;
      else {
        summary.mismatches += 1;
        const exception = await ensureException(db, {
          kind: "provider_payout_mismatch",
          severity: "high",
          dealId: payable.deal_id,
          contractId: payable.contract_id,
          invoiceId: payable.invoice_id,
          summary: `Provider payable ${payable.id} records ${recordedPaid} paid but confirmed payouts total ${confirmedPaid}.`,
          evidence: {
            payable_id: payable.id,
            recorded_paid_minor: recordedPaid,
            confirmed_payouts_minor: confirmedPaid,
            difference_minor: payoutDifference,
            payout_ids: confirmedPayouts.rows.map((payout) => payout.id),
          },
          actorId: options.actorId,
        });
        exceptionIds.add(exception.id);
        if (exception.created) summary.exceptions_created += 1;
        else summary.exceptions_reused += 1;
      }

      const ledgerSigned = await accountBalance(db, "2000", {
        contractId: payable.contract_id,
        invoiceId: payable.invoice_id,
      });
      const apBalance = -ledgerSigned;
      const expectedAp = accrued - recordedPaid;
      const ledgerDifference = apBalance - expectedAp;
      await db.query(
        `INSERT INTO reconciliation_matches
           (id, run_id, match_type, object_a_type, object_a_id, object_b_type, object_b_id,
            status, difference_minor, details)
         VALUES ($1, $2, 'provider_payable_ledger', 'ledger_account', '2000',
                 'provider_payable', $3, $4, $5, $6::jsonb)`,
        [
          randomUUID(),
          runId,
          payable.id,
          ledgerDifference === 0 ? "matched" : "mismatched",
          ledgerDifference,
          JSON.stringify({
            payable_id: payable.id,
            accounts_payable_balance_minor: apBalance,
            expected_accounts_payable_minor: expectedAp,
            accrued_minor: accrued,
            paid_minor: recordedPaid,
          }),
        ],
      );
      if (ledgerDifference === 0) summary.matches += 1;
      else {
        summary.mismatches += 1;
        const exception = await ensureException(db, {
          kind: "provider_payout_ledger_mismatch",
          severity: "critical",
          dealId: payable.deal_id,
          contractId: payable.contract_id,
          invoiceId: payable.invoice_id,
          summary: `Accounts payable for provider payable ${payable.id} differs from the payable balance by ${ledgerDifference} minor.`,
          evidence: {
            payable_id: payable.id,
            accounts_payable_balance_minor: apBalance,
            expected_accounts_payable_minor: expectedAp,
            difference_minor: ledgerDifference,
          },
          actorId: options.actorId,
        });
        exceptionIds.add(exception.id);
        if (exception.created) summary.exceptions_created += 1;
        else summary.exceptions_reused += 1;
      }

      if (recordedPaid > accrued) {
        const exception = await ensureException(db, {
          kind: "provider_payable_overpaid",
          severity: "critical",
          dealId: payable.deal_id,
          contractId: payable.contract_id,
          invoiceId: payable.invoice_id,
          summary: `Provider payable ${payable.id} records ${recordedPaid} paid against ${accrued} accrued.`,
          evidence: {
            payable_id: payable.id,
            accrued_minor: accrued,
            recorded_paid_minor: recordedPaid,
            overpaid_minor: recordedPaid - accrued,
          },
          actorId: options.actorId,
        });
        exceptionIds.add(exception.id);
        if (exception.created) summary.exceptions_created += 1;
        else summary.exceptions_reused += 1;
      }
    }

    summary.exception_ids = [...exceptionIds];
    const completedAt = new Date().toISOString();
    await db.query(
      `UPDATE reconciliation_runs SET status = 'completed', completed_at = $2, summary = $3::jsonb
       WHERE id = $1`,
      [runId, completedAt, JSON.stringify(summary)],
    );
    await appendAudit(db, {
      actorId: options.actorId,
      actorRole: options.actorRole,
      action: "reconciliation.completed",
      objectType: "reconciliation_run",
      objectId: runId,
      idempotencyKey: options.idempotencyKey,
      after: summary,
    });
    const exceptions: FinancialExceptionView[] = [];
    for (const id of exceptionIds) {
      const exception = await getException(db, id);
      if (exception) exceptions.push(exception);
    }
    return {
      run_id: runId,
      status: "completed",
      started_at: null,
      completed_at: completedAt,
      summary,
      exceptions,
    };
  } catch (error) {
    await db.query(
      `UPDATE reconciliation_runs SET status = 'failed', completed_at = now(), summary = $2::jsonb
       WHERE id = $1`,
      [runId, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })],
    );
    throw error;
  }
}

export async function getReconciliationRun(db: Db, runId: string): Promise<unknown> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT id, status, started_at, completed_at, summary FROM reconciliation_runs WHERE id = $1`,
    [runId],
  );
  if (!result.rows[0]) return null;
  const matches = await db.query<Record<string, unknown>>(
    `SELECT id, match_type, object_a_type, object_a_id, object_b_type, object_b_id,
            status, difference_minor, details, created_at
     FROM reconciliation_matches WHERE run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return { ...result.rows[0], matches: matches.rows };
}
