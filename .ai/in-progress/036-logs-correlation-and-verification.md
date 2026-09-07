# Plan: 036 -- Logs correlation and verification

Status: **planned**
Created: 2026-09-07
Assignee: @tom
Epic: 025
Theme: otel-instrumentation, splunk-observability
Tags: enhancement

## Problem / goal

The app already emits structured OTel log records with trace context
attached (via `logger.js`), and the OTel Collector has a logs pipeline
exporting to Splunk Log Observer at `/v2/log/otlp`. However:

1. **No verification** that logs are actually arriving in Splunk Log
   Observer -- the pipeline was set up (task 021) but never confirmed
   end-to-end with the current Splunk Observability Cloud account.
2. **No dashboard integration** -- there are no log-related charts on the
   Splunk dashboards, and no documented way to correlate logs with traces
   in the Splunk UI.
3. **No log-level filtering** -- the collector forwards all log levels
   (DEBUG through ERROR) which may be noisy. A filter processor could
   reduce volume while keeping important logs.

The goal is to verify the logs pipeline works end-to-end, add log
visibility to the dashboard, and document the trace-to-log correlation
workflow in Splunk.

## Expected behaviour

1. App logs appear in Splunk Log Observer with correct severity, message,
   attributes, and trace context (trace_id, span_id).
2. Clicking a trace in Splunk APM shows correlated log records from the
   same trace.
3. The dashboard has at least one log-related chart (e.g. error log count
   or log volume over time).
4. Documentation explains how to navigate from traces to logs and vice
   versa in Splunk.

## Edge cases / error states

- Splunk Log Observer may not be enabled on all Splunk Observability Cloud
  plans -- verify the account has Log Observer access.
- If Log Observer is not available, logs can still be verified via the
  collector debug exporter output.
- High log volume (especially DEBUG level) could hit Splunk ingest limits
  -- consider adding a filter processor to drop DEBUG logs before export.
- The `otlp_http/splunk_logs` exporter previously returned 404 with HEC
  endpoint (task 021 fixed this) -- verify the current OTLP endpoint
  still works.

## Files to create or modify

| File | Change |
|---|---|
| `otel-collector-config.yaml` | (Optional) Add `filter/logs` processor to drop DEBUG-level logs |
| `splunk/dashboard.json` | Add 1-2 log-related charts to the Service Overview or LLM tab |
| `scripts/setup-splunk-dashboard.ps1` | No change needed (reads from dashboard.json) |
| `docs/splunk-setup.md` | Add section on Log Observer verification and trace-log correlation |
| `docs/opentelemetry.md` | Update logs section with verification steps for Splunk |

## Functions / classes to add or change

None -- the logging infrastructure (`logger.js`, `instrumentation.js` log
exporter, collector logs pipeline) is already in place. This task is about
verification, dashboard integration, and documentation.

## Tests to write

- Manual: send a chat request, check Splunk Log Observer for log records
  with matching trace_id.
- Manual: in Splunk APM, open a trace and verify "Related Content > Logs"
  shows correlated log records.
- Manual: verify log charts on the dashboard populate after traffic.
- Existing test suite: run to confirm no regressions (logger.test.js).

## Dependencies to add or upgrade

None.

## Out of scope

- Changing the logger API or adding new log levels.
- Structured log parsing or field extraction in Splunk (Log Observer
  handles OTel log records natively).
- Log-based alerting/detectors -- could be a follow-up task.
- Forwarding logs to non-Splunk backends (Grafana Loki, etc.).

## Implementation checklist

- [ ] Verify logs arrive in Splunk Log Observer (manual check)
- [ ] If Log Observer not available, document the limitation and skip
      dashboard charts
- [ ] (Optional) Add filter processor to collector to drop DEBUG logs
- [ ] Add error log count chart to dashboard (Service Overview or LLM tab)
- [ ] Add log volume over time chart to dashboard
- [ ] Update `docs/splunk-setup.md` with Log Observer verification steps
- [ ] Document trace-to-log correlation workflow in Splunk
- [ ] Run `setup-splunk-dashboard.ps1` to deploy updated charts
- [ ] Run test suite (no regressions)

## Review notes

(To be filled during review.)
