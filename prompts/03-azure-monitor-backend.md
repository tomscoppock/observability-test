# Prompt 3: Azure Monitor backend

Points an already-instrumented service at Azure Monitor / Application
Insights, and builds an Azure Workbook and drift-detection alert rules as
code.

**Requires prompt 1 first**, or an existing OTel Collector setup. This prompt
adds an exporter, dashboards and alerting; it does not instrument anything.

Can run **alongside prompt 2**. Collector pipelines fan out to every exporter
listed, so one service can feed Splunk and Azure Monitor simultaneously from
one traffic run. That is how the source project produced a controlled
side-by-side comparison.

**Copy everything between the fences into your coding agent.**

````text
Add Azure Monitor as an OpenTelemetry backend for this project.

Start in PLAN MODE. Before proposing anything:
  1. Read the repo and report what already exists: is there an OTel
     Collector? Which SDK and version? Are traces, metrics AND logs all
     exported, or only some? Is there an existing observability backend?
  2. Report what is missing against the requirements below.
  3. Ask me about anything ambiguous. Do not guess and do not start
     writing code until I approve a plan.

If this project already exports OTLP to a collector, say so explicitly in
step 1. It changes the whole shape of the work: adding a backend then means
adding one exporter to that collector, not touching application code at all.

## Priorities, in order

1. Token consumption and cost attribution per model and operation
2. Per-step pipeline latency (retrieval, inference, database)
3. Log records correlated with the traces that produced them
4. Infrastructure and container metrics

## Architecture

Use the UPSTREAM otel/opentelemetry-collector-contrib image, not a vendor
distribution. Vendor distributions make backend switching harder, which is
the opposite of the point.

  Traces  -> azure_monitor  -> App Insights "requests" + "dependencies"
  Metrics -> azure_monitor  -> App Insights "customMetrics"
  Logs    -> azure_monitor  -> App Insights "traces" (+ "exceptions")

All three signals land in ONE Application Insights resource, correlated by
operation_Id. If this project also exports to another backend, add
azure_monitor alongside it rather than replacing it: collector pipelines
fan out to every exporter listed, so both backends get identical telemetry.
Keep the existing config file untouched and add sibling files, selected by
an environment variable on the bind mount:

    volumes:
      - ${OTEL_COLLECTOR_CONFIG:-./otel-collector-config.yaml}:/etc/otelcol/config.yaml:ro

PROVENANCE: the Azure material below is verified against Microsoft's
documentation, against `otelcol validate` and `az bicep build`, AND against
a live Application Insights resource carrying real application traffic.
Every trap marked [VERIFIED] was observed, not reasoned. Traps 14 to 17 in
particular were each found by a failure in the real thing rather than by
reading anything, which is why they are worth your attention.

=============================================================
PART 1 -- Ingestion path
=============================================================

## 1.1 Choose the path deliberately

Two options, and the easy one is not Microsoft's recommended one.

Option A, the azure_monitor exporter:
  - Auth is a connection string in one environment variable
  - No extra Azure resources beyond App Insights
  - Works from Docker on a laptop
  - Data lands in the classic App Insights schema, which is what
    Workbooks and the App Insights UI expect
  - Community component, beta per signal

Option B, native OTLP with Entra ID (Microsoft-recommended, IN PREVIEW):
  - otlp_http exporter plus the azure_auth extension
  - Collector >= 0.132, and >= 0.148 for the current azure_auth syntax,
    which is not backward compatible
  - A Microsoft Entra identity. Managed identity on Azure VMs and Scale
    Sets; a workload identity or service principal anywhere else,
    including a laptop
  - A Data Collection Endpoint and Data Collection Rule, deployed from
    the ARM template in the Azure Monitor Community repository
  - The Monitoring Metrics Publisher role assigned on the DCR
  - A Log Analytics workspace for logs/traces AND an Azure Monitor
    workspace for metrics
  - Requires delta temporality and exponential histogram aggregation

Use Option A unless this is going to production and someone can absorb
the resource orchestration. Do not start with Option B to "do it
properly" and lose days to Entra from a developer machine.

Shortcut for Option B: create the App Insights resource with OTLP
support set to On. That provisions the DCE, DCR and workspaces and
surfaces the three endpoint URLs on the resource Overview page.

