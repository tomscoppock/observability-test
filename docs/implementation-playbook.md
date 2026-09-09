# Implementation Playbook: OpenTelemetry to Splunk and Azure Monitor

Transferable know-how from building this stack, condensed into one place.

Where [opentelemetry.md](opentelemetry.md), [splunk-setup.md](splunk-setup.md)
and [azure-monitor-setup.md](azure-monitor-setup.md) document *what this
project's configuration is*, this playbook documents *how to build it again
somewhere else, and what will silently break*.

Every snippet here is copied from working, verified code in this
repository. Versions are those in `api/package.json`, proven against a
live Splunk org on 2026-09-08.

The Azure Monitor material in Part 3 and traps 14 to 33 is verified against
vendor documentation and against `otelcol validate` and `az bicep build`, but
**not yet against a live Application Insights resource**. Items awaiting that
are marked. The Splunk material is fully runtime-verified.

> To apply this to another project, see
> `.ai/backlog/040-knowledge-discovery-observability-prompt.md` (Splunk) and
> `.ai/backlog/048-azure-learnings-prompts.md` (Azure), which wrap this
> material into self-contained coding-agent prompts.

## Contents

- [The traps](#the-traps) -- read this first
- [Part 1: OpenTelemetry implementation](#part-1-opentelemetry-implementation)
- [Part 2: Splunk setup](#part-2-splunk-setup)
- [Part 3: Azure Monitor setup](#part-3-azure-monitor-setup)
- [Scope boundaries](#scope-boundaries)

---

## The traps

Almost every item here is a **silent failure**: the system reports itself
healthy while emitting nothing. Two of them cost most of a day each.
This section is the reason this document exists.

Traps 23 to 33 are the exceptions. It fails loudly, but it fails on the one run that
was supposed to work, and the error names the wrong culprit.

### 1. `BatchLogRecordProcessor` takes an options object

In `@opentelemetry/sdk-logs` 0.2xx+:

```js
new BatchLogRecordProcessor({ exporter })   // correct
new BatchLogRecordProcessor(exporter)       // silently discards 100% of logs
```

Passing positionally leaves `options.exporter` undefined, and every
export throws `TypeError: Cannot read properties of undefined (reading
'export')` **inside** the SDK. Invisible for two compounding reasons:
OTel's `diag` logger is a no-op by default, and unit tests that mock the
logger provider never exercise the real wiring. This repo had 63 passing
tests while emitting zero logs for weeks.

Verify the installed version's signature rather than trusting any
example, including this one:

```bash
grep -A8 "constructor" node_modules/@opentelemetry/sdk-logs/build/src/export/BatchLogRecordProcessorBase.js
```

### 2. Wire up `OTEL_LOG_LEVEL` on day one

SDK export failures are silent without it. This is the only reason trap 1
was ever found. Add the passthrough with an empty default so it costs
nothing until needed:

```yaml
- OTEL_LOG_LEVEL=${OTEL_LOG_LEVEL:-}
```

Then when telemetry goes missing: `OTEL_LOG_LEVEL=debug docker compose up -d --force-recreate api`

### 3. Pin or review OTel 0.x versions

These are pre-1.0 packages under caret ranges, so minor bumps change
APIs. Trap 1 was introduced by a caret range resolving to a version with
a changed constructor. This project's own memory bank had flagged the
risk a month before it bit.

### 4. An empty HEC endpoint or token kills the entire collector

The `splunk_hec` exporter rejects an empty `endpoint` **or** `token` at
config-validation time, which stops traces and metrics too, not just
logs. Give both non-empty placeholder defaults in compose, and validate:

```bash
docker run --rm -v "$(pwd)/otel-collector-config.yaml:/etc/otelcol/config.yaml:ro" \
  -e SPLUNK_ACCESS_TOKEN=x -e SPLUNK_REALM=us1 -e OTEL_DEPLOYMENT_ENV=dev \
  -e SPLUNK_HEC_URL=https://localhost:8088/services/collector \
  -e SPLUNK_HEC_TOKEN=x -e SPLUNK_HEC_INDEX=main -e SPLUNK_HEC_SOURCETYPE=otel \
  -e SPLUNK_HEC_INSECURE_SKIP_VERIFY=false \
  otel/opentelemetry-collector-contrib:latest validate --config /etc/otelcol/config.yaml
```

### 5. Splunk MetricSets only cover SERVER and CONSUMER spans

LLM calls, DB queries and MCP tool calls are INTERNAL/CLIENT spans, so
they produce no metrics by default. The `spanmetrics` connector is what
makes per-operation latency chartable at all. Without it there is
nothing to build latency analysis on.

### 6. Splunk drops cumulative histograms

Set delta temporality on the app and `send_otlp_histograms: true` on the
signalfx exporter:

```yaml
- OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta
```

### 7. Instrumentation must load before application code

`node --require ./src/instrumentation.js src/index.js`

### 8. The access token needs BOTH Ingest and API scopes

One token does two jobs: the collector ingests with it, and the
dashboard automation script calls the management API with it. **Splunk
displays a warning when you combine the scopes; it is expected and
should be overridden.** With API only, scripts work while the collector
401s on `/v2/datapoint` and drops everything. For API, the `power` role
grants dashboard and detector writes.

### 9. HEC: leave indexer acknowledgement unchecked

When enabled, HEC requires an `X-Splunk-Request-Channel` header that the
collector does not send, and every request fails with HTTP 400 `"Data
channel is missing"` (code 28).

### 10. The HEC index must be in the token's Allowed Indexes

Otherwise HEC returns HTTP 400 `"Incorrect index"`. Avoid `history`; it
is Splunk's internal search-history index, not a general-purpose one.

### 11. HEC hostnames vary and may not be provisioned

Splunk documents `https://http-inputs-<stack>.splunkcloud.com/services/collector`
(port 8088 on trials), but that DNS record is not always created. If it
fails to resolve, try the main stack hostname on port 8088. Prove where
the fault lies by comparing certificate SANs against DNS:

```bash
echo | openssl s_client -connect <stack>.splunkcloud.com:443 \
  -servername <stack>.splunkcloud.com 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
nslookup http-inputs-<stack>.splunkcloud.com
```

If the SANs list the ingest hostname but DNS returns NXDOMAIN, Splunk
issued a certificate for a hostname it never published. That is their
provisioning gap, not your misconfiguration.

### 12. Docker Compose prefers shell environment variables over `.env`

Two consequences that look like Docker being broken:

- A running container never sees `.env` edits. Env is snapshotted at
  creation, and Compose only recreates when resolved config changes, so
  `restart` and plain `up -d` keep the old values. Use
  `docker compose up -d --force-recreate <service>`.
- Any script that exports `SPLUNK_*` into the shell poisons every later
  `docker compose up` from that terminal, and `--force-recreate` cannot
  help, because Compose is faithfully applying what the shell told it.
  **Helper scripts must read `.env` into local variables and never set
  process environment variables.**

To see what `.env` actually resolves to, independent of your shell, run
`docker compose config` from a terminal that has never run the scripts,
and compare against what the container really received:

```bash
docker inspect <container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep SPLUNK_
```

### 13. TMS and MMS are not interchangeable

**Troubleshooting MetricSets** power Tag Spotlight. **Monitoring
MetricSets** power dashboards, alerting and 13-month retention. Indexing
a tag as TMS will not make it available to dashboards. Dashboards built
on spanmetrics need neither, because the dimensions arrive as real
metric dimensions.

### 14. The Azure exporter type has an underscore

`azure_monitor`, not `azuremonitor`. The latter is not a registered
component type, so the collector refuses to start and takes every signal down
with it. This is not a silent failure, but it is a fast one to hit, and it was
wrong in this repo's own docs for weeks.

Relatedly, and in the opposite direction: `otlp_http` is the **canonical**
name for the OTLP HTTP exporter and `otlphttp` is the deprecated alias. It
looks like a typo and is not. Do not "fix" it.

### 15. An empty Azure connection string kills the entire collector

Exactly trap 4, in a new place. The `azure_monitor` exporter validates
`connection_string` at config-decode time. An empty value fails validation,
which stops every pipeline including traces and metrics.

Same remedy: an inert placeholder default in compose, never an empty string.

```yaml
- APPLICATIONINSIGHTS_CONNECTION_STRING=${APPLICATIONINSIGHTS_CONNECTION_STRING:-InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://localhost/}
```

The general lesson is worth extracting: **any exporter with a required
credential field is a whole-collector outage waiting to happen.** Give every
one of them a placeholder default.

### 16. `customMetrics.value` is not the field you want

Use `valueSum` and `valueCount`.

| Want | Query |
|---|---|
| Counter total | `sum(valueSum)` |
| Histogram mean | `sum(valueSum) / sum(valueCount)` |
| Gauge reading | `avg(valueSum)` |

For a single-measurement point `value == valueSum`, so a naive query appears
to work and then diverges once real histogram points arrive. Silent.

### 17. `customDimensions` values are strings, and `success` changes type

Every span attribute arrives as a string, including numeric ones.
`gen_ai.usage.output_tokens` reads back as `"420"`, so `sum()` on it silently
returns zero or errors depending on context. Always
`tolong(tostring(customDimensions['...']))`.

`success` is a string (`"True"` / `"False"`) in the classic `requests` view
and a bool in the workspace `AppRequests` table. `tobool(success) == false`
is correct in both; `success == false` works in only one.

Array attributes serialise as JSON text, so `gen_ai.response.finish_reasons`
reads back as `["stop"]` and needs `parse_json(...)[0]`.

### 18. Cumulative counters chart as diagonal ramps

`customMetrics` has no counter concept. A data point is just a value, so a
cumulative counter is charted literally as its running total.

`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` only affects the
application SDK. It does **not** affect collector receivers such as
`docker_stats` or `hostmetrics`, and it does not affect other services with
their own SDKs (SurrealDB's Rust SDK defaults to cumulative). Those arrive
cumulative regardless.

Fix with `cumulative_to_delta`, using a **strict include list** rather than a
regex, because a broad pattern will sweep in gauges and delta-converting a
gauge is wrong:

```yaml
cumulative_to_delta:
  include:
    match_type: strict
    metrics:
      - container.cpu.usage.total
      - container.network.io.usage.rx_bytes
      - container.network.io.usage.tx_bytes
```

This never bites on Splunk, because the `signalfx` exporter understands
counter semantics and the UI applies `.rate()`. It is Azure-specific.

### 19. Resource attributes DO reach `customDimensions`, but receiver-mapped labels may not

**Verified 2026-09-09 against a live Application Insights resource.**
Resource attributes are surfaced as custom dimensions on metrics: a
`container.cpu.usage.total` datapoint arrived carrying `container.name`,
`container.id`, `container.image.name`, `container.runtime`,
`deployment.environment`, `host.name` and `os.type`.

So the concern that infrastructure charts would have indistinguishable
datapoints was unfounded, and a `transform` copying resource attributes
onto datapoints is **not required**. It remains defensible as a
deterministic guarantee rather than a dependency on undocumented
behaviour.

The real gap is elsewhere and is easy to miss: `compose.service`, produced
by the `docker_stats` receiver's `container_labels_to_metric_labels`
mapping, was **absent**, because the container sampled was not managed by
the Compose project and so carried no `com.docker.compose.*` labels. Any
chart grouping on a receiver-mapped label needs a `coalesce()` over a real
resource attribute as a fallback.

Two related things worth knowing: container metrics arrive with an **empty
`cloud_RoleName`**, because `docker_stats` sets no `service.name`, so do
not filter infrastructure charts on it. And `deployment.environment` does
survive, so environment-scoped queries are viable.

If you do want the deterministic guarantee, copy what you need onto the
data points:

```yaml
transform/azure_dims:
  error_mode: ignore
  metric_statements:
    - context: datapoint
      statements:
        - set(datapoint.attributes["container.name"], resource.attributes["container.name"]) where resource.attributes["container.name"] != nil
```

Then `coalesce()` over the candidate keys in the query, because
`container_labels_to_metric_labels` on the receiver may already supply one.

### 20. Histograms lose their buckets at ingest

The classic Application Insights schema is pre-aggregated. An explicit-bucket
histogram is reduced to sum, count, min and max. **A true percentile cannot be
recovered**, and **`valueStdDev` is not populated either** (confirmed against
live data: a datapoint arrived with `valueSum` 1171, `valueCount` 2,
`valueMin` 386, `valueMax` 785, `valueStdDev` empty).

This is silent in the worst way: the metric exists, the chart renders, and the
"P90" you compute from it is not a P90.

The workaround is only available if you planned for it: record the same value
as a **span attribute** as well as a histogram, then percentile the span. This
project got away with it by accident. Design for it deliberately.

Corollary, worth stating because it inverts the usual advice: **do not send
the `spanmetrics` connector output to Azure.** Splunk needs spanmetrics
because its MetricSets cover only SERVER and CONSUMER spans (trap 5).
Application Insights turns every CLIENT and INTERNAL span into a
`dependencies` row with a native `duration`, so raw-table percentiles are both
available and exact. Routing spanmetrics there gives strictly less.

### 21. `spaneventsenabled` gates the entire `exceptions` table

Off by default. With it off, every `recordException()` call is discarded and
the `exceptions` table stays empty, so error diagnosis is materially worse
than in Splunk, where span events ride on the span natively.

```yaml
azure_monitor:
  connection_string: "${APPLICATIONINSIGHTS_CONNECTION_STRING}"
  spaneventsenabled: true
```

Get the key name wrong and the collector will not start, so run `validate` to
distinguish "not set" from "misspelled".

### 22. Standard deviation cannot be recovered from pre-aggregated metrics

For any anomaly rule of the form "recent mean versus baseline mean plus N
sigma", do not compute sigma from `customMetrics`. Taking `stdev()` of a set
of per-interval means is not the standard deviation of the population: it
systematically understates variance, so the rule fires far more often than
3-sigma implies. Silent, and it looks like a working detector.

Read the raw span rows instead, where there is one row per call.

Two related gotchas in the same area:

- **Add sample-size guards.** `n >= 30 and m >= 5 and sigma > 0`. Without
  them, a cold-start window with a handful of observations fires immediately.
  The Splunk detectors in this repo lack these and have the same latent
  problem.
- **Metric alerts with Dynamic Thresholds are not the equivalent.** They
  require the metric to be in the Azure Monitor metrics namespace, which
  log-based `customMetrics` is not, and Dynamic Thresholds is a seasonality
  model rather than 3-sigma, so it would not be comparing the same logic.

### 23. In PowerShell, a failing `az` probe aborts the whole script

Not Azure Monitor specific, and it will bite any setup script that asks
"does this resource exist yet?".

Windows PowerShell 5.1 wraps a native command's stderr output in an
ErrorRecord (`NativeCommandError`). Under `$ErrorActionPreference = 'Stop'`
that makes **any** `az` command which writes to stderr a *terminating*
error. So this looks like a soft existence check and is not one:

```powershell
# WRONG -- aborts the script when the group does not exist,
# which is exactly the state a first run is in
az group show --name $rg 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { ... } else { ...create it... }
```

The `else` branch is unreachable. The symptom is a `NativeCommandError`
stack trace quoting `ResourceGroupNotFound`, on the very run that was
supposed to create the resource group.

Two fixes, and use both:

1. **Prefer commands that do not error on "absent".** `az group exists`
   returns `true`/`false` on stdout with exit code 0. For resources with
   no `exists` verb, use a list-and-count query rather than `show`:
   `az resource list --query "[?name=='$n'] | length(@)" -o tsv`.
2. **Route every `az` call through a helper** that neutralises the
   behaviour and returns the exit code:

```powershell
function Invoke-Az {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & az @Arguments 2>&1
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output   = (@($raw | Where-Object {
                $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n").Trim()
        }
    } finally { $ErrorActionPreference = $previous }
}
```

Bash is not affected: a failing command inside an `if` condition does not
trigger `errexit`, so `if az group show ... &>/dev/null; then` behaves as
intended. This is a PowerShell-only trap, which is why a bash/PowerShell
script pair can pass review with only the bash half actually working.

**A related trap when driving a CLI from Python on Windows.** The Azure CLI
is a `.CMD` shim, and `subprocess` cannot execute it by bare name:

```python
subprocess.run(['az', 'account', 'show'])   # WinError 2 on Windows
```

Resolve it once and use the full path, which is portable because
`which()` returns `/usr/bin/az` on Linux and that execs fine:

```python
AZ_BIN = shutil.which('az')
subprocess.run([AZ_BIN, 'account', 'show'], stdout=PIPE, stderr=PIPE)
```

Capture stderr rather than inheriting it, too, or the CLI's periodic
upgrade notices will corrupt any machine-readable output you print.

While you are there: prefer `az group create` over a
create-or-`az group update --set` branch. It is a PUT, so it creates when
absent and updates tags when present, and it avoids
`--set tags."Responsible Owner"=...`, whose quoting of a tag key
containing a space is fragile across shells.

### 24. Multi-period log alerts need a `timestamp` column, and the period is `windowSize`

Three coupled facts. Missing any one of them fails the deployment or
silently narrows the rule.

**The deployment error, which names the wrong culprit:**

```
Number of evaluation periods must be 1 for queries that do not project
the 'timestamp' column of type 'datetime'
```

`numberOfEvaluationPeriods > 1` requires the query to project a column
**literally named `timestamp`**, of type `datetime`. So a rule of the form
"recent mean versus baseline" cannot return one scalar summary row. It has
to bin into points and emit one row per breaching point:

```kql
let population = dependencies | where ... | extend v = ...;
let baseline = population | summarize mu = avg(v), sigma = stdev(v), n = count();
population
| summarize short_mu = avg(v), m = count() by timestamp = bin(timestamp, 5m)
| extend joinkey = 1
| join kind=inner (baseline | extend joinkey = 1) on joinkey
| where n >= 30 and m >= 5 and sigma > 0
| where short_mu > mu + 3 * sigma
| project timestamp, short_mu, mu, sigma, n, m
```

**An evaluation period is `windowSize`, not `evaluationFrequency`.** The
schema is explicit: "The lookback time window is calculated based on the
aggregation granularity (windowSize) and the selected number of aggregated
points." With `windowSize: PT1H` and two periods you get a two-hour
lookback, not two five-minute checks.

**The query time range defaults to `windowSize * numberOfEvaluationPeriods`.**
For a five-minute window and two periods that is ten minutes, so a
one-hour baseline silently becomes a ten-minute one. Decouple them with
`overrideQueryTimeRange`.

Putting it together, a faithful translation of a Splunk detector using
`mean(over='5m')`, `stddev(over='1h')` and `lasting='5m'`:

```bicep
windowSize: 'PT5M'              // one evaluation period, and the bin() size
evaluationFrequency: 'PT5M'
overrideQueryTimeRange: 'PT1H'  // the baseline window
criteria: {
  allOf: [
    {
      query: theQuery
      timeAggregation: 'Count'  // rows per bin: 1 = breach, 0 = healthy
      operator: 'GreaterThan'
      threshold: 0
      failingPeriods: {
        numberOfEvaluationPeriods: 2
        minFailingPeriodsToAlert: 2
      }
    }
  ]
}
```

Leave `skipQueryValidation` at its default of false. Azure then validates
the KQL against the workspace schema at deploy time, which turns a class
of silent runtime failures into a loud deployment failure.

### 25. Workbook queries are NOT validated at deploy time

Alert rules are. Workbooks are not, and the asymmetry will catch you.

`properties.serializedData` is an opaque **string** to Azure Resource
Manager. Nothing parses the KQL inside it, so a workbook containing a
non-existent function deploys with `provisioningState: Succeeded` and then
shows `Unknown function: 'x'` on every affected panel, discovered only when a
human clicks the tab.

Scheduled query rules behave the opposite way: with `skipQueryValidation` at
its default of `false`, Azure validates each query against the workspace
schema during deployment, so a bad query is a loud deployment failure.

So a green deployment proves nothing about a workbook. Validate the queries
yourself after deploying, by extracting them and running each one:

```bash
az monitor app-insights query --app "$APPID"   --analytics-query "$(cat query.kql)" --offset 1h   --query "tables[0].rows | length(@)" -o tsv
```

Assert two things per panel, not one: that the query **runs**, and that it
**returns rows**. A query that runs and returns nothing is the failure mode
that looks like success, and it is what tasks 033 and 035 had to fix on the
Splunk side. Worse, an aggregate with no `by` clause returns one row of
zeroes rather than no rows, so it renders a confident, wrong number.

**Do not use a non-existent KQL function.** There is no `percentileexact()`.
`percentile()`, `percentiles()`, `percentiles_array()` and `percentilesw()`
are all T-Digest estimates, capped at 1% error on *rank*, worst at the
median, exact only at 0 and 100.

### 26. `trace.getActiveSpan()` in Express middleware is not the server span

An application bug rather than a backend one, but it silently breaks
dashboards on **every** backend at once, so it belongs here. Found here by
noticing an "Active sessions" tile that confidently read 0.

**The broken pattern:**

```js
app.use((req, _res, next) => {
  const sessionId = req.headers['x-session-id'] || crypto.randomUUID();
  const span = trace.getActiveSpan();       // the MIDDLEWARE span
  if (span) span.setAttribute('session.id', sessionId);
  next();
});
```

With `@opentelemetry/instrumentation-express` active, each middleware layer
gets its own INTERNAL span, and that is what is active inside the handler. So
the attribute lands on `middleware - <anonymous>`, becomes a `dependencies`
row in Application Insights, and never appears on the HTTP SERVER span that
becomes the `requests` row. Measured here: 1773 request rows, **zero** with
the attribute or a native `session_Id`; 382 middleware spans carrying it.

The damage is backend-agnostic and very easy to misdiagnose:

- In Application Insights, any query against `requests` finds nothing.
- In Splunk, any chart grouping a SERVER-span metric such as
  `service.request` by that tag returns nothing, and **no amount of MetricSet
  indexing fixes it**. It is tempting to conclude "the tag was not indexed",
  index it, and still see an empty chart.

**The fix: put it on the server span at creation.** Use the http
instrumentation's `startIncomingSpanHook`, which is incoming-only, receives
the `IncomingMessage`, and applies its return value as the server span is
created. Verify the option exists in your installed version rather than
copying this (`node_modules/@opentelemetry/instrumentation-http/build/src/types.d.ts`):

```js
getNodeAutoInstrumentations({
  '@opentelemetry/instrumentation-http': {
    startIncomingSpanHook: (request) => sessionAttributes(request.headers),
  },
}),
```

`requestHook` also exists but fires for client spans too, so it needs
disambiguation. `headersToSpanAttributes` is simpler still but produces
`http.request.header.x-session-id` rather than the semantic-convention name.

### 27. Never invent a request-scoped id when the client did not send one

The same middleware had a second, independent bug:

```js
const sessionId = req.headers['x-session-id'] || crypto.randomUUID();
```

A generated per-request id is not a session. Every Docker healthcheck and
Nginx upstream probe becomes a distinct "user", so any distinct-count is
garbage. Measured here: 3 real sessions against **307** single-request
phantoms, so `dcount` reported 310.

Absent means absent. Leave the attribute unset:

```js
function sessionAttributes(headers) {
  if (!headers) return {};
  const raw = headers['x-session-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;   // repeated header = array
  if (typeof value !== 'string') return {};
  const sessionId = value.trim();
  if (!sessionId || sessionId.length > 200) return {};
  return { 'session.id': sessionId };
}
```

Three details in there that are each worth having:

- **A repeated header arrives as an array.** Take the first value.
- **Cap the length and reject rather than truncate.** This is
  attacker-influenced input that reaches the telemetry backend and, once
  indexed as a metric dimension, its cardinality budget. Truncating would
  silently merge distinct sessions.
- **Keep it a pure function in its own module.** `instrumentation.js` starts
  the SDK on require, so it cannot be imported by tests. A separate module
  can be, and this is logic worth testing: the regression above is invisible
  in any test that mocks the tracer.

If you cannot avoid a generated fallback, exclude single-occurrence ids at
query time (`summarize by id | where count > 1`) and say so on the chart.

### 28. `Set-Content -Encoding utf8` writes a BOM in PowerShell 5.1

If your project has an ASCII-only rule for scripts and config, this will
break it from inside your own tooling.

Windows PowerShell 5.1's `-Encoding utf8` means *UTF-8 with BOM*. Three
bytes (`EF BB BF`) land at the start of every file you rewrite, which is
non-ASCII by definition, and worse, it is invisible in every editor and
every `git diff`.

It broke this project's own tracker: a `#` heading preceded by a BOM stopped
matching the parser's title regex, so a task file that existed reported as
"does not exist" from a dependency check.

```powershell
# WRONG in 5.1 -- adds a BOM
$text | Set-Content file.md -Encoding utf8

# Correct, and version-independent
[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
```

PowerShell 7+ defaults to BOM-less UTF-8 and offers `-Encoding utf8NoBOM`,
so code that works on a developer's PowerShell 7 can still corrupt files on
a 5.1 host. In Python, `newline=''` plus an explicit `encoding='utf-8'` never
writes a BOM.

Detect it cheaply, and put it in whatever check enforces the ASCII rule:

```bash
head -c3 file | od -An -tx1 | grep -q 'ef bb bf' && echo "BOM: file"
```

### 29. Splunk APM MetricSets have no public API, so design around them

Dashboards and detectors are fully automatable through
`/v2/dashboard`, `/v2/chart` and `/v2/detector`. **APM MetricSets are not.**
Creating a Troubleshooting or Monitoring MetricSet is a UI-only operation
(Settings > APM & RUM MetricSets), with no documented REST endpoint and no
Terraform resource.

That matters more than it sounds, because a Monitoring MetricSet dimension
is what lets a dashboard chart *group* `service.request` by a span tag. So
"index the tag" is a manual click-path that cannot be committed, reviewed, or
reproduced in another org, and it silently blocks any chart that needs it.

**Design around it with the `span_metrics` connector.** A connector dimension
arrives as a real metric dimension and needs no indexing at all:

```yaml
span_metrics:
  dimensions:
    - name: gen_ai.operation.name
    - name: session.id        # read the cardinality warning below
```

The cost is cardinality, and it is worth being precise about rather than
hand-waving. Every dimension multiplies the metric time series count, so a
high-cardinality identifier is genuinely dangerous. Two things bound it, and
both are verifiable:

- **A span that lacks the attribute has the dimension omitted from its
  datapoint entirely**, not set to empty. Confirmed by sending two spans
  through a probe collector, one with the attribute and one without. So
  restricting an attribute to the server span keeps child spans free.
- If the application never fabricates the value (trap 27), unheadered
  traffic such as healthchecks adds no series at all.

The practical cost is therefore roughly (distinct endpoints) x (distinct
values). For a demo that is tens of series. For a real service with 10k
concurrent sessions it is a bill. **If you need distinct-count over a
high-cardinality identifier at scale, ask a log-based backend, not a
dimensional-metrics one.** That difference is architectural, not a
configuration gap.

### 30. Do not grep collector logs for "error"

The `debug` exporter at `verbosity: detailed` prints every metric name and
every attribute value it sees. A healthy collector therefore emits hundreds
of lines containing the word "error":

```
-> Name: system.network.errors
-> error_class: Str(-)
-> outcome: Str(error)
```

Measured on this stack: **381 naive matches against one real log line**, and
that one was a benign `host_metrics` note about `root_path` in Docker. So the
usual troubleshooting advice sends you hunting through telemetry content
looking for a problem that is not there, and worse, would hide a genuine
error in the noise.

The collector logs one record per line, tab-delimited, with the level as the
**second field**. Match that:

```bash
docker compose logs otel-collector | awk -F'	' '$2 ~ /^(error|warn|fatal)$/'
```

```powershell
docker compose logs otel-collector | Select-String -Pattern "`t(error|warn|fatal)`t"
```

A level histogram is a better health check than any grep, because it tells
you what "normal" looks like for your stack:

```bash
docker compose logs otel-collector   | awk -F'	' '$2 ~ /^[a-z]+$/ { c[$2]++ } END { for (l in c) printf "%-7s %d
", l, c[l] }'
```

This project's healthy baseline is 180 info, 1 warn, 0 error.

Two related points. `grep -P` is unavailable in some locales (it fails with
"-P supports only unibyte and UTF-8 locales"), so use `awk -F'	'` rather
than a Perl-regex `	`. And `docker compose logs` prefixes each line with
the service name, which shifts nothing here because the prefix is joined to
the timestamp without a tab, but pass `--no-log-prefix` if you need clean
fields.

### 31. Splunk `service.request` is in NANOSECONDS, and double-counts

Two independent traps in one metric, both of which produce a
plausible-looking dashboard that is quietly wrong.

**Units.** `service.request` is nanoseconds. The `span_metrics` connector's
`traces.span.metrics.duration` is milliseconds, because you set `unit: ms` in
its config. So a single Splunk dashboard can show nanoseconds on one tab and
milliseconds on another, both labelled "Latency", and nothing warns you.
Sanity-check any latency chart against a known value before believing it: a
P50 of 940,000 for an endpoint you know is sub-millisecond is the tell.

**Double counting.** `service.request` emits **two** MetricSets:

| MetricSet | `sf_dimensionalized` |
|---|---|
| Endpoint-level | `'true'` |
| Service-level | property absent |

Both match a filter that does not mention the property, so
`.count().sum()` counts every request twice. Measured on this project over
one 10-minute window: **132 unfiltered, 66 with
`filter('sf_dimensionalized', 'true')`, 58 in Azure** for the same traffic.

```
A = histogram('service.request',
      filter=filter('sf_service', 'rag-api')
         and filter('sf_environment', 'dev')
         and filter('sf_dimensionalized', 'true')
    ).count().sum().publish(label='requests')
```

Note `filter('sf_dimensionalized', 'false')` returns **zero**, because the
service-level series does not carry the property at all rather than carrying
it as false. So you cannot select the other half by negating it.

What makes this genuinely nasty is which charts survive it. **Ratios are
immune**, because numerator and denominator both double: an error-rate chart
looks perfect while the request-count chart beside it is 2x. Percentiles are
immune too, since the percentile of a duplicated population is unchanged.
Only counts are wrong, so a dashboard can be 80% correct and give no hint.

This was a live defect in this project's own dashboard across eight charts,
and it was invisible until a second backend was put next to it.

### 32. SignalFlow is reachable over plain HTTP, no websocket needed

Worth knowing because the assumption that it needs a streaming client is what
stops people automating Splunk reads, and it is wrong.

```bash
curl -sS -N -X POST   "https://stream.${REALM}.signalfx.com/v2/signalflow/execute?start=${START_MS}&stop=${STOP_MS}&immediate=true&resolution=60000"   -H "Content-Type: application/json"   -H "X-SF-Token: ${TOKEN}"   -H "Accept: text/event-stream"   -d '{"programText":"A = data('cpu.utilization').mean().publish(label='v')"}'
```

Four details that each cost a round of trial and error:

- **`Accept` must be `text/event-stream`**, or absent, or `*/*`. Sending
  `application/json` returns a bare **HTTP 406** with no explanation.
- **`immediate=true` with a bounded `start`/`stop` is what makes it
  terminate.** Without it the response stays open waiting for future data,
  which is the behaviour people mistake for needing a websocket.
- **The response is SSE**: blocks separated by a blank line, each with an
  `event:` type and a `data:` JSON payload. The types that matter are
  `metadata`, which maps a `tsId` to properties including `sf_streamLabel`
  (your `publish(label=...)` name), and `data`, which carries
  `{"data": [{"tsId": ..., "value": ...}]}`. You must join the two on `tsId`
  to know which series a number belongs to.
- **`resolution` is honoured**, but asking for a single window-wide bucket
  produced a boundary artefact here (a spurious 1.44e9 point alongside the
  real one). Prefer a normal resolution and aggregate the points yourself,
  respecting trap 22: sum counters, but take the **median** of per-interval
  percentiles rather than the mean.

### 33. Comparing two backends: share one window, and get ground truth

A backend comparison is only as good as its method, and two mistakes here
produced a table that looked like one vendor was losing data.

**Give every query the same absolute window.** The obvious approach is a
relative window per query (`az ... --offset 1h`, and `start = now - 1h` for
SignalFlow). Across a dozen rows those run seconds apart, each anchored to
its own "now", so the two backends measure different slices and continuous
traffic makes the counts disagree. Compute the window **once** and pass
absolute timestamps to both:

```python
resolution_ms = 60000
stop_ms = (int(time.time() * 1000) // resolution_ms) * resolution_ms
start_ms = stop_ms - window_ms
```

Aligning down to a whole bucket also drops the in-progress interval, which
matters because **SignalFlow returns an inclusive endpoint**: 61 points for a
60-minute window at 60s resolution. That extra partial bucket silently added
a minute of traffic to every count. `az monitor app-insights query` takes
`--start-time` / `--end-time`, so both sides can be pinned exactly.

Measured on this project, request count over one hour:

| | Before | After |
|---|---|---|
| Splunk | 599 | **593** |
| Azure | 593 | **593** |

**Get ground truth before blaming a backend.** The residual gap looked like
Azure dropping data. Rather than argue from inference, send a known number of
uniquely tagged requests and count them on both sides:

```bash
SID="ctrl-$(date +%s)"
for i in $(seq 1 60); do
  curl -s -o /dev/null -H "X-Session-Id: $SID" http://localhost/health
done
```

```kql
requests | where tostring(customDimensions['session.id']) == 'ctrl-...'
| summarize rows = count(), items = sum(itemCount)
```

Result here: **60 sent, 60 in Azure, 60 in Splunk.** Neither backend dropped
anything, and `itemCount` was 1 on every row, which also rules out ingestion
sampling. The discrepancy was entirely in the comparison harness.

That check takes two minutes and is worth doing before any claim about data
loss, because "the other vendor is losing spans" is an easy and expensive
conclusion to reach by accident.

---

## Part 1: OpenTelemetry implementation

### 1.1 Dependencies

Node >= 20.6.0. These exact versions are proven:

```json
"@opentelemetry/api": "^1.9.1",
"@opentelemetry/auto-instrumentations-node": "^0.79.0",
"@opentelemetry/exporter-logs-otlp-http": "^0.221.0",
"@opentelemetry/exporter-metrics-otlp-http": "^0.221.0",
"@opentelemetry/exporter-trace-otlp-http": "^0.221.0",
"@opentelemetry/resources": "^2.10.0",
"@opentelemetry/sdk-logs": "^0.221.0",
"@opentelemetry/sdk-metrics": "^2.10.0",
"@opentelemetry/sdk-node": "^0.221.0",
"@opentelemetry/semantic-conventions": "^1.43.0"
```

### 1.2 SDK bootstrap

See [`api/src/instrumentation.js`](../api/src/instrumentation.js) for the
live version. The shape that matters:

```js
if (otlpEndpoint) {
  sdkOptions.traceExporter = new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });

  sdkOptions.metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` }),
    exportIntervalMillis: 15000,
  });

  // Options OBJECT -- see trap 1
  sdkOptions.logRecordProcessors = [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({ url: `${otlpEndpoint}/v1/logs` }),
    }),
  ];
}
```

### 1.3 Logging with trace correlation

Write to stdout *and* emit an OTel record. Attaching the active context
is what puts `trace_id`/`span_id` on the record, which is the entire
basis of trace-to-log correlation later:

```js
const activeContext = context.active();
if (trace.getSpan(activeContext)) {
  record.context = activeContext;
}
logger.emit(record);
```

Fetch the logger lazily at emit time. The logs API returns a no-op
logger when no provider is registered, and a cached no-op never upgrades.

See [`api/src/logger.js`](../api/src/logger.js).

### 1.4 LLM instrumentation

Three metric instruments. The counter exists alongside the histogram
because counters behave more predictably with `data()` in SignalFlow:

```js
meter.createHistogram('gen_ai.client.token.usage',    { unit: '{token}' });
meter.createCounter('gen_ai.client.token.count',      { unit: '{token}' });
meter.createHistogram('gen_ai.client.response.length',{ unit: '{character}' });
```

Record with a `gen_ai.token.type` dimension so input and output are
separable, carrying provider and model so cost can be sliced:

```js
const metricAttrs = {
  'gen_ai.operation.name': 'chat',
  'gen_ai.provider.name': provider,
  'gen_ai.request.model': model,
  'gen_ai.response.model': data.model || model,
};
tokenUsageHistogram.record(promptTokens, { ...metricAttrs, 'gen_ai.token.type': 'input' });
tokenCounter.add(completionTokens,       { ...metricAttrs, 'gen_ai.token.type': 'output' });
```

**Instrument the streaming path too.** It is easy to cover the plain call
and silently lose all usage data on streamed responses.

The full 14-attribute span set is documented in
[splunk-setup.md Section 25](splunk-setup.md#25-splunk-ootb-features----what-works-and-what-needs-configuration).

### 1.5 MCP instrumentation

HTTP auto-instrumentation on both ends propagates W3C `traceparent`
automatically, so traces cross into MCP servers with no manual context
plumbing. On outbound calls, add:

```js
'peer.service':  'playwright-mcp',   // draws the service map edge
'mcp.tool.name': toolName,
```

Do not put tool arguments or results into attributes; that leaks content.

Networking trap: inside Docker, `localhost` is the container. Use
`host.docker.internal` to reach the host.

### 1.6 Collector configuration

Full config in [`otel-collector-config.yaml`](../otel-collector-config.yaml).
The parts that are load-bearing:

- **`spanmetrics` connector** with dimensions for
  `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`
  and `deployment.environment`. This is what produces metrics for
  INTERNAL/CLIENT spans (trap 5).
- **`resourcedetection`** sets `host.name`, which is required for APM to
  Infrastructure Related Content correlation.
- **`filter/logs`** drops DEBUG and TRACE before export
  (`severity_number < SEVERITY_NUMBER_INFO`) to cut ingest volume.
- **Three exporters to two different products**, see
  [architecture.md](architecture.md).

### 1.7 SurrealDB

SurrealDB 3.1+ emits OTLP natively, no application code required:

```yaml
- SURREAL_TELEMETRY_PROVIDER=otlp
- OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317   # gRPC
```

Splunk **Database Monitoring does not support SurrealDB** (only MS SQL
Server, PostgreSQL and Oracle). It appears as an inferred service via
`db.system`. Add `db.query.text` (sanitized, no parameter values),
`db.namespace` and `peer.service` to DB spans for trace-level detail.

---

## Part 2: Splunk setup

### 2.1 Verify HEC before wiring the collector

```bash
curl -s -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Splunk $SPLUNK_HEC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event":"hec connectivity test","sourcetype":"otel","index":"main"}' \
  "$SPLUNK_HEC_URL"
