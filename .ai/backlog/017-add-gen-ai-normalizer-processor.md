# 017 -- Add gen_ai normalizer processor to OTel Collector

Status: backlog
Priority: medium
Assignee: @tom
Epic: 005
Theme: llm-observability, otel-core
Tags:
Blocked by: 009
Blocked:

## Description

Add the `gen-ai normalizer processor` to the OTel Collector pipeline
configuration. This processor converts Traceloop/OpenLLMetry telemetry
into official `gen_ai.*` semantic conventions, ensuring LLM telemetry
follows the standard OTel format.

## Acceptance criteria

- [ ] `gen-ai normalizer processor` added to the collector config
- [ ] Processor is in the traces pipeline between receiver and exporter
- [ ] LLM spans with Traceloop attributes are normalised to `gen_ai.*` semconv
- [ ] Normalised spans visible in the collector debug output

## Notes

The OTel Demo 3.0 (July 2026) introduced this processor. Check the
`opentelemetry-collector-contrib` repo for the exact processor name and
configuration syntax -- it may be `genainormalizer` or similar.

This processor is the bridge between instrumentation libraries that use
their own attribute names and the official OTel `gen_ai.*` conventions.
