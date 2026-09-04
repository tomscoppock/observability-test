# Plan: 027 -- Demo talk track

Status: **done** <!-- planning | in-progress | in-review | done -->
Created: 2026-09-04
Owner: @tom
Epic: 025
Theme: llm-observability

## Problem / goal

Create a scripted demo talk track document that walks through the
finished Splunk Observability Cloud dashboard for the RAG Agent stack.
The talk track should be usable as speaker notes for a live demo or
screen recording, with each section tied to a specific dashboard
chart/view.

The demo must showcase:

1. **Infrastructure-to-app relationships** -- how Docker container
   metrics, SurrealDB process health, and the Node.js API are all
   visible in one place; how Splunk correlates infrastructure with
   application performance.

2. **Token spend tracking** -- `gen_ai.client.token.usage` metrics,
   cost implications, how to spot anomalous token consumption.

3. **Latency and inter-service interplay** -- P50/P90/P99 latency,
   RAG pipeline breakdown (embedding vs. vector search vs. LLM), MCP
   scrape pipeline breakdown (session create vs. navigate vs. extract),
   distributed traces spanning `rag-api` and `playwright-mcp`.

4. **Security threats** -- prompt injection detection patterns, agent
   subversion attempts, what signals to look for in traces/logs, how
   observability enables security monitoring for AI agents.

5. **Eval-based quality monitoring** -- how to identify sub-par agent
   responses, hallucination detection patterns, response quality
   signals available in the telemetry (finish reasons, token ratios,
   empty responses, error rates).

The voice-over must highlight benefits:

- **OTel benefits:** vendor-neutral, open standard, future-proof,
  W3C trace context propagation, semantic conventions for gen_ai
- **Observability Cloud benefits:** auto-derived metrics (MMS),
  service map, Tag Spotlight, detectors/alerts, no-code dashboards
- **Stack/architecture benefits:** SurrealDB as unified document +
  vector + graph store, MCP for tool interop, Docker Compose for
  reproducibility

## Expected behaviour

A new file `docs/demo-talk-track.md` that contains:

1. **Opening** -- what we're looking at, why it matters (30 seconds)
2. **Section 1: Service Map and Infrastructure** (~2 min)
3. **Section 2: RAG Pipeline Performance** (~2 min)
4. **Section 3: Token Economics** (~1.5 min)
5. **Section 4: Cross-Service Tracing (MCP)** (~2 min)
6. **Section 5: Security and Threat Detection** (~2 min)
7. **Section 6: Quality and Eval Monitoring** (~1.5 min)
8. **Closing** -- summary of benefits, call to action (30 seconds)

Each section should include:
- **[SHOW]** -- what to click/navigate to in Splunk
- **[SAY]** -- the voice-over script
- **[HIGHLIGHT]** -- specific data points or patterns to call out
- **[CHART]** -- reference to the specific chart name (must match the
  dashboard automation in task 028)

Total demo length target: ~12 minutes.

## Edge cases / error states

- Some security/eval monitoring capabilities may not be fully
  implementable with current instrumentation -- the talk track should
  distinguish between "what we show today" and "what's possible with
  additional instrumentation" (future roadmap).
- The demo should work with the free tier of Splunk Observability Cloud.
- Chart names in the talk track must exactly match the chart names
  created by the dashboard automation script (task 028).

## Files to create or modify

- `docs/demo-talk-track.md` -- new file, the complete talk track

## Functions / classes to add or change

- None (documentation only)

## Tests to write

- None (documentation only)

## Dependencies to add or upgrade

- None

## Out of scope

- Recording the actual demo video
- Adding new instrumentation code (note what would be needed as "future
  roadmap" in the talk track)
- Creating the dashboard (that's task 028)
- Modifying the Splunk setup tutorial (that's task 026)

---

## Implementation checklist

- [x] Draft the opening section (what, why, who cares)
- [x] Draft Section 1: Service Map and Infrastructure
      (Docker Desktop metrics, SurrealDB health, rag-api, service map)
- [x] Draft Section 2: RAG Pipeline Performance
      (upload pipeline, chat pipeline, latency breakdown)
- [x] Draft Section 3: Token Economics
      (gen_ai.client.token.usage, cost projections, anomaly detection)
- [x] Draft Section 4: Cross-Service Tracing (MCP)
      (distributed traces, rag-api <-> playwright-mcp, latency)
- [x] Draft Section 5: Security and Threat Detection
      (prompt injection patterns, agent subversion signals, log analysis)
- [x] Draft Section 6: Quality and Eval Monitoring
      (hallucination signals, response quality, finish reasons, evals)
- [x] Draft the closing section (benefits summary, call to action)
- [x] Cross-reference all [CHART] references against task 028 chart names
- [x] Self-review for flow, timing, and technical accuracy

## Review notes

- Bugs / logic:
- Security:
- Performance:
- UX:
- Cost:
