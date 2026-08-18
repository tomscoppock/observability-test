# Epic: 002 -- OTel Collector Pipeline to Splunk

Status: not-started
Created: 2026-08-18
Theme: otel-core, splunk-observability
Lead: @tom

## Goal

Configure the OTel Collector to receive OTLP telemetry (traces, metrics,
logs) from the Node.js API and export it to Splunk Observability Cloud
(free edition). Verify end-to-end data flow in the Splunk UI.

## Scope

Included:
- Splunk Observability Cloud free edition sign-up and token provisioning
- OTel Collector config with OTLP receiver, batch processor, and Splunk
  exporter (using the `sapm` or `splunk_hec` exporter in the upstream
  contrib collector)
- Verification that traces and metrics appear in Splunk dashboards

Excluded:
- Azure Monitor exporter (future epic)
- Grafana stack exporter (future epic)
- Application-level instrumentation (Epic 003)

## Child items

- [ ] 009 -- Configure OTel Collector with OTLP receiver and Splunk exporter (@tom)
- [ ] 010 -- Sign up for Splunk Observability Cloud free edition and get realm/token (@tom)

## Notes

Using the upstream `otel/opentelemetry-collector-contrib` Docker image
rather than the Splunk distribution -- the Splunk exporter is included in
contrib and this keeps the setup portable for future backend switches.

Splunk free edition launched June 2026 -- full features, limited by hosts.
Requires a realm and access token configured in `.env`.
