# Prompt 2: Splunk Observability Cloud backend

Points an already-instrumented service at Splunk Observability Cloud (traces
and metrics) and Splunk Cloud Platform (logs), and builds dashboards and
detectors as code.

**Requires prompt 1 first**, or an existing OTel Collector setup. This prompt
adds exporters, dashboards and alerting; it does not instrument anything.

**Copy everything between the fences into your coding agent.**

````text
Add Splunk Observability Cloud as the observability backend for this
project.

Start in PLAN MODE. First confirm the prerequisites, and say plainly if any
are missing rather than working around them:
  - An OTel Collector is running and receiving OTLP from the application
  - Traces, metrics AND logs are all being exported to it
  - You can see telemetry with the debug exporter before any vendor is
    involved

If the project is not instrumented yet, stop and run the OpenTelemetry
instrumentation prompt first. Bolting a vendor onto missing
instrumentation produces empty dashboards and a long debugging session.

ARCHITECTURE, and the bit that surprises people:

  Traces  -> otlp_http/splunk -> Splunk Observability Cloud (APM)
  Metrics -> signalfx         -> Splunk Observability Cloud (Infra Mon)
  Logs    -> splunk_hec       -> Splunk Cloud Platform / Enterprise

Logs go to a DIFFERENT PRODUCT. Splunk deprecated native Log Observer
(direct log ingest into Observability Cloud) in January 2024. Logs must
live in a Splunk Cloud Platform or Enterprise instance, which
Observability Cloud then reads in place via Log Observer Connect rather
than storing a copy. Plan for two destinations, not one.

=============================================================
Splunk setup
=============================================================
## 2.1 Tokens (get this wrong and everything silently fails)

**Observability Cloud access token** -- Settings > Access Tokens. It must
have **BOTH Ingest and API scopes**, because the collector ingests with
it and the dashboard script calls the management API with it. Splunk
shows a warning when you combine them; that is expected, override it.
For API, the `power` role grants dashboard/detector writes.

With API only: scripts work, collector 401s on `/v2/datapoint` and drops
everything. With Ingest only: the reverse.

**HEC token** (Splunk Cloud Platform) -- Settings > Add Data > Monitor >
HTTP Event Collector.
- Sourcetype `_json`, and put your target index in **Allowed Indexes**
- **Leave "Enable indexer acknowledgement" UNCHECKED.** When on, HEC
  requires an `X-Splunk-Request-Channel` header the collector does not
  send, and every request fails with HTTP 400 "Data channel is missing"
- Avoid the `history` index; it is Splunk's internal search-history index

Endpoint format is `https://http-inputs-<stack>.splunkcloud.com/services/collector`
(port 8088 on trials), but that DNS record is not always provisioned. If
it fails to resolve, try the main stack hostname on port 8088. Diagnose
by comparing cert SANs against DNS:

```bash
echo | openssl s_client -connect <stack>.splunkcloud.com:443 \
  -servername <stack>.splunkcloud.com 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
nslookup http-inputs-<stack>.splunkcloud.com
```

If the SANs list the ingest hostname but DNS does not resolve it, that is
a Splunk-side provisioning gap, not your error.

## 2.2 Verify the HEC path before wiring the collector

```bash
curl -s -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Splunk $SPLUNK_HEC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event":"hec connectivity test","sourcetype":"otel","index":"main"}' \
  "$SPLUNK_HEC_URL"
```

`{"text":"Success","code":0}` means good. Otherwise:
`404` wrong host; `400` bad index or ack enabled; `401` bad token;
`403` token disabled or HEC disabled globally.

Validate the collector config before deploying, especially for empty vars:

```bash
docker run --rm -v "$(pwd)/otel-collector-config.yaml:/etc/otelcol/config.yaml:ro" \
  -e SPLUNK_ACCESS_TOKEN=x -e SPLUNK_REALM=us1 -e OTEL_DEPLOYMENT_ENV=dev \
  -e SPLUNK_HEC_URL=https://localhost:8088/services/collector \
  -e SPLUNK_HEC_TOKEN=x -e SPLUNK_HEC_INDEX=main -e SPLUNK_HEC_SOURCETYPE=otel \
  -e SPLUNK_HEC_INSECURE_SKIP_VERIFY=false \
  otel/opentelemetry-collector-contrib:latest validate --config /etc/otelcol/config.yaml
```

## 2.3 Dashboard and detector automation (REST API)

