# 009 -- Configure OTel Collector with OTLP receiver and Splunk exporter (@tom)

Status: done
Priority: high
Assignee: @tom
Epic: 002
Theme: otel-core, splunk-observability
Tags:
Blocked by: 010 (done)
Blocked:

## Description

Configure the OTel Collector (`otel/opentelemetry-collector-contrib`) with
an OTLP receiver (HTTP on port 4318), batch processor, and Splunk exporters
to send traces, metrics, and logs to Splunk Observability Cloud.

## Acceptance criteria

- [x] `otel-collector-config.yaml` at repo root
- [x] OTLP HTTP receiver on port 4318
- [x] Batch processor configured
- [x] Splunk exporters using `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` from `.env`
- [x] Debug/logging exporter retained for local troubleshooting
- [x] Traces visible in Splunk Observability Cloud APM
- [x] Metrics visible in Splunk Infrastructure Monitoring

## Notes

Using upstream contrib collector. Three exporters configured:
- Traces: `otlp_http/splunk` to `/v2/trace/otlp` (sapm is deprecated)
- Metrics: `signalfx` (native Splunk metrics format)
- Logs: `splunk_hec/logs` to HEC endpoint
- Using `signalfx.com` domain (legacy but functional; new domain is
  `observability.splunkcloud.com`)
- Collector v0.159.0 renamed `otlphttp` to `otlp_http` (snake_case)
- OTel Collector does not support bash `${VAR:-default}` syntax;
  defaults must be set in docker-compose.yml environment block
