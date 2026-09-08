# Active Context

Last refreshed: 2026-09-07

> This file was a month stale (last refreshed 2026-08-18, describing
> Epics 001/002 as pending). `.ai/STATUS.md` is the authoritative record
> for the full task history; this refresh covers current state only.

## Current focus

Epic 025 (Splunk demo and dashboard automation). Active: tasks 027, 028,
036, 037, 038, 039.

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