Keep dashboards in version control as JSON and deploy them idempotently.
Do NOT hand-build them in the UI.

| Resource | Endpoint | Methods |
|---|---|---|
| Dashboard group | `https://api.{REALM}.signalfx.com/v2/dashboardgroup` | GET, POST |
| Dashboard | `https://api.{REALM}.signalfx.com/v2/dashboard` | GET, POST, PUT, DELETE |
| Chart | `https://api.{REALM}.signalfx.com/v2/chart` | GET, POST, PUT |
| Detector | `https://api.{REALM}.signalfx.com/v2/detector` | GET, POST, PUT |

All requests need header `X-SF-Token: <SPLUNK_ACCESS_TOKEN>`.

Find-or-create pattern (this is what makes re-runs safe):

```bash
GROUP_ID=$(api_call GET "/v2/dashboardgroup?limit=100" \
  | jq -r --arg n "$GROUP_NAME" '.results[]? | select(.name==$n) | .id' | head -1)
if [ -z "$GROUP_ID" ]; then
  GROUP_ID=$(api_call POST "/v2/dashboardgroup" \
    "$(jq -n --arg n "$GROUP_NAME" '{name:$n}')" | jq -r '.id')
fi
```

Chart type mapping for the API's `options.type`:
`Line`/`Area` -> `TimeSeriesChart` (Area also sets
`defaultPlotType: AreaChart`), `List` -> `List`, `Table` -> `TableChart`,
`SingleValue` -> `SingleValue`.

**Important for any helper script:** read `.env` into LOCAL variables.
Never set process environment variables. Docker Compose gives shell env
precedence over `.env`, so a script that exports `SPLUNK_*` poisons every
later `docker compose up` in that terminal, and `--force-recreate` cannot
fix it. See trap 12.

## 2.4 SignalFlow queries per priority

Note the syntax: percentiles use the named argument `percentile(pct=N)`,
and the working dashboards publish one filtered series per operation
rather than grouping with `by=`. Copy this shape.

Priority 1, MCP tool latency. This is the proven pattern, filtering on
`span.name` where MCP spans are named `mcp.tool.<toolname>`:

```
filter_mcp = filter('service.name', 'playwright-mcp')
A = histogram('traces.span.metrics.duration',
      filter=filter_mcp and filter('span.name', 'mcp.tool.browser_navigate')).percentile(pct=50).publish(label='Navigate')
B = histogram('traces.span.metrics.duration',
      filter=filter_mcp and filter('span.name', 'mcp.tool.browser_get_text')).percentile(pct=50).publish(label='Get Text')
```

If you add an `mcp.tool.name` span attribute AND declare it as a
spanmetrics dimension (section 1.5/1.6), you can group instead of
enumerating, which scales better as tools are added. That grouping is a
suggested improvement, not something proven here, so verify it renders
before committing to it.

Priority 2, tokens by model, and input vs output:

```
A = data('gen_ai.client.token.count',
      filter=filter('gen_ai.token.type','input'), rollup='delta')
      .sum(by=['gen_ai.request.model']).publish('input tokens')

B = data('gen_ai.client.token.count',
      filter=filter('gen_ai.token.type','output'), rollup='delta')
      .sum(by=['gen_ai.request.model']).publish('output tokens')
```

Priority 3, SurrealDB and container health:

```
A = data('surrealdb.process.memory').publish('SurrealDB memory')
B = data('surrealdb.transaction').sum().publish('transactions')
C = data('container.cpu.usage.total').publish('container CPU')
```

Priority 4, latency percentiles per internal operation. One series per
stage of the pipeline, so a single chart shows where time actually goes:

```
filter_ = filter('service.name', 'knowledge-discovery') and filter('deployment.environment', 'dev')
A = histogram('traces.span.metrics.duration',
      filter=filter_ and filter('span.name', 'chat.pipeline')).percentile(pct=50).publish(label='Total Chat')
B = histogram('traces.span.metrics.duration',
      filter=filter_ and filter('span.name', 'db.vectorSearch')).percentile(pct=50).publish(label='Vector Search')
C = histogram('traces.span.metrics.duration',
      filter=filter_ and filter('gen_ai.operation.name', 'chat')).percentile(pct=50).publish(label='LLM Completion')
D = histogram('traces.span.metrics.duration',
      filter=filter_ and filter('gen_ai.operation.name', 'embeddings')).percentile(pct=50).publish(label='Query Embedding')
```

This is the single most useful chart in the sister project: it shows at a
glance whether latency is retrieval, embedding or the model.

