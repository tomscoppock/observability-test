# Splunk vs Azure Monitor: where parity breaks

The same application, the same traffic run, the same spans and metrics, sent
to two backends in parallel. This document records where the two genuinely
differ, in both directions.

It exists because the workbook makes the comparison *possible* but not
*honest*. Several of the 31 Splunk charts cannot be reproduced faithfully in
Azure, a few are reproduced better, and two of the largest differences are not
represented in any chart at all.

## Evidence status

Claims here are labelled. Read the labels.

| Label | Meaning |
|---|---|
| **Verified** | Confirmed against vendor documentation or by running it here |
| **Reasoned** | Follows from verified mechanics, but not directly observed |
| **Unverified** | Needs a live side-by-side run to settle |

Everything in the "Measured numbers" section is **Unverified** until someone
runs the dual config against both backends and fills it in. Nothing in this
document should be quoted as a measurement until then.

## How the comparison is set up

Dual mode (`otel-collector-config.dual.yaml`) is what makes this controlled.
Collector pipelines fan out to every exporter listed, so both backends receive
byte-identical telemetry from one traffic run. There is no second
instrumentation to account for, and no timing difference in what was
captured.

The application is deliberately left alone for this. In particular the
`gen_ai.usage.prompt_tokens` and `gen_ai.usage.completion_tokens` aliases in
[api/src/llm.js](../api/src/llm.js), which exist only for Splunk MetricSet
compatibility, are kept rather than tidied away. Removing them would be a
small optimisation that costs the experiment its control.

One asymmetry is unavoidable and deliberate: the metrics signal is split into
`metrics/splunk` and `metrics/azure` pipelines, because the two backends need
different inputs. That difference is itself a finding, covered next.

## 1. The span_metrics connector: needed by Splunk, actively harmful to Azure

**Verified.**

First, what it is, because the name reads like a third-party add-on and it is
not. `span_metrics` is a **connector**: one of the four component types the
OpenTelemetry Collector defines, alongside receivers, processors and
exporters. A connector bridges two pipelines, acting as an exporter on one
end and a receiver on the other, which is why it appears in both an
`exporters:` list and a `receivers:` list in the same config. It derives
duration and call-count metrics from spans.

It ships in the upstream `otel/opentelemetry-collector-contrib` image this
project already runs, so using it is configuration rather than an install, a
plugin or a dependency. Nothing about it is Splunk's, and nothing about it is
ours.

Splunk needs the `span_metrics` connector. Its Monitoring MetricSets cover only
SERVER and CONSUMER spans, so without the connector every LLM, DB, MCP and
pipeline span in this application produces no metric at all. This is trap 5 in
the [implementation playbook](implementation-playbook.md), and fixing it was
the whole of task 033.

Application Insights has no such gap. Every CLIENT and INTERNAL span becomes a
`dependencies` row carrying its own `duration` in milliseconds, so KQL
percentiles work directly off the raw table.

Routing `span_metrics` output into `azure_monitor` would give strictly *less* than the
raw table: `traces.span.metrics.duration` is an explicit-bucket histogram, the
exporter flattens histograms, and `traces.span.metrics.calls` merely
duplicates `sum(itemCount)`. So the Azure metrics pipeline drops it.

### The consequence: the two backends will disagree on P90 and P99

**Reasoned.** And Azure's number will be the more correct one.

Splunk interpolates percentiles from the bucket list configured in the
connector:

```
[2ms, 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2s, 5s, 10s, 30s]
```

LLM completions land in the seconds range. So a Splunk P90 or P99 for the
`chat gpt-4o-mini` span is being interpolated across a 2s-to-5s or 5s-to-10s
gap, which is a very wide bucket to place a percentile inside. Azure computes
over raw per-span durations.

**Neither backend computes an exact percentile, and KQL has no option to.**
Kusto offers `percentile()`, `percentiles()`, `percentiles_array()` and
`percentilesw()`, all T-Digest estimates. There is no exact variant. The
documented error bound is worth quoting because it is a bound on *rank*, not
on value:

> The bounds on the estimation error vary with the value of the requested
> percentile. The best accuracy is at both ends of the [0..100] scale ...
> It's worst at the median and is capped at 1%. ... There is no theoretical
> limit on the difference between Xm and the actual median value of X.

So the honest comparison is between two different approximations rather than
between an approximation and the truth:

