# Relay contract probe v2 (reconstructed)

This is a **new** standalone probe, not the preserved `contract_probe.py` from
the original Relay Deal Coordinator package. The preserved probe is not present
in this repository or in either deployed CREAO agent bundle. This artifact
reconstructs the 14 preserved operations from the OpenAPI contract and the
Relay route tests.

It exercises exactly these paths:

1. `GET /v1/health`
2. `GET /v1/workloads/{workload_id}`
3. `GET /v1/parties/{party_id}`
4. `GET /v1/offers`
5. `GET /v1/market/history`
6. `POST /v1/deals/search`
7. `GET /v1/deals/{deal_id}`
8. `POST /v1/deals/{deal_id}/counteroffers`
9. `POST /v1/deals/{deal_id}/negotiation-events`
10. `POST /v1/approval-requests`
11. `GET /v1/approvals`
12. `POST /v1/approvals`
13. `POST /v1/deals/{deal_id}/handoff`
14. `POST /v1/deals/{deal_id}/escalations`

## Modes

### Agent-only (default)

Uses `RELAY_API_KEY`. Two operations are human-only and are expected to return
`403`:

- `counteroffer` → `403 negotiation_mandate_required` when the agent has no
  negotiation mandate.
- `approval decision` → `403 human_attestation_required`.

Those are reported as **authorization boundaries**, not failures. The probe also
expects and reports:

- `409 approval_request_exists` when the search already created the participant
  request.
- `409 handoff_not_permitted` because the approval set is intentionally
  incomplete.

A clean agent-only run returns `passed: 14`, `total: 14`, `verdict: "ok"` with
two boundaries and two guards.

### Human-provider (optional)

Set `RELAY_HUMAN_API_KEY` and `RELAY_HUMAN_USER_ID` to a human credential bound
to a provider participant in the proposal. The probe then:

- performs a real provider counteroffer, bumping the deal to version 2;
- creates a fresh approval request for that provider on version 2;
- records a real human approval for that provider;
- still expects `409 handoff_not_permitted` because the other participants have
  not approved.

This is the closest reconstruction of the original workflow. It requires a
human key and the matching human user id; the probe never invents them.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `RELAY_API_BASE_URL` | yes | Relay host root, e.g. `https://api.bitsthat.fit` |
| `RELAY_API_KEY` | yes | Relay **agent** key (`relay_…`) |
| `RELAY_HUMAN_API_KEY` | no | Human key for a provider participant |
| `RELAY_HUMAN_USER_ID` | with human key | The human user bound to that key |
| `RELAY_HUMAN_PARTY_ID` | no | Provider party to counter/approve; defaults to the first provider in the proposal |
| `RELAY_WORKLOAD_ID` | no | Defaults to `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab` (Brightlane) |

No other secrets are used. The probe never prints a key; it prints a SHA-256
fingerprint prefix.

## Local run

```bash
set -a; . ./.env; set +a
RELAY_API_BASE_URL="https://api.bitsthat.fit" \
RELAY_API_KEY="<relay_ agent key>" \
python3 creao/relay-contract-probe/contract_probe_v2.py
```

## CREAO run

The working secret name on the new CREAO account is `AGENT_TOKEN`, not
`RELAY_API_KEY`. Run the probe with the alias:

```bash
RELAY_API_KEY="$AGENT_TOKEN" \
python3 <mounted-path>/contract_probe_v2.py
```

If the probe is attached as a reference file, locate it through
`/home/user/agent/app-files.json` first. Do not create or source a `.env` file
inside the sandbox.

## Reset the demo before a clean run

The probe creates a deal and an escalation. A previous run can consume the
seeded capacity, causing `deals/search` to return `no_feasible_deal` or
`capacity_conflict`. Reset the transactional demo state first:

```bash
npm run db:reset-demo -- --confirm
```

This truncates deals, approvals, allocations, contracts, invoices, payments,
and exceptions, then re-seeds the fixtures. It preserves parties, API keys,
ledger accounts, market offers, and audit events. Never run it against a
production-labelled host.

## Expected output

A clean agent-only run:

```json
{
  "passed": 14,
  "total": 14,
  "boundaries": ["counteroffer", "approval_decision"],
  "guards": ["approval_request", "handoff"],
  "verdict": "ok"
}
```

A failure is any operation whose `ok` is false. The JSON includes the exact
HTTP status, error code, detail, and elapsed time for each operation. Do not
replace a failed result with a narrative claim that the contract works.

## Safety

- Read-only on failure paths: no approvals on behalf of a human, no payment, no
  settlement, no handoff completion.
- The escalation marks the probe deal escalated. That is deliberate so the
  probe cannot be mistaken for a cleared deal.
- Run against the demo dataset only.
