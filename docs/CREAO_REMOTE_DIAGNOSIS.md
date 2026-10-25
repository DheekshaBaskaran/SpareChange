# CREAO remote run: exact root cause

**Date:** 2026-10-25
**Verdict:** the app runs remotely. It fails with `config_error` because
`RELAY_API_KEY` is not set in the CREAO environment. This is not a Vultr, Caddy,
or Relay outage.

## What was called

```http
POST https://agent.creao.ai/api/v1/apps/2b187fe0-4ad4-4693-a4ed-c061da8214a0/runs
Authorization: Bearer $CREAO_API_KEY
Content-Type: application/json

{"inputs": {}}
```

Response: `202` with run `fcd34a60-0cc8-4d74-bf42-81750ca60bb3`, app
`Relay Read Probe v1`.

Polling `GET .../runs/fcd34a60-0cc8-4d74-bf42-81750ca60bb3` reached
`completed`. The probe returned:

```json
{
  "probe": "relay-read-probe/1.0",
  "generated_at": "2026-10-25T15:07:35.681855Z",
  "verdict": "config_error",
  "error": "RELAY_API_KEY is not set"
}
```

The app's own explanation:

> The only Relay-related secret available was `RELAY_API_BASE_URL`, which is
> already correct at `https://api.bitsthat.fit`. ... zero HTTP requests were
> made.

## Why the old app ID is not the target

`POST /api/v1/apps/93f296bc-583e-4245-8eb2-cd2ad9974832/runs` returns
`404 APP_NOT_FOUND`. The old deal-coordinator app ID in the runbook is stale or
deleted. The trigger key in `.env` is scoped to the **Relay Read Probe v1** app
(`2b187fe0-4ad4-4693-a4ed-c061da8214a0`), not the old app. The 14/14 contract
probe was an attached-script/session run, not an app run.

## The one fix

In CREAO, open **Settings → Secrets** and add:

| Name | Value |
| --- | --- |
| `RELAY_API_KEY` | the Relay **agent** key (`relay_…`, 49 characters) |

Keep `RELAY_API_BASE_URL` as `https://api.bitsthat.fit` (no `/v1`, no trailing
slash). Do not store a `capi_…` or `cr_sk_…` key under `RELAY_API_KEY`; the probe
will stop with `CONFIG_ERROR` by design.

Then re-run the app with `{"inputs": {}}`. Expected: `verdict: "ok"` with
`health.http_status: 200` and an authenticated work-items read of `200`.

## Evidence

- [Run creation](evidence/creao-read-probe-run-create-2026-10-25.json)
- [Completed run with config error](evidence/creao-read-probe-config-error-2026-10-25.json)

## What this does not prove

The read probe only checks connectivity and authentication. The 14/14 contract
probe proves the route/status contract. Neither proves the full Relay Deal
Coordinator workflow. That still requires the coordinator's own app run, a
non-empty result, and matching Relay audit/Caddy evidence.