| | Splunk | Azure |
|---|---|---|
| Input | Pre-aggregated explicit-bucket histogram | Raw per-span durations |
| Method | Interpolation within a bucket | T-Digest |
| Error bounded by | Bucket width, which at LLM latencies is the 2s-to-5s and 5s-to-10s buckets | 1% on rank, worst at the median |

Azure is still the better estimate for this workload, because a rank error of
1% over raw values is a much tighter constraint than interpolating inside a
three-second bucket. But "exact" was the wrong word and this document
previously used it.

### The cost characteristics invert

**Reasoned.** This matters for any production recommendation and not at all
for a spike.

Splunk queries pre-aggregated time series: fixed cost, driven by cardinality.
Azure scans raw dependency rows: query cost grows with span volume, and every
span is a billable Log Analytics row rather than being collapsed into a
15-second aggregate.

If this pattern went to production at volume, the Azure-native mitigations are
a Log Analytics summary rule, or keeping the histogram and giving up
percentiles. Worth naming now rather than discovering later.

### One structural consequence for new charts

**Verified.** A generic "calls by span name" chart in Azure needs
`union requests, dependencies`, because SERVER and CLIENT spans split across
two tables. None of the current charts hit this (the `db.*` spans are all
INTERNAL), but any new one might.

## 2. Histogram percentiles do not survive ingest

**Verified 2026-09-09 against live data.** A `gen_ai.client.response.length`
datapoint arrived as `value` 1171, `valueSum` 1171, `valueCount` 2,
`valueMin` 386, `valueMax` 785, and `valueStdDev` **empty**.

So the buckets are gone and `valueStdDev` is not populated either. What
survives is sum, count, min and max. The exponential-histogram path is not
exercised here, because the SDK default is explicit buckets.

Two application metrics are histograms:

- `gen_ai.client.token.usage` (unit `{token}`)
- `gen_ai.client.response.length` (unit `{character}`)

Their buckets are discarded at ingest. What survives is the total
(`sum(valueSum)`), the observation count (`sum(valueCount)`), the mean
(`sum(valueSum)/sum(valueCount)`), the min and the max. **A true P90 does not
survive.**

### Why the dashboard survives anyway, and why that is not a general result

For this application it does not matter, because both values are *also* on the
span: `gen_ai.response.length` and `gen_ai.usage.input_tokens` /
`output_tokens` are in `dependencies.customDimensions`. Percentiling those
gives an exact P90 that is better than Splunk's bucket-interpolated one. The
Response Length chart in the workbook therefore reads `dependencies`, not
`customMetrics`.

**Do not generalise this into "Azure Monitor preserves OTel histogram
distributions". It does not.** The correct statement is:

> The classic Application Insights schema pre-aggregates histograms, so
> distribution shape is lost at ingest. Percentiles are recoverable in this
> project only because the application redundantly records the same values as
> span attributes. An application that emitted only the histogram would have
> no P90 in Azure.

A side effect worth noting: `gen_ai.client.token.count`, the counter that
exists purely because it "works reliably with `data()` in SignalFlow", turns
out to carry all the load on the Azure side too. Keeping it is vindicated.

## 3. Infrastructure: the charts reach parity, the product does not

Three problems, in increasing severity.

### Temporality (solved, but asymmetrically)

**Verified.** `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` in
`docker-compose.yml` applies only to the Node SDK. It does not affect
collector receivers, and SurrealDB sets no such variable (its Rust SDK
defaults to cumulative). So `container.cpu.usage.total`,
`container.network.io.usage.*`, `surrealdb.transaction` and
`surrealdb.http.request` all arrive cumulative.

The `signalfx` exporter understands counter semantics and Splunk's UI applies
`.rate()`. `customMetrics` has no counter concept at all, so an unconverted
cumulative counter charts as a straight monotonic ramp. Hence
`cumulative_to_delta` on the Azure path only.

Consequence: **the two backends deliberately see different infrastructure
data.** Same source, different processing. Any infrastructure number compared
across the two needs that caveat attached.

The Azure container CPU chart also normalises to cores rather than charting
cumulative nanoseconds, which is what the Splunk chart does. That is a
deliberate improvement, not a parity break, but it means the two charts will
never show the same y-axis.

### Dimensions

**Verified 2026-09-09 against the live resource, and the answer is better
than expected.** Resource attributes *are* surfaced as custom dimensions on
metrics. A `container.cpu.usage.total` datapoint arrived carrying
`container.name`, `container.id`, `container.image.name`,
`container.hostname`, `container.runtime`, `deployment.environment`,
`host.name` and `os.type`.

