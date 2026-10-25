import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ElasticConfig } from "../src/config.js";
import { DEMO_IDS } from "../src/db/seed-demo.js";
import { ElasticFinanceIntegration } from "../src/elastic/investigations.js";
import { ElasticSyncService } from "../src/elastic/sync.js";
import type {
  AgentBuilderPort,
  BulkAction,
  BulkResult,
  ConverseInput,
  ConverseResponse,
  ElasticsearchPort,
  FinancialDocument,
} from "../src/elastic/types.js";
import { createTestContext, TEST_KEYS } from "./helpers/app.js";

const elasticConfig: ElasticConfig = {
  enabled: true,
  elasticsearchUrl: "http://elastic.invalid",
  kibanaUrl: "http://kibana.invalid",
  elasticsearchApiKey: "test-es-key",
  kibanaApiKey: "test-kibana-key",
  indexName: "relay-financial-test",
  agentId: "relay-financial-investigator",
  kibanaSpace: null,
  syncIntervalMs: 15_000,
  investigationTimeoutMs: 30_000,
  maxSyncBatch: 2_000,
  maxBackfillPerType: 5_000,
  disabledReason: null,
};

class FakeElastic implements ElasticsearchPort, AgentBuilderPort {
  readonly documents = new Map<string, FinancialDocument>();
  message = "";
  failConverse = false;

  async bulk(actions: BulkAction[]): Promise<BulkResult> {
    const result: BulkResult = { indexed: [], deleted: [], failures: [] };
    for (const action of actions) {
      if (action.action === "delete") {
        this.documents.delete(action.id);
        result.deleted.push(action.id);
      } else {
        if (action.document) this.documents.set(action.id, action.document);
        result.indexed.push(action.id);
      }
    }
    return result;
  }

  async deleteDocuments(ids: string[]): Promise<BulkResult> {
    return this.bulk(ids.map((id) => ({ action: "delete" as const, id })));
  }

  async getDocuments(ids: string[]): Promise<Map<string, FinancialDocument>> {
    const result = new Map<string, FinancialDocument>();
    for (const id of ids) {
      const document = this.documents.get(id);
      if (document) result.set(id, document);
    }
    return result;
  }

  async refresh(): Promise<void> {}

  async ping(): Promise<void> {}

  async converse(_input: ConverseInput): Promise<ConverseResponse> {
    if (this.failConverse) throw new Error("Agent Builder unavailable");
    return {
      conversationId: randomUUID(),
      roundId: randomUUID(),
      status: "completed",
      message: this.message,
      steps: [],
      modelUsage: { input_tokens: 100, output_tokens: 20 },
    };
  }
}

async function insertException(db: Awaited<ReturnType<typeof createTestContext>>["db"]) {
  const exceptionId = randomUUID();
  await db.query(
    `INSERT INTO financial_exceptions
       (id, kind, status, severity, deal_id, summary, evidence)
     VALUES ($1, 'invoice_overbilled', 'open', 'high', $2, $3, $4::jsonb)`,
    [
      exceptionId,
      DEMO_IDS.deal,
      "Invoice is 1000 minor above verified usage.",
      JSON.stringify({ difference_minor: 1000 }),
    ],
  );
  return exceptionId;
}

test("finance writes enter the outbox and are projected incrementally", async (t) => {
  const { db, app } = await createTestContext();
  t.after(async () => app.close());
  const fake = new FakeElastic();
  const sync = new ElasticSyncService(db, elasticConfig, fake);

  const pending = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM elastic_outbox WHERE processed_at IS NULL`,
  );
  assert.ok(Number(pending.rows[0]?.count) > 0, "seed writes must enqueue projection changes");

  const first = await sync.syncPending(1_000);
  assert.equal(first.status, "completed", JSON.stringify(first));
  assert.ok(fake.documents.size >= 5, "the seed should project linked records");
  const deal = fake.documents.get(`deal:${DEMO_IDS.deal}`);
  assert.ok(deal, "the seeded deal must be searchable");
  assert.equal(deal.entity_type, "deal");
  assert.equal(deal.deal_id, DEMO_IDS.deal);
  assert.equal(deal.status, "awaiting_human_approval");

  const partyId = randomUUID();
  await db.query(
    `INSERT INTO parties (id, kind, name, status) VALUES ($1, 'buyer', 'Incremental Test Buyer', 'active')`,
    [partyId],
  );
  const second = await sync.syncPending(1_000);
  assert.equal(second.status, "completed", JSON.stringify(second));
  const party = fake.documents.get(`party:${partyId}`);
  assert.ok(party, "a post-sync write must be projected without a manual reindex");
  assert.equal(party.status, "active");
  assert.equal(party.party_ids?.[0], partyId);

  const remaining = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM elastic_outbox WHERE processed_at IS NULL`,
  );
  assert.equal(Number(remaining.rows[0]?.count), 0);
});

