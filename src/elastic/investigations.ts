import { randomUUID } from "node:crypto";
import type { ElasticConfig } from "../config.js";
import type { Db } from "../db/client.js";
import { appendAudit } from "../db/audit.js";
import { asArray, iso } from "../db/values.js";
import { ApiError } from "../errors.js";
import { getException, type FinancialExceptionView } from "../finance/exceptions.js";
import { ElasticHttpError } from "./http.js";
import type { ElasticSyncService } from "./sync.js";
import {
  buildInvestigationPrompt,
  InvestigatorOutputError,
  parseAgentOutput,
  validateInvestigation,
} from "./investigator.js";
import type {
  AgentBuilderPort,
  ElasticInvestigationService,
  ElasticsearchPort,
  EvidenceCitation,
  InvestigationDetail,
  InvestigationFinding,
  InvestigationRequest,
  InvestigationSummary,
} from "./types.js";

interface InvestigationRow {
  id: string;
  exception_id: string;
  parent_investigation_id: string | null;
  status: string;
  initiated_by: string;
  requested_by: string;
  question: string | null;
  agent_id: string;
  conversation_id: string | null;
  round_id: string | null;
  summary: string | null;
  missing_evidence: unknown;
  recommended_next_actions: unknown;
  validation_warnings: unknown;
  model_usage: unknown;
  error_code: string | null;
  error_message: string | null;
  started_at: unknown;
  completed_at: unknown;
  finding_count?: unknown;
}

interface FindingRow {
  id: string;
  issue_code: string;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: unknown;
  uncertainty: string | null;
  recommended_actions: unknown;
  evidence: unknown;
  created_at: unknown;
}

interface EvidenceRow {
  index_name: string;
  document_id: string;
  entity_type: string;
  entity_id: string;
  field: string;
  value: unknown;
}

function summaryFromRow(row: InvestigationRow): InvestigationSummary {
  return {
    id: row.id,
    exception_id: row.exception_id,
    parent_investigation_id: row.parent_investigation_id,
    status: row.status,
    initiated_by: row.initiated_by,
    requested_by: row.requested_by,
    question: row.question,
    agent_id: row.agent_id,
    conversation_id: row.conversation_id,
    round_id: row.round_id,
    summary: row.summary,
    missing_evidence: asArray(row.missing_evidence),
    recommended_next_actions: asArray(row.recommended_next_actions),
    validation_warnings: asArray(row.validation_warnings),
    model_usage: row.model_usage,
    error_code: row.error_code,
    error_message: row.error_message,
    started_at: iso(row.started_at),
    completed_at: iso(row.completed_at),
    finding_count: Number(row.finding_count ?? 0),
  };
}

function findingFromRow(row: FindingRow): InvestigationFinding {
  return {
    id: row.id,
    issue_code: row.issue_code,
    title: row.title,
    summary: row.summary,
    severity: row.severity,
    confidence: Number(row.confidence),
    uncertainty: row.uncertainty,
    recommended_actions: asArray(row.recommended_actions),
    evidence: asArray(row.evidence) as InvestigationFinding["evidence"],
    created_at: iso(row.created_at),
  };
}

function evidenceFromRow(row: EvidenceRow): EvidenceCitation {
  return {
    index: row.index_name,
    document_id: row.document_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    field: row.field,
    value: row.value,
  };
}

export async function listInvestigations(
  db: Db,
  exceptionId: string,
  limit = 50,
): Promise<InvestigationSummary[]> {
  const result = await db.query<InvestigationRow>(
    `SELECT i.id, i.exception_id, i.parent_investigation_id, i.status, i.initiated_by,
            i.requested_by, i.question, i.agent_id, i.conversation_id, i.round_id,
            i.summary, i.missing_evidence, i.recommended_next_actions,
            i.validation_warnings, i.model_usage, i.error_code, i.error_message,
            i.started_at, i.completed_at,
            (SELECT count(*) FROM elastic_investigation_findings f
             WHERE f.investigation_id = i.id) AS finding_count
     FROM elastic_investigations i
     WHERE i.exception_id = $1
     ORDER BY i.created_at DESC
     LIMIT $2`,
    [exceptionId, Math.min(Math.max(limit, 1), 200)],
  );
  return result.rows.map(summaryFromRow);
}

