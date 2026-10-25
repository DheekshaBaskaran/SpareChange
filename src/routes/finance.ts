import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../auth/service.js";
import { assertPermission } from "../auth/rbac.js";
import { IDEMPOTENCY_HEADER } from "../contract.js";
import type { Db } from "../db/client.js";
import { ApiError } from "../errors.js";
import { headerValue } from "../http.js";
import { idempotent } from "../idempotency.js";
import { parse } from "../validation.js";
import {
  authorizeExecution,
  getExecutionAuthorization,
  listExecutionAuthorizations,
  getContractsForDeal,
  getContractById,
} from "../finance/contracts.js";
import {
  addInvoiceLine,
  createManualInvoice,
  generateInvoiceForContract,
  getInvoice,
  listInvoices,
} from "../finance/invoices.js";
import {
  decideFinancialApproval,
  listFinancialApprovals,
} from "../finance/approvals.js";
import {
  dismissException,
  getException,
  getExceptionEvidence,
  listExceptions,
  proposeCorrection,
  recordInvestigation,
} from "../finance/exceptions.js";
import {
  listPaymentInstructions,
  requestPaymentInstruction,
  retryFailedInstruction,
  submitPaymentInstruction,
} from "../finance/payments.js";
import { runReconciliation, getReconciliationRun } from "../finance/reconciliation.js";
import { listJournalEntries, trialBalance } from "../finance/ledger.js";
import { getProviderPayable, listProviderPayables } from "../finance/payables.js";
import {
  listProviderPayoutInstructions,
  listProviderPayouts,
  requestProviderPayout,
  retryProviderPayout,
} from "../finance/payouts.js";

const dealParam = z.object({ dealId: z.string().uuid() });
const contractParam = z.object({ contractId: z.string().uuid() });
const invoiceParam = z.object({ invoiceId: z.string().uuid() });
const instructionParam = z.object({ instructionId: z.string().uuid() });
const payableParam = z.object({ payableId: z.string().uuid() });
const payoutInstructionParam = z.object({ payoutInstructionId: z.string().uuid() });
const approvalParam = z.object({ approvalId: z.string().uuid() });
const exceptionParam = z.object({ exceptionId: z.string().uuid() });
const runParam = z.object({ runId: z.string().uuid() });

const invoiceQuery = z.object({
  contract_id: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const exceptionQuery = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  kind: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const approvalQuery = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  object_type: z.string().trim().min(1).max(80).optional(),
  object_id: z.string().uuid().optional(),
});
const ledgerQuery = z.object({
  source_type: z.string().trim().min(1).max(80).optional(),
  source_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const payablesQuery = z.object({
  contract_id: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(40).optional(),
});
const payoutInstructionsQuery = z.object({
  payable_id: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(40).optional(),
});
const payoutBody = z.object({
  amount_minor: z.number().int().positive().optional(),
  chain: z.string().trim().min(1).max(80).optional(),
  destination: z.string().trim().min(1).max(200).optional(),
});
const instructionQuery = z.object({
  invoice_id: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(40).optional(),
});

const invoiceLineBody = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive(),
  unit_rate_minor: z.number().int().nonnegative(),
  amount_minor: z.number().int().positive().optional(),
  reason: z.string().trim().min(1).max(2_000),
});

const paymentRequestBody = z.object({
  chain: z.string().trim().min(1).max(80).optional(),
  destination: z.string().trim().min(1).max(200).optional(),
  approval_id: z.string().uuid().optional(),
});

const manualInvoiceBody = z.object({
  contract_id: z.string().uuid(),
  source: z.enum(["manual", "external"]).optional(),
  duplicate_of: z.string().uuid().nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantity: z.number().positive(),
        unit_rate_minor: z.number().int().nonnegative(),
        amount_minor: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const approvalDecisionBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(2_000).nullable().optional(),
});

const investigationBody = z.object({
  findings: z.string().trim().min(1).max(10_000),
  assigned_to: z.string().trim().min(1).max(200).optional(),
  sources: z.array(z.record(z.string(), z.unknown())).optional(),
});

const correctionBody = z.object({
  corrected_total_minor: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(2_000),
});

const dismissBody = z.object({
  reason: z.string().trim().min(1).max(2_000),
});