test("agreement, invoice, execution, settlement, ledger, and audit records share identifiers", async (t) => {
  const { db, app } = await createTestContext();
  t.after(async () => app.close());
  const contractId = randomUUID();
  const eventId = randomUUID();
  const usageId = randomUUID();
  const billingId = randomUUID();
  const invoiceId = randomUUID();
  const invoiceLineId = randomUUID();
  const adjustmentId = randomUUID();
  const obligationId = randomUUID();
  const paymentId = randomUUID();
  const payableId = randomUUID();
  const instructionId = randomUUID();
  const payoutId = randomUUID();
  const entryId = randomUUID();

  await db.query(
    `INSERT INTO contracts
       (id, deal_id, deal_version, buyer_id, provider_id, status, currency, terms,
        approved_at, starts_at, ends_at)
     VALUES ($1, $2, 1, $3, $4, 'active', 'USD', $5::jsonb, now(), now(), now() + interval '10 hours')`,
    [
      contractId,
      DEMO_IDS.deal,
      DEMO_IDS.parties.acme,
      DEMO_IDS.parties.vertex,
      JSON.stringify({
        compute_amount_minor: 19000,
        gpu_model: "H100",
        gpu_count: 8,
        duration_hours: 10,
        rate_minor_per_gpu_hour: 238,
      }),
    ],
  );
  await db.query(
    `INSERT INTO contract_rate_lines
       (id, contract_id, description, gpu_model, gpu_count, rate_minor_per_gpu_hour)
     VALUES ($1, $2, '8x H100 for 10 hours', 'H100', 8, 238)`,
    [randomUUID(), contractId],
  );
  await db.query(
    `INSERT INTO execution_events
       (id, workload_id, job_id, worker_id, event_type, measured_at, gpu_seconds, proof_reference)
     VALUES ($1, $2, 'elastic-job', 'duo2-worker', 'usage', now(), 288000, 'elastic-proof')`,
    [eventId, DEMO_IDS.workloads.acme],
  );
  await db.query(
    `INSERT INTO verified_usage
       (id, execution_event_id, workload_id, contract_id, gpu_model, gpu_count,
        gpu_seconds, verified_at, evidence)
     VALUES ($1, $2, $3, $4, 'H100', 8, 288000, now(), $5::jsonb)`,
    [usageId, eventId, DEMO_IDS.workloads.acme, contractId, JSON.stringify({ measured: true })],
  );
  await db.query(
    `INSERT INTO billing_calculations
       (id, contract_id, usage_id, calculation_version, amount_minor, currency, basis, breakdown)
     VALUES ($1, $2, $3, 'test-v1', 19000, 'USD', 'measured_gpu_seconds', $4::jsonb)`,
    [billingId, contractId, usageId, JSON.stringify({ rate_minor_per_gpu_hour: 238 })],
  );
  await db.query(
    `INSERT INTO invoices
       (id, contract_id, invoice_number, status, issued_at, currency, subtotal_minor,
        tax_minor, total_minor, paid_minor, source)
     VALUES ($1, $2, $3, 'issued', now(), 'USD', 19000, 0, 19000, 0, 'system')`,
    [invoiceId, contractId, `INV-ELASTIC-${invoiceId.slice(0, 8)}`],
  );
  await db.query(
    `INSERT INTO invoice_lines
       (id, invoice_id, description, quantity, unit_rate_minor, amount_minor, usage_id,
        billing_calculation_id)
     VALUES ($1, $2, 'Measured H100 usage', 10, 1900, 19000, $3, $4)`,
    [invoiceLineId, invoiceId, usageId, billingId],
  );
  await db.query(
    `INSERT INTO invoice_adjustments
       (id, invoice_id, amount_minor, reason, status, created_by, applied_at)
     VALUES ($1, $2, -1000, 'Verified overbilling correction', 'applied', 'finance:test', now())`,
    [adjustmentId, invoiceId],
  );
  await db.query(
    `INSERT INTO payment_obligations
       (id, invoice_id, contract_id, amount_minor, currency, status)
     VALUES ($1, $2, $3, 19000, 'USD', 'pending')`,
    [obligationId, invoiceId, contractId],
  );
  await db.query(
    `INSERT INTO payments
       (id, invoice_id, amount_minor, currency, status, provider_reference, confirmed_at)
     VALUES ($1, $2, 19000, 'USD', 'confirmed', 'elastic-payment-ref', now())`,
    [paymentId, invoiceId],
  );
  await db.query(
    `INSERT INTO provider_payables
       (id, contract_id, invoice_id, provider_id, amount_minor, paid_minor, currency, status)
     VALUES ($1, $2, $3, $4, 18000, 0, 'USD', 'accrued')`,
    [payableId, contractId, invoiceId, DEMO_IDS.parties.vertex],
  );
  await db.query(
    `INSERT INTO provider_payout_instructions
       (id, payable_id, amount_minor, currency, chain, destination, status,
        idempotency_key, requested_by, approved_by)
     VALUES ($1, $2, 18000, 'USD', 'solana-devnet', 'test-wallet', 'created',
             $3, 'finance:test', 'human:test')`,
    [instructionId, payableId, `elastic-payout-${instructionId}`],
  );
  await db.query(
    `INSERT INTO provider_payouts
       (id, instruction_id, payable_id, amount_minor, currency, status,
        transaction_id, provider_reference, confirmed_at)
     VALUES ($1, $2, $3, 18000, 'USD', 'confirmed', 'elastic-tx', 'elastic-payout-ref', now())`,
    [payoutId, instructionId, payableId],
  );
  await db.query(
    `INSERT INTO journal_entries
       (id, entry_number, entry_date, description, source_type, source_id, status)
     VALUES ($1, $2, current_date, 'Elastic projection test', 'invoice', $3, 'posted')`,
    [entryId, `JE-ELASTIC-${entryId.slice(0, 8)}`, invoiceId],
  );
  await db.query(
    `INSERT INTO journal_lines
       (id, entry_id, account_code, debit_minor, credit_minor, metadata)
     VALUES ($1, $2, '1100', 19000, 0, $3::jsonb),
            ($4, $2, '4000', 0, 19000, $3::jsonb)`,
    [
      randomUUID(),
      entryId,
      JSON.stringify({ contract_id: contractId, invoice_id: invoiceId, deal_id: DEMO_IDS.deal }),
      randomUUID(),
    ],
  );
  await db.query(
    `INSERT INTO audit_events
       (actor_id, actor_role, action, object_type, object_id, deal_id)
     VALUES ('test', 'finance', 'invoice.issued', 'invoice', $1, $2)`,
    [invoiceId, DEMO_IDS.deal],
  );

  const fake = new FakeElastic();
  const sync = new ElasticSyncService(db, elasticConfig, fake);
  const result = await sync.syncPending(2_000);
  assert.equal(result.status, "completed", JSON.stringify(result));

  const contract = fake.documents.get(`contract:${contractId}`);
  assert.ok(contract);
  assert.equal(contract.deal_id, DEMO_IDS.deal);
  assert.equal(contract.amount_minor, 19000);
  assert.ok(contract.party_ids?.includes(DEMO_IDS.parties.acme));

  const invoice = fake.documents.get(`invoice:${invoiceId}`);
  assert.ok(invoice);
  assert.equal(invoice.amount_minor, 19000);
  assert.equal(invoice.contract_id, contractId);
  assert.equal(invoice.difference_minor, 19000);

  const adjustment = fake.documents.get(`invoice_adjustment:${adjustmentId}`);
  assert.ok(adjustment);
  assert.equal(adjustment.invoice_id, invoiceId);
  assert.equal(adjustment.amount_minor, -1000);
  assert.equal(adjustment.status, "applied");

  const obligation = fake.documents.get(`payment_obligation:${obligationId}`);
  assert.ok(obligation);
  assert.equal(obligation.invoice_id, invoiceId);
  assert.equal(obligation.amount_minor, 19000);
  assert.equal(obligation.status, "pending");

  const usage = fake.documents.get(`verified_usage:${usageId}`);
  assert.ok(usage);
  assert.equal(usage.execution_event_id, eventId);
  assert.equal(usage.gpu_seconds, 288000);
  assert.equal(usage.amount_minor, 19000);

  const payment = fake.documents.get(`payment:${paymentId}`);
  assert.ok(payment);
  assert.equal(payment.invoice_id, invoiceId);
  assert.equal(payment.status, "confirmed");

  const payout = fake.documents.get(`provider_payout:${payoutId}`);
  assert.ok(payout);
  assert.equal(payout.payable_id, payableId);
  assert.equal(payout.payout_instruction_id, instructionId);
  assert.equal(payout.amount_minor, 18000);

  const entry = fake.documents.get(`journal_entry:${entryId}`);
  assert.ok(entry);
  assert.equal(entry.amount_minor, 19000);
  assert.equal(entry.journal_entry_id, entryId);

  const audit = [...fake.documents.values()].find(
    (document) => document.entity_type === "audit_event" && document.object_id === invoiceId,
  );
  assert.ok(audit);
  assert.equal(audit.action, "invoice.issued");
  assert.equal(audit.deal_id, DEMO_IDS.deal);
});