Note `histogram('service.request')` covers HTTP endpoints only. The
interesting latency lives in retrieval, embedding, LLM and MCP calls, all
INTERNAL/CLIENT spans, which is why spanmetrics matters.

## 2.5 Drift detectors (no code changes needed)

Compare a short window against a longer baseline using standard
deviations, not a fixed percentage. This exact program is deployed and
working; earlier attempts using the `against_recent` library had to be
rewritten to this `detect`/`when` form, so start here:

```
A = data('gen_ai.client.response.length', filter=filter('service.name', 'knowledge-discovery')).mean(over='5m')
B = data('gen_ai.client.response.length', filter=filter('service.name', 'knowledge-discovery')).mean(over='1h')
C = data('gen_ai.client.response.length', filter=filter('service.name', 'knowledge-discovery')).stddev(over='1h')
detect(when(A > B + C * 3, lasting='5m') or when(A < B - C * 3, lasting='5m')).publish('Response Length Anomaly')
```

The `lasting='5m'` clause is what stops a single outlier request paging
someone. Apply the same shape to `gen_ai.client.token.usage` (filtered to
`gen_ai.token.type='output'`) and to `service.request.duration`.

These need roughly an hour of traffic before the baseline means
anything. Deploy them via `/v2/detector` from JSON alongside the
dashboards, not by hand.

## 2.6 MetricSets: TMS vs MMS

Settings > APM MetricSets. **Troubleshooting MetricSets (TMS)** power Tag
Spotlight. **Monitoring MetricSets (MMS)** power dashboards, alerting and
13-month retention. Indexing a tag as TMS will NOT make it available to
dashboards.

Worth indexing: `gen_ai.operation.name`, `gen_ai.request.model`,
`gen_ai.provider.name`, `mcp.tool.name`, `db.system`.

Dashboards built on spanmetrics do not need MetricSets at all, because
the dimensions arrive as real metric dimensions.

=============================================================
Non-obvious traps -- handle ALL of these explicitly
=============================================================

These are Splunk-specific. The OpenTelemetry instrumentation prompt carries
its own separate trap list; you need both.

1. **`splunk_hec` rejects an empty endpoint or token at config validation**,
   stopping the ENTIRE collector including traces and metrics. Use
   non-empty placeholder defaults and run `validate` (section 2.2).

    GENERALISE THIS: any exporter with a required credential field is a
    whole-collector outage waiting to happen, not just splunk_hec. The
    same bug exists in azure_monitor's connection_string, and in any
    vendor exporter you add later. Give EVERY such field a non-empty
    placeholder default in compose, and run `otelcol validate` before
    starting. An invalid config takes down every signal, not only the one
    whose credentials are missing.

2. **Splunk MetricSets only cover SERVER/CONSUMER spans.** Add the
   `spanmetrics` connector for INTERNAL/CLIENT spans, or priority 4 has
   no data.

3. **Splunk drops cumulative histograms.** Set delta temporality on the
   app and `send_otlp_histograms: true` on the signalfx exporter.

4. **The access token needs BOTH Ingest and API scopes** (section 2.1).

5. **HEC: leave indexer acknowledgement unchecked** (section 2.1).

6. **The HEC index must be in the token's Allowed Indexes.**

7. **HEC hostnames vary and may not be provisioned** (section 2.1).

8. **TMS vs MMS** (section 2.6).

9. **APM MetricSets have NO public API, so design around them.**
    Dashboards, charts and detectors are fully automatable via
    `/v2/dashboard`, `/v2/chart` and `/v2/detector`. MetricSets are not:
    creating a Troubleshooting or Monitoring MetricSet is a UI-only
    operation (Settings > APM & RUM MetricSets), with no documented REST
    endpoint and no Terraform resource. This blocks more than it looks
    like, because a Monitoring MetricSet dimension is what lets a chart
    GROUP `service.request` by a span tag. "Index the tag" therefore
    becomes a manual click-path that cannot be committed or reproduced in
    another org.

    Design around it with the `span_metrics` connector, whose dimensions
    arrive as real metric dimensions needing no indexing:

        span_metrics:
          dimensions:
            - name: gen_ai.operation.name
            - name: session.id      # read the cardinality note below

    CARDINALITY, stated precisely rather than hand-waved. Every dimension
    multiplies the metric time series count, so a high-cardinality
    identifier is dangerous. Two things bound it, both verified by sending
    spans through a probe collector:
      - A span that LACKS the attribute has the dimension omitted from its
        datapoint entirely, not set to empty. So confining an attribute to
        the server span leaves child spans free.
      - If the app never fabricates the value (trap 15), unheadered traffic
        such as healthchecks adds no series at all.
    Practical cost is roughly (distinct endpoints) x (distinct values).
    Tens of series for a demo; a bill for a service with 10k concurrent
    sessions. If you need distinct-count over a high-cardinality identifier
    at scale, ask a log-based backend, not a dimensional-metrics one.

