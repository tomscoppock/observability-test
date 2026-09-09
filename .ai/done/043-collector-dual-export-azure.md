# 043 -- Collector dual-export plumbing for Azure Monitor

Status: done
Priority: high
Assignee: @tom
Epic: 042
Theme: otel-core, azure-monitor

## Description

Add Azure Monitor as a selectable collector export destination alongside
Splunk, so the stack can run Splunk-only, Azure-only, or both in parallel
without editing YAML. The existing Splunk baseline config stays functionally
untouched.

## Acceptance criteria

- [x] `otel-collector-config.azure.yaml` exports all three signals to
      Azure Monitor only
- [x] `otel-collector-config.dual.yaml` exports to Splunk and Azure Monitor in
      parallel, with split `metrics/splunk` and `metrics/azure` pipelines
- [x] `otel-collector-config.yaml` is functionally unchanged (header comment
      only) and Splunk-only behaviour is byte-identical to before
- [x] Compose selects the config via
      `${OTEL_COLLECTOR_CONFIG:-./otel-collector-config.yaml}` on the bind
      mount
- [x] `APPLICATIONINSIGHTS_CONNECTION_STRING` is passed through with a
      non-empty placeholder default, so an unconfigured Azure backend cannot
      stop the collector
- [x] `cumulative_to_delta` converts the five cumulative infra counters on the
      Azure path, and does not touch gauges
- [x] `transform/azure_dims` copies container identity onto datapoints
- [x] `spanmetrics` and `hostmetrics` are absent from the Azure metrics
      pipeline, with the reason recorded in a comment
- [x] No change to any file under `api/src/`
- [x] All three configs pass `otelcol validate`
- [x] `npm test` and `npm run lint` pass in `api/`
- [x] `.env.example` and `docs/configuration.md` document both new variables
- [x] `docs/opentelemetry.md` exporter name corrected to `azure_monitor`
- [x] ASCII-only check passes on every new and modified file

## Notes

**Completed 2026-09-09.** All three configs pass `otelcol validate`, and the
dual config boots against the live stack with zero deprecation warnings.
Deprecated component aliases were migrated in the same pass
(`host_metrics`, `resource_detection`, `span_metrics`), after verifying by
probe collector that renaming the connector does NOT change the metric names
it emits, so no dashboard chart broke.

One criterion needs a footnote. "No change to any file under `api/src/`" held
for 043 itself. Application code WAS later changed under this epic, but by a
separate deliberate decision: the `session.id` instrumentation defect found
during runtime validation. See epic 042's scope note and
`docs/splunk-vs-azure-monitor.md` section 6.

Two traps this task exists to avoid, both instances of patterns the
`docs/implementation-playbook.md` already records:

1. **An empty connection string stops the whole collector.** The
   `azure_monitor` exporter validates it at config-decode time, so traces and
   metrics go down with it. Same failure mode as playbook trap 4 for HEC,
   solved the same way: a placeholder default in compose.
2. **`spaneventsenabled` gates the `exceptions` table.** Left off (the
   default), `recordException` calls in `llm.js`, `embeddings.js`, `db.js`
   and `index.js` never surface and error diagnosis in Azure is materially
   worse than in Splunk. Confirm the exact key name with `validate` before
   committing -- a wrong key is itself a collector-stopping error.

Cumulative temporality is the third trap and the least obvious.
`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` in compose applies
only to the Node SDK. Collector receivers ignore it, and SurrealDB's Rust SDK
defaults to cumulative. `customMetrics` has no counter concept, so an
unconverted cumulative counter charts as a straight monotonic ramp. The
SignalFx exporter understands counter semantics and Splunk's UI rates them,
which is why this has never mattered before.

`spanmetrics` is deliberately dropped from the Azure metrics pipeline.
Splunk needs the connector because its MetricSets cover only SERVER and
CONSUMER spans (playbook trap 5); App Insights has no such gap, because every
CLIENT and INTERNAL span becomes a `dependencies` row carrying its own
duration. Routing spanmetrics into `azure_monitor` would give strictly less
than the raw table, since histograms are flattened and yield no percentiles.

`hostmetrics` is dropped for a different reason: no chart uses it, its Splunk
purpose is Related Content correlation which has no Azure counterpart, and its
`cpu` and `filesystem` scrapers produce per-core and per-mount data points that
each become a billable `customMetrics` row.

The Splunk `gen_ai.usage.prompt_tokens` / `completion_tokens` aliases and
`gen_ai.system` stay. Nothing in Azure reads them, nothing is confused by
them, and keeping them means the app emits byte-identical telemetry to both
backends -- the precondition for the comparison being about the backends
rather than two slightly different instrumentations.

### Deprecated component aliases, found by actually running it

Booting the dual config against collector 0.160 surfaced four deprecated
component aliases that `otelcol validate` accepts silently. This is the same
class of thing as `otlphttp` -> `otlp_http`, and it is only visible in the
startup log.

| Deprecated alias | Current name | Status |
|---|---|---|
| `cumulativetodelta` | `cumulative_to_delta` | Fixed in the two new configs |
| `resourcedetection` | `resource_detection` | Fixed in the two new configs |
| `hostmetrics` | `host_metrics` | **Not fixed.** Splunk-path only |
| `spanmetrics` | `span_metrics` | **Not fixed.** Splunk-path only |

The last two are left alone on purpose. Both are Splunk-only components
copied verbatim from the baseline config, and renaming them in the dual file
while the baseline keeps the old spelling would break the
mirror-changes-by-hand convention for no functional gain. They still work.

Also worth knowing: OTTL statements in `context: datapoint` want the
explicit `datapoint.attributes[...]` prefix. The bare `attributes[...]` form
works, but the collector silently rewrites it and logs a warning asking for
the prefixed version. The new configs use the prefixed form.

**Follow-up worth raising separately:** migrate all four aliases in
`otel-collector-config.yaml` in one pass. Deliberately not done here, because
this task's contract is that the Splunk baseline stays functionally
unchanged, and a rename touches every pipeline in it.

Plan: `~/.claude/plans/ok-if-i-wanted-lazy-catmull.md`
