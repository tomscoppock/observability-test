# 018 -- Instrument LLM calls with gen_ai.* spans and token metrics

Status: backlog
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

- [ ] Each LLM API call wrapped in a custom span
- [ ] Span attributes include: `gen_ai.system`, `gen_ai.request.model`,
      `gen_ai.response.model`, `gen_ai.usage.prompt_tokens`,
      `gen_ai.usage.completion_tokens`
- [ ] Token usage recorded as OTel metrics (histogram or counter)
- [ ] LLM call latency visible as span duration
- [ ] Spans and metrics visible in Splunk Observability Cloud

## Notes

Consider evaluating OpenLLMetry/Traceloop (`@traceloop/node-server-sdk`)
as an alternative to manual instrumentation -- it auto-instruments popular
LLM SDKs and outputs OTel-compatible spans. The gen_ai normalizer
processor (task 017) would then convert these to standard semconv.

If using manual instrumentation, use `@opentelemetry/api` to create spans
and set attributes directly.