test("the investigator keeps only citations that match indexed records", async (t) => {
  const fake = new FakeElastic();
  const foreignDealId = randomUUID();
  fake.documents.set(`deal:${foreignDealId}`, {
    document_id: `deal:${foreignDealId}`,
    entity_type: "deal",
    entity_id: foreignDealId,
    deal_id: foreignDealId,
    status: "awaiting_human_approval",
  });
  fake.message = JSON.stringify({
    summary: "The deal is still awaiting human approval; the fake invoice does not exist.",
    findings: [
      {
        issue_code: "missing_evidence",
        title: "Deal has not been approved",
        summary: "The indexed deal is awaiting_human_approval.",
        severity: "medium",
        confidence: 0.8,
        uncertainty: "Execution and payment records are not available yet.",
        evidence: [
          {
            document_id: `deal:${DEMO_IDS.deal}`,
            entity_type: "deal",
            entity_id: DEMO_IDS.deal,
            field: "status",
            value: "awaiting_human_approval",
          },
          {
            document_id: `invoice:${randomUUID()}`,
            entity_type: "invoice",
            entity_id: randomUUID(),
            field: "total_minor",
            value: 19000,
          },
          {
            document_id: `deal:${foreignDealId}`,
            entity_type: "deal",
            entity_id: foreignDealId,
            field: "status",
            value: "awaiting_human_approval",
          },
        ],
        recommended_actions: ["Keep the exception open until a human reviews the agreement."],
      },
    ],
    missing_evidence: ["No verified execution or payment record exists yet."],
    recommended_next_actions: ["Escalate to a human finance approver."],
  });

  let service: ElasticFinanceIntegration;
  const context = await createTestContext({
    elasticFactory: (db) => {
      const sync = new ElasticSyncService(db, elasticConfig, fake);
      service = new ElasticFinanceIntegration({
        db,
        config: elasticConfig,
        search: fake,
        agent: fake,
        sync,
      });
      return service;
    },
  });
  t.after(async () => context.app.close());
  const exceptionId = await insertException(context.db);

  const response = await context.app.inject({
    method: "POST",
    url: `/v1/creao/investigations/${exceptionId}/run`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "elastic-run-1" }),
    payload: { question: "Is this invoice supported by the agreement?" },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.investigation.status, "completed_with_warnings", response.body);
  assert.equal(body.investigation.finding_count, 1);
  assert.equal(body.investigation.findings[0].evidence.length, 1);
  assert.equal(body.investigation.findings[0].evidence[0].document_id, `deal:${DEMO_IDS.deal}`);
  assert.ok(
    body.investigation.validation_warnings.some((warning: string) => warning.includes("Rejected")),
  );
  assert.equal(body.financial_exception.status, "investigating");
  assert.ok(service!);

  const history = await context.app.inject({
    method: "GET",
    url: `/v1/creao/investigations/${exceptionId}/runs`,
    headers: context.headers(TEST_KEYS.agent),
  });
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().investigations.length, 1);

  const detail = await context.app.inject({
    method: "GET",
    url: `/v1/finance/investigations/${body.investigation.id}`,
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().investigation.findings.length, 1);
  assert.equal(detail.json().investigation.evidence.length, 1);

  const actions = await context.db.query<{ action: string }>(
    `SELECT action FROM exception_actions WHERE exception_id = $1 ORDER BY created_at`,
    [exceptionId],
  );
  assert.ok(actions.rows.some((row) => row.action === "elastic_investigation_completed"));

  fake.message = JSON.stringify({
    summary: "The follow-up confirms the deal is still awaiting human approval.",
    findings: [
      {
        issue_code: "missing_evidence",
        title: "Approval remains pending",
        summary: "The indexed deal status is still awaiting_human_approval.",
        severity: "low",
        confidence: 0.9,
        uncertainty: "No newer approval record was found.",
        evidence: [
          {
            document_id: `deal:${DEMO_IDS.deal}`,
            entity_type: "deal",
            entity_id: DEMO_IDS.deal,
            field: "status",
            value: "awaiting_human_approval",
          },
        ],
        recommended_actions: ["Escalate the pending participant approvals."],
      },
    ],
    missing_evidence: [],
    recommended_next_actions: ["Continue the human approval workflow."],
  });
  const followUp = await context.app.inject({
    method: "POST",
    url: `/v1/creao/investigations/${exceptionId}/run`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "elastic-run-follow-up" }),
    payload: {
      question: "Has the approval completed since the last run?",
      follow_up_of: body.investigation.id,
    },
  });
  assert.equal(followUp.statusCode, 200, followUp.body);
  assert.equal(followUp.json().investigation.initiated_by, "follow_up");
  assert.equal(followUp.json().investigation.parent_investigation_id, body.investigation.id);
  assert.equal(
    followUp.json().investigation.question,
    "Has the approval completed since the last run?",
  );

  const historyAfterFollowUp = await context.app.inject({
    method: "GET",
    url: `/v1/creao/investigations/${exceptionId}/runs`,
    headers: context.headers(TEST_KEYS.agent),
  });
  assert.equal(historyAfterFollowUp.statusCode, 200, historyAfterFollowUp.body);
  assert.equal(historyAfterFollowUp.json().investigations.length, 2);
});