So the worry that container datapoints would be indistinguishable was
unfounded, and `transform/azure_dims` turns out to be **redundant** for
`container.name`. It stays as a deterministic guarantee rather than a
dependency on undocumented behaviour, but it is not load-bearing.

The real gap sits one level down: `compose.service`, produced by the
`docker_stats` receiver's `container_labels_to_metric_labels` mapping, was
**absent** on the sampled datapoint. That container (`playwright-mcp`) is not
managed by this Compose project, so it carries no `com.docker.compose.*`
labels for the receiver to map. The `coalesce(compose.service,
container.name)` in the container charts is therefore load-bearing, and any
future chart grouping on a receiver-mapped label needs the same fallback.

Two related facts worth recording:

- Container metrics arrive with an **empty `cloud_RoleName`**, because
  `docker_stats` sets no `service.name`. The container charts correctly do not
  filter on it, and adding such a filter would silently empty them.
- **`deployment.environment` does survive** into `customDimensions`. The
  workbook queries drop the environment filter their Splunk counterparts
  carry, which was a defensive choice taken before this was known. It could
  be restored if a second environment ever exists.

### The real break: App Insights has no infrastructure product

**Verified.** This is the headline Infrastructure finding, not a footnote.

Splunk gives you Infrastructure Navigators, per-host dashboards, and
APM-to-Infrastructure Related Content keyed on `host.name`. That last one is
precisely why `resource_detection` is in the collector config.

Azure Monitor's equivalents, VM Insights and Container Insights, run off the
Azure Monitor Agent or the Container Insights DaemonSet against a Log
Analytics workspace. They do not run off custom metrics in an Application
Insights resource. And there is no collector exporter that puts OTel metrics
into the Azure Monitor **metrics** namespace, where Metrics Explorer and
metric alerts live.

So: the four Infrastructure charts are reproducible as workbook queries, and
the tab will *look* comparable. Everything around it is not, and
`resource_detection`'s `host.name` buys nothing on the Azure side.

Follow-on decision: `host_metrics` is dropped from the Azure pipeline
entirely. No chart uses it, its Splunk purpose has no Azure counterpart, and
its `cpu` and `filesystem` scrapers emit per-core and per-mount data points
that would each become a billable `customMetrics` row. That is a defensible
asymmetry rather than a gap.

## 4. Drift detection: Azure detects later, structurally

### Why metric alerts with Dynamic Thresholds are not the analogue

**Verified.** Two independent reasons. `customMetrics` is log-based, and
metric alerts require the metric to live in the Azure Monitor metrics
namespace. And Dynamic Thresholds is a seasonality-aware model, not 3-sigma,
so even if it worked it would not compare the same detection logic.

Whether custom metrics sent through the App Insights ingestion endpoint also
reach the metrics store depends on a subscription-level
custom-metrics-with-dimensions opt-in. **Unverified**, and not worth building
on.

### A hard constraint on reproducing `lasting='5m'`

**Verified by a failed deployment, then a successful one.** Azure rejects
`numberOfEvaluationPeriods > 1` unless the query projects a column literally
named `timestamp` of type `datetime`:

```
Number of evaluation periods must be 1 for queries that do not project
the 'timestamp' column of type 'datetime'
```

A scalar summary row is not enough, so the naive translation of these
detectors fails at deploy time. Two further facts follow from the ARM schema,
and both matter:

- An evaluation period is **`windowSize`**, not `evaluationFrequency`. With
  `windowSize: PT1H`, two periods would mean a two-hour lookback.
- The query time range defaults to
  `windowSize * numberOfEvaluationPeriods`, which for a 5-minute window and
  two periods is ten minutes. A one-hour baseline needs
  `overrideQueryTimeRange: PT1H`, or it silently becomes a ten-minute one.

The working shape is `windowSize: PT5M` (matching Splunk's
`mean(over='5m')`, and the `bin()` size in the KQL),
`overrideQueryTimeRange: PT1H` (matching `stddev(over='1h')`), and
`failingPeriods` of 2 of 2 (matching `lasting='5m'`), with each query binning
into 5-minute points and emitting one row per breaching point. With that, the
Splunk detector semantics are reproduced exactly rather than approximated.

### The honest analogue

`Microsoft.Insights/scheduledQueryRules` (kind `LogAlert`) doing the standard
deviation in KQL. It translates the SignalFlow `detect`/`when` form almost
mechanically:

