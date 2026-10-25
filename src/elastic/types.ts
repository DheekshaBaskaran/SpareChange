export interface FinancialDocument {
  document_id: string;
  entity_type: string;
  entity_id: string;
  exception_id?: string | null;
  deal_id?: string | null;
  contract_id?: string | null;
  invoice_id?: string | null;
  invoice_line_id?: string | null;
  adjustment_id?: string | null;
  obligation_id?: string | null;
  usage_id?: string | null;
  execution_event_id?: string | null;
  execution_authorization_id?: string | null;
  payment_id?: string | null;
  payment_instruction_id?: string | null;
  payable_id?: string | null;
  payout_id?: string | null;
  payout_instruction_id?: string | null;
  workload_id?: string | null;
  offer_id?: string | null;
  approval_id?: string | null;
  journal_entry_id?: string | null;
  party_ids?: string[];
  object_type?: string | null;
  object_id?: string | null;
  action?: string | null;
  kind?: string | null;
  severity?: string | null;
  status?: string | null;
  currency?: string | null;
  amount_minor?: number | null;
  paid_minor?: number | null;
  difference_minor?: number | null;
  gpu_seconds?: number | null;
  title?: string;
  summary?: string;
  occurred_at?: string | null;
  updated_at?: string | null;
  search_text?: string;
  payload?: unknown;
}

export interface BulkAction {
  action: "index" | "delete";
  id: string;
  document?: FinancialDocument;
}

export interface BulkFailure {
  id: string;
  action: "index" | "delete";
  error: string;
}

export interface BulkResult {
  indexed: string[];
  deleted: string[];
  failures: BulkFailure[];
}

export interface ConverseInput {
  prompt: string;
  agentId: string;
  conversationId?: string | null;
}

export interface ConverseStep {
  type?: string;
  tool_id?: string;
  params?: unknown;
  results?: unknown;
  reasoning?: string;
  [key: string]: unknown;
}

export interface ConverseResponse {
  conversationId: string | null;
  roundId: string | null;
  status: string;
  message: string;
  steps: ConverseStep[];
  modelUsage: unknown;
}

export interface ElasticsearchPort {
  bulk(actions: BulkAction[]): Promise<BulkResult>;
  deleteDocuments(ids: string[]): Promise<BulkResult>;
  getDocuments(ids: string[]): Promise<Map<string, FinancialDocument>>;
  refresh(): Promise<void>;
  ping(): Promise<void>;
}

export interface AgentBuilderPort {
  converse(input: ConverseInput): Promise<ConverseResponse>;
}

export interface InvestigationRequest {
  exceptionId: string;
  question?: string | null;
  followUpOf?: string | null;
  actorId: string;
  actorRole: string;
  idempotencyKey: string | null;
}

export interface InvestigationSummary {
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
  missing_evidence: unknown[];
  recommended_next_actions: unknown[];
  validation_warnings: unknown[];
  model_usage: unknown;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  finding_count: number;
}

export interface InvestigationFinding {
  id: string;
  issue_code: string;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  uncertainty: string | null;
  recommended_actions: unknown[];
  evidence: EvidenceCitation[];
  created_at: string | null;
}

export interface EvidenceCitation {
  index: string;
  document_id: string;
  entity_type: string;
  entity_id: string;
  field: string;
  value: unknown;
}

export interface InvestigationDetail extends InvestigationSummary {
  findings: InvestigationFinding[];
  evidence: EvidenceCitation[];
}

export interface ElasticInvestigationService {
  runInvestigation(request: InvestigationRequest): Promise<{
    investigation: InvestigationDetail;
    financial_exception: unknown;
  }>;
  listInvestigations(exceptionId: string, limit?: number): Promise<InvestigationSummary[]>;
  getInvestigation(id: string): Promise<InvestigationDetail | null>;
  start?(): void;
  stop?(): void;
}