export async function getInvestigation(db: Db, id: string): Promise<InvestigationDetail | null> {
  const result = await db.query<InvestigationRow>(
    `SELECT i.id, i.exception_id, i.parent_investigation_id, i.status, i.initiated_by,
            i.requested_by, i.question, i.agent_id, i.conversation_id, i.round_id,
            i.summary, i.missing_evidence, i.recommended_next_actions,
            i.validation_warnings, i.model_usage, i.error_code, i.error_message,
            i.started_at, i.completed_at
     FROM elastic_investigations i WHERE i.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const findings = await db.query<FindingRow>(
    `SELECT id, issue_code, title, summary, severity, confidence, uncertainty,
            recommended_actions, evidence, created_at
     FROM elastic_investigation_findings
     WHERE investigation_id = $1 ORDER BY position`,
    [id],
  );
  const evidence = await db.query<EvidenceRow>(
    `SELECT index_name, document_id, entity_type, entity_id, field, value
     FROM elastic_investigation_evidence
     WHERE investigation_id = $1 ORDER BY created_at, document_id, field`,
    [id],
  );
  return {
    ...summaryFromRow(row),
    finding_count: findings.rows.length,
    findings: findings.rows.map(findingFromRow),
    evidence: evidence.rows.map(evidenceFromRow),
  };
}

async function insertRunning(
  db: Db,
  options: {
    id: string;
    exceptionId: string;
    parentId: string | null;
    requestedBy: string;
    question: string | null;
    agentId: string;
    initiatedBy: "creao" | "manual" | "follow_up";
  },
): Promise<void> {
  await db.query(
    `INSERT INTO elastic_investigations
       (id, exception_id, parent_investigation_id, status, initiated_by, requested_by,
        question, agent_id)
     VALUES ($1, $2, $3, 'running', $4, $5, $6, $7)`,
    [
      options.id,
      options.exceptionId,
      options.parentId,
      options.initiatedBy,
      options.requestedBy,
      options.question,
      options.agentId,
    ],
  );
}

async function failRunning(
  db: Db,
  options: {
    investigationId: string;
    errorCode: string;
    errorMessage: string;
    agentSteps?: unknown;
    actorId: string;
    idempotencyKey: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.query<{ status: string; exception_id: string }>(
      `SELECT status, exception_id FROM elastic_investigations WHERE id = $1 FOR UPDATE`,
      [options.investigationId],
    );
    const row = result.rows[0];
    if (!row || row.status !== "running") return;
    await tx.query(
      `UPDATE elastic_investigations
       SET status = 'failed', error_code = $2, error_message = $3, agent_steps = $4::jsonb,
           completed_at = now()
       WHERE id = $1`,
      [
        options.investigationId,
        options.errorCode,
        options.errorMessage.slice(0, 4_000),
        options.agentSteps === undefined ? null : JSON.stringify(options.agentSteps),
      ],
    );
    const exception = await getException(tx, row.exception_id);
    await tx.query(
      `INSERT INTO exception_actions (id, exception_id, action, actor_id, details)
       VALUES ($1, $2, 'elastic_investigation_failed', $3, $4::jsonb)`,
      [
        randomUUID(),
        row.exception_id,
        options.actorId,
        JSON.stringify({
          investigation_id: options.investigationId,
          error_code: options.errorCode,
          error_message: options.errorMessage.slice(0, 2_000),
        }),
      ],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: "agent",
      action: "financial_exception.elastic_investigation_failed",
      objectType: "financial_exception",
      objectId: row.exception_id,
      dealId: exception?.deal_id ?? null,
      idempotencyKey: options.idempotencyKey,
      after: {
        investigation_id: options.investigationId,
        error_code: options.errorCode,
      },
    });
  });
}

async function completeRunning(
  db: Db,
  options: {
    investigationId: string;
    status: "completed" | "completed_with_warnings" | "insufficient_evidence";
    summary: string;
    findings: Array<Omit<InvestigationFinding, "id" | "created_at">>;
    evidence: EvidenceCitation[];
    warnings: string[];
    missingEvidence: string[];
    recommendedNextActions: string[];
    modelUsage: unknown;
    agentSteps: unknown;
    conversationId: string | null;
    roundId: string | null;
    agentId: string;
    actorId: string;
    idempotencyKey: string | null;
  },
): Promise<InvestigationDetail> {
  return db.transaction(async (tx) => {
    const result = await tx.query<{ status: string; exception_id: string }>(
      `SELECT status, exception_id FROM elastic_investigations WHERE id = $1 FOR UPDATE`,
      [options.investigationId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "investigation_not_found", "Investigation not found.");
    if (row.status !== "running") {
      throw new ApiError(409, "investigation_not_running", `Investigation is ${row.status}.`);
    }
    await tx.query(
      `UPDATE elastic_investigations
       SET status = $2, summary = $3, conversation_id = $4, round_id = $5,
           missing_evidence = $6::jsonb, recommended_next_actions = $7::jsonb,
           validation_warnings = $8::jsonb, model_usage = $9::jsonb,
           agent_steps = $10::jsonb, completed_at = now()
       WHERE id = $1`,
      [
        options.investigationId,
        options.status,
        options.summary,
        options.conversationId,
        options.roundId,
        JSON.stringify(options.missingEvidence),
        JSON.stringify(options.recommendedNextActions),
        JSON.stringify(options.warnings),
        options.modelUsage === null || options.modelUsage === undefined
          ? null
          : JSON.stringify(options.modelUsage),
        JSON.stringify(options.agentSteps),
      ],
    );
    for (const [position, finding] of options.findings.entries()) {
      await tx.query(
        `INSERT INTO elastic_investigation_findings
           (id, investigation_id, position, issue_code, title, summary, severity,
            confidence, uncertainty, recommended_actions, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
        [
          randomUUID(),
          options.investigationId,
          position,
          finding.issue_code,
          finding.title,
          finding.summary,
          finding.severity,
          finding.confidence,
          finding.uncertainty,
          JSON.stringify(finding.recommended_actions),
          JSON.stringify(finding.evidence),
        ],
      );
    }
    for (const citation of options.evidence) {
      await tx.query(
        `INSERT INTO elastic_investigation_evidence
           (id, investigation_id, index_name, document_id, entity_type, entity_id,
            field, value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (investigation_id, index_name, document_id, field) DO NOTHING`,
        [
          randomUUID(),
          options.investigationId,
          citation.index,
          citation.document_id,
          citation.entity_type,
          citation.entity_id,
          citation.field,
          JSON.stringify(citation.value),
        ],
      );
    }
    const exception = await getException(tx, row.exception_id);
    await tx.query(
      `INSERT INTO exception_actions (id, exception_id, action, actor_id, details)
       VALUES ($1, $2, 'elastic_investigation_completed', $3, $4::jsonb)`,
      [
        randomUUID(),
        row.exception_id,
        options.actorId,
        JSON.stringify({
          investigation_id: options.investigationId,
          status: options.status,
          finding_count: options.findings.length,
          evidence_count: options.evidence.length,
          missing_evidence: options.missingEvidence,
          validation_warnings: options.warnings,
        }),
      ],
    );
    await tx.query(
      `UPDATE financial_exceptions
       SET status = CASE WHEN status = 'open' THEN 'investigating' ELSE status END
       WHERE id = $1`,
      [row.exception_id],
    );
    await appendAudit(tx, {
      actorId: options.actorId,
      actorRole: "agent",
      action: "financial_exception.elastic_investigation_completed",
      objectType: "financial_exception",
      objectId: row.exception_id,
      dealId: exception?.deal_id ?? null,
      idempotencyKey: options.idempotencyKey,
      after: {
        investigation_id: options.investigationId,
        status: options.status,
        finding_count: options.findings.length,
        evidence_count: options.evidence.length,
        agent_id: options.agentId,
      },
    });
    const detail = await getInvestigation(tx, options.investigationId);
    if (!detail) throw new ApiError(500, "investigation_write_failed", "Investigation could not be read back.");
    return detail;
  });
}

export class ElasticFinanceIntegration implements ElasticInvestigationService {
  private readonly db: Db;
  private readonly config: ElasticConfig;
  private readonly search: ElasticsearchPort;
  private readonly agent: AgentBuilderPort;
  private readonly sync: ElasticSyncService;
  private readonly onError: (error: unknown) => void;
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;

  constructor(options: {
    db: Db;
    config: ElasticConfig;
    search: ElasticsearchPort;
    agent: AgentBuilderPort;
    sync: ElasticSyncService;
    onError?: (error: unknown) => void;
  }) {
    this.db = options.db;
    this.config = options.config;
    this.search = options.search;
    this.agent = options.agent;
    this.sync = options.sync;
    this.onError = options.onError ?? (() => undefined);
  }

  start(): void {
    if (this.timer || !this.config.enabled) return;
    const run = () => {
      if (this.syncing) return;
      this.syncing = true;
      void this.sync
        .syncPending()
        .then((summary) => {
          if (summary.status === "failed") this.onError(new Error(summary.error ?? "Elastic sync failed."));
        })
        .catch((error: unknown) => this.onError(error))
        .finally(() => {
          this.syncing = false;
        });
    };
    run();
    this.timer = setInterval(run, this.config.syncIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runInvestigation(request: InvestigationRequest): Promise<{
    investigation: InvestigationDetail;
    financial_exception: FinancialExceptionView;
  }> {
    if (!this.config.enabled) {
      throw new ApiError(
        503,
        "elastic_not_configured",
        "The Elastic investigator is not configured; financial exceptions remain open and unchanged.",
        { retryable: false },
      );
    }
    const exception = await getException(this.db, request.exceptionId);
    if (!exception) {
      throw new ApiError(404, "financial_exception_not_found", "Financial exception not found.");
    }
    if (["resolved", "dismissed"].includes(exception.status)) {
      throw new ApiError(409, "exception_closed", `Exception is ${exception.status}.`);
    }

    let parent: InvestigationDetail | null = null;
    if (request.followUpOf) {
      parent = await getInvestigation(this.db, request.followUpOf);
      if (!parent) throw new ApiError(404, "investigation_not_found", "Parent investigation not found.");
      if (parent.exception_id !== exception.id) {
        throw new ApiError(409, "investigation_exception_mismatch", "The parent investigation belongs to a different exception.");
      }
    }

    try {
      await this.search.ping();
    } catch (error) {
      this.onError(error);
      throw new ApiError(
        503,
        "elastic_unavailable",
        "Elasticsearch is unavailable; the financial exception remains open and unchanged.",
        { retryable: true },
      );
    }

    try {
      for (let batch = 0; batch < 20; batch += 1) {
        const pending = await this.sync.status();
        if (pending.pending === 0) break;
        const result = await this.sync.syncPending();
        if (result.status === "failed") {
          throw new Error(result.error ?? "incremental index sync failed");
        }
        if (result.pending_after === 0) break;
        if (batch === 19) {
          throw new Error(`${result.pending_after} projection changes remain after 20 sync batches`);
        }
      }
      await this.search.refresh();
    } catch (error) {
      this.onError(error);
      throw new ApiError(
        503,
        "elastic_sync_failed",
        "The investigation index could not be refreshed; the financial exception remains open and unchanged.",
        { retryable: true },
      );
    }

    const investigationId = randomUUID();
    await insertRunning(this.db, {
      id: investigationId,
      exceptionId: exception.id,
      parentId: parent?.id ?? null,
      requestedBy: request.actorId,
      question: request.question ?? null,
      agentId: this.config.agentId,
      initiatedBy: parent ? "follow_up" : request.actorRole === "agent" ? "creao" : "manual",
    });

    const actorId = `agent:${this.config.agentId}`;
    const prompt = buildInvestigationPrompt(exception, request.question ?? null, parent?.summary ?? null);
    let response;
    try {
      response = await this.agent.converse({ agentId: this.config.agentId, prompt });
    } catch (error) {
      this.onError(error);
      // Agent Builder relays the model provider's quota as a 429 after its own
      // retries. Report that distinctly so operators raise the Elastic trial
      // limit instead of debugging a phantom outage.
      const rateLimited = error instanceof ElasticHttpError && error.status === 429;
      const errorCode = rateLimited
        ? "agent_builder_rate_limited"
        : error instanceof ElasticHttpError && error.status === 401
          ? "agent_builder_unauthorized"
          : "agent_builder_unavailable";
      await failRunning(this.db, {
        investigationId,
        errorCode,
        errorMessage: error instanceof Error ? error.message : String(error),
        actorId,
        idempotencyKey: request.idempotencyKey,
      }).catch((cause: unknown) => this.onError(cause));
      if (rateLimited) {
        throw new ApiError(
          503,
          "elastic_rate_limited",
          "Elastic Agent Builder reached its model rate or trial limit; the financial exception remains open and unchanged. Retry after the provider quota refills.",
          { retryable: true },
        );
      }
      throw new ApiError(
        503,
        "elastic_investigation_failed",
        "The Elastic investigator could not complete the investigation; the financial exception remains open and unchanged.",
        { retryable: true },
      );
    }

    let output;
    try {
      output = parseAgentOutput(response.message);
    } catch (error) {
      const message = error instanceof InvestigatorOutputError ? error.message : String(error);
      await failRunning(this.db, {
        investigationId,
        errorCode: "invalid_agent_output",
        errorMessage: message,
        agentSteps: response.steps,
        actorId,
        idempotencyKey: request.idempotencyKey,
      });
      throw new ApiError(
        502,
        "elastic_investigation_invalid_output",
        "The investigator returned no valid structured findings; the financial exception remains open and unchanged.",
        { retryable: true },
      );
    }

    let validated;
    try {
      validated = await validateInvestigation(output, exception, this.search, this.config.indexName);
    } catch (error) {
      this.onError(error);
      await failRunning(this.db, {
        investigationId,
        errorCode: "citation_validation_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        agentSteps: response.steps,
        actorId,
        idempotencyKey: request.idempotencyKey,
      }).catch((cause: unknown) => this.onError(cause));
      throw new ApiError(
        503,
        "elastic_evidence_lookup_failed",
        "The investigator's evidence could not be verified; the financial exception remains open and unchanged.",
        { retryable: true },
      );
    }

    let investigation: InvestigationDetail;
    try {
      investigation = await completeRunning(this.db, {
        investigationId,
        status: validated.status,
        summary: output.summary,
        findings: validated.findings,
        evidence: validated.evidence,
        warnings: validated.warnings,
        missingEvidence: output.missing_evidence,
        recommendedNextActions: output.recommended_next_actions,
        modelUsage: response.modelUsage,
        agentSteps: response.steps,
        conversationId: response.conversationId,
        roundId: response.roundId,
        agentId: this.config.agentId,
        actorId,
        idempotencyKey: request.idempotencyKey,
      });
    } catch (error) {
      await failRunning(this.db, {
        investigationId,
        errorCode: "investigation_persistence_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        agentSteps: response.steps,
        actorId,
        idempotencyKey: request.idempotencyKey,
      }).catch((cause: unknown) => this.onError(cause));
      throw error;
    }

    return {
      investigation,
      financial_exception: (await getException(this.db, exception.id)) ?? exception,
    };
  }

  async listInvestigations(exceptionId: string, limit?: number): Promise<InvestigationSummary[]> {
    return listInvestigations(this.db, exceptionId, limit);
  }

  async getInvestigation(id: string): Promise<InvestigationDetail | null> {
    return getInvestigation(this.db, id);
  }

  async status(): Promise<{ pending: number; last_run: Record<string, unknown> | null }> {
    return this.sync.status();
  }
}