test("an unconfigured investigator returns 503 and leaves the exception open", async (t) => {
  const context = await createTestContext();
  t.after(async () => context.app.close());
  const exceptionId = await insertException(context.db);

  const response = await context.app.inject({
    method: "POST",
    url: `/v1/creao/investigations/${exceptionId}/run`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "elastic-run-unconfigured" }),
    payload: {},
  });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().code, "elastic_not_configured");

  const exception = await context.app.inject({
    method: "GET",
    url: `/v1/finance/exceptions/${exceptionId}`,
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(exception.statusCode, 200, exception.body);
  assert.equal(exception.json().financial_exception.status, "open");
});

test("an agent outage records a failed investigation and leaves the exception open", async (t) => {
  const fake = new FakeElastic();
  fake.failConverse = true;
  const context = await createTestContext({
    elasticFactory: (db) =>
      new ElasticFinanceIntegration({
        db,
        config: elasticConfig,
        search: fake,
        agent: fake,
        sync: new ElasticSyncService(db, elasticConfig, fake),
      }),
  });
  t.after(async () => context.app.close());
  const exceptionId = await insertException(context.db);

  const response = await context.app.inject({
    method: "POST",
    url: `/v1/creao/investigations/${exceptionId}/run`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "elastic-run-agent-outage" }),
    payload: {},
  });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().code, "elastic_investigation_failed");

  const exception = await context.app.inject({
    method: "GET",
    url: `/v1/finance/exceptions/${exceptionId}`,
    headers: context.headers(TEST_KEYS.finance),
  });
  assert.equal(exception.statusCode, 200, exception.body);
  assert.equal(exception.json().financial_exception.status, "open");
  assert.ok(
    exception
      .json()
      .financial_exception.actions.some((action: { action: string }) => action.action === "elastic_investigation_failed"),
  );

  const failed = await context.db.query<{ status: string; error_code: string }>(
    `SELECT status, error_code FROM elastic_investigations WHERE exception_id = $1`,
    [exceptionId],
  );
  assert.equal(failed.rows[0]?.status, "failed");
  assert.equal(failed.rows[0]?.error_code, "agent_builder_unavailable");
});

