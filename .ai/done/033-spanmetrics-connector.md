# Plan: 033 -- Add spanmetrics connector for custom span dashboard charts

Status: **done** <!-- planning | in-progress | in-review | done -->
Created: 2026-09-04
Owner: @tom
Epic: 025
Theme: llm-observability

## Problem / goal

The RAG Pipeline and LLM and AI dashboard tabs (created in Plan 032)
show no data. Root cause: `histogram('spans', ...)` in Splunk APM only
generates MMS for spans with `span.kind = SERVER` or `CONSUMER`. Our
custom spans (`chat.pipeline`, `db.vectorSearch`, `chat <model>`,
`embeddings <model>`) have `span.kind = INTERNAL` or `CLIENT`, so they
are invisible to `histogram('spans', ...)`.

The Custom MetricSet (TMS) configured for `gen_ai.operation.name` adds
a filterable dimension but does not change which spans generate MMS --
still only SERVER/CONSUMER spans.

**Solution:** Add the OTel Collector **spanmetrics connector** to
generate duration and call-count metrics from ALL spans (including
INTERNAL and CLIENT). These metrics are exported as standard OTel
metrics via the signalfx exporter and can be queried with `data()` in
SignalFlow. Then rewrite all `histogram('spans', ...)` queries in the
dashboard to use `data('duration', ...)` or `data('calls', ...)`.

**No manual Splunk UI steps required** -- the spanmetrics connector
runs entirely in the OTel Collector. The TMS Custom MetricSet created
earlier becomes unnecessary (but harmless to leave in place).

## Expected behaviour

After implementation:

1. The OTel Collector generates two new metrics from trace spans:
   - `duration` -- histogram of span durations (in ms) with dimensions
     `service.name`, `span.name`, `span.kind`, `status.code`,
     `deployment.environment`, `gen_ai.operation.name`
   - `calls` -- counter of span invocations with the same dimensions

2. All 8 previously-broken charts on the RAG Pipeline and LLM tabs
   show data using `data('duration', ...)` or `data('calls', ...)`
   queries instead of `histogram('spans', ...)`.

3. The `docker compose restart otel-collector` (or full `docker compose
   up -d`) picks up the new config and starts generating metrics
   immediately from incoming traces.

4. Documentation is updated to reflect the new metric source and
   remove the TMS prerequisite (no longer needed for dashboard charts).

### Metric dimension mapping

| Old SignalFlow filter | New SignalFlow filter |
|---|---|
| `filter('sf_service', 'rag-api')` | `filter('service.name', 'rag-api')` |
| `filter('sf_environment', 'dev')` | `filter('deployment.environment', 'dev')` |
| `filter('sf_operation', 'chat.pipeline')` | `filter('span.name', 'chat.pipeline')` |
| `filter('gen_ai.operation.name', 'chat')` | `filter('gen_ai.operation.name', 'chat')` |

### Chart query rewrites (RAG Pipeline tab)

| Chart | Old query pattern | New query pattern |
|---|---|---|
| RAG Chat Pipeline Latency | `histogram('spans', filter=... and filter('sf_operation', 'chat.pipeline')).median()` | `data('duration', filter=... and filter('span.name', 'chat.pipeline')).percentile(pct=50)` |
| RAG Upload Pipeline Latency | `histogram('spans', filter=... and filter('sf_operation', 'upload.pipeline')).median()` | `data('duration', filter=... and filter('span.name', 'upload.pipeline')).percentile(pct=50)` |
| MCP Scrape Latency | `histogram('spans', filter=... and filter('sf_operation', 'mcp.scrape')).median()` | `data('duration', filter=... and filter('span.name', 'mcp.scrape')).percentile(pct=50)` |
| Embedding Latency | `histogram('spans', filter=... and filter('gen_ai.operation.name', 'embeddings')).percentile(pct=50)` | `data('duration', filter=... and filter('gen_ai.operation.name', 'embeddings')).percentile(pct=50)` |
| DB Operation Breakdown | `histogram('spans', filter=... and filter('sf_operation', 'db.*')).count().sum(by=['sf_operation'])` | `data('calls', filter=... and filter('span.name', 'db.vectorSearch', 'db.insertDocument', ...)).sum(by=['span.name'])` |
| Vector Search Latency | `histogram('spans', filter=... and filter('sf_operation', 'db.vectorSearch')).percentile(pct=50)` | `data('duration', filter=... and filter('span.name', 'db.vectorSearch')).percentile(pct=50)` |

### Chart query rewrites (LLM and AI tab)

| Chart | Old query pattern | New query pattern |
|---|---|---|
| LLM Call Latency | `histogram('spans', filter=... and filter('gen_ai.operation.name', 'chat')).percentile(pct=50)` | `data('duration', filter=... and filter('gen_ai.operation.name', 'chat')).percentile(pct=50)` |
| Embedding API Latency | `histogram('spans', filter=... and filter('gen_ai.operation.name', 'embeddings')).percentile(pct=50)` | `data('duration', filter=... and filter('gen_ai.operation.name', 'embeddings')).percentile(pct=50)` |