Everything below assumes Option A.

## 1.2 Exporter configuration

    exporters:
      azure_monitor:
        connection_string: "${APPLICATIONINSIGHTS_CONNECTION_STRING}"
        # Routes span events to the "exceptions" table. Off by default,
        # which silently discards every recordException() call.
        spaneventsenabled: true

NOTE THE UNDERSCORE: azure_monitor, not azuremonitor. See trap 1.

The connection string embeds an ingestion key and IS a credential. It
belongs in .env or a secret manager, never in the repo. It CANNOT be
rotated: if it leaks, the remedy is a new App Insights resource and
repointing, which loses continuity of the data. Say this in the docs
you write.

## 1.3 Give it a placeholder default

    - APPLICATIONINSIGHTS_CONNECTION_STRING=${APPLICATIONINSIGHTS_CONNECTION_STRING:-InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://localhost/}

Not optional, and not cosmetic. See trap 2.

## 1.4 Metrics pipeline needs two extra processors

    processors:
      # customMetrics has no counter semantics, so cumulative counters
      # chart as monotonic ramps. STRICT include list, not a regex: a
      # broad pattern sweeps in gauges, and delta-converting a gauge
      # is wrong.
      cumulative_to_delta:
        include:
          match_type: strict
          metrics:
            - container.cpu.usage.total
            - container.network.io.usage.rx_bytes
            - container.network.io.usage.tx_bytes

      # Resource attributes may not surface in customMetrics
      # customDimensions. Copy what the charts group by onto the
      # data points so it is deterministic.
      transform/azure_dims:
        error_mode: ignore
        metric_statements:
          - context: datapoint
            statements:
              - set(datapoint.attributes["container.name"], resource.attributes["container.name"]) where resource.attributes["container.name"] != nil
              - set(datapoint.attributes["compose.service"], resource.attributes["compose.service"]) where resource.attributes["compose.service"] != nil

## 1.5 Do NOT send spanmetrics to Azure

If this project has a spanmetrics connector, it almost certainly exists
because the other backend needs it. Azure does not. Every CLIENT and
INTERNAL span becomes a "dependencies" row with a native duration in
milliseconds, so KQL percentiles work off the raw table and are exact.
The spanmetrics histogram loses its buckets at ingest and yields no
percentiles at all, so routing it to Azure gives strictly less.

Consequence: traces and logs can be single fan-out pipelines, but
METRICS CANNOT. Split them:

    service:
      pipelines:
        traces:
          receivers: [otlp]
          exporters: [<existing>, azure_monitor, spanmetrics]
        metrics/<existing-backend>:
          receivers: [otlp, docker_stats, hostmetrics, spanmetrics]
          exporters: [<existing>]
        metrics/azure:
          receivers: [otlp, docker_stats]
          processors: [resource_detection, cumulative_to_delta, transform/azure_dims, batch]
          exporters: [azure_monitor]
        logs:
          receivers: [otlp]
          exporters: [<existing>, azure_monitor]

Receiver instances are shared across pipelines of the same type, so a
receiver named in both metrics pipelines scrapes once, not twice.

Also consider dropping hostmetrics from the Azure pipeline. Its usual
purpose is the other vendor's APM-to-Infrastructure correlation, which
App Insights has no counterpart for, and its cpu and filesystem
scrapers emit per-core and per-mount data points that each become a
billable customMetrics row.

## 1.6 Delta temporality is required

    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta

The exporter attaches no counter semantics to a Sum data point. Under
cumulative temporality every exported point is the running total since
process start, so sum(valueSum) over a window sums a ramp. If this is
already set for another backend, leave it. If not, set it.

It only affects the application SDK. It does NOT affect collector
receivers, and it does not affect other services with their own SDKs.
Hence cumulative_to_delta above.

## 1.7 Validate before running

An invalid collector config is a TOTAL outage: every signal stops, not
just the Azure one.

    docker run --rm \
      -v "$(pwd)/otel-collector-config.azure.yaml:/etc/otelcol/config.yaml:ro" \
      -e APPLICATIONINSIGHTS_CONNECTION_STRING='InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://localhost/' \
      otel/opentelemetry-collector-contrib:latest validate --config /etc/otelcol/config.yaml

Silence means success. On Windows, run this from PowerShell rather than
Git Bash: Git Bash rewrites the container-side path and the config will
not be found.

## 1.8 Do not change application code

Everything above is a collector concern or an environment variable. If
you find yourself editing instrumentation for Azure, stop and re-read.
The collector sitting in the middle is what makes the application
backend-agnostic, and preserving that is worth more than any
optimisation.

In particular, if the app emits vendor-specific attribute aliases for
another backend, KEEP THEM. They cost bytes, nothing in Azure reads
them, and keeping them means the app emits byte-identical telemetry to
both backends -- which is the precondition for any comparison being
about the backends rather than two different instrumentations.

=============================================================
PART 2 -- Azure resources, dashboards and alerts
=============================================================

## 2.1 Provision by script, not by portal

Three resources, in order. Application Insights is workspace-based now,
so the Log Analytics workspace is a hard requirement.

    az group create --name "$RG" --location "$LOC" --tags "Purpose=$P" "Owner=$O"
    az monitor log-analytics workspace create --resource-group "$RG" --workspace-name "$LAW" --location "$LOC"
    az monitor app-insights component create --resource-group "$RG" --app "$APPI" \
        --location "$LOC" --kind web --application-type web --workspace "$WORKSPACE_ID"
    az monitor app-insights component show --resource-group "$RG" --app "$APPI" --query connectionString -o tsv

The app-insights commands live in a CLI extension:

    az extension add --name application-insights

Make every step idempotent with a `show` check first, so re-running
updates rather than duplicating. Print the connection string; do not
write it into .env for the user.

## 2.2 The schema mapping everything depends on

    Span kind SERVER, CONSUMER          -> requests
    Span kind CLIENT, PRODUCER, INTERNAL -> dependencies
    Span attributes                      -> customDimensions (both tables)
    Log records                          -> traces (correlated by operation_Id)
    Span events                          -> exceptions (needs spaneventsenabled)
    Metrics, all kinds                   -> customMetrics
    service.name                         -> cloud_RoleName

Two consequences:
  - A "calls by span name" query needs `union requests, dependencies`.
    There is no single span table.
  - Per-span duration is native on both tables, in milliseconds. No
    connector, no pre-aggregation, exact percentiles.

## 2.3 Verify ingest BEFORE building any dashboard

All five must return rows. Skipping this is how you end up debugging a
query that was never going to work.

    requests      | summarize count() by cloud_RoleName
    dependencies  | summarize count() by name
    customMetrics | summarize count() by name
    traces        | summarize count() by severityLevel
    exceptions    | summarize count()

Empty exceptions after error traffic -> trap 8.
Unlabelled infrastructure charts     -> trap 6.
Diagonal ramp charts                 -> trap 5.

## 2.4 KQL patterns per priority

Priority 1, token cost. Correct ONLY because temporality is delta:

    customMetrics
    | where name == 'gen_ai.client.token.count'
    | summarize Tokens = tolong(sum(valueSum))
        by ['Token type'] = tostring(customDimensions['gen_ai.token.type'])

    // Attribution by provider and model, from spans
    dependencies
    | where tostring(customDimensions['gen_ai.operation.name']) == 'chat'
    | summarize Calls = sum(itemCount),
                ['Input tokens']  = sum(tolong(tostring(customDimensions['gen_ai.usage.input_tokens']))),
                ['Output tokens'] = sum(tolong(tostring(customDimensions['gen_ai.usage.output_tokens'])))
        by Provider = tostring(customDimensions['gen_ai.provider.name']),
           Model    = tostring(customDimensions['gen_ai.request.model'])

Priority 2, per-step pipeline latency. Case order is load-bearing: an
LLM client span carries gen_ai.operation.name but its name is not the
pipeline span's name, and a DB span carries no gen_ai attributes:

    let bin_ = {TimeRange:grain};
    dependencies
    | extend genai_op = tostring(customDimensions['gen_ai.operation.name'])
    | extend Step = case(
        name in ('chat.pipeline', 'chat.pipeline.stream'), 'Total Chat',
        name == 'db.vectorSearch',                         'Vector Search',
        genai_op == 'chat',                                'LLM Completion',
        genai_op == 'embeddings',                          'Query Embedding',
        '')
    | where Step != ''
    | summarize P50 = percentile(duration, 50) by bin(timestamp, bin_), Step

Priority 3, logs correlated with traces:

    traces
    | where severityLevel >= 3
    | project timestamp, Service = cloud_RoleName, Message = message,
              ['Trace ID'] = operation_Id
    | order by timestamp desc

Priority 4, infrastructure. Rate arithmetic is manual, because
customMetrics has no counter concept:

    let bin_ = {TimeRange:grain};
    customMetrics
    | where name == 'container.cpu.usage.total'
    | extend Container = coalesce(tostring(customDimensions['compose.service']),
                                  tostring(customDimensions['container.name']))
    | summarize CpuNs = sum(valueSum) by bin(timestamp, bin_), Container
    | project timestamp, Container,
              ['CPU cores'] = round(todouble(CpuNs) / 1e9 / (bin_ / 1s), 3)

THERE IS NO EXACT PERCENTILE FUNCTION IN KQL. percentile(),
percentiles(), percentiles_array() and percentilesw() are all
T-Digest estimates, with error capped at 1% on RANK (not value),
worst at the median, exact only at 0 and 100. Do not write
percentileexact() -- it does not exist, and a workbook containing it
deploys successfully and then shows "Unknown function" on every
affected panel. For several percentiles off one column,
percentiles(duration, 50, 90, 99) is cheaper than three separate
calls, at the cost of fixed percentile_<col>_<n> column names.

## 2.5 Workbook as code

    var payload = json(loadTextContent('workbook.json'))
    var scoped = {
      version: payload.version
      isLocked: payload.isLocked
      items: payload.items
      fallbackResourceIds: [ appInsights.id ]
    }
    resource workbook 'Microsoft.Insights/workbooks@2022-04-01' = {
      name: guid(resourceGroup().id, 'my-workbook')
      location: location
      kind: 'shared'
      properties: {
        displayName: 'My Workbook'
        serializedData: string(scoped)
        version: '1.0'
        sourceId: appInsights.id
        category: 'workbook'
      }
    }

Injecting fallbackResourceIds at deploy time keeps workbook.json free
of subscription IDs, so the same file deploys anywhere.

Tabs need TWO pieces: a type 11 links item with style "tabs" whose
links set a parameter, and type 12 group items with
conditionalVisibility on that parameter. Without the groups you get one
long scroll instead of tabs.

Each query item: type 3, queryType 0, resourceType
"microsoft.insights/components", timeContextFromParameter "TimeRange".
Two-up layout is styleSettings.maxWidth "50".

There is NO SingleValue item type. Use visualization "tiles", which
needs one result row per tile, so N single-value charts collapse into
one `summarize ... by <dimension>`. Usually an improvement.

## 2.6 Alert rules as the drift-detector analogue

Microsoft.Insights/scheduledQueryRules, kind LogAlert.

    mean over 5m               -> recent window in the KQL
    mean/stddev over 1h        -> baseline in the KQL, windowSize PT1H
    "lasting 5m"               -> failingPeriods numberOfEvaluationPeriods 2,
                                  minFailingPeriodsToAlert 2
    Warning severity           -> severity 2
    no notifications           -> empty actions.actionGroups

The rule fires on rows returned, so use timeAggregation 'Count',
operator 'GreaterThan', threshold 0, and write the query to return
nothing when healthy. Set windowSize to match the widest ago() in the
query or the baseline silently narrows.

See trap 9: the query must read raw spans, not customMetrics.

Metric alerts with Dynamic Thresholds are NOT the equivalent. They need
the metric in the Azure Monitor metrics namespace, which log-based
customMetrics is not, and Dynamic Thresholds is a seasonality model
rather than 3-sigma.

Accept that this detects LATER than a streaming metric pipeline: a
five-minute evaluation floor plus one to three minutes of Log Analytics
ingestion latency. Architectural, not tunable.

Do not forget Smart Detection, which arrives free with the resource and
covers latency degradation and failure-rate anomalies with no rules at
all.

=============================================================
NON-OBVIOUS TRAPS -- handle ALL of these explicitly
=============================================================

1. THE EXPORTER TYPE HAS AN UNDERSCORE. azure_monitor, not
   azuremonitor. The latter is not a registered type, so the collector
   refuses to start and takes every signal down with it. Relatedly and
   in the opposite direction: otlp_http is the CANONICAL name for the
   OTLP HTTP exporter and otlphttp is the deprecated alias. It looks
   like a typo and is not. Do not "fix" it.

2. AN EMPTY CONNECTION STRING KILLS THE ENTIRE COLLECTOR. The exporter
   validates it at config-decode time. Empty fails validation, which
   stops every pipeline including traces and metrics. Always give it a
   non-empty placeholder default in compose. The general lesson:
   any exporter with a required credential field is a whole-collector
   outage waiting to happen -- give every one of them a placeholder.

3. USE valueSum AND valueCount, NOT value. Counter total is
   sum(valueSum). Histogram mean is sum(valueSum)/sum(valueCount).
   Gauge reading is avg(valueSum). For a single-measurement point
   value == valueSum, so a naive query appears to work and then
   diverges once real histogram points arrive. Silent.

4. customDimensions VALUES ARE STRINGS, EVEN NUMERIC ONES.
   gen_ai.usage.output_tokens reads back as "420", so sum() on it
   silently returns zero or errors depending on context. Always
   tolong(tostring(customDimensions['...'])). Also: `success` is a
   string in the classic requests view and a bool in the workspace
   AppRequests table, so use tobool(success) == false, which is correct
   in both. And array attributes serialise as JSON text, so
   finish_reasons reads back as ["stop"] and needs parse_json(...)[0].

5. CUMULATIVE COUNTERS CHART AS DIAGONAL RAMPS. customMetrics has no
   counter concept, so a running total is charted literally. The
   application's delta temporality preference does NOT affect collector
   receivers or other services' SDKs. Fix with cumulative_to_delta and a
   STRICT include list -- a broad regex sweeps in gauges, and
   delta-converting a gauge is wrong. This never bites on backends
   whose exporter understands counter semantics, so it is easy to
   inherit a config where it was never needed.

6. RESOURCE ATTRIBUTES DO REACH customDimensions, BUT RECEIVER-MAPPED
   LABELS MAY NOT. [VERIFIED against a live resource.] Resource
   attributes ARE surfaced as custom dimensions on metrics: a
   container.cpu.usage.total datapoint arrived carrying container.name,
   container.id, container.image.name, container.runtime,
   deployment.environment, host.name and os.type. So a transform
   processor copying resource attributes onto datapoints is NOT
   required, though it remains defensible as a deterministic guarantee.

   The real gap is one level down. compose.service, produced by the
   docker_stats receiver's container_labels_to_metric_labels mapping,
   was ABSENT -- the sampled container was not managed by the Compose
   project and so carried no com.docker.compose.* labels. Any chart
   grouping on a receiver-mapped label needs a coalesce() over a real
   resource attribute as a fallback.

   Two more facts from the same check: container metrics arrive with an
   EMPTY cloud_RoleName, because docker_stats sets no service.name, so
   do not filter infrastructure charts on it. And deployment.environment
   does survive, so environment-scoped queries are viable.

7. HISTOGRAMS LOSE THEIR BUCKETS AT INGEST, AND valueStdDev IS NOT
   POPULATED. [VERIFIED against a live resource: a datapoint arrived as
   value 1171, valueSum 1171, valueCount 2, valueMin 386, valueMax 785,
   valueStdDev EMPTY.] The classic schema is pre-aggregated: an
   explicit-bucket histogram is reduced to sum, count, min and max. A
   true percentile CANNOT be recovered. This is silent in the worst
   way -- the metric exists, the chart renders, and the "P90" you
   compute from it is not a P90. The only workaround requires having
   planned for it: record the same value as a SPAN ATTRIBUTE as well as
   a histogram, then percentile the span. Do not claim Azure Monitor
   preserves OTel histogram distributions. It does not.

8. spaneventsenabled GATES THE ENTIRE exceptions TABLE. Off by default.
   With it off, every recordException() call is discarded and
   exceptions stays empty, so error diagnosis is materially worse than
   on a backend where span events ride on the span natively. Get the
   key name wrong and the collector will not start, so run `validate`
   to distinguish "not set" from "misspelled".

9. STDDEV CANNOT BE RECOVERED FROM PRE-AGGREGATED METRICS. For any
   "recent mean versus baseline plus N sigma" rule, do not compute
   sigma from customMetrics. The standard deviation of a set of
   per-interval means is not the standard deviation of the population:
   it systematically understates variance, so the rule fires far more
   often than 3-sigma implies. Silent, and it looks like a working
   detector. Read raw span rows instead. Also ADD SAMPLE-SIZE GUARDS
   (n >= 30, m >= 5, sigma > 0) -- without them a cold-start window
   with a handful of observations fires immediately.

10. THE WORKBOOK RESOURCE NAME MUST BE A DETERMINISTIC GUID. Use
    guid(resourceGroup().id, '<stable-key>'). newGuid() creates a NEW
    workbook on every deployment, so you end up with seven identical
    workbooks and no way to tell which one people bookmarked.

11. serializedData IS A JSON STRING, NOT AN OBJECT. Hand-escaping
    thirty KQL queries into an ARM string is not maintainable. Keep the
    payload in its own file and use
    string(union(json(loadTextContent(...)), ...)) in Bicep.

12. THERE IS NO SingleValue ITEM TYPE IN WORKBOOKS. Use "tiles", which
    needs one result row per tile. Plan the query around that from the
    start rather than porting N single-value charts one-to-one.

13. A GENERIC SPAN QUERY NEEDS union requests, dependencies. SERVER and
    CLIENT spans land in different tables. Any query that assumes one
    span table will silently return half the data.

14. IN POWERSHELL, A FAILING az PROBE ABORTS THE WHOLE SCRIPT. Not
    Azure-specific, but it will break your setup script on the first run.
    Windows PowerShell 5.1 wraps a native command's stderr in an
    ErrorRecord (NativeCommandError), so under
    $ErrorActionPreference = 'Stop' ANY az command that writes to stderr
    becomes a TERMINATING error. This looks like a soft existence check
    and is not one:

        # WRONG -- aborts on the run that was supposed to create the RG
        az group show --name $rg 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { ... } else { ...create it... }

    The else branch is unreachable, and the error message blames
    ResourceGroupNotFound rather than the redirect. Fix it two ways at
    once: prefer commands that do not error on "absent"
    (`az group exists` returns true/false with exit code 0; for other
    resources use `az resource list --query "[?name=='$n'] | length(@)"`),
    and route every az call through a helper that sets
    $ErrorActionPreference = 'Continue' for the duration and returns
    $LASTEXITCODE. Bash is unaffected, because a failing command in an
    `if` condition does not trigger errexit -- which is exactly how a
    bash/PowerShell script pair passes review with only the bash half
    working.

    While there: prefer `az group create` over a create-or-update branch.
    It is a PUT, so it creates when absent and updates tags when present,
    and it avoids `--set tags."Responsible Owner"=...`, whose quoting of
    a tag key containing a space is fragile across shells.

15. MULTI-PERIOD LOG ALERTS NEED A `timestamp` COLUMN, AND THE PERIOD IS
    windowSize. Three coupled facts; missing any one fails the deployment
    or silently narrows the rule.

    (a) numberOfEvaluationPeriods > 1 requires the query to project a
        column LITERALLY NAMED `timestamp`, of type datetime. Otherwise
        deployment fails with "Number of evaluation periods must be 1 for
        queries that do not project the 'timestamp' column of type
        'datetime'". So a "recent mean versus baseline" rule cannot
        return one scalar row -- it must bin into points and emit one row
        per breaching point:

            let population = dependencies | where ... | extend v = ...;
            let baseline = population
                | summarize mu = avg(v), sigma = stdev(v), n = count();
            population
            | summarize short_mu = avg(v), m = count()
                by timestamp = bin(timestamp, 5m)
            | extend joinkey = 1
            | join kind=inner (baseline | extend joinkey = 1) on joinkey
            | where n >= 30 and m >= 5 and sigma > 0
            | where short_mu > mu + 3 * sigma
            | project timestamp, short_mu, mu, sigma, n, m

    (b) An evaluation period is windowSize, NOT evaluationFrequency. With
        windowSize PT1H and 2 periods the lookback is two hours.

    (c) The query time range defaults to
        windowSize * numberOfEvaluationPeriods. For PT5M and 2 periods
        that is ten minutes, so a one-hour baseline silently becomes a
        ten-minute one. Use overrideQueryTimeRange to decouple them.

    A faithful translation of mean(over='5m') + stddev(over='1h') +
    lasting='5m' is therefore: windowSize PT5M, overrideQueryTimeRange
    PT1H, failingPeriods 2 of 2, timeAggregation Count, operator
    GreaterThan, threshold 0, and a query that returns nothing when
    healthy.

    Leave skipQueryValidation at its default of false, so Azure validates
    the KQL against the workspace schema at deploy time.

16. WORKBOOK QUERIES ARE NOT VALIDATED AT DEPLOY TIME. Alert rules are;
    workbooks are not, and the asymmetry will catch you.
    properties.serializedData is an opaque STRING to ARM, so nothing
    parses the KQL inside it. A workbook containing a non-existent
    function deploys with provisioningState "Succeeded" and then shows
    "Unknown function: 'x'" on every affected panel, discovered only when
    a human clicks the tab.

    So a green deployment proves nothing about a workbook. Extract every
    query and run it yourself after deploying:

        az monitor app-insights query --app "$APPID"           --analytics-query "$(cat query.kql)" --offset 1h           --query "tables[0].rows | length(@)" -o tsv

    Assert TWO things per panel, not one: that the query RUNS, and that it
    RETURNS ROWS. A query that runs and returns nothing is the failure
    mode that looks like success. Worse, an aggregate with no `by` clause
    returns one row of zeroes rather than no rows, so it renders a
    confident, wrong number.

    Related: THERE IS NO percentileexact() IN KQL. percentile(),
    percentiles(), percentiles_array() and percentilesw() are all T-Digest
    estimates, capped at 1% error on RANK (not value), worst at the
    median, exact only at 0 and 100.

17. REQUEST-SCOPED ATTRIBUTES MUST BE ON THE SERVER SPAN, AND MUST NOT BE
    INVENTED. An application bug rather than an Azure one, but it silently
    breaks the same chart on every backend at once, so check for it early.

    With @opentelemetry/instrumentation-express active, each middleware
    layer gets its own INTERNAL span, and that is what trace.getActiveSpan()
    returns inside a handler. So this is WRONG:

        app.use((req, _res, next) => {
          const sessionId = req.headers['x-session-id'] || crypto.randomUUID();
          const span = trace.getActiveSpan();   // the MIDDLEWARE span
          if (span) span.setAttribute('session.id', sessionId);
          next();
        });

    The attribute lands on "middleware - <anonymous>", becomes a
    dependencies row, and NEVER appears on the requests row. Measured in
    the source project: 1773 request rows, zero with the attribute.
    Splunk is affected identically -- any chart grouping a SERVER-span
    metric by that tag returns nothing, and no amount of MetricSet
    indexing fixes it, because the tag is on the wrong span.

    Fix it at the span, using the incoming-only hook whose return value is
    applied as the server span is created:

        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': {
            startIncomingSpanHook: (request) => sessionAttributes(request.headers),
          },
        }),

    Confirm the option exists in YOUR installed version rather than
    trusting the above:
    node_modules/@opentelemetry/instrumentation-http/build/src/types.d.ts

    The second half of the bug is the `|| crypto.randomUUID()`. A
    generated per-request id is not a session: every healthcheck becomes a
    distinct "user". Measured in the source project: 3 real sessions
    against 307 single-request phantoms, so dcount reported 310. Absent
    means absent -- leave the attribute unset. Also take the first value
    of a repeated header (Node gives an array) and cap the length,
    rejecting rather than truncating, since truncation merges distinct
    sessions. Keep the whole thing a pure function in its own module so it
    is unit testable: instrumentation.js starts the SDK on require and
    cannot be imported by tests, and this regression is invisible to any
    test that mocks the tracer.

