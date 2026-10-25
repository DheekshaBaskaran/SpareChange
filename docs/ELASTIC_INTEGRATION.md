# Elastic integration — Relay Financial Investigator

**Status:** local implementation and contract tests complete; no live Elastic project or deployed Agent Builder agent is claimed in this workspace. See [Live verification](#9-live-verification) for the evidence still required.

**Boundary:** Tiger Data/PostgreSQL remains the system of record. Elasticsearch is a read-only, incrementally synchronized investigation projection. Elastic Agent Builder investigates; it cannot approve, correct, settle, or move money. CREAO remains the orchestrator. Deterministic finance rules, approvals, ledger postings, and payment eligibility remain in the Relay backend.

## 1. Architecture

```text
Tiger Data (authoritative)
  parties, workloads, deals, contracts, invoices, usage, execution,
  payments, payouts, approvals, journal, audit
        │
        │ triggers write identifiers only
        ▼
  elastic_outbox ──► incremental sync worker ──► relay-financial-v1
                                                   (Elasticsearch Serverless)
                                                          ▲
                                                          │ scoped custom tools
CREAO ──POST /v1/creao/investigations/{id}/run──► Relay ──┴──► Elastic Agent Builder
                                                          │      Relay Financial Investigator
                                                          ▼
                                         structured findings + normalized evidence
                                                          │
                                                          ▼
                                 CREAO workflow / finance exception detail /
                                 frontend read APIs
```

The investigator never writes to Tiger Data or to the finance tables. Relay persists the investigation and the validated evidence, then returns both to CREAO.

## 2. Elasticsearch Serverless setup

1. Create an Elasticsearch Serverless project in Elastic Cloud and open its Kibana.
2. Confirm Agent Builder is available for the project's feature tier.
3. Copy the project's **Elasticsearch endpoint** and **Kibana endpoint** from **Manage → Application endpoints**. Use base URLs only; do not append paths.
4. Create API keys in Kibana. Do not paste keys into chat, source files, or committed `.env` files.

The setup uses two keys because the bootstrap and runtime need different privileges:

| Purpose | Environment variable | Required privileges |
|---|---|---|
| Index creation and mapping | `ELASTICSEARCH_API_KEY` (bootstrap phase) | Index `manage`, `read`, `write`, `view_index_metadata` on `relay-financial-v1`; cluster `monitor_inference` |
| Sync and evidence re-reads | `ELASTICSEARCH_API_KEY` (runtime phase) | Index `read`, `write`, `view_index_metadata` on `relay-financial-v1` |
| Create/update tools and agent | `KIBANA_API_KEY` (bootstrap phase) | Kibana `feature_agentBuilder.all` scoped to the target space; cluster `monitor_inference` |
| Invoke the agent | `KIBANA_API_KEY` (runtime phase) | Kibana `feature_agentBuilder.read` scoped to the target space; cluster `monitor_inference` if the project's inference service requires it |

Example bootstrap role descriptor for the default space:

```json
{
  "relay-elastic-bootstrap": {
    "cluster": ["monitor_inference"],
    "indices": [
      {
        "names": ["relay-financial-v1"],
        "privileges": ["manage", "read", "write", "view_index_metadata"]
      }
    ],
    "applications": [
      {
        "application": "kibana-.kibana",
        "privileges": ["feature_agentBuilder.all"],
        "resources": ["space:default"]
      }
    ]
  }
}
```

For a non-default space, change both the space resource and `ELASTIC_KIBANA_SPACE`; the client prefixes Kibana requests with `/s/{space}`.

The simplest local setup may use the same keys for bootstrap and runtime. For production, run `elastic:bootstrap` with the management keys, then replace `ELASTICSEARCH_API_KEY` and `KIBANA_API_KEY` with the narrower runtime keys. If the runtime key cannot see the agent created by the bootstrap key, use one Kibana key with `feature_agentBuilder.all` for both phases.

### Configuration

```bash
ELASTIC_ENABLED=1
ELASTICSEARCH_URL=https://<project>.es.<region>.elastic-cloud.com
KIBANA_URL=https://<project>.kb.<region>.elastic-cloud.com
ELASTICSEARCH_API_KEY=<server-side>
KIBANA_API_KEY=<server-side>
ELASTIC_FINANCIAL_INDEX=relay-financial-v1
ELASTIC_INVESTIGATOR_AGENT_ID=relay-financial-investigator
ELASTIC_KIBANA_SPACE=default
ELASTIC_SYNC_INTERVAL_MS=15000
ELASTIC_INVESTIGATION_TIMEOUT_MS=120000
ELASTIC_MAX_SYNC_BATCH=200
ELASTIC_MAX_BACKFILL_PER_TYPE=5000
```

Absence of this configuration is a supported degraded mode. The finance backend continues normally; the three investigation endpoints return `503 elastic_not_configured`, and no exception is approved or resolved because of the outage.

### Bootstrap and initial index

Apply all database migrations first. Migration `0006_elastic_investigations.sql` adds the outbox, sync-run log, investigation records, and triggers.

```bash
npm run db:migrate
npm run elastic:bootstrap
npm run elastic:reindex
```

- `elastic:bootstrap` creates the `relay-financial-v1` index with explicit mappings, creates eight custom tools, and creates the `Relay Financial Investigator` agent. It is idempotent: existing tools and the agent are updated in place.
- `elastic:reindex` backfills current Tiger Data rows into Elasticsearch and clears the corresponding outbox entries. Use `--incremental` to process only pending outbox rows.
- The running server starts the incremental worker automatically when Elastic is configured. It syncs every `ELASTIC_SYNC_INTERVAL_MS`, and an investigation drains pending rows before it calls Agent Builder.

The index is an investigation projection, not an accounting database. Do not use it as the source for balances, eligibility, approvals, or settlement state.

## 3. Indexed records and shared identifiers

Every document has:

- `document_id` — stable projection ID, `<entity_type>:<uuid>` except audit events;
- `entity_type` and `entity_id`;
- shared relationship fields where applicable: `exception_id`, `deal_id`, `contract_id`, `invoice_id`, `invoice_line_id`, `adjustment_id`, `obligation_id`, `usage_id`, `execution_event_id`, `execution_authorization_id`, `payment_id`, `payment_instruction_id`, `payable_id`, `payout_id`, `payout_instruction_id`, `workload_id`, `offer_id`, `approval_id`, `journal_entry_id`, `party_ids`;
- a human-readable `title`, `summary`, and searchable `search_text`;
- `occurred_at`, `updated_at`, status/amount fields where meaningful;
- the source row in `payload` for exact field-level citation.

| Entity type | Source table | Key links |
|---|---|---|
| `party` | `parties` | `party_ids` |
| `workload` | `workloads` | `deal_id`, `workload_id`, `party_ids` |
| `deal` | `deals` | `deal_id`, `workload_id`, `party_ids` |
| `contract` | `contracts` | `deal_id`, `contract_id`, `party_ids` |
| `contract_rate_line` | `contract_rate_lines` | `deal_id`, `contract_id` |
| `invoice` | `invoices` | `deal_id`, `contract_id`, `invoice_id`, `party_ids` |
| `invoice_line` | `invoice_lines` | `invoice_id`, `invoice_line_id`, `usage_id` |
| `invoice_adjustment` | `invoice_adjustments` | `invoice_id`, `adjustment_id`, `approval_id` |
| `payment_obligation` | `payment_obligations` | `invoice_id`, `obligation_id` |
| `billing_calculation` | `billing_calculations` | `contract_id`, `usage_id`, `execution_event_id` |
| `verified_usage` | `verified_usage` | `contract_id`, `usage_id`, `execution_event_id` |
| `execution_event` | `execution_events` | `execution_event_id`, `workload_id`, `usage_id` |
| `execution_authorization` | `execution_authorizations` | `deal_id`, `execution_authorization_id` |
| `payment` | `payments` | `invoice_id`, `payment_id`, `party_ids` |
| `payment_instruction` | `payment_instructions` | `invoice_id`, `payment_instruction_id` |
| `provider_payable` | `provider_payables` | `invoice_id`, `payable_id`, `party_ids` |
| `provider_payout_instruction` | `provider_payout_instructions` | `payable_id`, `payout_instruction_id` |
| `provider_payout` | `provider_payouts` | `payable_id`, `payout_id`, `payout_instruction_id` |
| `financial_exception` | `financial_exceptions` | `exception_id`, `deal_id`, `contract_id`, `invoice_id` |
| `exception_action` | `exception_actions` | `exception_id` |
| `financial_approval` | `financial_approvals` | `approval_id`, `exception_id`, `payable_id` |
| `journal_entry` | `journal_entries` | `journal_entry_id`, `deal_id`, `contract_id`, `invoice_id` |
| `journal_line` | `journal_lines` | `journal_entry_id`, `deal_id`, `invoice_id`, `party_ids` |
| `audit_event` | `audit_events` | `object_type`, `object_id`, `deal_id`, and derived links |

`payload` is stored but not indexed. Tools return it in search hits; evidence validation reads the exact `_source` field by path (for example `payload.terms.compute_amount_minor`).

## 4. Incremental synchronization

Migration `0006` creates `relay_elastic_outbox_enqueue()` and attaches it to the projected tables. A trigger writes only the table name and row ID to `elastic_outbox`; the sync worker re-reads the authoritative row from Tiger Data. This means:

- no financial values are copied into the outbox;
- updates after an insert are coalesced by entity;
- deletes remove the document from the index;
- a failed Elasticsearch bulk request leaves rows pending with `attempts` and `last_error`;
- the investigation endpoint drains the pending queue before querying, so a newly created exception is searchable in the same request.

`elastic_sync_runs` records each incremental or backfill run for operations. The backfill script paginates per entity type; increase `ELASTIC_MAX_BACKFILL_PER_TYPE` only with memory and runtime in mind.

## 5. Agent Builder tools

`src/elastic/bootstrap.ts` creates these tools in the configured Kibana space:

| Tool | Type | Purpose |
|---|---|---|
| `relay.search_financial_records` | `index_search` | Exploratory natural-language search across the projection |
| `relay.get_exception_records` | ES\|QL | Exception document plus directly linked exception records |
| `relay.get_deal_records` | ES\|QL | Agreement, invoices, usage, payments, payouts, ledger, and audit for a deal |
| `relay.get_contract_records` | ES\|QL | Contract terms, rate lines, usage, billing, and settlements |
| `relay.get_invoice_records` | ES\|QL | Invoice, lines, adjustments, obligation, payments, payable, and payouts |
| `relay.get_execution_evidence` | ES\|QL | Verified Duo 2 usage, billing calculations, and execution events |
| `relay.get_payment_history` | ES\|QL | Buyer payments, instructions, payables, payout instructions, and payouts |
| `relay.get_audit_trail` | ES\|QL | Audit events for one object type and object id |

All tools are restricted to `relay-financial-v1`. The agent intentionally does **not** receive `platform.core.search`, `platform.core.list_indices`, or other broad cluster tools. It cannot search unrelated indices or invoke arbitrary Elasticsearch APIs.

The agent instructions require the investigator to:

1. start from the exception and extract `deal_id`, `contract_id`, and `invoice_id`;
2. follow those identifiers through the linked-record tools;
3. compare approved terms, invoice arithmetic, verified usage, payment history, and audit events;
4. state missing evidence rather than inventing it;
5. return one JSON object with `summary`, `findings`, `missing_evidence`, and `recommended_next_actions`;
6. cite the exact `document_id`, `entity_type`, `entity_id`, `field`, and observed `value` for every finding.

## 6. Evidence validation

The model does not get the final word on what is evidence. `src/elastic/investigator.ts`:

1. parses and schema-validates the agent's JSON;
2. fetches every cited `document_id` with Elasticsearch `_mget`;
3. verifies the document exists, the entity type and ID match, the cited field exists, and the cited value is deeply equal to the indexed `_source` value;
4. verifies the record is linked to this exception by `exception_id`, `deal_id`, `contract_id`, `invoice_id`, or an identifier present in the exception evidence;
5. rejects citations from another deal, contract, invoice, or exception;
6. drops a finding whose citations are all invalid and records a warning;
7. records surviving evidence in `elastic_investigation_evidence` with a normalized index, document ID, field, and value.

Outcomes:

| Status | Meaning | Exception |
|---|---|---|
| `completed` | Valid findings, no rejected citations | Moves `open → investigating`; never resolved |
| `completed_with_warnings` | Valid findings plus rejected citations or unsupported findings | Moves `open → investigating`; warnings returned |
| `insufficient_evidence` | No finding survived validation | Moves `open → investigating`; requires escalation |
| `failed` | Agent outage, invalid JSON/schema, evidence lookup failure, or persistence failure | Remains open and unchanged; an `elastic_investigation_failed` action is recorded |

A validation warning never becomes an approval. A failed or inconclusive investigation is escalated, not silently approved.

## 7. CREAO API

All calls require:

```text
X-Relay-Contract: relay-duo1.v1
Authorization: Bearer <agent or finance key>
```

Writes also require `Idempotency-Key`.

### Run an investigation

`POST /v1/creao/investigations/{exception_id}/run`

Permission: `exception:investigate` (agent, finance, admin).

```json
{
  "question": "Does the invoice match the approved rate and verified GPU-seconds?",
  "follow_up_of": "optional prior investigation UUID"
}
```

A follow-up must belong to the same exception. Each run creates a fresh Agent Builder conversation; the prior summary is supplied for continuity but the agent must independently verify it.

Response `200`:

```json
{
  "investigation": {
    "id": "uuid",
    "exception_id": "uuid",
    "parent_investigation_id": null,
    "status": "completed",
    "initiated_by": "creao",
    "requested_by": "agent-key-id",
    "question": "Does the invoice match...",
    "agent_id": "relay-financial-investigator",
    "conversation_id": "agent-builder-conversation",
    "round_id": "agent-builder-round",
    "summary": "Verified usage supports 4,200 minor; the invoice bills 5,800 minor.",
    "findings": [
      {
        "id": "uuid",
        "issue_code": "invoice_overbilled",
        "title": "Invoice exceeds approved agreement and verified usage",
        "summary": "The invoice total is 5,800 minor; the agreement and verified usage support 4,200 minor; difference 1,600 minor.",
        "severity": "high",
        "confidence": 0.96,
        "uncertainty": "No later credit memo was found.",
        "recommended_actions": [
          "Open a correction for 1,600 minor and route it to the counterparty approver."
        ],
        "evidence": [
          {
            "index": "relay-financial-v1",
            "document_id": "invoice:<uuid>",
            "entity_type": "invoice",
            "entity_id": "<uuid>",
            "field": "total_minor",
            "value": 5800
          },
          {
            "index": "relay-financial-v1",
            "document_id": "contract:<uuid>",
            "entity_type": "contract",
            "entity_id": "<uuid>",
            "field": "payload.terms.compute_amount_minor",
            "value": 4200
          }
        ],
        "created_at": "2026-10-24T12:00:00.000Z"
      }
    ],
    "evidence": [
      {
        "index": "relay-financial-v1",
        "document_id": "invoice:<uuid>",
        "entity_type": "invoice",
        "entity_id": "<uuid>",
        "field": "total_minor",
        "value": 5800
      }
    ],
    "missing_evidence": [],
    "recommended_next_actions": [
      "CREAO should request a correction and human approval."
    ],
    "validation_warnings": [],
    "finding_count": 1,
    "model_usage": {},
    "error_code": null,
    "error_message": null,
    "started_at": "2026-10-24T11:59:40.000Z",
    "completed_at": "2026-10-24T12:00:00.000Z"
  },
  "financial_exception": {
    "id": "uuid",
    "status": "investigating"
  }
}
```

`question` is optional. The deterministic exception summary and evidence are always supplied to the agent. The `financial_exception` field is the current persisted status, not a decision.

### Read history

`GET /v1/creao/investigations/{exception_id}/runs?limit=50`

Permission: `finance:read`.

Returns the current exception and summaries newest first, including status, parent, question, summary, missing evidence, warnings, finding count, and timestamps.

### Read one investigation

`GET /v1/finance/investigations/{investigation_id}`

Permission: `finance:read`.

Returns normalized findings, all supporting citations, model usage, warnings, and the current exception. The frontend can join `document_id` back to the investigation index or display the cited value and field directly. Raw Agent Builder steps and the conversation/round IDs are retained internally for audit and can be inspected in the persisted investigation row or Kibana conversation.

### Errors

| Status | Code | Behavior |
|---|---|---|
| `400` | validation error | Bad UUID, question length, or follow-up shape |
| `403` | permission error | Caller lacks `exception:investigate` / `finance:read` |
| `404` | `financial_exception_not_found` | Unknown exception |
| `409` | `exception_closed` | Exception is resolved or dismissed |
| `409` | `investigation_exception_mismatch` | Follow-up belongs to another exception |
| `502` | `elastic_investigation_invalid_output` | Agent returned no schema-valid JSON; a failed run is persisted |
| `503` | `elastic_not_configured` | No Elastic configuration; no accounting state changed |
| `503` | `elastic_unavailable` | Elasticsearch index mapping check failed; exception remains open |
| `503` | `elastic_investigation_failed` | Agent Builder failed; a failed run and exception action are persisted |
| `503` | `elastic_evidence_lookup_failed` | Cited evidence could not be re-read; a failed run is persisted |

Every successful run inserts an `elastic_investigation_completed` exception action and sets an open exception to `investigating`. It never sets `resolved`, `dismissed`, `correction_proposed`, or `awaiting_approval`.

## 8. Workflow integration and boundaries

### Deterministic exception → CREAO

When reconciliation or settlement handling creates a `financial_exception`, it also creates an `agent_work_items` row with:

```json
{
  "exception_id": "uuid",
  "elastic_investigation": {
    "method": "POST",
    "endpoint": "/v1/creao/investigations/<uuid>/run",
    "required_permission": "exception:investigate",
    "follow_up_supported": true
  }
}
```

CREAO claims the work item, calls the investigation endpoint, interprets the structured findings, requests a follow-up if needed, and coordinates the human resolution. It can complete the work item with its outcome.

### Finance remains deterministic

The finance backend alone:

- calculates the discrepancy and creates the exception;
- decides whether a payment or payout is blocked;
- creates correction proposals and approval requests;
- enforces separation of duties and spending authority;
- posts balanced ledger entries;
- accepts Duo 2 settlement confirmations.

Elastic can recommend an action. It cannot execute one. Open exceptions continue to block payment and payout instructions while an investigation is `running`, `completed`, or `insufficient_evidence`.

### Hyphenate

Hyphenate's billing, double-entry bookkeeping, reconciliation, controls, and auditability are unchanged. The investigation layer is additive evidence retrieval. If Elastic is unavailable, reconciliation still runs, payments remain blocked or allowed by the deterministic rules, and unresolved exceptions stay open for human escalation. There is no path where an Elastic outage results in approval or payment.

### Duo 2

Duo 2 supplies verified usage and settlement confirmations through the existing `/internal/v1/duo2` interfaces. Relay projects those records into the investigation index. The investigator can compare:

- approved GPU count, model, rate, duration, and budget;
- verified GPU-seconds and billing calculations;
- invoice lines and totals in minor units;
- buyer payment instructions and confirmed payments;
- provider payables, payout instructions, and payout confirmations;
- AP/AR ledger postings and audit events.

During the target demo, Duo 2 executes the authorized **test** payment only after the human workflow approves the corrected amount. A confirmed test settlement is reconciled and labelled as a test settlement, never revenue.

## 9. Live verification

Local checks (no Elastic credentials required):

```bash
npm run typecheck
npm test
npm run build
```

The test suite covers outbox projection, shared identifiers, citation validation, unrelated-record rejection, follow-up investigations, unconfigured degraded mode, agent outage persistence, insufficient evidence, and the Agent Builder bootstrap request contract.

Live evidence still required before claiming the deliverable is deployed:

1. An Elasticsearch Serverless project URL and Agent Builder availability.
2. `npm run elastic:bootstrap` output showing the index, eight tools, and `relay-financial-investigator` agent.
3. `npm run elastic:reindex` output showing a completed backfill.
4. An actual exception created by reconciliation from persisted invoice/usage records.
5. A `POST /v1/creao/investigations/{id}/run` response with real `conversation_id`, `round_id`, tool steps, and validated citations.
6. A check that every returned citation's `document_id` and value exist in the index; no invented records.
7. A failed investigation (agent disabled or invalid output) showing the exception remains open and no payment is approved.
8. A follow-up investigation after new evidence, with the same parent exception.
9. A recording or log of the live Agent Builder conversation and the resulting audit rows.
10. A completed human-approved correction and Duo 2 test settlement with a clean reconciliation and balanced ledger.

If credentials are not present, do not infer a live deployment from a local mock, a bootstrap HTTP test, or a screenshot. Record the blocker instead.
