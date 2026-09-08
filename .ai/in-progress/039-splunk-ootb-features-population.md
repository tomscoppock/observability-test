# Plan: 039 -- Populate Splunk OOTB features via standard OTel

Status: **in-progress**
Created: 2026-09-07
Assignee: @tom
Epic: 025
Theme: splunk-observability, otel-core
Tags: research, enhancement

## Problem / goal

Splunk Observability Cloud (free tier) provides several built-in views
that auto-populate from OTel data. Currently, only some of these views
show data. The goal is to configure the OTel Collector and app
instrumentation so that ALL available OOTB features are fully populated,
using standard OTel collection only (no Splunk-specific SDK or hardwired
Splunk API calls from the app).

### Available Splunk OOTB features (from navigation)

| Section | Feature | Current state | Data source |
|---|---|---|---|
| **APM** | Overview | Working | Traces (SERVER/CONSUMER spans) |
| **APM** | Applications & services | Working | Traces |
| **APM** | Service map | Partially working | Traces (inter-service spans) |
| **APM** | Tag spotlight | Unknown | Traces + indexed tags |
| **APM** | Trace analyzer | Working | Traces |
| **AI Agent Monitoring** | AI overview | Empty (all zeros) | `gen_ai.*` spans |
| **AI Agent Monitoring** | AI agents | Unknown | `gen_ai.*` spans |
| **AI Agent Monitoring** | AI trace data | Unknown | `gen_ai.*` traces |
| **Database Monitoring** | Overview | Unknown | DB spans (`db.*` attributes) |
| **Infrastructure** | Various | Partially working | Metrics (docker_stats, custom) |
| **Logs** | Log Observer Connect | Blocked on licensing | OTel logs -> Splunk Cloud Platform via HEC (see 036) |
| **Metrics** | Metric Finder | Working | All metrics |

### Principles

1. **Standard OTel only** -- all data flows through the OTel Collector.
   No Splunk-specific SDKs, no direct Splunk API calls from app code.
2. **Collector does the work** -- processors, connectors, and exporters
   in the collector handle any transformation Splunk needs.
3. **App emits standard semconv** -- the app uses official OTel semantic
   conventions (`gen_ai.*`, `db.*`, `http.*`, etc.) and the collector
   maps these to whatever Splunk expects.

## Expected behaviour

Every Splunk OOTB feature listed above shows relevant data when the app
is running and processing requests. Specifically:

1. **APM Tag spotlight** shows indexed span tags for filtering.
2. **AI Agent Monitoring** (all 3 views) shows LLM request counts,
   errors, tokens, cost, and trace data.
3. **Database Monitoring** shows SurrealDB query performance.
4. **Logs** shows correlated log records.
5. **Infrastructure** shows container metrics.

## Edge cases / error states

- Some features may require paid Splunk tiers -- document which features
  are available on the free plan vs paid.
- AI Agent Monitoring may require specific Splunk configuration (e.g.
  enabling AI monitoring in Settings).
- Database Monitoring may require specific `db.*` span attributes that
  SurrealDB's native OTel doesn't emit.
- Tag spotlight requires tags to be indexed -- this may need Splunk-side
  configuration (APM MetricSets).

## Research steps

### Phase 1: Audit current state

For each OOTB feature, check:
1. Does it show any data currently?
2. What data does it expect (span attributes, metric names, log fields)?
3. What's missing from our OTel pipeline?

### Phase 2: APM features

- **Tag spotlight**: Check if `gen_ai.*` and `db.*` attributes are
  indexed as tags. If not, configure Custom MetricSets or Troubleshooting
  MetricSets in Splunk APM settings.
- **Service map**: Verify all services appear (rag-api, surrealdb,
  playwright-mcp). Check if `peer.service` attribute is set correctly
  on CLIENT spans.

### Phase 3: AI Agent Monitoring

- Research Splunk's AI Agent Monitoring requirements:
  - Which span attributes does it consume?
  - Does it need `gen_ai.usage.input_tokens` as a span attribute (not
    just a histogram metric)?
  - Does it need specific span naming conventions?
  - Is there a Splunk setting to enable AI monitoring?
- Cross-reference with OTel gen_ai semconv to ensure compatibility.

### Phase 4: Database Monitoring

- Check if SurrealDB's native OTel spans include the `db.*` attributes
  Splunk Database Monitoring expects.
- If not, add a processor in the collector to enrich SurrealDB spans
  with required attributes.

### Phase 5: Logs