18. SEVERAL COMMON COLLECTOR COMPONENT NAMES ARE DEPRECATED ALIASES, AND
    `otelcol validate` DOES NOT FLAG THEM. They still work, but the
    collector logs a warning on startup, so they are invisible unless you
    read the boot log rather than trusting a clean validate. On collector
    0.160: cumulativetodelta -> cumulative_to_delta, resourcedetection ->
    resource_detection, hostmetrics -> host_metrics, spanmetrics ->
    span_metrics.

    Going the OTHER way, and equally counter-intuitive: otlp_http is the
    canonical exporter name and otlphttp is the deprecated alias, not the
    reverse. It looks like a typo. Do not "fix" it.

    Also: OTTL statements in a transform processor's `context: datapoint`
    want the explicit `datapoint.attributes[...]` prefix. The bare
    `attributes[...]` form works, but the collector silently rewrites it
    and logs a warning asking for the prefixed version.

    General lesson worth carrying: `validate` proves the config PARSES.
    Only starting the collector and reading its log proves the config is
    what you meant. Always do both.

19. `Set-Content -Encoding utf8` WRITES A BOM IN POWERSHELL 5.1. If the
    project has an ASCII-only rule for scripts and config, your own
    tooling will break it. In 5.1 `-Encoding utf8` means UTF-8 WITH BOM:
    three bytes (EF BB BF) at the start of every rewritten file,
    invisible in editors and in git diff. It broke this project's tracker
    parser, where a `#` heading preceded by a BOM stopped matching a
    title regex, so a file that existed reported as missing.

        # WRONG in 5.1
        $text | Set-Content file.md -Encoding utf8
        # Correct, version-independent
        [System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($false)))

    PowerShell 7+ defaults to BOM-less UTF-8, so code that is clean on a
    developer's PS7 can corrupt files on a 5.1 host. Detect it in
    whatever check enforces the ASCII rule:
    head -c3 file | od -An -tx1 | grep -q 'ef bb bf'

    A related trap if you drive az from PYTHON on Windows: the CLI is a
    .CMD shim and subprocess cannot exec it by bare name --
    subprocess.run(['az', ...]) fails with WinError 2. Resolve it once
    with shutil.which('az') and use the full path, which is portable
    because which() returns /usr/bin/az on Linux. Capture stderr rather
    than inheriting it, or the CLI's upgrade notices corrupt any
    machine-readable output you print.