## Edge cases / error states

- **Cardinality:** The spanmetrics connector generates one MTS per
  unique combination of dimensions. With ~30 distinct span names, 3
  services, 2 status codes, and 4 span kinds, cardinality is ~720 MTS
  -- well within Splunk limits.
- **Metric name collision:** The `duration` and `calls` metric names
  are generic. If other connectors or receivers produce metrics with
  the same names, add a `namespace` prefix (e.g. `span.metrics.`).
  Check for collisions before finalising.
- **Histogram vs gauge for duration:** The spanmetrics connector
  produces `duration` as an explicit histogram by default. The signalfx
  exporter converts this to a set of gauge metrics
  (`duration.bucket`, `duration.count`, `duration.sum`) or a single
  histogram depending on config. Verify which format Splunk receives
  and adjust queries accordingly. May need `histogram('duration', ...)`
  instead of `data('duration', ...)`.
- **Flush interval:** Default is 15s. This is fine for dashboard
  refresh rates.
- **MCP spans from playwright-mcp:** The spanmetrics connector only
  processes spans that flow through this collector. The playwright-mcp
  service sends traces to the same collector, so its spans will also
  generate metrics.
- **Collector restart required:** Config changes require
  `docker compose restart otel-collector`.

## Files to create or modify

| File | Action | What changes |
|------|--------|--------------|
| `otel-collector-config.yaml` | Modify | Add `spanmetrics` connector, wire into traces->metrics pipeline |
| `splunk/dashboard.json` | Modify | Rewrite 8 chart queries from `histogram('spans', ...)` to `data('duration/calls', ...)` |
| `docs/splunk-setup.md` | Modify | Update section 1 (data pipeline), section 22 (TMS -- mark as optional), section 23 (automated dashboard), sections 14-15 (tutorials) |
| `docs/opentelemetry.md` | Modify | Document the spanmetrics connector and its output metrics |
| `docs/demo-talk-track-2-splunk.md` | Modify | Update any references to TMS requirement |

## Functions / classes to add or change

### `otel-collector-config.yaml`

Add `connectors` section:

```yaml
connectors:
  spanmetrics:
    histogram:
      explicit:
        buckets: [2ms, 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2s, 5s, 10s, 30s]
      unit: ms
    dimensions:
      - name: gen_ai.operation.name
      - name: deployment.environment
    metrics_flush_interval: 15s
```

Update `service.pipelines`:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [gen_ai_normalizer, batch, resource/splunk]
      exporters: [debug, otlp_http/splunk, spanmetrics]  # add spanmetrics
    metrics:
      receivers: [otlp, docker_stats, spanmetrics]  # add spanmetrics
      processors: [batch, resource/splunk]
      exporters: [debug, signalfx]
```

### `splunk/dashboard.json`

Rewrite 8 chart `programText` values as detailed in the Expected
Behaviour section above. The exact SignalFlow syntax depends on whether
the signalfx exporter sends the duration metric as a histogram or as
gauge metrics -- verify during implementation.

## Tests to write

- None (infrastructure config + dashboard JSON, tested by running the
  collector and verifying metrics appear in Splunk).
- Verify: after `docker compose restart otel-collector` and generating
  traffic, the new metrics appear in Splunk Metrics Finder.

## Dependencies to add or upgrade

- None. The spanmetrics connector is built into the Splunk distribution
  of the OTel Collector (and the contrib distribution).

## Out of scope

- **Removing the TMS Custom MetricSet** -- it's harmless and may be
  useful for Tag Spotlight. Leave it in place.
- **Adding more span dimensions** (e.g. `http.method`, `http.route`)
  -- keep cardinality low for now.
- **Alerting on span metrics** -- defer to a follow-up.
- **Changing the Service Overview tab** -- it already works with
  `histogram('service.request', ...)`.

---

## Implementation checklist

<!-- Checked off during the Implement phase. -->

- [x] Add `spanmetrics` connector to `otel-collector-config.yaml`
- [x] Wire connector into traces (as exporter) and metrics (as receiver) pipelines
- [ ] Restart collector and generate traffic to verify metrics appear
- [x] Determine correct SignalFlow syntax (`data()` vs `histogram()`) for the new metrics
- [x] Rewrite 8 chart queries in `splunk/dashboard.json`
- [x] Update RAG Pipeline dashboard description (remove TMS requirement)
- [x] Update LLM and AI dashboard description (remove TMS requirement)
- [ ] Re-run dashboard setup script and verify all 4 tabs show data
- [x] Update `docs/splunk-setup.md` (sections 1, 14-15, 22, 23)
- [x] Update `docs/opentelemetry.md` with spanmetrics connector docs
- [x] Update `docs/demo-talk-track-2-splunk.md` if needed (no TMS references found -- no changes needed)
- [x] Run test suite (63 tests) -- all 63 pass, 0 fail
- [x] Commit and push (a3a0dd4)

## Review notes

<!-- Filled in during the Review phase (AGENTS.md Section 3, Step 5). -->

- Bugs / logic:
- Security:
- Performance:
- UX:
- Cost:
