# Plan: 038 -- Evals and drift monitoring

Status: **done** (2026-09-08)
Created: 2026-09-07
Assignee: @tom
Epic: 025
Theme: llm-observability
Tags: research, enhancement

## Problem / goal

There is currently no mechanism to detect quality drift in chat responses
over time. The observability stack tracks latency, errors, and token
counts, but not whether the LLM's answers are actually correct, relevant,
or consistent.

The user wants to explore options for monitoring chat response quality and
detecting drift using the observability platform. This is primarily a
research and design task -- the implementation will depend on findings.

## Expected behaviour

A documented approach (and ideally a working prototype) for monitoring
chat response quality, covering:

1. **What to measure** -- response relevance, factual accuracy, context
   utilisation, answer consistency, hallucination rate.
2. **How to measure it** -- automated eval frameworks, LLM-as-judge,
   reference-based scoring, embedding similarity.
3. **Where to surface it** -- Splunk dashboards, detectors/alerts, or
   external eval platforms with OTel integration.
4. **When to run evals** -- inline (per-request), batch (periodic), or
   triggered (on drift detection).

## Options analysis

### Option A: Custom OTel metrics for response quality

Record quality scores as OTel metrics from within the app. For example,
after each chat response, run a lightweight eval (e.g. embedding
similarity between query and response) and record the score as a gauge
metric. This flows through the existing OTel pipeline to Splunk.

**Pros:** Fully integrated with existing pipeline, real-time, no external
dependencies.
**Cons:** Inline evals add latency, limited eval sophistication, need to
define scoring logic.

### Option B: LLM-as-judge eval

Use a second LLM call to evaluate the quality of each response (or a
sample). Record the judge's score as an OTel metric. This is the approach
used by frameworks like Ragas and DeepEval.

**Pros:** More sophisticated evaluation, can check for hallucination and
relevance.
**Cons:** Doubles LLM cost, adds latency, judge LLM can itself be wrong,
circular dependency if using the same model.

### Option C: Batch eval with external framework

Run periodic batch evaluations using a framework like Ragas, DeepEval, or
custom scripts. Store eval results as OTel metrics or push directly to
Splunk. Compare against a golden dataset of expected Q&A pairs.

**Pros:** No inline latency impact, can use sophisticated eval metrics,
golden dataset provides ground truth.
**Cons:** Not real-time (detects drift after the fact), requires
maintaining a golden dataset, separate infrastructure.

### Option D: Splunk detectors for proxy metrics

Use Splunk's built-in anomaly detection on proxy metrics that correlate
with quality drift: sudden changes in token count distribution, latency
patterns, error rates, or response length. These don't measure quality
directly but can signal when something has changed.

**Pros:** No code changes, uses existing data, real-time alerting.
**Cons:** Indirect -- detects change, not quality degradation. High
false-positive risk.

### Option E: Embedding-based drift detection

Compute embeddings of responses and track the centroid/distribution over
time. A shift in the embedding space indicates the model's responses are
changing character. Record the drift score as an OTel metric.

**Pros:** Language-agnostic quality signal, detects subtle shifts.
**Cons:** Requires embedding computation per response, needs baseline
period, doesn't distinguish good drift from bad drift.

## Recommended approach

Start with **Option D** (Splunk detectors on proxy metrics) as it requires
no code changes and provides immediate value. Then implement **Option A**
(lightweight inline eval -- embedding similarity score) as a custom OTel
metric. Finally, explore **Option C** (batch eval with golden dataset) as
a more thorough periodic check.

## Files to create or modify

| File | Change |
|---|---|
| `api/src/routes/chat.js` | Pass `responseLength` to `recordStreamUsage` |
| `api/src/llm.js` | Record `gen_ai.client.response.length` histogram metric |
| `splunk/dashboard.json` | Add Response Length Over Time chart to LLM and AI tab |
| `splunk/detectors.json` | Drift detection detector definitions (response length, token, latency) |
| `docs/splunk-setup.md` | Section 18.5: LLM drift detection detectors |
| `docs/opentelemetry.md` | Document `gen_ai.client.response.length` metric |
| `scripts/setup-splunk-dashboard.sh` | Step 4: automated detector creation from detectors.json |
| `scripts/setup-splunk-dashboard.ps1` | Step 4: automated detector creation from detectors.json |
| `scripts/run-eval.sh` | Batch eval script (golden Q&A dataset) |
| `scripts/run-eval.ps1` | Batch eval script (PowerShell) |
| `sample-docs/golden-qa.json` | Golden Q&A dataset (10 entries) |

## Functions / classes to add or change

Depends on chosen approach. For Option A (inline eval):
- `chat.js`: add `computeResponseQualityScore()` function
- `chat.js`: record `gen_ai.response.quality_score` gauge metric
- `llm.js`: add `gen_ai.response.length` attribute to spans

## Tests to write

- Unit test for quality score computation (if Option A).
- Integration test verifying quality metric appears in OTel output.
- Manual: verify quality charts populate in Splunk dashboard.

## Dependencies to add or upgrade

- (Option C) Eval framework: `ragas` or `deepeval` (Python) or custom
  Node.js script.
- No new Node.js dependencies for Options A or D.

## Out of scope

- Production-grade eval pipeline (this is a prototype/exploration).
- Automated remediation (e.g. auto-switching models on drift detection).
- User feedback collection (thumbs up/down) -- separate feature.
- A/B testing infrastructure.

## Implementation checklist

- [x] Research: review Splunk detector types for anomaly detection
- [x] Implement Option D: document Splunk detector on token count anomaly (section 18.5)
- [x] Implement Option D: document Splunk detector on response latency anomaly (section 18.5)
- [x] Design Option A: define response length metric as lightweight drift proxy
- [x] Implement Option A: add `gen_ai.client.response.length` histogram metric to `llm.js`
- [x] Implement Option A: record response length in both `chatCompletion` and `recordStreamUsage`
- [x] Implement Option A: pass `responseLength` from `chat.js` streaming path
- [x] Add Response Length Over Time chart to LLM and AI dashboard tab
- [x] Design Option C: define golden Q&A dataset format (`sample-docs/golden-qa.json`)
- [x] Implement Option C: batch eval script (`scripts/run-eval.sh`, `scripts/run-eval.ps1`)
- [x] Implement Option D: automated detector creation via API (`splunk/detectors.json` + setup scripts)
- [x] Document approach in `docs/splunk-setup.md` (section 18.5 drift detection)
- [x] Document `gen_ai.client.response.length` metric in `docs/opentelemetry.md`
- [x] Run test suite (no regressions) -- 63 pass, 0 fail

## Review notes

(To be filled during review.)