| Splunk detector | Scheduled query rule |
|---|---|
| `mean(over='5m')` | recent window in the KQL |
| `mean(over='1h')`, `stddev(over='1h')` | baseline in the KQL, `windowSize: PT1H` |
| detector evaluation cadence | `evaluationFrequency: PT5M` |
| `lasting='5m'` | `failingPeriods: {numberOfEvaluationPeriods: 2, minFailingPeriodsToAlert: 2}` |
| `severity: Warning` | `severity: 2` |
| `notifications: []` | empty `actions.actionGroups` |

### Two of the three had to change data source

**Verified reasoning.** Standard deviation **cannot be recovered from
`customMetrics`**. Taking `stdev()` of pre-aggregated per-interval means is
not the standard deviation of the population; it silently understates
variance and produces a hair-trigger detector.

So the response-length and output-token rules read `dependencies` span
attributes instead, where there is one row per call and both `avg()` and
`stdev()` are true. The latency rule needed no such change, because
`requests.duration` is already per-request.

### Guards the Splunk versions lack

Each Azure rule carries `n >= 30 and m >= 5 and sigma > 0`. The Splunk
detectors have no equivalent. On a demo stack, a cold-start hour containing
four LLM calls will fire all three Splunk detectors immediately. This is the
same "needs roughly an hour of traffic" caveat the playbook already records,
made explicit in the rule rather than left to hope.

### The structural gap

**Verified.** Scheduled query rules have a floor of 5-minute evaluation plus
Log Analytics ingestion latency, typically 1 to 3 minutes. Splunk's detectors
evaluate on the streaming metric pipeline, seconds behind. **Azure will detect
the same drift later.** That is not a tuning problem.

### What Azure has that this comparison would otherwise miss

**Verified.** Application Insights **Smart Detection** flags latency
degradation and failure-rate anomalies with zero configuration, arriving free
with the resource. It is not a translation of these three detectors, but
omitting it would understate Azure.

## 5. Chart-by-chart parity

31 Splunk charts become 29 workbook items: two merges and two splits.

| Splunk chart | Workbook item | Change |
|---|---|---|
| rag-api / surrealdb / playwright-mcp Requests, Error Rate % | `overview-service-tiles` | **Merged 4 into 1.** Workbooks has no SingleValue type; the idiom is one result row per tile. One `summarize by cloud_RoleName` gives all four plus an error-rate column, and puts the three services side by side where comparison is the point |
| Request Rate | `overview-request-rate` | Direct |
| Service Latency P50/P90/P99 | `overview-service-latency` | Source changes from interpolated histogram to raw `requests.duration`. Numbers will differ |
| Error Count by Endpoint | `overview-errors-by-endpoint` | Direct. `requests.name` replaces `sf_operation` |
| Top Endpoints | `overview-top-endpoints` | Direct |
| RAG Chat Pipeline Latency | `rag-chat-pipeline-latency` | Source changes from span_metrics to `dependencies` |
| RAG Upload Pipeline Latency | `rag-upload-pipeline-latency` | Same |
| MCP Scrape Latency | `rag-mcp-scrape-latency` | Simplified: both services live in one App Insights resource, so one query replaces Splunk's two filter variables |
| Embedding Latency P50/P90 | `rag-embedding-latency` | Source change |
| DB Operation Breakdown | `rag-db-operation-breakdown` | **Improved.** Splunk needs an explicit 13-name list because `db.*` wildcards are invalid; Azure filters semantically on `db.system == 'surrealdb'` and gets latency in the same table for free |
| Vector Search Latency | `rag-vector-search-latency` | Source change |
| Active Sessions | `rag-active-sessions` | **Source changed to `dependencies`, and single-use sessions filtered out.** See section 6: the underlying defect is in the application and breaks the Splunk chart too |
| LLM Provider and Model | `llm-provider-and-model` | Enriched with latency and token columns |
| Embedding Model | `llm-embedding-model` | Same |
| Total Input Tokens, Total Output Tokens | `llm-token-totals` | **Merged 2 into 1.** Also fixes a real difference: the Splunk charts hardcode `sum(over='4h')` with a note telling the operator to switch to Dashboard Window by hand in the UI. The Azure tiles bind to the time range automatically, so the two disagree unless that manual fix-up was actually performed |
| Token Usage Over Time | `llm-token-usage-over-time` | Direct |
| LLM Tokens Over Time | `llm-tokens-over-time` | Direct |
| Embedding Tokens Over Time | `llm-embedding-tokens-over-time` | Direct |
| LLM Call Latency P50/P90/P99 | `llm-call-latency` | Source change. The largest expected numeric disagreement, since LLM latencies sit in Splunk's widest buckets |
| Embedding API Latency | `llm-embedding-api-latency` | Direct. Duplicates the RAG Pipeline chart, as it does in Splunk; kept so the chart count reconciles |
| Response Length Over Time | `llm-response-length` | **Source forced to change** from the histogram metric to the span attribute, per section 2 |
| Container CPU Usage | `infra-container-cpu` | Normalised to cores rather than cumulative nanoseconds |
| Container Memory Usage | `infra-container-memory` | Direct (gauge, no conversion) |
| Container Network I/O | `infra-container-network` | Delta-converted, then rated |
| SurrealDB Process Health | `infra-surrealdb-cpu` + `infra-surrealdb-memory` | **Split 1 into 2.** A 0-100 percentage and a hundreds-of-megabytes byte count cannot share a Workbooks y-axis. The Splunk chart has the same flaw; not copied |
| SurrealDB Transaction Rate | `infra-surrealdb-transactions` | Delta-converted |
| SurrealDB HTTP Activity | `infra-surrealdb-http-rate` + `infra-surrealdb-active-requests` | **Split 1 into 2.** A per-second rate and an instantaneous in-flight gauge want different aggregations (`sum` versus `avg`) |

Two merges considered and rejected: combining the LLM Provider and Embedding
Model tables (obscures the 1:1 mapping this spike demonstrates), and dropping
Embedding API Latency as a duplicate (the Splunk dashboard has the same
duplication; removing it makes the count harder to reconcile).

Three workbook items have **no Splunk counterpart**, all on the fifth tab:
log volume by severity, exceptions by type, and recent errors with trace
correlation. See section 7.

## 6. Active Sessions: an application defect, since fixed

**Investigated and fixed 2026-09-09. The most useful finding of the exercise,
because the fix belonged in neither dashboard.**

The symptom was an "Active sessions" tile reading 0, which is worse than an
error because it looks like an answer.

`api/src/index.js` set `session.id` from the `X-Session-Id` header using
`trace.getActiveSpan()` inside Express middleware. That returns the **Express
middleware span**, which is INTERNAL, not the HTTP SERVER span. So the
attribute landed on `middleware - <anonymous>` and reached the `dependencies`
table. It never reached `requests`: of 1773 request rows, **zero** carried
`session.id` in `customDimensions`, and zero carried a native `session_Id`.

The consequence for Splunk was identical and worse. Its chart groups
`service.request`, a SERVER-span metric, by `session.id`. The attribute was
not on the SERVER span, so no amount of MetricSet indexing would have fixed
it. This was never "Splunk did not index the dimension"; the dimension was on
the wrong span, in both backends.

A second, independent bug sat underneath. The middleware generated a fresh
`crypto.randomUUID()` whenever the header was absent, so every healthcheck
invented a phantom session. Live data showed 3 real sessions
(`demo-alice`, `demo-bob`, `demo-carol`, 22 to 29 requests each) against 307
single-use UUIDs. A naive `dcount` reported 310.

### The fix

Both bugs are fixed in the application, in `api/src/session-attributes.js`
and `api/src/instrumentation.js`:

- The attribute is applied by the http instrumentation's
  `startIncomingSpanHook`, which fires for incoming requests only and applies
  its return value **as the server span is created**.
- A session id is never invented. Absent means the attribute is unset.
- Repeated headers (Node gives an array) take the first value, and values
  over 200 characters are rejected rather than truncated, since truncation
  would merge distinct sessions and the value is attacker-influenced input
  that reaches the backend's cardinality budget.

Verified end to end after rebuilding: 176 requests, **3** carrying
`session.id`, being exactly the 3 that sent the header, on the `requests`
table, with **zero** phantoms from three deliberately unheadered calls.

The workbook query is consequently now the obvious one, with no workaround:

```kql
requests
| where cloud_RoleName == 'rag-api'
| extend SessionId = tostring(customDimensions['session.id'])
| where isnotempty(SessionId)
| summarize ['Active sessions'] = dcount(SessionId)
```

### The Splunk side, and why it needed a different fix