10. **`service.request` IS IN NANOSECONDS, AND IT DOUBLE-COUNTS.** Two
    independent traps in one metric, each producing a plausible-looking
    dashboard that is quietly wrong.

    UNITS: service.request is nanoseconds, while the spanmetrics connector's
    traces.span.metrics.duration is MILLISECONDS because you set unit: ms in
    its config. One dashboard can therefore show ns on one tab and ms on
    another, both labelled "Latency". Sanity-check against a known value: a
    P50 of 940,000 for an endpoint you know is sub-millisecond is the tell.

    DOUBLE COUNTING: service.request emits TWO MetricSets -- an
    endpoint-level one carrying sf_dimensionalized='true', and a
    service-level one where the property is ABSENT. Both match a filter that
    does not mention it, so .count().sum() counts every request twice.
    Measured on the source project over one 10-minute window: 132
    unfiltered, 66 filtered, 58 in a second backend for the same traffic.

        A = histogram('service.request',
              filter=filter('sf_service', 'my-service')
                 and filter('sf_environment', 'dev')
                 and filter('sf_dimensionalized', 'true')
            ).count().sum().publish(label='requests')

    Note filter('sf_dimensionalized', 'false') returns ZERO -- the
    service-level series lacks the property rather than setting it false, so
    you cannot select the other half by negating.

    What makes it nasty is which charts survive. RATIOS ARE IMMUNE, because
    numerator and denominator both double, so an error-rate chart looks
    perfect while the request-count chart beside it is 2x. Percentiles are
    immune too. Only counts are wrong, so a dashboard can be 80% right and
    give no hint. This was a live defect across eight charts in the source
    project, invisible until a second backend sat next to it.

