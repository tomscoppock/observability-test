b# Plan: 037 -- Splunk AI overview and Azure Foundry monitoring

Status: **planned**
Created: 2026-09-07
Assignee: @tom
Epic: 025
Theme: llm-observability, splunk-observability
Tags: enhancement, research

## Problem / goal

Two related gaps in LLM observability:

### A. Splunk AI overview shows all zeros

Splunk Observability Cloud has a built-in **AI overview** view (under APM)
that auto-populates from `gen_ai.*` semantic convention spans. Currently it
shows all zeros for Requests, Errors, Tokens, and Cost despite the app
emitting `gen_ai.*` spans with correct attributes.

The AI overview likely requires one or more of:
1. **Troubleshooting MetricSets (TMS)** or **Custom MetricSets** indexed
   on `gen_ai.*` attributes -- Splunk's built-in MMS only covers
   `SERVER`/`CONSUMER` spans, but our LLM spans are `CLIENT` kind.
2. Specific span attribute naming that matches Splunk's AI feature
   expectations (e.g. `gen_ai.usage.input_tokens` vs
   `gen_ai.client.token.usage` histogram).
3. The `gen_ai_normalizer` processor in the collector may need to be
   producing specific output attributes that Splunk's AI view consumes.

### B. Azure AI Foundry data not flowing

The project uses Azure AI Foundry (OpenAI-compatible endpoint) as the LLM
backend. Azure Foundry supports exporting its own telemetry via
`OTEL_EXPORTER_OTLP_ENDPOINT` env var, which would provide server-side
LLM metrics (model inference time, token counts from the provider's
perspective, etc.) in addition to the client-side metrics we already emit.

The data path would be: Azure Foundry -> OTel Collector -> Splunk.

## Expected behaviour

1. Splunk AI overview auto-populates with request counts, error rates,
   token usage, and cost data from the app's `gen_ai.*` spans.
2. (Stretch) Azure Foundry server-side telemetry flows through the OTel
   Collector alongside client-side telemetry, providing a complete
   picture of LLM performance.

## Edge cases / error states

- Splunk AI overview may require a specific Splunk plan tier or feature
  flag -- verify availability.
- Azure Foundry OTLP export may not be available on all deployment types
  (e.g. serverless vs provisioned).
- If Azure Foundry exports to the same collector, the collector must be
  reachable from Azure (requires public endpoint or VPN -- not possible
  with the current Docker-only setup).
- The `gen_ai_normalizer` processor is currently a no-op (we use manual
  instrumentation, not Traceloop SDK) -- it won't affect our spans.

## Files to create or modify

| File | Change |
|---|---|
| `otel-collector-config.yaml` | (If needed) Add Custom MetricSet rules for `gen_ai.*` attributes |
| `splunk/dashboard.json` | (If needed) Update token charts to match Splunk AI overview expectations |
| `.env.example` | (If Azure Foundry OTLP) Add `AZURE_FOUNDRY_OTLP_ENDPOINT` variable |
| `docker-compose.yml` | (If Azure Foundry OTLP) Expose collector port or add config |
| `docs/splunk-setup.md` | Document Splunk AI overview requirements and setup |
| `docs/opentelemetry.md` | Document Azure Foundry OTLP export configuration |

## Functions / classes to add or change

Depends on investigation findings. Possible changes:
- `llm.js` / `embeddings.js`: adjust span attribute names if Splunk AI
  overview requires specific naming (e.g. adding `gen_ai.usage.cost`).
- No changes if the issue is purely Splunk-side configuration (MetricSets).

## Tests to write

- Manual: verify Splunk AI overview populates after configuration changes.
- Manual: verify "View all AI agents" and "View related AI trace data"
  buttons in Splunk AI overview work correctly.
- Existing test suite: run to confirm no regressions.

## Dependencies to add or upgrade

None expected. Azure Foundry OTLP export is a configuration change, not a
code dependency.

## Out of scope

- Switching from manual OTel instrumentation to Traceloop/OpenLLMetry SDK
  (separate task if ever needed).
- Cost calculation/estimation in the app code (Splunk AI overview may
  handle this natively if configured).
- Multi-model support (currently single model per deployment).

## Research steps (before implementation)

This task requires investigation before coding. The research phase should:

1. **Check Splunk docs** for AI overview requirements -- what span
   attributes, metric names, and MetricSet configuration are needed.
2. **Check Splunk APM settings** for any "AI Monitoring" toggle or
   configuration that needs to be enabled.
3. **Test with Splunk's expected attribute names** -- try adding
   `gen_ai.usage.prompt_tokens` and `gen_ai.usage.completion_tokens`
   as span attributes (in addition to the histogram metric) to see if
   the AI overview picks them up.
4. **Check Azure Foundry OTLP docs** for supported telemetry signals
   and configuration requirements.

## Implementation checklist

- [ ] Research Splunk AI overview requirements (docs + experimentation)
- [ ] Identify which span attributes / metrics Splunk AI overview consumes
- [ ] Test attribute changes locally to verify AI overview populates
- [ ] Apply necessary span attribute changes to `llm.js` / `embeddings.js`
- [ ] (If needed) Configure Custom MetricSets in Splunk for `gen_ai.*`
- [ ] Research Azure Foundry OTLP export capabilities
- [ ] Document findings and configuration in `docs/splunk-setup.md`
- [ ] Update `docs/opentelemetry.md` with Azure Foundry section
- [ ] Run test suite (no regressions)
- [ ] Verify Splunk AI overview shows live data

## Review notes

(To be filled during review.)
