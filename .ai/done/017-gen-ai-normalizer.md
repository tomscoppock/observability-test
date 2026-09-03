# Plan: 017 -- Add gen_ai normalizer processor to OTel Collector

Status: done
Priority: medium
Assignee: @tom
Epic: 005
Theme: llm-observability, otel-core

## Problem / goal

LLM telemetry from the Traceloop/OpenLLMetry SDK uses proprietary attribute
names. The OTel Collector contrib distribution (v0.159.0+) includes a
`gen_ai_normalizer` processor that converts these to the official `gen_ai.*`
semantic conventions. Adding this processor ensures our LLM spans follow the
standard OTel format and are correctly recognised by Splunk APM.

## Expected behaviour

- The `gen_ai_normalizer` processor runs in the traces pipeline between
  the OTLP receiver and the batch processor.
- OpenLLMetry-sourced spans (e.g. `traceloop.entity.*`, `llm.*`) are
  normalised to `gen_ai.*` attributes before export.
- Normalised spans are visible in the collector debug output.
- No change to the metrics or logs pipelines.

## Edge cases / error states

- If no OpenLLMetry spans are present, the processor is a no-op (safe).
- The processor only applies to traces; metrics/logs pipelines are unchanged.

## Files to create or modify

- [x] `otel-collector-config.yaml` -- add `gen_ai_normalizer` processor and
  insert it into the traces pipeline
- [ ] `docs/opentelemetry.md` -- document the new processor

## Functions / classes to add or change

None -- this is a config-only change.

## Tests to write

- Validate config with `otelcol-contrib validate`
- End-to-end: send a chat request and verify normalised `gen_ai.*` attributes
  appear in the collector debug output

## Dependencies to add or upgrade

None -- the processor is already included in the
`otel/opentelemetry-collector-contrib:latest` image (v0.159.0).

## Out of scope

- Custom attribute mappings beyond the built-in `openllmetry` source
- Changes to the Node.js instrumentation code
- Metrics or logs pipeline changes

## Implementation checklist

- [x] Research processor name and config syntax
- [x] Add `gen_ai_normalizer` processor to `otel-collector-config.yaml`
- [x] Insert processor into traces pipeline (before batch)
- [x] Validate config with `otelcol-contrib validate`
- [x] Rebuild stack and test with a chat request
- [x] Verify collector running with processor (no errors)
- [x] Update `docs/opentelemetry.md`
- [x] Clean up test config file
- [x] Commit and push

## Review notes

- Processor name: `gen_ai_normalizer` (module: `genainormalizerprocessor v0.159.0`)
- Config: `sources: [{name: openllmetry}]` -- built-in source, no custom mappings
- Validated with `otelcol-contrib validate` -- passes with env vars set
- Collector starts cleanly, traces flow through the pipeline without errors
- All 32 unit tests pass (0 failures)

### Why the processor is currently a no-op

The API currently uses **manual OTel instrumentation** in `llm.js` and
`embeddings.js` -- we create spans with `tracer.startActiveSpan()` and set
custom attributes like `llm.model`, `llm.provider`, `embedding.model`, etc.
These are our own attribute names, not the Traceloop/OpenLLMetry convention.

The `gen_ai_normalizer` processor with the `openllmetry` source is designed
to recognise spans emitted by the **Traceloop OpenLLMetry SDK**
(`@traceloop/node-server-sdk`), which auto-instruments LLM client libraries
(OpenAI SDK, Azure OpenAI SDK, etc.) and emits spans with specific attribute
names like:

- `traceloop.entity.name` -> `gen_ai.operation.name`
- `traceloop.entity.input` -> `gen_ai.content.prompt`
- `llm.request.model` -> `gen_ai.request.model`
- `llm.response.model` -> `gen_ai.response.model`
- `llm.usage.total_tokens` -> `gen_ai.usage.output_tokens` (etc.)

Since our API calls the LLM/embedding APIs via raw `fetch()` (not the
OpenAI SDK), the Traceloop SDK has nothing to auto-instrument. The
processor sits in the pipeline ready to normalise, but finds no matching
spans to transform.

**To activate normalisation**, a future task would either:
1. Switch from raw `fetch()` to the official OpenAI Node.js SDK, then add
   `@traceloop/node-server-sdk` which auto-instruments it, OR
2. Update our manual spans to use the Traceloop attribute names so the
   normaliser recognises them.

Option 1 is the recommended path -- it gives us auto-instrumentation of
all LLM calls (including retries, streaming, tool calls) with zero manual
span code, and the normaliser converts everything to `gen_ai.*` semconv.