```

`{"text":"Success","code":0}` is good. Otherwise: `404` wrong host,
`400` bad index or acknowledgement enabled, `401` bad token, `403` token
disabled or HEC disabled globally.

`scripts/setup-splunk-hec.*` automates this check plus the collector
redeploy.

### 2.2 Dashboards and detectors as code

Keep definitions in version control (`splunk/dashboard.json`,
`splunk/detectors.json`) and deploy idempotently via
`scripts/setup-splunk-dashboard.*`. Do not hand-build in the UI.

| Resource | Endpoint | Methods |
|---|---|---|
| Dashboard group | `https://api.{REALM}.signalfx.com/v2/dashboardgroup` | GET, POST |
| Dashboard | `/v2/dashboard` | GET, POST, PUT, DELETE |
| Chart | `/v2/chart` | GET, POST, PUT |
| Detector | `/v2/detector` | GET, POST, PUT |

All require the `X-SF-Token` header. Chart `options.type` mapping:
`Line`/`Area` to `TimeSeriesChart` (Area also sets
`defaultPlotType: AreaChart`), `List` to `List`, `Table` to
`TableChart`, `SingleValue` to `SingleValue`.

### 2.3 SignalFlow that works

Percentiles use the **named argument** `percentile(pct=N)`, and the
working dashboards publish one filtered series per operation rather than
grouping with `by=`.