test("unsupported citations become insufficient evidence and leave the exception unresolved", async (t) => {
  const fake = new FakeElastic();
  fake.message = JSON.stringify({
    summary: "Only an invented invoice supports this claim.",
    findings: [
      {
        issue_code: "invoice_overbilled",
        title: "Invented invoice",
        summary: "This should be rejected.",
        severity: "high",
        confidence: 0.99,
        uncertainty: "None.",
        evidence: [
          {
            document_id: `invoice:${randomUUID()}`,
            entity_type: "invoice",
            entity_id: randomUUID(),
            field: "total_minor",
            value: 58000,
          },
        ],
        recommended_actions: ["Do not pay."],
      },
    ],
    missing_evidence: ["No real invoice record."],
    recommended_next_actions: ["Human review."],
  });

  const context = await createTestContext({
    elasticFactory: (db) =>
      new ElasticFinanceIntegration({
        db,
        config: elasticConfig,
        search: fake,
        agent: fake,
        sync: new ElasticSyncService(db, elasticConfig, fake),
      }),
  });
  t.after(async () => context.app.close());
  const exceptionId = await insertException(context.db);

  const response = await context.app.inject({
    method: "POST",
    url: `/v1/creao/investigations/${exceptionId}/run`,
    headers: context.headers(TEST_KEYS.agent, { idempotencyKey: "elastic-run-insufficient" }),
    payload: {},
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().investigation.status, "insufficient_evidence");
  assert.equal(response.json().investigation.findings.length, 0);
  assert.equal(response.json().financial_exception.status, "investigating");
  assert.notEqual(response.json().financial_exception.status, "resolved");
});
