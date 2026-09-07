# Plan: 035 -- Fix token metrics dashboard charts

Status: **in-progress**
Created: 2026-09-07
Assignee: @tom
Epic: 025
Theme: llm-observability
Tags: bug-fix

## Problem / goal

The LLM and AI dashboard tab shows broken or empty token charts:
- "Total Input Tokens" -- barely any data (tiny orange bar)
- "Total Output Tokens" -- "A problem has occurred" error
- "Token Usage Over Time" -- flat zero line

Root cause: `gen_ai.client.token.usage` is created as an OTel **histogram**
(via `meter.createHistogram()` in `llm.js` and `embeddings.js`), but the
dashboard SignalFlow queries use `data()` which is for gauge/counter
metrics. With `send_otlp_histograms: true` on the signalfx exporter,
histograms are sent in OTLP format and must be queried with `histogram()`
in SignalFlow.

The latency charts on the same tab work correctly because they already use
`histogram('traces.span.metrics.duration', ...)`.

## Expected behaviour

All 3 token charts on the LLM and AI dashboard tab display live data:
- Total Input Tokens: single-value showing cumulative input tokens
- Total Output Tokens: single-value showing cumulative output tokens
- Token Usage Over Time: line chart with input and output token series

## Edge cases / error states

- If no LLM calls have been made, charts show zero (not an error).
- The `gen_ai.token.type` attribute values are `input` and `output` --
  these must match exactly in the filter.
- Embedding calls only emit `input` tokens (no `output`), so the output
  token chart only reflects LLM chat completions.

## Files to create or modify

| File | Change |
|---|---|
| `splunk/dashboard.json` | Fix 3 token chart `programText` queries: `data()` -> `histogram()` |
| `docs/splunk-setup.md` | Update Section 16 (token usage chart tutorial) if it references `data()` |
| `docs/opentelemetry.md` | Add note that token metrics are histograms, queried with `histogram()` |

## Functions / classes to add or change

None -- this is a query/config fix only. No application code changes.

## Tests to write

- Manual: run `simulate-demo-traffic` script, verify all 3 token charts
  populate in Splunk within 2 minutes.
- Manual: verify the setup script (`setup-splunk-dashboard.ps1`) deploys
  the corrected charts without errors.

## Dependencies to add or upgrade

None.

## Out of scope

- Changing the metric type from histogram to counter (histogram is correct
  per gen_ai semconv -- it captures distribution of token counts).
- Adding new token-related charts (e.g. cost estimation) -- separate task.
- Azure Foundry token metrics -- separate task (037).

## Implementation checklist

- [x] Change "Total Input Tokens" query from `data()` to `histogram().sum()`
- [x] Change "Total Output Tokens" query from `data()` to `histogram().sum()`
- [x] Change "Token Usage Over Time" query from `data()` to `histogram().sum()`
- [x] Run `setup-splunk-dashboard.ps1` to deploy updated charts
- [ ] Verify all 3 token charts show data in Splunk (awaiting user test)
- [x] Update `docs/splunk-setup.md` Section 16 -- added token usage chart tutorial
- [x] Add histogram query note to `docs/opentelemetry.md` token metrics section
- [x] Run test suite (63 pass, 0 fail)

## Review notes

(To be filled during review.)
