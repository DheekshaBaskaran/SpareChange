# CREAO fresh-agent prompts

Use these in CREAO after the Relay host and the Relay agent key are already
configured. Do not paste the key itself into a prompt.

## 1. Create the agent

```text
Create a new reusable CREAO agent named "Relay Read Probe". Leave the existing
"Relay Deal Coordinator" untouched as the fallback.

Attach the reference files from the provided relay-read-probe.zip, especially
SKILL.md and relay_read_probe.py. Use those files as the agent's procedure and
probe; do not rewrite the probe from memory.

Configuration:
- Output format: JSON.
- Read RELAY_API_BASE_URL and RELAY_API_KEY only from CREAO environment values /
  Secrets. Never read, create, or source a .env file. Never hardcode a URL or key.
- RELAY_API_BASE_URL must be https://api.bitsthat.fit, with no /v1 and no
  trailing slash.
- RELAY_API_KEY must be the Relay agent key (prefix relay_). If it is missing or
  starts with capi_ or cr_sk_, stop with CONFIG_ERROR; those are CREAO keys, not
  Relay keys. Never print or echo the key.
- This agent is read-only. It may call only:
  GET /v1/health
  GET /v1/creao/work-items?status=pending&kind=financial_exception
  It must not call deal search, approvals, payments, handoffs, escalations, or
  any other write endpoint.
- Do not use backend_mode=mock, auto_simulate, or a localtunnel URL.

Run procedure:
1. Read /home/user/agent/app-files.json and locate the mounted path for
   relay_read_probe.py.
2. Run: python3 <mounted-path>/relay_read_probe.py
3. Return the JSON output verbatim in a fenced json block.
4. If verdict is not "ok", stop and report the exact HTTP status, code, and
   key prefix/length/fingerprint. Do not retry with another credential.

After creating the agent, run it once with no inputs and show the JSON.
```

## 2. First-run verification prompt

```text
Run the Relay Read Probe once with no inputs.

Return the complete JSON. Confirm:
- base_url is exactly https://api.bitsthat.fit
- health.http_status is 200
- health.database is "ok"
- authenticated_read.http_status is 200
- verdict is "ok"

If any of those are false, stop. Report the exact failure and do not start the
14-operation workflow. Do not print RELAY_API_KEY.
```

## 3. Only after the probe is green

```text
The Relay Read Probe returned verdict "ok" with health 200 and authenticated
read 200. Now configure the full Relay Deal Coordinator workflow with
backend_mode=http, approval_mode=stop_for_human, and auto_handoff=true.

Run the reconstructed 14-operation probe from `creao/relay-contract-probe` and
report `passed: 14`, `total: 14`, `verdict: "ok"`. Label it reconstructed. Do
not claim 31/31: the preserved probe and the full 31-operation probe are
unavailable. Do not approve, pay, or hand off in the probe. Capture the run id
and the Relay audit evidence separately.
```
