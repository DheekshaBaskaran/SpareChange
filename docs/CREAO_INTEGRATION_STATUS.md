# CREAO integration status

**Verified:** 2026-10-25 (Relay-side contract test re-run on `integration/duo1-duo2`)
**Branch:** `integration/duo1-duo2`
**Verdict:** **RELAY-SIDE 14-OPERATION CONTRACT VERIFIED LOCALLY / LIVE HOSTED AGENT AND LIVE ELASTIC DEPLOYMENT NOT VERIFIED**

The exact CREAO-side configuration and proof sequence is in
[HOSTED_CREAO_RUNBOOK.md](HOSTED_CREAO_RUNBOOK.md).

The Relay backend preserves the 14 operations used by the existing hosted CREAO Deal Coordinator. The agent specification is [CREAO_AGENT_HANDOFF.md](CREAO_AGENT_HANDOFF.md); the agent itself is **not rebuilt** here. There is still no evidence in this workspace that the hosted agent has called a deployed Relay instance, and no public host, CREAO secret, runtime package, or probe output has been provided.

The distinction matters:

- **Implemented and locally tested:** the preserved operations, additive finance/investigation surfaces, response aliases, and the end-to-end workflow.
- **Not verified:** the hosted agent's live configuration, network reachability, probe result, and run logs.

## Preserved contract

The 14 operations and compatibility checks are defined in [test/creao-contract.test.ts](../test/creao-contract.test.ts):

- health, workload, party, offers, and market history reads;
- deal search, deal read, counteroffer, and negotiation-event writes;
- approval-request creation, approval list, and human approval write;
- provisional handoff and escalation.

Contract additions do not change those paths or methods. `POST /v1/deals/search` now returns a persisted `proposal` field (plus additive `recommended`/`proposals`/`rejected` aliases). Counteroffers that would remove the economic surplus or exceed the buyer budget return `409 counteroffer_infeasible` with `violations`.

## What is implemented on the Relay side

| Surface | Status | Evidence |
|---|---|---|
| Deterministic solver-backed search and counteroffers | `[x]` | `test/solver.test.ts`, `test/solver-general.test.ts` |
| Participant-issued negotiation mandates | `[x]` | Mandate create/list routes; governed agent counteroffer test |
| Persisted CREAO work queue and triggers | `[x]` | `deal_opportunity`, `financial_exception`, `approval_followup`; claim/complete tests |
| Approval follow-up trigger | `[x]` | `POST /v1/creao/deals/{deal_id}/approval-followups` |
| Investigation evidence packet | `[x]` | Contract, invoice, usage, payment, approval, payable, payout, and ledger records |
| Findings, correction proposal, human approval, resolution | `[x]` | `test/finance.test.ts` |
| Agent cannot approve or pay | `[x]` | 403 tests in `test/approvals.test.ts` and `test/recovery.test.ts` |
| Audit query | `[x]` | `GET /v1/audit` used in workflow tests |
| 14 preserved operations | `[x]` | `test/creao-contract.test.ts` |
| Elastic investigation endpoint and history | `[x]` | `test/elastic.test.ts` |
| Scoped Agent Builder bootstrap | `[x]` | `test/elastic-bootstrap.test.ts` |
| Incremental outbox projection | `[x]` | `test/elastic.test.ts` |
| Evidence citation re-validation | `[x]` | Unrelated/deleted citations rejected in `test/elastic.test.ts` |
| Degraded mode and failed investigation | `[x]` | `503` paths leave the exception open |

## What is still external

- A public HTTPS Relay host reachable by CREAO.
- Partner Tiger Data `DATABASE_URL` with migrations and seed applied.
- `RELAY_API_BASE_URL` and `RELAY_API_KEY` configured in CREAO.
- Runtime ZIP, `SKILL.md`, `mock_server.py`, and `contract_probe.py`.
- The existing agent's 14/14 read probe and full workflow probe against the deployed API.
- An agent run showing `backend.is_mock=false`.
- A request log or `audit_events` row matching the agent's run time, endpoint, and principal.
- The agent skill update that calls the new finance and investigation endpoints.
- An Elasticsearch Serverless project, scoped Elasticsearch/Kibana API keys, a completed `elastic:bootstrap` and `elastic:reindex`, and a live `Relay Financial Investigator` run with validated citations.
- A CREAO run that claims a financial-exception work item and calls `POST /v1/creao/investigations/{exception_id}/run`, followed by a correction/human-approval workflow.

## Required proof to mark the live integration verified

1. A public HTTPS host serving `/v1/health` with `database: "ok"`.
2. Partner Tiger Data migrated through `0005_provider_payouts.sql`, seeded, and reachable from that host.
3. `RELAY_API_BASE_URL` set in CREAO to the host root, with no `/v1` and no trailing slash.
4. `RELAY_API_KEY` stored as a CREAO secret, not in a document or chat.
5. The existing agent's `contract_probe.py` output showing 14/14 on the preserved endpoints.
6. An agent run showing `backend.is_mock=false`.
7. A backend request log or `audit_events` row matching the probe/run time, endpoint, and agent principal.
8. A negative test: the agent's `POST /v1/approvals` returns `403 human_attestation_required`.
9. A real human approval recorded through a human credential.
10. A response showing the handoff remains `settlement_authorized: false`; execution authorization is a separate explicit step.
11. For the Elastic investigator: bootstrap output for the index, eight tools, and agent; a backfill result; and a live investigation response whose persisted citations all match indexed records.
12. For a failed investigation: the exception remains open, no correction is applied, no payment is approved, and the failure is visible in `exception_actions` and `elastic_investigations`.

Do not mark the integration verified from a mock run, a reference-server run, a localhost curl, or a screenshot of the CREAO UI alone. Do not mark the Elastic agent deployed from a local bootstrap test.

## What to do next

1. Confirm the Tiger Data URL and apply migrations through `0008` (see
   [../deploy/vultr/README.md](../deploy/vultr/README.md)).
2. Deploy the backend to the shared public HTTPS host.
3. Set the CREAO secrets and run the preserved read-only probe
   ([HOSTED_CREAO_RUNBOOK.md](HOSTED_CREAO_RUNBOOK.md)).
4. Run the full agent workflow against the deployed API and record the probe output.
5. Configure Elasticsearch Serverless and Agent Builder, run `npm run elastic:bootstrap` and `npm run elastic:reindex`, then run one live investigation and one deliberate failure. [ELASTIC_INTEGRATION.md](ELASTIC_INTEGRATION.md) has the exact contract and live gates.
6. Record the evidence in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).

## Accurate wording for the demo

> "The Relay coordination and finance APIs are implemented and locally tested end to end, including the preserved 14-operation CREAO contract, the hosted-agent work queue, finance investigation surfaces, and a scoped Elastic Agent Builder investigator with citation validation. The live hosted CREAO connection is still pending a public host, Tiger Data credentials, and a probe result. The live Elastic agent is pending a Serverless project, scoped keys, bootstrap, and a recorded investigation; it is not being rebuilt."
