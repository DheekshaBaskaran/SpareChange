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
import { getContractById, getExecutionAuthorization } from "../finance/contracts.js";
import { listVerifiedUsage, recordVerifiedUsage } from "../finance/billing.js";
import {
  confirmSettlement,
  listPaymentInstructions,
  submitPaymentInstruction,
} from "../finance/payments.js";
import { listProviderPayables } from "../finance/payables.js";
import {
  confirmProviderPayout,
  listProviderPayoutInstructions,
  listProviderPayouts,
  submitProviderPayout,
} from "../finance/payouts.js";

const contractParam = z.object({ contractId: z.string().uuid() });
const instructionParam = z.object({ instructionId: z.string().uuid() });
const payoutInstructionParam = z.object({ payoutInstructionId: z.string().uuid() });
const authorizationParam = z.object({ authorizationId: z.string().uuid() });

const usageBody = z.object({
  contract_id: z.string().uuid(),
  authorization_id: z.string().uuid(),
  gpu_seconds: z.number().positive(),
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }),
  job_id: z.string().trim().min(1).max(200).nullable().optional(),
  worker_id: z.string().trim().min(1).max(200).nullable().optional(),
  proof_reference: z.string().trim().min(1).max(500).nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  execution_event_id: z.string().uuid().optional(),
});

const settlementBody = z.object({
  instruction_id: z.string().uuid(),
  status: z.enum(["confirmed", "failed"]),
  amount_minor: z.number().int().positive(),
  transaction_id: z.string().trim().min(1).max(500),
  provider_reference: z.string().trim().min(1).max(500),
  confirmed_at: z.string().datetime({ offset: true }).optional(),
  failure_code: z.string().trim().min(1).max(120).optional(),
  failure_message: z.string().trim().min(1).max(2_000).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

const providerSettlementBody = z.object({
  instruction_id: z.string().uuid(),
  status: z.enum(["confirmed", "failed"]),
  amount_minor: z.number().int().positive(),
  transaction_id: z.string().trim().min(1).max(500),
  provider_reference: z.string().trim().min(1).max(500),
  confirmed_at: z.string().datetime({ offset: true }).optional(),
  failure_code: z.string().trim().min(1).max(120).optional(),
  failure_message: z.string().trim().min(1).max(2_000).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export function registerDuo2Routes(app: FastifyInstance, db: Db): void {
  app.get("/internal/v1/duo2/execution-authorizations/:authorizationId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { authorizationId } = parse(authorizationParam, request.params);
    const authorization = await getExecutionAuthorization(db, authorizationId);
    if (!authorization) throw new ApiError(404, "authorization_not_found", "Execution authorization not found.");
    return { authorization };
  });

  app.get("/internal/v1/duo2/contracts/:contractId", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { contractId } = parse(contractParam, request.params);
    const contract = await getContractById(db, contractId);
    if (!contract) throw new ApiError(404, "contract_not_found", "Contract not found.");
    return { contract, verified_usage: await listVerifiedUsage(db, contractId) };
  });

  app.post("/internal/v1/duo2/usage", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "usage:verify");
      const body = parse(usageBody, request.body);
      const usage = await recordVerifiedUsage(db, {
        contractId: body.contract_id,
        authorizationId: body.authorization_id,
        gpuSeconds: body.gpu_seconds,
        startedAt: body.started_at,
        endedAt: body.ended_at,
        jobId: body.job_id,
        workerId: body.worker_id,
        proofReference: body.proof_reference,
        evidence: body.evidence,
        executionEventId: body.execution_event_id,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 201, body: { verified_usage: usage } };
    });
  });

  app.get("/internal/v1/duo2/contracts/:contractId/usage", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const { contractId } = parse(contractParam, request.params);
    return { verified_usage: await listVerifiedUsage(db, contractId) };
  });

  app.get("/internal/v1/duo2/payment-instructions", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(
      z.object({
        status: z.string().trim().min(1).max(40).optional(),
        invoice_id: z.string().uuid().optional(),
      }),
      request.query,
    );
    return {
      payment_instructions: await listPaymentInstructions(db, {
        status: query.status ?? null,
        invoiceId: query.invoice_id ?? null,
      }),
    };
  });

  app.post("/internal/v1/duo2/payment-instructions/:instructionId/submit", async (request, reply) => {
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

  app.get("/internal/v1/duo2/provider-payables", async (request) => {
    const principal = requirePrincipal(request.principal);
    assertPermission(principal, "finance:read");
    const query = parse(
      z.object({
        contract_id: z.string().uuid().optional(),
        status: z.string().trim().min(1).max(40).optional(),
      }),
      request.query,
    );
    return {
      provider_payables: await listProviderPayables(db, {
        contractId: query.contract_id ?? null,
        status: query.status ?? null,
      }),
    };
  });

  app.get("/internal/v1/duo2/provider-payout-instructions", async (request) => {
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
      provider_payout_instructions: await listProviderPayoutInstructions(db, {
        payableId: query.payable_id ?? null,
        status: query.status ?? null,
      }),
    };
  });

  app.get("/internal/v1/duo2/provider-payouts", async (request) => {
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

  app.post("/internal/v1/duo2/provider-payout-instructions/:payoutInstructionId/submit", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "payment:execute");
      const { payoutInstructionId } = parse(payoutInstructionParam, request.params);
      const instruction = await submitProviderPayout(db, {
        instructionId: payoutInstructionId,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return { statusCode: 200, body: { provider_payout_instruction: instruction } };
    });
  });

  app.post("/internal/v1/duo2/provider-settlements", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "settlement:confirm");
      const body = parse(providerSettlementBody, request.body);
      const result = await confirmProviderPayout(db, {
        instructionId: body.instruction_id,
        status: body.status,
        amountMinor: body.amount_minor,
        transactionId: body.transaction_id,
        providerReference: body.provider_reference,
        confirmedAt: body.confirmed_at,
        failureCode: body.failure_code,
        failureMessage: body.failure_message,
        raw: body.raw,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return {
        statusCode: 200,
        body: {
          provider_payout: { id: result.payout_id },
          provider_payout_instruction: result.instruction,
          payable_status: result.payable_status,
          paid_minor: result.paid_minor,
          outstanding_minor: result.outstanding_minor,
        },
      };
    });
  });

  app.post("/internal/v1/duo2/settlements", async (request, reply) => {
    return idempotent(request, reply, db, async () => {
      const principal = requirePrincipal(request.principal);
      assertPermission(principal, "settlement:confirm");
      const body = parse(settlementBody, request.body);
      const result = await confirmSettlement(db, {
        instructionId: body.instruction_id,
        status: body.status,
        amountMinor: body.amount_minor,
        transactionId: body.transaction_id,
        providerReference: body.provider_reference,
        confirmedAt: body.confirmed_at,
        failureCode: body.failure_code,
        failureMessage: body.failure_message,
        raw: body.raw,
        actorId: principal.id,
        actorRole: principal.role,
        idempotencyKey: headerValue(request, IDEMPOTENCY_HEADER),
      });
      return {
        statusCode: 200,
        body: {
          payment: { id: result.payment_id },
          payment_instruction: result.instruction,
          invoice_status: result.invoice_status,
        },
      };
    });
  });
}
