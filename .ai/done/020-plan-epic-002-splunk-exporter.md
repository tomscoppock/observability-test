# Plan: 020 -- Configure OTel Collector Splunk Exporters

## Problem / goal

The OTel Collector currently only has a `debug` exporter (stdout). We need
to add Splunk Observability Cloud exporters so traces, metrics, and logs
appear in the Splunk UI. The user already has a Splunk account with realm
and access token.

## Expected behaviour

- Traces appear in Splunk APM (service: `rag-api`)
- Metrics appear in Splunk Infrastructure Monitoring
- Logs appear via Splunk HEC
- Debug exporter is retained for local troubleshooting
- Collector starts cleanly when `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM`
  are set in `.env`
- Collector still starts (debug-only) when Splunk vars are not set

## Edge cases / error states

- Missing `SPLUNK_ACCESS_TOKEN` -- collector should still start with debug
  exporter only. Use conditional config or accept startup warnings.
- Wrong realm -- Splunk returns 401/403; visible in collector logs.

## Files to create or modify

1. `otel-collector-config.yaml` -- add `otlphttp/splunk`, `signalfx`,
   `splunk_hec` exporters; wire into pipelines alongside `debug`
2. `docker-compose.yml` -- pass `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM`
   as environment variables to the otel-collector service
3. `.env.example` -- update `SPLUNK_INGEST_URL` to new domain, add
   comments about the exporter types

## Functions / classes to add or change

None -- config-only change.

## Tests to write

Manual validation: `docker compose up -d`, check collector logs for
successful export to Splunk, verify traces in Splunk APM UI.

## Dependencies to add or upgrade

None -- all exporters are included in `otel/opentelemetry-collector-contrib`.

## Out of scope

- Azure Monitor exporter (future epic)
- Custom application instrumentation (Epic 003)
- gen_ai semantic conventions (Epic 005)

## Implementation checklist

- [ ] Update `otel-collector-config.yaml` with Splunk exporters
- [ ] Update `docker-compose.yml` to pass Splunk env vars to collector
- [ ] Update `.env.example` with new domain and exporter docs
- [ ] Validate: `docker compose up -d`, check collector logs
- [ ] Update `docs/opentelemetry.md` with Splunk pipeline info
- [ ] Commit and update STATUS.md

## Review notes

(To be filled after implementation.)
