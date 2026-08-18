# Epic: 003 -- Node.js OTel Instrumentation

Status: not-started
Created: 2026-08-18
Theme: otel-instrumentation
Lead: @tom

## Goal

Instrument the Node.js API with OpenTelemetry SDK 2.x so that traces,
metrics, and logs flow automatically from the application to the OTel
Collector. Includes both auto-instrumentation (Express, HTTP, etc.) and a
custom logger service that wraps the OTel logs API for structured,
correlated logging.

## Scope

Included:
- OTel SDK 2.x setup with `@opentelemetry/sdk-node`
- Auto-instrumentation via `@opentelemetry/auto-instrumentations-node`
- OTLP HTTP exporters for traces, metrics, and logs
- `instrumentation.js` loaded before app code via `--require`
- Custom logger service wrapping OTel logs API for application-level logging
- Correlation between traces and logs (trace ID in log records)

Excluded:
- LLM-specific instrumentation (Epic 005)
- Database query instrumentation beyond what auto-instrumentation provides

## Child items

- [ ] 011 -- Add OTel SDK 2.x instrumentation to Node.js API (@tom)
- [ ] 012 -- Add custom logger service wrapping OTel logs API (@tom)

## Notes

OTel JS SDK 2.x (released 2025) requires Node.js ^18.19.0 || >=20.6.0.
The `instrumentation.js` file MUST execute before any application code --
in Docker, use `CMD ["node", "--require", "./src/instrumentation.js", "src/index.js"]`.
This is the #1 source of "I don't see traces" issues.

Key packages:
- `@opentelemetry/api`
- `@opentelemetry/sdk-node` (>= 2.0.0)
- `@opentelemetry/auto-instrumentations-node`
- `@opentelemetry/exporter-trace-otlp-http`
- `@opentelemetry/exporter-metrics-otlp-http`
- `@opentelemetry/exporter-logs-otlp-http`
- `@opentelemetry/resources`
- `@opentelemetry/semantic-conventions`