20. DO NOT GREP COLLECTOR LOGS FOR "error". The debug exporter at
    verbosity: detailed prints every metric name and attribute value, so a
    healthy collector emits hundreds of lines containing "error"
    (system.network.errors, error_class: Str(-), outcome: Str(error)).
    Measured on the source project: 381 naive matches against ONE real log
    line, which was benign. The advice sends you hunting a problem that is
    not there, and would bury a real one.

    The collector logs tab-delimited records with the LEVEL as the second
    field. Match that field instead:

        docker compose logs otel-collector | awk -F'	' '$2 ~ /^(error|warn|fatal)$/'

    A level histogram makes a better health check than any grep, because it
    shows what normal looks like:

        docker compose logs otel-collector           | awk -F'	' '$2 ~ /^[a-z]+$/ { c[$2]++ } END { for (l in c) print l, c[l] }'

    Note grep -P is unavailable in some locales, so prefer awk -F'	' over
    a Perl-regex tab.

=============================================================
DELIVERABLES
=============================================================

1. Collector config: existing backend untouched, plus azure-only and
   dual sibling files, selected by an env var on the bind mount. All
   pass `otelcol validate`.
2. Compose changes: config selector and the placeholder-defaulted
   connection string.
3. A provisioning script (bash AND PowerShell if the project has both)
   that creates the resource group, Log Analytics workspace and App
   Insights resource idempotently and prints the connection string.
4. A workbook as workbook.json plus Bicep, and a deploy script.
5. Alert rules as Bicep.
6. Setup documentation, including the .env block, ingest verification
   queries and troubleshooting keyed to the traps above.
7. A written comparison of the two backends if this project keeps
   both, stating where each one genuinely wins. That document, not the
   dashboard, is the real deliverable of a backend comparison.

Do not mark any of this complete on the strength of the config
validating. Validation proves the config parses. Only a live run with
real traffic proves a panel is not empty, and an empty panel is the
failure mode that matters.
````
