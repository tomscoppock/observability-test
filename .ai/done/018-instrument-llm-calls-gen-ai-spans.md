# 018 -- Instrument LLM calls with gen_ai.* spans and token metrics

Status: done
Priority: high
Assignee: @tom
Epic: 005
Theme: llm-observability, llm-integration
Tags:
Blocked by: 011, 016
Blocked:

## Description

Add OpenTelemetry instrumentation around LLM API calls in the chat
endpoint so that each call produces a span with `gen_ai.*` semantic
convention attributes (model name, provider, token counts) and records
token usage as metrics.

## Acceptance criteria

- [x] Each LLM API call wrapped in a custom span
- [x] Span attributes include: `gen_ai.system`, `gen_ai.request.model`,
      `gen_ai.response.model`, `gen_ai.usage.input_tokens`,
      `gen_ai.usage.output_tokens`
- [x] Token usage recorded as OTel metrics (histogram)
- [x] LLM call latency visible as span duration
- [x] Spans and metrics visible in Splunk Observability Cloud

## Implementation details

Used manual instrumentation with `@opentelemetry/api` (tracer + meter)
rather than Traceloop/OpenLLMetry, because the API calls LLM/embedding
endpoints via raw `fetch()` (not the OpenAI Node.js SDK).

### Files modified

- `api/src/llm.js` -- full gen_ai semconv compliance:
  - Span name: `chat {model}` (was `llm.chatCompletion`)
  - SpanKind: CLIENT (was default INTERNAL)
  - Added `gen_ai.provider.name`, `gen_ai.response.id`,
    `gen_ai.response.finish_reasons` (array), `error.type`
  - Added `gen_ai.client.token.usage` histogram (input + output)
- `api/src/embeddings.js` -- full gen_ai semconv compliance:
  - Span name: `embeddings {model}` (was `embeddings.embedTexts`)
  - SpanKind: CLIENT (was default INTERNAL)
  - Added `gen_ai.provider.name`, `gen_ai.response.model`,
    `gen_ai.response.dimensions`, `error.type`
  - Added `gen_ai.client.token.usage` histogram (input only)
- `docs/opentelemetry.md` -- new "gen_ai semantic conventions" section
  with full attribute table, metrics reference, and verification steps

### Key decisions

- Both `gen_ai.system` (legacy) and `gen_ai.provider.name` (new semconv)
  are set for backward compatibility with existing dashboards.
- `gen_ai.response.finish_reasons` is an array (per spec), not a scalar.
- Token metrics use a single histogram (`gen_ai.client.token.usage`)
  with a `gen_ai.token.type` dimension (`input`/`output`) rather than
  separate counters, matching the gen_ai semconv metrics spec.
- Provider name comes from `LLM_PROVIDER` env var (default: `openai`).

## Notes

The gen_ai normalizer processor (task 017) remains configured as a safe
no-op. If the project later switches to the OpenAI Node.js SDK with
Traceloop auto-instrumentation, the normalizer will convert those spans
to the same `gen_ai.*` format automatically.
