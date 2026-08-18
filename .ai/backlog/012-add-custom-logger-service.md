# 012 -- Add custom logger service wrapping OTel logs API

Status: backlog
Priority: high
Assignee: @tom
Epic: 003
Theme: otel-instrumentation
Tags:
Blocked by: 011
Blocked:

## Description

Create a logger service module that wraps the OTel Logs API to provide
structured, levelled logging (info, warn, error, debug) with automatic
trace context correlation. All application logging should go through this
service so logs are exported via OTLP alongside traces and metrics.

## Acceptance criteria

- [ ] `src/logger.js` module exporting `info()`, `warn()`, `error()`, `debug()`
- [ ] Log records include trace ID and span ID for correlation
- [ ] Log records include structured attributes (service name, level, timestamp)
- [ ] Logs appear in OTel Collector output alongside traces
- [ ] Application code uses the logger instead of `console.log`

## Notes

The OTel Logs API in JS SDK 2.x uses `LoggerProvider` and `LogRecord`.
The OTLP logs exporter sends to the same collector endpoint.
Trace context correlation means you can click from a log line to its
parent trace in the observability UI.
