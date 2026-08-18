# 009 -- Configure OTel Collector with OTLP receiver and Splunk exporter

Status: backlog
Priority: high
Assignee: @tom
Epic: 002
Theme: otel-core, splunk-observability
Tags:
Blocked by: 010
Blocked:

## Description

Configure the OTel Collector (`otel/opentelemetry-collector-contrib`) with
an OTLP receiver (HTTP on port 4318), batch processor, and Splunk exporter
to send traces, metrics, and logs to Splunk Observability Cloud.

## Acceptance criteria

- [ ] `otel-collector-config.yaml` at repo root (or `config/` directory)
- [ ] OTLP HTTP receiver on port 4318
- [ ] Batch processor configured
- [ ] Splunk exporter using `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` from `.env`
- [ ] Debug/logging exporter retained for local troubleshooting
- [ ] Traces visible in Splunk Observability Cloud APM
- [ ] Metrics visible in Splunk Infrastructure Monitoring

## Notes

The upstream contrib collector includes the `sapm` exporter (for traces)
and `splunk_hec` exporter (for logs/metrics). Check which is recommended
for the free edition.

Smart Agent monitors are deprecated -- use native OTel receivers only.