Latency per pipeline stage, the single most useful chart in this project,
because it shows at a glance whether latency is retrieval, embedding or
the model:

```
filter_ = filter('service.name', 'rag-api') and filter('deployment.environment', 'dev')
A = histogram('traces.span.metrics.duration',
      filter=filter_ and filter('span.name', 'chat.pipeline')).percentile(pct=50).publish(label='Total Chat')
B = histogram('traces.span.metrics.duration',
      filter=filter_ and filter('span.name', 'db.vectorSearch')).percentile(pct=50).publish(label='Vector Search')
C = histogram('traces.span.metrics.duration',
      filter=filter_ and filter('gen_ai.operation.name', 'chat')).percentile(pct=50).publish(label='LLM Completion')
```

Token consumption by model:

```
A = data('gen_ai.client.token.count',
      filter=filter('gen_ai.token.type','input'), rollup='delta')
      .sum(by=['gen_ai.request.model']).publish('input tokens')
```

### 2.4 Drift detectors

Compare a short window against a longer baseline using standard
deviations, not a fixed percentage. An earlier implementation using the
`against_recent` library had to be rewritten to this `detect`/`when`
form:

```
A = data('gen_ai.client.response.length', filter=filter('service.name','rag-api')).mean(over='5m')
B = data('gen_ai.client.response.length', filter=filter('service.name','rag-api')).mean(over='1h')
C = data('gen_ai.client.response.length', filter=filter('service.name','rag-api')).stddev(over='1h')
detect(when(A > B + C * 3, lasting='5m') or when(A < B - C * 3, lasting='5m')).publish('Response Length Anomaly')
```

