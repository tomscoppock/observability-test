# Epic: 005 -- LLM Observability with gen_ai Semantic Conventions

Status: done (2026-09-08, retroactive -- all child tasks were completed 2026-08-25 to 2026-09-04 but the epic file was never updated)
Created: 2026-08-18
Theme: llm-observability, llm-integration
Lead: @tom

## Goal

Instrument LLM calls with OpenTelemetry's `gen_ai.*` semantic conventions
so that token usage, latency, cost, and prompt/completion metadata are
captured as structured telemetry and visible in the observability backend.

## Scope

Included:
- `gen-ai normalizer processor` added to the OTel Collector pipeline
  (converts Traceloop/OpenLLMetry spans into official `gen_ai.*` semconv)
- Custom spans around LLM API calls with `gen_ai.*` attributes
- Token usage metrics (prompt tokens, completion tokens, total tokens)
- LLM call latency tracking
- Model name and provider as span attributes

Excluded:
- Cost calculation dashboards (future -- depends on per-model pricing data)
- Prompt/completion content logging (privacy concern -- opt-in only)

## Child items

- [x] 017 -- Add gen_ai normalizer processor to OTel Collector (@tom)
- [x] 018 -- Instrument LLM calls with gen_ai.* spans and token metrics (@tom)

## Notes

The OTel Demo 3.0 (July 2026) added the `gen-ai normalizer processor` to
the Collector for converting Traceloop/OpenLLMetry telemetry into official
`gen_ai.*` semconv. This is the pattern to follow.

Consider also evaluating OpenLLMetry/Traceloop as a complementary
instrumentation library that auto-instruments popular LLM SDKs and outputs
OTel-compatible spans -- this could reduce manual instrumentation effort.

The `gen_ai.*` semantic conventions are still evolving but are the official
OTel direction for LLM observability.