export function registerFinanceRoutes(app: FastifyInstance, db: Db): void {
  app.get("/v1/contracts/:contractId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { contractId } = parse(contractParam, request.params);
    const contract = await getContractById(db, contractId);
    if (!contract) throw new ApiError(404, "contract_not_found", "Contract not found.");
    return { contract };
  });
  app.get("/v1/contracts", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(z.object({ deal_id: z.string().uuid() }), request.query);
    return { contracts: await getContractsForDeal(db, query.deal_id) };
  });

  app.post("/v1/deals/:dealId/execution-authorizations", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "execution:authorize");
      const { dealId } = parse(dealParam, request.params);
      const result = await authorizeExecution(db, {
        dealId,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return {
        statusCode: result.replayed ? 200 : 201,
        body: {
          authorization: result.authorization,
          replayed: result.replayed,
          contracts: result.authorization.contracts,
          settlement_authorized: true,
          note: "Execution is authorized. Funds are not authorized until an invoice and payment approval exist.",
        },
      };
    });
  });

  app.get("/v1/deals/:dealId/execution-authorizations", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { dealId } = parse(dealParam, request.params);
    return { authorization: await listExecutionAuthorizations(db, dealId) };
  });

  app.get("/v1/execution-authorizations/:authorizationId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { authorizationId } = parse(
      z.object({ authorizationId: z.string().uuid() }),
      request.params,
    );
    const authorization = await getExecutionAuthorization(db, authorizationId);
    if (!authorization) throw new ApiError(404, "authorization_not_found", "Execution authorization not found.");
    return { authorization };
  });

  app.post("/v1/contracts/:contractId/invoices", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "invoice:generate");
      const { contractId } = parse(contractParam, request.params);
      const invoice = await generateInvoiceForContract(db, {
        contractId,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { invoice } };
    });
  });

  app.post("/v1/invoices", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "invoice:adjust");
      const body = parse(manualInvoiceBody, request.body);
      const invoice = await createManualInvoice(db, {
        contractId: body.contract_id,
        source: body.source ?? "manual",
        duplicateOf: body.duplicate_of,
        currency: body.currency,
        lines: body.lines,
        metadata: body.metadata,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { invoice } };
    });
  });

  app.get("/v1/invoices", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(invoiceQuery, request.query);
    return {
      invoices: await listInvoices(db, {
        contractId: query.contract_id ?? null,
        status: query.status ?? null,
        limit: query.limit,
      }),
    };
  });

  app.post("/v1/invoices/:invoiceId/lines", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "invoice:adjust");
      const { invoiceId } = parse(invoiceParam, request.params);
      const body = parse(invoiceLineBody, request.body);
      const invoice = await addInvoiceLine(db, {
        invoiceId,
        description: body.description,
        quantity: body.quantity,
        unitRateMinor: body.unit_rate_minor,
        amountMinor: body.amount_minor,
        reason: body.reason,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { invoice } };
    });
  });

  app.get("/v1/invoices/:invoiceId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { invoiceId } = parse(invoiceParam, request.params);
    return { invoice: await getInvoice(db, invoiceId) };
  });

  app.get("/v1/provider-payables", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(payablesQuery, request.query);
    return {
      payables: await listProviderPayables(db, {
        contractId: query.contract_id ?? null,
        status: query.status ?? null,
      }),
    };
  });

  app.get("/v1/provider-payables/:payableId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { payableId } = parse(payableParam, request.params);
    return { payable: await getProviderPayable(db, payableId) };
  });

  app.post("/v1/provider-payables/:payableId/payout-instruction", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "payment:request");
      const { payableId } = parse(payableParam, request.params);
      const body = parse(payoutBody, request.body ?? {});
      const result = await requestProviderPayout(db, {
        payableId,
        amountMinor: body.amount_minor,
        chain: body.chain,
        destination: body.destination,
        principal,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return {
        statusCode: result.status === "approval_required" ? 202 : 201,
        body: result,
      };
    });
  });

  app.get("/v1/provider-payout-instructions", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(payoutInstructionsQuery, request.query);
    return {
      provider_payout_instructions: await listProviderPayoutInstructions(db, {
        payableId: query.payable_id ?? null,
        status: query.status ?? null,
      }),
    };
  });

  app.post("/v1/provider-payout-instructions/:payoutInstructionId/retry", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "payment:request");
      const { payoutInstructionId } = parse(payoutInstructionParam, request.params);
      const instruction = await retryProviderPayout(db, {
        instructionId: payoutInstructionId,
        principal,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { provider_payout_instruction: instruction } };
    });
  });

  app.get("/v1/provider-payouts", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(
      z.object({
        payable_id: z.string().uuid().optional(),
        status: z.string().trim().min(1).max(40).optional(),
      }),
      request.query,
    );
    return {
      provider_payouts: await listProviderPayouts(db, {
        payableId: query.payable_id ?? null,
        status: query.status ?? null,
      }),
    };
  });

  app.post("/v1/invoices/:invoiceId/payment-instruction", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "payment:request");
      const { invoiceId } = parse(invoiceParam, request.params);
      const body = parse(paymentRequestBody, request.body ?? {});
      const result = await requestPaymentInstruction(db, {
        invoiceId,
        chain: body.chain,
        destination: body.destination,
        approvalId: body.approval_id,
        principal,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return {
        statusCode: result.status === "approval_required" ? 202 : 201,
        body: result,
      };
    });
  });

  app.get("/v1/payment-instructions", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(instructionQuery, request.query);
    return {
      payment_instructions: await listPaymentInstructions(db, {
        invoiceId: query.invoice_id ?? null,
        status: query.status ?? null,
      }),
    };
  });

  app.post("/v1/payment-instructions/:instructionId/submit", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "payment:execute");
      const { instructionId } = parse(instructionParam, request.params);
      const instruction = await submitPaymentInstruction(db, {
        instructionId,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 200, body: { payment_instruction: instruction } };
    });
  });

  app.post("/v1/payment-instructions/:instructionId/retry", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "payment:request");
      const { instructionId } = parse(instructionParam, request.params);
      const instruction = await retryFailedInstruction(db, {
        instructionId,
        principal,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { payment_instruction: instruction } };
    });
  });

  app.get("/v1/financial-approvals", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(approvalQuery, request.query);
    return {
      financial_approvals: await listFinancialApprovals(db, {
        status: query.status ?? null,
        objectType: query.object_type ?? null,
        objectId: query.object_id ?? null,
      }),
    };
  });

  app.post("/v1/financial-approvals/:approvalId/decision", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      const { approvalId } = parse(approvalParam, request.params);
      const body = parse(approvalDecisionBody, request.body);
      const result = await decideFinancialApproval(db, {
        approvalId,
        decision: body.decision,
        principal,
        note: body.note,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 200, body: result };
    });
  });

  app.post("/v1/finance/reconciliations", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "invoice:adjust");
      const result = await runReconciliation(db, {
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: result };
    });
  });

  app.get("/v1/finance/reconciliations/:runId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { runId } = parse(runParam, request.params);
    const run = await getReconciliationRun(db, runId);
    if (!run) throw new ApiError(404, "reconciliation_run_not_found", "Reconciliation run not found.");
    return run;
  });

  app.get("/v1/finance/exceptions", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(exceptionQuery, request.query);
    return {
      financial_exceptions: await listExceptions(db, {
        status: query.status ?? null,
        kind: query.kind ?? null,
        limit: query.limit,
      }),
    };
  });

  app.get("/v1/finance/exceptions/:exceptionId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { exceptionId } = parse(exceptionParam, request.params);
    const exception = await getException(db, exceptionId);
    if (!exception) throw new ApiError(404, "financial_exception_not_found", "Financial exception not found.");
    return { financial_exception: exception };
  });

  app.get("/v1/finance/exceptions/:exceptionId/evidence", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { exceptionId } = parse(exceptionParam, request.params);
    return { evidence: await getExceptionEvidence(db, exceptionId) };
  });

  app.post("/v1/finance/exceptions/:exceptionId/investigate", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "exception:investigate");
      const { exceptionId } = parse(exceptionParam, request.params);
      const body = parse(investigationBody, request.body);
      const exception = await recordInvestigation(db, {
        exceptionId,
        findings: body.findings,
        assignedTo: body.assigned_to,
        sources: body.sources,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { financial_exception: exception } };
    });
  });

  app.post("/v1/finance/exceptions/:exceptionId/propose-correction", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "exception:propose");
      const { exceptionId } = parse(exceptionParam, request.params);
      const body = parse(correctionBody, request.body);
      const result = await proposeCorrection(db, {
        exceptionId,
        correctedTotalMinor: body.corrected_total_minor,
        reason: body.reason,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: result };
    });
  });

  app.post("/v1/finance/exceptions/:exceptionId/dismiss", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "invoice:adjust");
      const { exceptionId } = parse(exceptionParam, request.params);
      const body = parse(dismissBody, request.body);
      const exception = await dismissException(db, {
        exceptionId,
        reason: body.reason,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 200, body: { financial_exception: exception } };
    });
  });

  app.get("/v1/ledger/trial-balance", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "ledger:read");
    const accounts = await trialBalance(db);
    const totalDebit = accounts.reduce((sum, account) => sum + account.debit_minor, 0);
    const totalCredit = accounts.reduce((sum, account) => sum + account.credit_minor, 0);
    return {
      accounts,
      total_debit_minor: totalDebit,
      total_credit_minor: totalCredit,
      balanced: totalDebit === totalCredit,
    };
  });

  app.get("/v1/ledger/entries", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "ledger:read");
    const query = parse(ledgerQuery, request.query);
    return {
      entries: await listJournalEntries(db, {
        sourceType: query.source_type ?? null,
        sourceId: query.source_id ?? null,
        limit: query.limit,
      }),
    };
  });
}