The application fix was necessary but **not sufficient** for Splunk. The
attribute is now on the SERVER span, so it shows up in Trace Analyzer, but
the chart grouped `service.request` by it, and that requires `session.id` to
be indexed as a **Monitoring MetricSet dimension**. Task 039 indexed five
tags and `session.id` was not among them.

**And that cannot be automated.** Splunk exposes no public REST API and no
Terraform resource for APM MetricSets: creating one is a UI-only operation
under Settings > APM & RUM MetricSets. So "index the tag" would have been a
manual click-path that cannot be committed, reviewed, or reproduced in
another org, which is a poor foundation for a dashboard shipped as code.

The chart was therefore rewritten to read the **`span_metrics` connector**
output instead, where a configured dimension arrives as a real metric
dimension needing no indexing at all. This is the same manoeuvre task 033
used to get custom span latency out of Splunk in the first place:

```
A = data('traces.span.metrics.calls',
      filter=filter('service.name', 'rag-api')
         and filter('deployment.environment', 'dev')
         and filter('span.kind', 'SPAN_KIND_SERVER')
         and filter('session.id', '*'))
    .sum(by=['session.id']).count().publish(label='Active Sessions')
```

`SPAN_KIND_SERVER` because that is where the app now sets the attribute, and
`filter('session.id', '*')` because a datapoint from a span that lacks the
attribute has the dimension **omitted entirely** rather than blanked
(verified by sending two spans through a probe collector, one with and one
without).

### The cardinality cost, and the real architectural finding

Adding a high-cardinality identifier as a metric dimension is not free, and
this is where the two backends genuinely differ rather than merely
differing in ergonomics.

Every `span_metrics` dimension multiplies the metric time series count. Two
properties bound the blast radius here, both deliberate:

- The app sets `session.id` on the **server span only**, and a span without
  the attribute contributes no extra series at all.
- The app never fabricates a session id, so healthchecks and probes add
  nothing.

The practical cost is roughly (distinct endpoints) x (active sessions):
tens of series for this demo, and about 60k for a service with 10k
concurrent sessions. **So the honest conclusion is not "Azure is easier
here". It is that a distinct-count over a high-cardinality identifier is a
question for a log-based store, and Azure can answer it for free precisely
because `requests` is log-based rather than a dimensional metric.** Splunk
can be made to answer it, at a cardinality price that scales with your user
count. At demo scale the price is nil and the charts match. At production
scale the right answer in Splunk is to stop asking a metrics backend this
question.

That is a real architectural distinction between log-backed and
metric-backed observability, and it is the thing this chart should have been
illustrating all along.

## 6a. Prebuilt AI content: both empty, for asymmetric reasons

Both vendors ship agent-oriented AI dashboards. **Neither fully populates
from this application**, and the reasons differ in a way that matters more
than the shared outcome.

### What this application actually emits

Verified against live telemetry 2026-09-09:

| Convention the agent dashboards want | Emitted here |
|---|---|
| `chat <model>` span | Yes -- `chat gpt-5.4-mini` |
| `gen_ai.client.token.usage` | Yes |
| `gen_ai.operation.name`, `provider.name`, `request.model`, `usage.*_tokens` | Yes, all |
| `gen_ai.client.operation.duration` | **No** |
| `invoke_agent <agent>` span | **No** -- we emit `chat.pipeline` |
| `execute_tool <func>` span | **No** -- we emit `mcp.tool.*` |
| `gen_ai.agent.name`, `gen_ai.agent.id`, `gen_ai.conversation.id` | **No** -- we have `session.id` |

The shared root cause is not a backend defect: **this is a RAG pipeline
making direct LLM calls, not an agent framework**, so the agent spans do not
exist to be reported.

### Azure: a naming gap

Azure Managed Grafana ships dashboards under Azure / Insights / Applications
that query Application Insights through the Azure Monitor data source, with
no proprietary plugin. Its **Agent Framework** dashboard reads plain
OpenTelemetry GenAI conventions rather than a Microsoft SDK, so any framework
emitting them drives it.

Result here: the LLM and token panels populate from our data with nothing
built by us. The agent and tool panels stay empty.

Closing that gap is a **naming decision**, not a platform change. Renaming
`chat.pipeline` to `invoke_agent rag-agent`, renaming the MCP tool spans to
`execute_tool`, and adding `gen_ai.agent.name` would light the panels up.
Whether that is *honest* instrumentation for a pipeline that is not an agent
is a separate question, and the answer here is probably no.

