# 011 -- Add OTel SDK 2.x instrumentation to Node.js API (@tom)

Status: done
Priority: high
Assignee: @tom
Epic: 003
Theme: otel-instrumentation
Tags:
Blocked by: 006, 007
Blocked:

## Description

Replace the stub `instrumentation.js` with a full OTel SDK 2.x setup:
auto-instrumentation for Express/HTTP, OTLP HTTP exporters for traces,
metrics, and logs, and resource detection. Verify that spans appear in the
OTel Collector output.

## Acceptance criteria

- [x] `src/instrumentation.js` configures `NodeSDK` with auto-instrumentations
- [x] OTLP HTTP exporters point to `OTEL_EXPORTER_OTLP_ENDPOINT` from `.env`
- [x] Service name set from `OTEL_SERVICE_NAME` env var
- [x] HTTP request spans appear in collector logs
- [x] Express route spans appear with correct operation names

## Notes

Key: `instrumentation.js` must load via `--require` BEFORE any app code.
If Express is imported before the SDK patches it, no spans will appear.

Use `@opentelemetry/auto-instrumentations-node` meta-package for broad
coverage (HTTP, Express, DNS, etc.).
