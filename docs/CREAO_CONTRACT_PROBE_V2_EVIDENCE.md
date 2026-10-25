# Reconstructed contract probe evidence (2026-10-25)

**Status:** the reconstructed probe passed 14/14 both locally and in a hosted
CREAO run. This does **not** prove the missing preserved probe or the
31-operation surface.

- Probe: [`creao/relay-contract-probe/contract_probe_v2.py`](../creao/relay-contract-probe/contract_probe_v2.py)
- Local raw JSON: [`docs/evidence/contract-probe-v2-2026-10-25.json`](evidence/contract-probe-v2-2026-10-25.json)
- Hosted CREAO raw JSON: [`docs/evidence/contract-probe-v2-creao-2026-10-25.json`](evidence/contract-probe-v2-creao-2026-10-25.json)
- Host: `https://api.bitsthat.fit`
- Contract: `relay-duo1.v1`
- Mode: `agent-only`
- Local generated: `2026-10-25T14:42:48.730854Z`
- Hosted CREAO generated: `2026-10-25T14:46:15.193396Z`
- Result: `passed: 14`, `total: 14`, `verdict: "ok"` in both runs
- Local deal: `a4d69bbb-2fb2-4764-8afb-ab666dead779`
- Hosted CREAO deal: `2507d096-15fe-4616-bea2-31f173d7e17b`
- Credential: `relay_` agent key, length 49, `sha256_12` `dbab6894cefb`
  (fingerprint only; the key is not in this repository)

The hosted CREAO run executed the attached copy extracted from the supplied
bundle because `/home/user/agent/app-files.json` did not yet list
`contract_probe_v2.py`; it listed only `relay_read_probe.py` and `SKILL.md`.
Thus the hosted API compatibility result is real, but that agent's mounted-file
manifest is stale. Stage the probe in CREAO app files before using the agent
again so it can locate the script without relying on an out-of-manifest
attachment.

## Operation results

| # | Operation | Status | Meaning |
| --- | --- | --- | --- |
| 1 | `health` | `200` | `database: "ok"` |
| 2 | `workload_read` | `200` | Brightlane workload |
| 3 | `party_read` | `200` | Vertex party |
| 4 | `offers_read` | `200` | 20 offers for the workload |
| 5 | `market_history_read` | `200` | 24 h H100 history |
| 6 | `deal_search` | `201` | deal created |
| 7 | `deal_read` | `200` | version 1 |
| 8 | `counteroffer` | `403` | expected `negotiation_mandate_required` boundary |
| 9 | `negotiation_event` | `201` | version 1 event |
| 10 | `approval_request` | `409` | expected `approval_request_exists` duplicate guard |
| 11 | `approvals_list` | `200` | pending requests for version 1 |
| 12 | `approval_decision` | `403` | expected `human_attestation_required` boundary |
| 13 | `handoff` | `409` | expected `handoff_not_permitted` incomplete-approval guard |
| 14 | `escalation` | `201` | probe deal marked escalated |

Ten operations returned `2xx`; the two `403`s are authorization boundaries and
the two `409`s are guards. This is a **state-changing probe**: it created a
deal, recorded a negotiation event, and escalated the deal. It never approved
on a human's behalf, paid, handed off, or settled. Run only against the demo
environment, with capacity available and permission to create that test deal.

## Reproduce

The demo dataset must have free capacity. Reset it first if a prior run consumed
it (destructive to demo transactions only):

```bash
npm run db:reset-demo -- --confirm
```

Then:

```bash
RELAY_API_BASE_URL="https://api.bitsthat.fit" \
RELAY_API_KEY="<relay_ agent key>" \
python3 creao/relay-contract-probe/contract_probe_v2.py
```

The probe creates a deal and escalates it. It is a contract probe, not a
completed deal; do not present it as one.

## Gaps

- The preserved `contract_probe.py` is absent from this repository and from both
  deployed CREAO bundles. This artifact is a reconstruction.
- The 31-operation full probe is unavailable. Do not claim `31/31`.
- Human-provider mode is implemented but was not exercised; no human key was
  supplied.
- The CREAO response did not include a run id or matching Relay audit/Caddy
  evidence. It proves a hosted API probe execution, not the complete live-agent
  workflow or audit correlation.