- Verify Log Observer shows OTel log records.
- Verify trace-log correlation works (trace_id in log records).
- Check if Log Observer needs any configuration in Splunk settings.

### Phase 6: Infrastructure

- Verify docker_stats metrics appear in Infrastructure views.
- Check if additional host metrics are needed (hostmetrics receiver).

## Files to create or modify

| File | Change |
|---|---|
| `otel-collector-config.yaml` | Add processors/receivers as needed per research findings |
| `api/src/llm.js` | (If needed) Add span attributes for Splunk AI monitoring |
| `api/src/embeddings.js` | (If needed) Add span attributes for Splunk AI monitoring |
| `api/src/db.js` | (If needed) Enrich DB spans with attributes for Database Monitoring |
| `docker-compose.yml` | (If needed) Add hostmetrics receiver config |
| `docs/splunk-setup.md` | Document OOTB feature requirements and configuration |
| `splunk/dashboard.json` | (If needed) Add charts that complement OOTB views |

## Functions / classes to add or change

Depends on research findings. The goal is minimal app-side changes --
prefer collector-side processors over app code changes.

## Tests to write

- Manual: verify each OOTB feature shows data after configuration.
- Screenshot documentation of each working feature.
- Existing test suite: run to confirm no regressions.

## Dependencies to add or upgrade

None expected. All changes should be configuration-level.

## Out of scope

- Splunk paid-tier features (focus on what's available in free tier).
- Custom Splunk dashboards (covered by other tasks: 028, 032, 035).
- Splunk-specific SDKs or agents (we use standard OTel only).
- Digital Experience (RUM) -- would require browser-side instrumentation.

## Implementation checklist

- [x] Research: Splunk AI Agent Monitoring requirements
  - Result: gen_ai.* spans already correct; needs Splunk-side enable
- [x] Research: Splunk Database Monitoring requirements
  - Result: SurrealDB not supported (only MS SQL, PostgreSQL, Oracle)
  - SurrealDB shows as inferred service via db.system span attribute
- [x] Research: Splunk Tag spotlight / MetricSet requirements
  - Result: needs manual indexing of gen_ai.* tags in Settings > APM MetricSets
- [x] Research: Splunk Log Observer requirements
  - ~~Result: already working -- logs sent via OTLP with trace_id correlation~~
  - **Corrected 2026-09-07 (via 036):** this conclusion was wrong on two
    counts. (1) Native Log Observer (direct OTLP log ingest into
    Observability Cloud) was deprecated by Splunk in January 2024; the
    `v2/log/otlp` endpoint this relied on is a dead path. Logs now go to
    Splunk Cloud Platform via HEC (`splunk_hec/logs`), read back into
    Observability Cloud by Log Observer Connect, which requires a
    licensed (non-trial) Splunk platform instance. (2) No application
    logs were reaching the collector at all: `instrumentation.js` passed
    the exporter positionally to `BatchLogRecordProcessor`, which expects
    an options object, so every export threw silently (`diag` is a no-op
    unless `OTEL_LOG_LEVEL` is set). Both fixed in 036.
- [x] Research: Infrastructure views requirements
  - Result: needed hostmetrics receiver and resourcedetection processor
- [x] Implement: add hostmetrics receiver to collector config
- [x] Implement: add resourcedetection processor for host.name correlation
- [x] Implement: add db.query.text and db.namespace to DB spans
- [x] Implement: update metrics pipeline to include hostmetrics
- [x] Document all findings in docs/splunk-setup.md (Section 25)
- [x] Document collector components in docs/opentelemetry.md
- [x] Run test suite (63 pass, 0 fail)
- [x] Cross-reference gen_ai.* attributes against Splunk AI Overview dashboard
  - Added gen_ai.usage.total_tokens to chatCompletion and recordStreamUsage
  - Added gen_ai.request.input_count to chatCompletion and chatCompletionStream
  - All 14 dashboard-expected attributes now emitted with values
- [x] Re-run test suite after attribute fixes (63 pass, 0 fail)
- [ ] Final audit: user verifies OOTB features in Splunk UI
  - [ ] Enable AI Agent Monitoring in Splunk Settings
  - [ ] Index gen_ai.* tags in APM MetricSets for Tag Spotlight
  - [ ] Verify Infrastructure views show host + container metrics
  - [ ] Verify Log Observer Connect shows correlated logs (blocked --
        needs a licensed non-trial Splunk Cloud Platform/Enterprise
        instance; logs themselves now confirmed landing in Splunk Cloud
        Platform via HEC, see 036)

## Review notes

(To be filled during review.)
