# Progress

Last refreshed: 2026-08-18

## Works

- Project tracking framework fully set up (.ai/, memory-bank/, .archon/,
  .roo/rules/, .roomodes, AGENTS.md, CLAUDE.md).
- Epic 001 code complete: docker-compose.yml, api/ (Express + OTel SDK),
  nginx/ (reverse proxy + chat UI), otel-collector-config.yaml.
- All config externalised to .env (LLM, embedding, SurrealDB, OTel,
  Splunk, MCP).
- Three-layer secret enforcement (.gitignore, .claude/settings.json,
  .rooignore) in sync.
- Board validation passes (13 tasks, 5 epics, 0 errors).

## Left to do

> Refreshed 2026-09-07. Epics 001-005 and tasks 006-035 are done; see
> `.ai/STATUS.md` and `.ai/done/` for the authoritative trail.

- Task 036 (logs correlation): HEC ingestion into Splunk Cloud Platform
  is working and verified. Remaining: user confirms the app's own log
  records are searchable (`index=main sourcetype=otel`), then ship.
- Task 037: 3 items remain (Azure Foundry OTLP research is a stretch
  goal, and blocked architecturally -- the collector is not publicly
  reachable from Azure in a Docker-only setup).
- Task 038: 2 stretch items deferred (golden Q&A dataset, batch eval
  script).
- Task 039: remaining items are Splunk-side UI verification. Its Log
  Observer conclusion was corrected on 2026-09-07.
- Blocked, needs a licensing decision: Log Observer Connect (trace-to-log
  correlation in Observability Cloud) requires a licensed non-trial
  Splunk Cloud Platform or Splunk Enterprise instance.

## Known issues

- `SPLUNK_HEC_INSECURE_SKIP_VERIFY=true` is currently required because
  the Splunk Cloud Platform trial's HEC port serves Splunk's default
  self-signed certificate. Revert to `false` on a properly provisioned
  instance.
- The documented `http-inputs-<stack>.splunkcloud.com` HEC hostname does
  not resolve on this trial; HEC is reachable on the main stack hostname
  at port 8088 instead.
- Log Observer Connect is unavailable on Splunk Cloud Platform trials
  (Splunk's own documented restriction), so trace-to-log correlation in
  Observability Cloud cannot be demonstrated on the current account.
- OTel SDK packages are experimental (0.x) and caret-ranged, so minor
  bumps can change APIs silently. This already caused a real outage: a
  `BatchLogRecordProcessor` constructor signature change (positional to
  options object) silently dropped every log record, invisible to the
  test suite because tests mock the logger provider. When telemetry goes
  missing, set `OTEL_LOG_LEVEL=debug` on the api service -- SDK export
  failures are otherwise completely silent.
- No test covers `instrumentation.js`'s SDK wiring.