The `lasting='5m'` clause is what stops a single outlier paging someone.
These need roughly an hour of traffic before the baseline means
anything. Full detail in
[splunk-setup.md Section 18.5](splunk-setup.md#185-llm-drift-detection-detectors).

---

## Part 3: Azure Monitor setup

Verified against vendor documentation, `otelcol validate` and
`az bicep build`. **Not yet verified against a live Application Insights
resource** -- the items that depend on runtime behaviour are marked in
traps 19 and 20.

### 3.1 Choose the ingestion path deliberately

Two options, and the easy one is not the recommended one.

| | `azure_monitor` exporter | Native OTLP + Entra |
|---|---|---|
| Auth | Connection string, one env var | Microsoft Entra identity |
| Extra Azure resources | None beyond App Insights | DCE, DCR, Log Analytics workspace, Azure Monitor workspace |
| Collector version | Any recent contrib build | >= 0.132, and >= 0.148 for the current `azure_auth` syntax |
| Role assignments | None | Monitoring Metrics Publisher on the DCR |
| Works from a laptop | Yes | Awkward: needs a workload identity or service principal |
| Status | Community component, beta per signal | Microsoft-recommended, **in preview** |
| Data shape | Classic App Insights schema | OTLP-native into workspaces |

Pick the exporter for a spike or a demo. Pick native OTLP if you are going to
production and can absorb the resource orchestration. Do not start with native
OTLP to "do it properly" and lose two days to Entra from a laptop.

The shortcut for the native path: create the Application Insights resource
with **OTLP support** set to **On**, which provisions the DCE, DCR and
workspaces and surfaces the three endpoint URLs on the resource Overview page.

### 3.2 The schema mapping everything depends on

| OTel | App Insights table |
|---|---|
| Span kind SERVER, CONSUMER | `requests` |
| Span kind CLIENT, PRODUCER, INTERNAL | `dependencies` |
| Span attributes | `customDimensions` on both |
| Log records | `traces`, correlated by `operation_Id` |
| Span events | `exceptions` (needs trap 21) |
| Metrics, all kinds | `customMetrics` |
| `service.name` | `cloud_RoleName` |

The consequence people trip over: **a "calls by span name" query needs
`union requests, dependencies`**, because the two span-kind families land in
different tables. There is no single span table.

The consequence that saves work: per-span `duration` is native on both tables,
in milliseconds. No connector, no pre-aggregation, exact percentiles.

### 3.3 Exporter configuration

```yaml
exporters:
  azure_monitor:
    connection_string: "${APPLICATIONINSIGHTS_CONNECTION_STRING}"
    spaneventsenabled: true

processors:
  cumulative_to_delta:
    include:
      match_type: strict
      metrics: [container.cpu.usage.total, surrealdb.transaction]

  transform/azure_dims:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          - set(datapoint.attributes["container.name"], resource.attributes["container.name"]) where resource.attributes["container.name"] != nil

service:
  pipelines:
    metrics/azure:
      receivers: [otlp, docker_stats]
      processors: [resource_detection, cumulative_to_delta, transform/azure_dims, batch]
      exporters: [azure_monitor]
```

Running both backends at once is a fan-out, not a fork: pipelines send to
every exporter listed. Traces and logs can be single fan-out pipelines.
**Metrics cannot**, because the two backends need different receivers and
processors, so split into `metrics/splunk` and `metrics/azure`. Receiver
instances are shared across same-type pipelines, so a receiver named in both
scrapes once.

Validate before running. An invalid config is a total outage:

```bash
docker run --rm -v "$(pwd)/otel-collector-config.azure.yaml:/etc/otelcol/config.yaml:ro" \
  -e APPLICATIONINSIGHTS_CONNECTION_STRING='InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://localhost/' \
  otel/opentelemetry-collector-contrib:latest validate --config /etc/otelcol/config.yaml
```

### 3.4 Verify ingest before building any dashboard

Five queries, all of which must return rows. This is the equivalent of
section 2.1's "verify HEC first" discipline, and skipping it is how you end up
debugging a query that was never going to work:

```kql
requests      | summarize count() by cloud_RoleName
dependencies  | summarize count() by name
customMetrics | summarize count() by name
traces        | summarize count() by severityLevel
exceptions    | summarize count()
```

An empty `exceptions` after error traffic means trap 21. Unlabelled
infrastructure charts mean trap 19. Diagonal ramps mean trap 18.

### 3.5 KQL that works

Patterns, not a catalogue. The full set is in `azure/workbook.json`.

```kql
// RED signals per service, one row per tile
requests
| summarize Requests = sum(itemCount), Errors = sumif(itemCount, tobool(success) == false)
    by Service = cloud_RoleName
| extend ['Error rate %'] = iff(Requests == 0, 0.0, round(100.0 * Errors / Requests, 2))
```

```kql
// Exact percentiles off raw spans. No connector, no buckets.
dependencies
| where tostring(customDimensions['gen_ai.operation.name']) == 'chat'
| summarize P50 = percentile(duration, 50), P90 = percentile(duration, 90)
    by bin(timestamp, {TimeRange:grain})
```

```kql
// Delta counter total. Correct ONLY because temporality is delta.
customMetrics
| where name == 'gen_ai.client.token.count'
| summarize Tokens = tolong(sum(valueSum))
    by ['Token type'] = tostring(customDimensions['gen_ai.token.type'])
```

```kql
// Rate from a delta-converted counter
let bin_ = {TimeRange:grain};
customMetrics
| where name == 'surrealdb.transaction'
| summarize Tx = sum(valueSum) by bin(timestamp, bin_)
| project timestamp, ['Tx/s'] = round(todouble(Tx) / (bin_ / 1s), 2)
```

`percentile()` is the function. **There is no exact-percentile function in
KQL** -- `percentile()`, `percentiles()`, `percentiles_array()` and
`percentilesw()` are all T-Digest estimates, with error capped at 1% on
*rank* (not value), worst at the median, exact only at 0 and 100. If you need
several percentiles from one column, `percentiles(duration, 50, 90, 99)` is
cheaper than three `percentile()` calls, at the cost of fixed
`percentile_<col>_<n>` column names.

### 3.6 Workbooks as code

Two mechanics that will cost you an afternoon each.

**The resource name must be a GUID, and it must be deterministic.**

```bicep
name: guid(resourceGroup().id, 'rag-agent-observability')
```

`newGuid()` creates a *new* workbook on every deployment. You get seven
identical workbooks and no way to tell which one people bookmarked.

**`serializedData` is a JSON string, not an object.** Hand-escaping thirty KQL
queries into an ARM string is not maintainable. Keep the payload in its own
file, then parse, augment and re-serialise:

```bicep
var payload = json(loadTextContent('workbook.json'))
var scoped = {
  version: payload.version
  isLocked: payload.isLocked
  items: payload.items
  fallbackResourceIds: [ appInsights.id ]
}
resource workbook 'Microsoft.Insights/workbooks@2022-04-01' = {
  name: guid(resourceGroup().id, 'rag-agent-observability')
  kind: 'shared'
  properties: {
    displayName: 'RAG Agent -- Observability'
    serializedData: string(scoped)
    sourceId: appInsights.id
    category: 'workbook'
  }
}
```

Injecting `fallbackResourceIds` at deploy time is what keeps the JSON free of
subscription IDs, so the same file deploys anywhere.

**Tabs** need two pieces: a `type: 11` links item with `style: "tabs"` whose
links set a parameter, and `type: 12` group items with `conditionalVisibility`
on that parameter. Without the groups you get one long scroll.

**There is no SingleValue item type.** Use `visualization: "tiles"`, which
needs one result row per tile. Four separate single-value charts therefore
become one query with `summarize ... by <dimension>`, which is usually better
anyway.

Two-up layout is `styleSettings: { maxWidth: "50" }` per item.

### 3.7 Alert rules as the drift-detector analogue

`Microsoft.Insights/scheduledQueryRules`, kind `LogAlert`. The SignalFlow
`detect`/`when` form translates almost mechanically:

| SignalFlow | Scheduled query rule |
|---|---|
| `mean(over='5m')` | recent window in the KQL |
| `mean(over='1h')`, `stddev(over='1h')` | baseline in the KQL, `windowSize: PT1H` |
| `lasting='5m'` | `failingPeriods: {numberOfEvaluationPeriods: 2, minFailingPeriodsToAlert: 2}` |
| `severity: Warning` | `severity: 2` |
| `notifications: []` | empty `actions.actionGroups` |

Set `windowSize` to match the widest `ago()` in the query, or the baseline
silently narrows to the rule's window. The rule fires on rows returned, so the
criterion is `timeAggregation: 'Count'`, `operator: 'GreaterThan'`,
`threshold: 0`, and the query returns nothing when healthy.

See trap 22 for why the query must read spans rather than metrics.

**Accept that this detects later than Splunk.** Five-minute evaluation floor
plus one to three minutes of Log Analytics ingestion latency, against
Splunk's streaming pipeline seconds behind. Architectural, not tunable.

Do not forget **Smart Detection**, which arrives free with the resource and
covers latency degradation and failure-rate anomalies with no rules at all.
It is not a substitute for a specific business-signal detector, but omitting
it from any comparison understates Azure.

---

## Scope boundaries

Some Splunk capabilities are not reachable regardless of configuration.
These were each established empirically, and each one initially looked
like a configuration problem. Full detail with evidence in
[splunk-setup.md Section 26](splunk-setup.md#26-what-works-on-free--trial-accounts-and-what-does-not).

| Capability | Blocker |
|---|---|
| Log Observer Connect | Needs a licensed non-trial Splunk platform. Three gates on a trial |
| APM > AI Agent Monitoring | Python-only instrumentation, and expects `invoke_agent`/`invoke_workflow` span semantics |
| Splunk-side LLM evals | Platform licence plus prompt/response capture, which is a PII decision |

Prefer a local eval harness instead (`scripts/run-eval.*`): a golden
question set run against the live agent, plus the drift detectors above.
That covers regression and drift without sending a single prompt off the
stack.

---

*Last updated: 2026-09-08*