11. **SignalFlow is reachable over PLAIN HTTP -- no websocket client.** The
    assumption that it needs a streaming client is what stops people
    automating Splunk reads, and it is wrong. You can read dashboard numbers
    programmatically for regression checks or backend comparisons:

        POST https://stream.${REALM}.signalfx.com/v2/signalflow/execute
             ?start=${START_MS}&stop=${STOP_MS}&immediate=true&resolution=60000
        X-SF-Token: ${TOKEN}
        Accept: text/event-stream
        {"programText": "A = data('cpu.utilization').mean().publish(label='v')"}

    Four details that each cost a round of trial and error:
      - Accept MUST be text/event-stream (or absent, or */*). Sending
        application/json returns a bare HTTP 406 with no explanation.
      - immediate=true with a bounded start/stop is what makes it TERMINATE.
        Without it the response stays open waiting for future data, which is
        the behaviour mistaken for needing a websocket.
      - The response is SSE: blocks separated by a blank line, each with an
        "event:" type and a "data:" JSON payload. Join on tsId -- "metadata"
        maps tsId to properties including sf_streamLabel (your publish label),
        and "data" carries {"data":[{"tsId":...,"value":...}]}.
      - resolution is honoured, but asking for one window-wide bucket
        produced a boundary artefact (a spurious 1.44e9 point). Prefer a
        normal resolution and aggregate yourself: SUM counters, but take the
        MEDIAN of per-interval percentiles, never the mean (see trap 15's
        reasoning about collapsing statistics).


23. **CAPTURE PROMPT/RESPONSE CONTENT BEHIND AN EXPLICIT FLAG, OFF BY
    DEFAULT.** Splunk's AI Agent Monitoring (APM > AI trace data, AI
    Interactions) and its platform-side evaluations have nothing to show
    without prompt and response CONTENT on the spans. Content capture is
    off by default in OpenTelemetry, deliberately: prompts routinely carry
    names, account numbers and proprietary business logic.

    Do NOT conclude the AI screens are licence-blocked. The vendor docs
    state no licence requirement for AI trace data -- that was an
    assumption in the source project and it was wrong. What they DO
    require:

      - spans filtered by gen_ai.operation.name (you already emit this)
      - OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta
      - send_otlp_histograms: true on the signalfx exporter
      - OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY
      - the LLM Providers integration, but ONLY for platform-side
        evaluation scores, not for AI trace data. It is configured under
        Data Management > Available integrations, it is self-service
        rather than an entitlement, and Splunk calls the provider with
        your credentials to score the captured content. Until it is
        configured the AI Details panel reads "Status: not evaluated",
        which is an unconfigured integration and not an error.

    THE TRAP: OTEL_INSTRUMENTATION_GENAI_* is read by GenAI
    AUTO-instrumentation libraries, which exist for Python. If you
    instrument LLM calls by hand, as most non-Python services do, setting
    the variable does NOTHING. You must emit the attributes yourself. This
    is very likely why the source project first concluded "Python-only":
    the documentation is Python-shaped, but the requirement is span
    attributes, and any language can emit those.

    Honour the standard variable name anyway, so the config still works if
    the service is ever re-platformed onto a runtime with
    auto-instrumentation:

        const CAPTURE = 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT';
        const ON = new Set(['span_only', 'true', '1', 'span_and_event']);
        function enabled(env) {
          const v = (env || process.env)[CAPTURE];
          return typeof v === 'string' && ON.has(v.trim().toLowerCase());
        }
    THE SECOND TRAP, and this one takes the vendor's UI down. The content
    attributes have a NORMATIVE JSON schema. The conventions say
    instrumentations MUST follow it, and Splunk's AI Interactions view
    calls JSON.parse on the attribute and maps over the result. Putting the
    raw answer text on the span gives you this, in the browser console, on
    a page that will not render:

        SyntaxError: Unexpected token 'A', "According "... is not valid JSON
            at JSON.parse (<anonymous>)
            at Array.map (<anonymous>)

    "According " is the first word of the model's own answer. Ingest
    succeeded, the collector was clean, the span was stored, the tests
    passed. Only opening the trace in a browser found it.

    The schema is an ARRAY of messages, each { role, parts }, each text
    part { type, content }:

        function textMessage(role, content) {
          return { role, parts: [{ type: 'text', content }] };
        }
        // when enabled:
        span.setAttribute('gen_ai.input.messages', JSON.stringify(
          messages.map((m) => textMessage(m.role, m.content))));
        span.setAttribute('gen_ai.output.messages', JSON.stringify(
          [textMessage('assistant', responseText)]));

    Note "parts", NOT "content", on the message object. The OpenAI wire
    format [{role, content}] is valid JSON and still wrong: it parses, so
    nothing crashes and nothing displays. That is the harder failure of the
    two, because there is no error to search for.

    Six design points, each of which cost something to learn:

      - OFF BY DEFAULT, and make the test suite assert that FIRST. Unset,
        empty, "false" and unrecognised values must all disable it.
      - Honour SPAN_ONLY. Do NOT honour EVENT_ONLY as a span attribute:
        it asks for content as separate log events, so writing it to a
        span puts content somewhere the operator did not ask for it.
      - Serialise to a JSON STRING, never a structured value. Array and
        object attributes are dropped outright by some exporters (see the
        array-attribute trap).
      - CAP THE LENGTH and flag truncation. Splunk warns about oversized
        values, and an unbounded attribute is a billing risk on any
        ingest-priced backend. Truncate content, unlike identifiers, where
        truncation would merge distinct values.
      - TRUNCATE INSIDE THE STRUCTURE. The conventions require preserving
        JSON structure when clipping. Budget the text within the parts and
        serialise afterwards. Slicing the serialised document yields
        invalid JSON and reintroduces the crash above, but only for long
        conversations, which is the worst possible time to find out.
      - Set gen_ai.response.finish_reasons as its own attribute. The
        schema has a finish_reason field on the output message, but it is
        marked deprecated in favour of the attribute.
      - Keep it in its own pure module so it is unit testable. The
        instrumentation bootstrap usually cannot be imported by tests.

    The flag is what makes the same image safe in production and useful on
    a test system: identical config shape, different value. If you enable
    it anywhere real, mask PII first -- the vendor documentation recommends
    exactly that.

=============================================================
What I want from you
=============================================================

1. Audit what exists: collector config, exporters, existing dashboards.
2. Propose a plan covering exporters, dashboards-as-code and detectors,
   stating for each trap above how you are handling it.
3. Give each deliverable a verification step that proves data reached
   Splunk, not merely that the config parses. An empty chart is the
   failure mode that matters, and `otelcol validate` will not catch it.
````
