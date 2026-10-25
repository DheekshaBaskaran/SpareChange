# Relay read probe (minimal hosted CREAO agent)

This package is the smallest possible hosted-agent check for the deployed Relay:

1. `GET /v1/health` — unauthenticated host and database check.
2. `GET /v1/creao/work-items?status=pending&kind=financial_exception` — the
   authenticated read that returns `401` when the hosted credential is wrong.
3. Optionally `GET /v1/workloads/{id}` — confirms the path the deal coordinator
   will use after authentication works.

It never writes, approves, pays, or falls back to mock data. It reads only
`RELAY_API_BASE_URL` and `RELAY_API_KEY` from the process environment.

## Why this exists

The existing hosted agent returns `401` while the same Relay key succeeds from an
external shell. That means the failure is in the agent's runtime state, not in
Relay's route contract. The usual causes are:

- a stale `RELAY_API_KEY` secret or an old key copied into a runtime file;
- an app-level variable shadowing the account secret;
- a runtime snapshot containing a `.env` file that overwrites `process.env`;
- the runtime reading a hardcoded `loca.lt` host instead of the public host;
- a key from the wrong scope (CREAO `capi_`/`cr_sk_` vs. Relay `relay_`).

This probe removes all of those ambiguities from the question. It reports the
host it actually used, whether a key was present, its short fingerprint, and the
exact HTTP status from Relay.

## Local run

Use the same values the hosted agent should receive:

```bash
RELAY_API_BASE_URL="https://api.bitsthat.fit" \
RELAY_API_KEY="<Relay agent key>" \
python3 creao/relay-read-probe/relay_read_probe.py
```

The probe refuses `http://`, `localhost`, `*.loca.lt`, a path such as `/v1`, or
a trailing slash. That is intentional: those are the configuration mistakes that
produced the earlier tunnel failures.

Expected shape:

```json
{
  "probe": "relay-read-probe/1.0",
  "base_url": "https://api.bitsthat.fit",
  "contract": "relay-duo1.v1",
  "key": {
    "present": true,
    "length": 69,
    "prefix": "relay_",
    "sha256_12": "0123456789ab"
  },
  "health": {
    "http_status": 200,
    "reported_status": "ok",
    "contract": "relay-duo1.v1",
    "database": "ok"
  },
  "authenticated_read": {
    "http_status": 200,
    "work_item_count": 0
  },
  "verdict": "ok"
}
```

Exit codes: `0` ok, `2` configuration error, `3` authentication/role failure,
`1` any other failure.

## Compare fingerprints without exposing the key

The local Relay credential and the credential inside CREAO must have the same
SHA-256 fingerprint. Compute the local expected value without printing the key:

```bash
set -a; . ./.env; set +a
node -e "console.log(require('node:crypto').createHash('sha256').update(process.env.RELAY_API_KEY).digest('hex').slice(0,12))"
```

If the probe's `key.sha256_12` differs, the hosted secret is stale or a
different credential was injected. Rotate/replace the CREAO secret; do not add a
second fallback key to the agent.

## Add it as a fresh CREAO agent

Keep the existing **Relay Deal Coordinator** untouched as the fallback.

1. Create a new agent named `Relay Read Probe`.
2. Attach `SKILL.md` and `relay_read_probe.py` as reference files (or upload the
   package directory contents).
3. Ensure the account secret `RELAY_API_KEY` is the current Relay agent key and
   `RELAY_API_BASE_URL` is `https://api.bitsthat.fit` with no path.
4. Run the agent once with no inputs and capture the JSON.
5. Only after `verdict: "ok"` should the full deal-coordinator workflow be
   migrated to the public host.

If the fresh agent also returns `401` with the same fingerprint as the working
local key, the problem is Relay-side key scoping/rotation, not the agent. If the
fingerprint differs, the problem is CREAO secret injection or a stale runtime
file. Do not weaken Relay authentication to make the probe pass.
