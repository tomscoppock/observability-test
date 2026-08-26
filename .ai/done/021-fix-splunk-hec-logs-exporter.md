# 021 -- Fix Splunk HEC logs exporter 404 error

Status: done
Priority: medium
Assignee: @tom
Epic: 002
Theme: otel-instrumentation
Tags:
Blocked by:
Blocked:

## Description

The `splunk_hec/logs` exporter in `otel-collector-config.yaml` is failing
with `HTTP "/services/collector" 404 "Not Found"` when sending log records
to Splunk Observability Cloud. The HEC ingest endpoint
(`https://ingest.{realm}.signalfx.com`) does not support the
`/services/collector` path that the `splunk_hec` exporter uses.

This means application logs (from the new OTel logger service, task 012)
reach the OTel Collector and are output by the debug exporter, but are
**not** delivered to Splunk. Traces and metrics are unaffected (they use
`otlp_http/splunk` and `signalfx` exporters respectively).

## Investigation needed

1. Determine the correct Splunk Observability Cloud endpoint for log
   ingestion. Options:
   - Splunk Log Observer Connect may require a different ingest URL
   - The `otlphttp` exporter may work for logs (same as traces)
   - HEC may need a Splunk Cloud/Enterprise endpoint, not Observability
     Cloud
2. Check whether Splunk Observability Cloud even supports log ingestion
   via HEC, or if logs should go via OTLP/HTTP instead.
3. Fix or replace the `splunk_hec/logs` exporter in
   `otel-collector-config.yaml`.

## Acceptance criteria

- [ ] Log records from the rag-api logger arrive in Splunk Log Observer
- [ ] No 404 errors in OTel Collector logs for the logs pipeline
- [ ] SurrealDB logs (if any) also arrive in Splunk
- [ ] Update `docs/splunk-setup.md` if the exporter config changes

## Notes

Discovered during task 012 implementation. The `splunk_hec/logs` exporter
was configured in the original Epic 002 work but was never verified for
log delivery (only traces and metrics were confirmed at that time).

Error from collector logs:
```
Exporting failed. Will retry the request after interval.
  "otelcol.component.id": "splunk_hec/logs"
  "error": "HTTP \"/services/collector\" 404 \"Not Found\""
```