### Splunk: a language wall

Splunk's AI Agent Monitoring screens key off the same agent semantics
(`invoke_agent`, `invoke_workflow`), but its documented instrumentation is
**Python-only**. From a Node service that is unreachable regardless of what
span names we adopt or what we spend.

### Why the distinction is the finding

Task 037 recorded Splunk's AI screens as "unreachable" and attributed it to
two causes at once, Python-only instrumentation *and* agent span semantics.
Running the same test against a second backend separates them:

- The **span semantics** half is common to both vendors and is ours to fix.
- The **Python-only** half is Splunk-specific and is not.

So on paper both vendors lack the same capability, and in practice one of
them has an open door. That distinction is invisible with a single backend,
and it is exactly the sort of thing a parallel comparison is for.

Set against it: Splunk's out-of-the-box surface is the cleaner of the two.
Service map, Tag Spotlight, Trace Analyzer and Related Content are polished
and coherent, and cost nothing to reach. Azure's prebuilt content is plainer
but more open. The pattern repeats the one in section 7: Splunk has the
better product and charges for the best of it, Azure has the more accessible
surface.

## 7. Where Azure wins

| Capability | Detail | Status |
|---|---|---|
| **Logs beside spans** | Log records land in App Insights `traces` in the same resource as the spans, correlated by `operation_Id`, with no second product and no licence gate. The Splunk equivalent needs Log Observer Connect, which is blocked on a non-trial licence: three independent gates on a trial, recorded in [splunk-setup.md](splunk-setup.md) Section 26. **The largest single capability difference this spike surfaces, and it appears in none of the 31 charts** | Verified |
| **Application Map** | All three services in one App Insights resource produce a working topology map with no configuration. Splunk's service map needed `peer.service` hand-set on outbound calls (playbook 1.5) | Reasoned |
| **Smart Detection** | Latency and failure-rate anomaly detection arrives free with the resource | Verified |
| **Prebuilt content reads standard OTel** | Azure Managed Grafana's bundled dashboards, including Agent Framework, query Application Insights with no proprietary plugin and key off GenAI conventions rather than a vendor SDK. Splunk's equivalent AI screens are Python-only. Both are empty here for the same reason (this is not an agent framework), but only one of them could be filled by renaming spans. See section 6a | Verified |
| **Exact percentiles** | Raw span durations rather than interpolation across wide buckets | Verified |
| **Semantic DB filtering** | `db.system == 'surrealdb'` rather than an explicit 13-name span list | Verified |
| **Time-range binding** | Workbook tiles follow the time picker. The Splunk token charts hardcode a 4-hour window and carry a note asking the operator to fix it by hand | Verified |
| **Distinct-count aggregation** | `dcount()` over any span attribute, with no index configuration. Splunk needs the dimension indexed as a MetricSet first | Verified |

## 8. Where Splunk wins

| Capability | Detail | Status |
|---|---|---|
| **Infrastructure as a product** | Infrastructure Navigators, per-host dashboards, and APM-to-Infrastructure Related Content. App Insights has no counterpart, so the Azure Infrastructure tab is a custom workbook over custom metrics. See section 3 | Verified |
| **Detection latency** | Streaming metric pipeline, seconds behind. Azure's scheduled query rules have a 5-minute floor plus ingestion latency | Verified |
| **Retention** | Monitoring MetricSets retain 13 months; App Insights defaults to 90 days. This constrains any drift or long-term trend claim made on the Azure side | Reasoned |
| **Query cost at scale** | Fixed-cost pre-aggregated time series versus billable raw row scans. Irrelevant for a spike, material in production. See section 1 | Reasoned |
| **Counter semantics** | The `signalfx` exporter understands counters natively; `customMetrics` needs `cumulative_to_delta` in the collector and rate arithmetic in every query | Verified |
| **Histogram fidelity** | Splunk retains the distribution and can re-percentile it; Azure discards buckets at ingest. Splunk's percentiles are less accurate but its data is richer | Verified |

## 9. Measured numbers

**Measured 2026-09-09** over a one-hour window in dual mode, both backends
receiving identical telemetry from one traffic run and queried over the
**same absolute window**. Captured with
`python3 scripts/compare_backends.py --offset 1h --markdown`.

