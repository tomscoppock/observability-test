# Active Context

Last refreshed: 2026-09-08

> This file was a month stale (last refreshed 2026-08-18, describing
> Epics 001/002 as pending). `.ai/STATUS.md` is the authoritative record
> for the full task history; this refresh covers current state only.

## Current focus

**041 (in progress)** -- talk track click paths. Every `[SHOW]` block in
`docs/demo-talk-track.md` now gives explicit navigation: which surface
you are on, numbered steps, literal UI labels and filter values. Three
instructions were wrong, not merely vague, and are fixed:

- Section 4 told the presenter to filter for traces containing both
  `rag-api` and `playwright-mcp`. Splunk APM ORs multiple values inside
  one filter, so that returns traces containing either. Now filters on
  the `scrape.url` span tag, which only the scrape path sets.
- Section 6 said to expand the `llm.chatCompletion` span. No such span
  exists. It is `chat gpt-4o-mini` (`api/src/llm.js:73`, `chat ${model}`).
- Section 5 assumed Tag Spotlight covered `gen_ai.response.finish_reasons`.
  039 indexed five tags and that is not one of them, so the finish-reason
  demo moves to Trace Analyzer, which searches unindexed tags.

Doc edits are complete and the ASCII check passes. The remaining gate is
a literal walkthrough in the live Splunk org after a simulator run;
checklist is in `.ai/in-progress/041-talk-track-click-paths.md`.

**Epic 025 (Splunk demo and dashboard automation) closed 2026-09-08.**
Tasks 027, 028, 036, 037, 038 and 039 are all in `.ai/done/`.

Next up is **040** (backlog, high): the capstone item. A ready-to-paste
coding-agent prompt that carries this spike's learnings into the
Knowledge Discovery agent repo, covering MCP discoverability, token
consumption, SurrealDB infrastructure monitoring, and APM/latency
analysis. The prompt is already written in the task file; it needs review
against that repo's actual stack and then a run in Plan Mode there. The
most valuable part is its "Non-obvious traps" section, since every trap
listed was a silent failure where the system looked healthy while
emitting nothing.

Two capability boundaries were established empirically and are now
documented in `docs/splunk-setup.md` Section 26 and covered explicitly in
the demo talk track Section 7: Log Observer Connect needs a licensed
non-trial Splunk platform, and APM AI Agent Monitoring plus Splunk-side
evals are unreachable from Node.js (Python-only instrumentation, plus
agent/workflow span semantics this app does not emit).

### Historical note (task 036, 2026-09-07/08)

Task 036 (logs correlation) took a significant turn today. Two root
causes were found behind "no logs anywhere in Splunk":

1. **Splunk deprecated native Log Observer** (direct OTLP log ingest into
   Observability Cloud) in January 2024. The collector's
   `otlp_http/splunk_logs` -> `v2/log/otlp` path was exporting into a
   dead endpoint. Logs now go to **Splunk Cloud Platform via HEC**
   (`splunk_hec/logs`); Observability Cloud reads them back in place via
   Log Observer Connect rather than storing a copy. Traces and metrics
   are unaffected and still go straight to Observability Cloud.
2. **App logs were never reaching the collector at all.**
   `api/src/instrumentation.js` passed the exporter positionally to
   `BatchLogRecordProcessor`, but `@opentelemetry/sdk-logs` 0.221.0
   expects an options object, so every export threw silently (OTel's
   `diag` logger is a no-op unless `OTEL_LOG_LEVEL` is set). Fixed.

HEC ingestion is now verified end to end: app log records reach Splunk
Cloud Platform with `trace_id`/`span_id` attached.

**Blocked:** Log Observer Connect itself (the trace-to-log correlation UI
in Observability Cloud) requires a licensed, non-trial Splunk Cloud
Platform or Splunk Enterprise instance. The project only has a Cloud
Platform trial, and Splunk documents Log Observer Connect as unavailable
on trials. Setup steps are documented for whenever a licensed instance
exists.

## Recent changes

### 2026-09-07 (task 036 -- logs via HEC)

- `otel-collector-config.yaml`: replaced dead `otlp_http/splunk_logs`
  exporter with `splunk_hec/logs` targeting Splunk Cloud Platform.
- `api/src/instrumentation.js`: fixed `BatchLogRecordProcessor` to take
  an options object (`{ exporter }`) -- the positional form silently
  discarded every log record.
- `docker-compose.yml`: added `SPLUNK_HEC_URL`, `SPLUNK_HEC_TOKEN`,
  `SPLUNK_HEC_INDEX`, `SPLUNK_HEC_SOURCETYPE`,
  `SPLUNK_HEC_INSECURE_SKIP_VERIFY` (collector) and optional
  `OTEL_LOG_LEVEL` (api, for surfacing silent OTel export failures).
- New `scripts/setup-splunk-hec.sh` / `.ps1`: validate HEC env vars,
  POST a test event, redeploy the collector, tail its logs.
- Docs realigned on the two-product split: `docs/architecture.md` (new
  signal-split diagram + table), `README.md`, `docs/splunk-setup.md`
  (deprecation finding, HEC token steps, Log Observer Connect steps,
  per-realm Search Head API allow-list IPs), `docs/opentelemetry.md`,
  `docs/configuration.md`.
- Corrected task 039's stale "Log Observer already working" conclusion.

### Earlier (Epic 001, 2026-08-18)

- Created `api/` directory: package.json, Dockerfile, .dockerignore,
  src/index.js (Express + health + stub chat), src/instrumentation.js
  (OTel SDK with OTLP exporters).
- Created `nginx/` directory: nginx.conf (reverse proxy), html/index.html,
  html/style.css, html/app.js (vanilla JS chat client).
- Created `otel-collector-config.yaml` (OTLP receiver + debug exporter).
- Created `docker-compose.yml` (4 services: nginx, api, surrealdb,
  otel-collector).
- Tasks 006, 007, 008 moved to done. Epic 001 marked done.
- Plan 019 moved to done with review notes.

## Open questions

- Log Observer Connect needs a licensed non-trial Splunk Cloud Platform
  or Splunk Enterprise instance. Decide whether to pursue licensing, or
  accept HEC-only logging (searchable in Splunk Cloud Platform's own UI)
  with trace correlation deferred.
- The trial's HEC endpoint presents Splunk's default self-signed
  `SplunkServerDefaultCert`, so `SPLUNK_HEC_INSECURE_SKIP_VERIFY=true` is
  currently required. This must be reverted to `false` against any
  properly provisioned instance.
- The documented `http-inputs-<stack>.splunkcloud.com` HEC hostname does
  not resolve on this trial (confirmed NXDOMAIN); HEC works on the main
  stack hostname at port 8088 instead. Unclear whether that is
  trial-specific or a provisioning gap worth raising with Splunk.
- No test covers the OTel SDK wiring in `instrumentation.js`. The
  positional-argument bug was invisible to the 63-test suite because all
  tests mock the logger provider. Worth considering an integration-level
  check.

### Resolved

- ~~OTel SDK package versions use caret ranges (^0.200.0 etc.) -- verify
  no breaking changes.~~ This was prescient: the caret range resolved to
  `@opentelemetry/sdk-logs` 0.221.0, whose `BatchLogRecordProcessor`
  constructor takes an options object rather than a positional exporter.
  That silently broke all log export until 2026-09-07. Lesson: pin or
  review OTel 0.x minor bumps, and set `OTEL_LOG_LEVEL` when telemetry
  goes missing, since SDK export failures are silent by default.