| Metric | Splunk | Azure | Notes |
|---|---|---|---|
| Request count | 593 | 593 | **Exact match** |
| Error rate % | 2.0 | 2.02 | Agrees |
| Service latency P50 (ms) | 0.9 | 0.8 | Agrees. Median of per-minute P50 on both sides |
| Service latency P90 (ms) | 1.1 | 1.2 | Agrees |
| Service latency P99 (ms) | 1.1 | 1.2 | Agrees |
| LLM call latency P90 (ms) | 1891.7 | 1766.0 | **7% divergence**, the largest here, exactly where predicted: LLM latencies land in the 2s-to-5s span_metrics bucket where Splunk interpolates |
| Vector search P50 (ms) | 11.5 | 10.1 | 14% divergence, same cause at smaller absolute scale |
| Total input tokens | 120630 | 120630 | **Exact match** |
| Total output tokens | 7444 | 7444 | **Exact match** |
| db.vectorSearch calls | 75 | 75 | **Exact match** |
| Active sessions | 4 | 4 | Agrees here, but see section 6: **not the same statistic**. Azure is a true distinct count over the window; Splunk can only count distinct per interval, so its number is the peak. They coincide because all sessions were active throughout |

Counters match **exactly**. Percentiles diverge by up to 14%, entirely
explained by Splunk's bucket interpolation, and the divergence is largest
exactly where section 1 predicted. Nothing in this table is unexplained.

### Neither backend drops data

Worth stating plainly, because an earlier version of this table showed Splunk
599 against Azure 593, and the obvious reading was that Azure was losing
spans. It was not. A controlled send of 60 uniquely tagged requests returned
**60 in Azure and 60 in Splunk**, with `itemCount` of 1 on every Azure row,
which also rules out ingestion sampling.

The gap was in the comparison harness, and it had two causes, both fixed and
recorded as trap 33:

- **Each backend computed its own "now".** With a relative window per query,
  a dozen rows run seconds apart and the two backends measure different
  slices of continuous traffic. Both sides now receive one shared absolute
  window.
- **SignalFlow returns an inclusive endpoint**, 61 points for a 60-minute
  window at 60s resolution. That extra partial bucket added a minute of
  healthcheck traffic to every Splunk count. The window is now aligned down
  to a whole bucket.

The lesson generalises beyond this project: get ground truth from a
controlled send before concluding a vendor is losing data. It takes two
minutes, and the opposite conclusion is expensive to reach by accident.

### Three things that had to be corrected before the table meant anything

Every one of these produced a plausible-looking but wrong table first, which
is the argument for capturing it mechanically rather than reading numbers off
two dashboards by eye.

**Units differ, and not only between backends.** Splunk's `service.request`
histogram is in **nanoseconds**. Its own `traces.span.metrics.duration` is in
**milliseconds**, because the `span_metrics` connector config sets
`unit: ms`. Azure's `requests.duration` is milliseconds. So the Splunk
dashboard shows nanoseconds on the Service Overview tab and milliseconds on
the RAG Pipeline tab, both labelled only "Latency". Unscaled, Service
Overview latency reads a million times high.

**A percentile cannot be collapsed by averaging.** The mean of per-interval
P90s is not the window P90, which is the same error trap 22 records for
standard deviation. Asking SignalFlow for a single window-wide bucket
produced a boundary artefact instead (a spurious 1.44e9 point). Both sides
therefore report the *median of per-interval percentiles*, and the Azure KQL
is written to compute exactly that.

**`service.request` double-counts unless filtered.** It emits two
MetricSets: an endpoint-level one carrying `sf_dimensionalized='true'`, and a
service-level one where that property is absent. Summing both counts every
request twice. Measured over one 10-minute window: **132 unfiltered, 66
filtered, 58 in Azure**. This was a live defect in `splunk/dashboard.json`,
affecting all eight `service.request` charts, and it is now fixed there with
`filter('sf_dimensionalized', 'true')`. Ratios such as Error Rate escaped it
because both halves double; counts did not. Splunk's own request count was
2x too high and nothing on the dashboard said so.

## Related

- [azure-monitor-setup.md](azure-monitor-setup.md) -- getting Azure Monitor
  working
- [splunk-setup.md](splunk-setup.md) -- the Splunk side, including the trial
  and licensing boundaries in Section 26
- [implementation-playbook.md](implementation-playbook.md) -- rebuilding this
  elsewhere, and the silent failures to expect
- [demo-talk-track-2-splunk.md](demo-talk-track-2-splunk.md) and
  [demo-talk-track-3-azure.md](demo-talk-track-3-azure.md) -- the two demos
