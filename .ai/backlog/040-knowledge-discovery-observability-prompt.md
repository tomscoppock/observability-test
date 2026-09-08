# 040 -- Apply OTel/Splunk learnings to the Knowledge Discovery agent

Status: backlog
Priority: high
Assignee: @tom
Epic: 025
Theme: otel-instrumentation, llm-observability, splunk-observability
Tags: non-code
Repo: TungstenKnowledgeDiscovery
Stage: assessment

## Description

Carry everything learned in this observability-test spike across to the
full Knowledge Discovery agent, focusing on MCP discoverability, token
consumption, infrastructure monitoring (it also runs SurrealDB), and
APM/latency analysis. The deliverable is the ready-to-paste coding-agent
prompt below, not code in this repo.

## Acceptance criteria

- [ ] Prompt reviewed and adjusted for the Knowledge Discovery repo's
      actual stack (language, service names, MCP servers in use)
- [ ] Prompt run in the Knowledge Discovery repo, in Plan Mode first
- [ ] Resulting plan reviewed before implementation
- [ ] Cross-check that every trap in the prompt's "Non-obvious traps"
      section is explicitly handled, since each one was a silent failure

## Notes

Every code block in the prompt is copied from working, verified code in
this repo, not written from memory. Versions are the ones actually in
`api/package.json` and proven against Splunk on 2026-09-08.

Source material: `api/src/instrumentation.js`, `api/src/logger.js`,
`api/src/llm.js`, `otel-collector-config.yaml`, `docker-compose.yml`,
`scripts/setup-splunk-dashboard.*`, `splunk/dashboard.json`,
`splunk/detectors.json`, `docs/splunk-setup.md` (Sections 22, 25, 26).

If the Knowledge Discovery agent is **Python** rather than Node.js, most
of this still applies, but flag it: Splunk's AI Agent Monitoring has a
documented Python path (`splunk-otel-util-genai`) that is closed to
Node.js, so the scope boundary at the end of the prompt may not apply.

---

## The prompt

Paste the block below into Claude Code, in the Knowledge Discovery repo,
in Plan Mode.

````text
I want to add production-grade OpenTelemetry observability to this
Knowledge Discovery agent, exporting to Splunk. A sister project
(observability-test) already solved this end to end against a real
Splunk org, and I want to apply its working implementation rather than
rediscover it. Every snippet below is from verified working code.

Start in Plan Mode. Read this repo first and tell me what already exists
versus what is missing, and ask me about anything ambiguous before
proposing a plan.

## Priorities, in order

1. **MCP discoverability** -- each MCP server should appear as its own
   node on the Splunk APM service map, with distributed traces crossing
   the HTTP boundary into the MCP server and back, plus per-tool latency
   and error rates.
2. **Token consumption** -- full LLM cost attribution: input/output/total
   tokens by provider, model and operation, good enough to answer "what
   did this feature cost last week".
3. **Infrastructure monitoring** -- host, container and SurrealDB metrics
   in Splunk Infrastructure Monitoring, correlated with APM traces.
4. **APM and latency analysis** -- latency percentiles per internal
   operation (retrieval, embedding, LLM call, MCP tool call), not just
   per HTTP endpoint.

## Architecture

- Upstream `otel/opentelemetry-collector-contrib` image, NOT a vendor
  distribution. Keeps the backend swappable (Splunk now, Azure Monitor or
  Grafana later) with no application changes.
- All config via `.env`, nothing hardcoded.
- Three signals, and they do NOT all go to the same place:

```
  Traces  -> otlp_http/splunk -> Splunk Observability Cloud (APM)
  Metrics -> signalfx         -> Splunk Observability Cloud (Infra Mon)
  Logs    -> splunk_hec       -> Splunk Cloud Platform (via HEC)
```

Logs go to Splunk Cloud Platform because Splunk deprecated native Log
Observer (direct log ingest into Observability Cloud) in January 2024.
Observability Cloud reads them back in place via Log Observer Connect,
which needs a licensed non-trial Splunk platform. Do not build against
`v2/log/otlp`; it is a dead path.

=============================================================
PART 1 -- OpenTelemetry implementation
=============================================================

## 1.1 Dependencies (Node.js; these exact versions are proven)

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

Requires Node >= 20.6.0. These are 0.x packages under caret ranges, so
minor bumps can change APIs silently. See trap 3.

## 1.2 instrumentation.js -- must load BEFORE application code

Start with `node --require ./src/instrumentation.js src/index.js`.

```js
'use strict';
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const sdkOptions = {
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'knowledge-discovery',
    [ATTR_SERVICE_VERSION]: '0.1.0',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }, // too noisy
    }),
  ],
};

if (otlpEndpoint) {
  sdkOptions.traceExporter = new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });

  sdkOptions.metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` }),
    exportIntervalMillis: 15000,
  });

  // CRITICAL: options OBJECT, not positional. See trap 1.
  sdkOptions.logRecordProcessors = [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({ url: `${otlpEndpoint}/v1/logs` }),
    }),
  ];
}

const sdk = new NodeSDK(sdkOptions);
sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
```

## 1.3 Logger -- OTel logs API with automatic trace correlation

Write to stdout AND emit an OTel log record. Attaching the active context
is what puts `trace_id`/`span_id` on the record, which is what makes
trace-to-log correlation possible later.

```js
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const { context, trace } = require('@opentelemetry/api');

function emit(level, message, attributes) {
  process.stdout.write(`${new Date().toISOString()} ${level.text} ${message}\n`);

  const record = {
    severityText: level.text,
    severityNumber: level.number,
    body: message,
    ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
  };

  // Attach active span context so the SDK injects trace_id / span_id
  const activeContext = context.active();
  if (trace.getSpan(activeContext)) {
    record.context = activeContext;
  }

  logs.getLogger('knowledge-discovery', '0.1.0').emit(record);
}
```

Fetch the logger lazily at emit time, not at module load. The logs API
returns a no-op logger if no provider is registered yet, and a cached
no-op never upgrades.

## 1.4 Token consumption instrumentation (priority 2)

Three instruments. The counter exists alongside the histogram because
counters behave more predictably with `data()` in SignalFlow and across
backends.

```js
const { trace, metrics } = require('@opentelemetry/api');

const tracer = trace.getTracer('knowledge-discovery.llm', '0.1.0');
const meter = metrics.getMeter('knowledge-discovery.llm', '0.1.0');

const tokenUsageHistogram = meter.createHistogram('gen_ai.client.token.usage', {
  description: 'Measures number of input and output tokens used',
  unit: '{token}',
});
const tokenCounter = meter.createCounter('gen_ai.client.token.count', {
  description: 'Total number of tokens consumed (counter)',
  unit: '{token}',
});
const responseLengthHistogram = meter.createHistogram('gen_ai.client.response.length', {
  description: 'Character length of LLM responses',
  unit: '{character}',
});
```

Record with a `gen_ai.token.type` dimension so input and output are
separable, and carry provider/model so cost can be sliced:

```js
const metricAttrs = {
  'gen_ai.operation.name': 'chat',
  'gen_ai.provider.name': provider,
  'gen_ai.request.model': model,
  'gen_ai.response.model': data.model || model,
};

tokenUsageHistogram.record(promptTokens,     { ...metricAttrs, 'gen_ai.token.type': 'input'  });
tokenCounter.add(promptTokens,               { ...metricAttrs, 'gen_ai.token.type': 'input'  });
tokenUsageHistogram.record(completionTokens, { ...metricAttrs, 'gen_ai.token.type': 'output' });
tokenCounter.add(completionTokens,           { ...metricAttrs, 'gen_ai.token.type': 'output' });
responseLengthHistogram.record(responseLength, metricAttrs);
```

**Instrument the streaming path too.** It is easy to instrument the
plain call and silently lose all usage data on streamed responses.

Span attributes on the LLM span, set at request time:

```js
'gen_ai.operation.name':      'chat',   // or 'embeddings'
'gen_ai.system':              provider,
'gen_ai.provider.name':       provider,
'gen_ai.request.model':       model,
'gen_ai.request.temperature': temperature,
'gen_ai.request.message_count': messages.length,
'gen_ai.request.input_count':   messages.length,
```

and on response:

```js
'gen_ai.response.model':    data.model || model,
'gen_ai.response.id':       data.id || '',
'gen_ai.usage.input_tokens':  promptTokens,
'gen_ai.usage.output_tokens': completionTokens,
'gen_ai.usage.total_tokens':  promptTokens + completionTokens,
// OpenAI-compatible aliases, some Splunk views look for these
'gen_ai.usage.prompt_tokens':     promptTokens,
'gen_ai.usage.completion_tokens': completionTokens,
// array per the spec
span.setAttribute('gen_ai.response.finish_reasons', finishReasons);
```

## 1.5 MCP instrumentation (priority 1)

HTTP auto-instrumentation on both sides propagates W3C `traceparent`
automatically, so traces span into MCP servers with no manual context
plumbing, provided both ends are instrumented. On outbound MCP calls
also set:

```js
'peer.service':   'playwright-mcp',   // draws the service map edge
'mcp.tool.name':  toolName,           // per-tool breakdown
'mcp.server.url': serverUrl,
```

Record the tool name as a `spanmetrics` dimension (section 1.6) so
per-tool latency and error rate become chartable. Do NOT put tool
arguments or results in attributes; that leaks content.

Networking trap: inside Docker, `localhost` is the container. Use
`host.docker.internal` to reach the host.

## 1.6 Collector config (otel-collector-config.yaml)

```yaml
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 15s
  hostmetrics:
    collection_interval: 15s
    scrapers: { cpu: {}, memory: {}, filesystem: {}, network: {} }

processors:
  batch: { send_batch_size: 512, timeout: 5s }
  # Drop DEBUG/TRACE before export to cut ingest volume
  filter/logs:
    error_mode: ignore
    logs:
      log_record:
        - 'severity_number < SEVERITY_NUMBER_INFO'
  # Sets host.name -- REQUIRED for APM <-> Infrastructure Related Content
  resourcedetection:
    detectors: [env, system]
    system: { hostname_sources: [os] }
    override: false
  resource/splunk:
    attributes:
      - key: deployment.environment
        value: "${OTEL_DEPLOYMENT_ENV}"
        action: upsert

connectors:
  # Splunk's built-in MetricSets only cover SERVER/CONSUMER spans.
  # This is what gives you metrics for INTERNAL/CLIENT spans:
  # LLM calls, DB queries, MCP tool calls. Essential for priority 4.
  spanmetrics:
    histogram:
      explicit:
        buckets: [2ms, 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2s, 5s, 10s, 30s]
      unit: ms
    dimensions:
      - name: gen_ai.operation.name
      - name: gen_ai.provider.name
      - name: gen_ai.request.model
      - name: mcp.tool.name
      - name: deployment.environment
    metrics_flush_interval: 15s

exporters:
  debug: { verbosity: detailed }

  otlp_http/splunk:
    traces_endpoint: "https://ingest.${SPLUNK_REALM}.signalfx.com/v2/trace/otlp"
    headers: { X-SF-Token: "${SPLUNK_ACCESS_TOKEN}" }

  signalfx:
    access_token: "${SPLUNK_ACCESS_TOKEN}"
    realm: "${SPLUNK_REALM}"
    send_otlp_histograms: true      # Splunk drops histograms without this

  splunk_hec/logs:
    token: "${SPLUNK_HEC_TOKEN}"
    endpoint: "${SPLUNK_HEC_URL}"
    index: "${SPLUNK_HEC_INDEX}"
    source: "otel-collector"
    sourcetype: "${SPLUNK_HEC_SOURCETYPE}"
    tls:
      insecure_skip_verify: ${SPLUNK_HEC_INSECURE_SKIP_VERIFY}

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection, batch, resource/splunk]
      exporters: [debug, otlp_http/splunk, spanmetrics]
    metrics:
      receivers: [otlp, docker_stats, hostmetrics, spanmetrics]
      processors: [resourcedetection, batch, resource/splunk]
      exporters: [debug, signalfx]
    logs:
      receivers: [otlp]
      processors: [filter/logs, resourcedetection, batch, resource/splunk]
      exporters: [debug, splunk_hec/logs]
```

## 1.7 docker-compose wiring

App service:

```yaml
  api:
    environment:
      - OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_EXPORTER_OTLP_ENDPOINT:-http://otel-collector:4318}
      - OTEL_SERVICE_NAME=${OTEL_SERVICE_NAME:-knowledge-discovery}
      - OTEL_RESOURCE_ATTRIBUTES=${OTEL_RESOURCE_ATTRIBUTES:-deployment.environment=dev}
      # Splunk drops cumulative histograms; delta is required
      - OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta
      # Surfaces OTel SDK export failures, which are silent by default
      - OTEL_LOG_LEVEL=${OTEL_LOG_LEVEL:-}
```

Collector service:

```yaml
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    user: "0:0"                       # needed to read docker.sock
    command: ["--config", "/etc/otelcol/config.yaml"]
    ports: ["4317:4317", "4318:4318"]
    environment:
      - SPLUNK_ACCESS_TOKEN=${SPLUNK_ACCESS_TOKEN:-}
      - SPLUNK_REALM=${SPLUNK_REALM:-us1}
      # Non-empty defaults on purpose: the splunk_hec exporter rejects an
      # empty endpoint OR token at validation time, which kills the WHOLE
      # collector including traces and metrics. See trap 4.
      - SPLUNK_HEC_URL=${SPLUNK_HEC_URL:-https://localhost:8088/services/collector}
      - SPLUNK_HEC_TOKEN=${SPLUNK_HEC_TOKEN:-hec-token-not-configured}
      - SPLUNK_HEC_INDEX=${SPLUNK_HEC_INDEX:-main}
      - SPLUNK_HEC_SOURCETYPE=${SPLUNK_HEC_SOURCETYPE:-otel}
      - SPLUNK_HEC_INSECURE_SKIP_VERIFY=${SPLUNK_HEC_INSECURE_SKIP_VERIFY:-false}
      - OTEL_DEPLOYMENT_ENV=dev
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol/config.yaml:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

## 1.8 SurrealDB (priority 3)

SurrealDB 3.1+ emits OTLP natively; no application code required:

```yaml
  surrealdb:
    environment:
      - SURREAL_TELEMETRY_PROVIDER=otlp
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317   # gRPC
      - OTEL_SERVICE_NAME=surrealdb
```

This yields `surrealdb.process.*`, `surrealdb.transaction*`,
`surrealdb.http.*`, `surrealdb.rpc.*` and `surrealdb.network.*` metrics
plus traces and logs.

Splunk **Database Monitoring does not support SurrealDB** (only MS SQL
Server, PostgreSQL, Oracle). It appears as an inferred service via
`db.system`. Add these to DB spans for trace-level detail:

```js
'db.system': 'surrealdb',
'db.namespace': ns,
'db.query.text': sanitizedQuery,   // no parameter values
'peer.service': 'surrealdb',       // service map edge
```

=============================================================
PART 2 -- Splunk setup
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

Every one is a silent failure: the system reports itself healthy while
emitting nothing.

1. **`BatchLogRecordProcessor` takes an options object** in sdk-logs
   0.2xx+: `new BatchLogRecordProcessor({ exporter })`. Positional leaves
   `options.exporter` undefined and discards 100% of logs. Invisible
   because `diag` is a no-op, and invisible to tests that mock the logger
   provider. Verify the installed version's signature rather than
   trusting any example, including this one.
2. **Add `OTEL_LOG_LEVEL` passthrough from day one** (default empty). SDK
   export failures are otherwise silent. This is the only reason trap 1
   was ever found.
3. **Pin or review OTel 0.x versions.** Caret ranges on pre-1.0 packages;
   trap 1 was introduced by a caret resolving to a changed constructor.
4. **`splunk_hec` rejects an empty endpoint or token at config validation**,
   stopping the ENTIRE collector including traces and metrics. Use
   non-empty placeholder defaults and run `validate` (section 2.2).
5. **Splunk MetricSets only cover SERVER/CONSUMER spans.** Add the
   `spanmetrics` connector for INTERNAL/CLIENT spans, or priority 4 has
   no data.
6. **Splunk drops cumulative histograms.** Set delta temporality on the
   app and `send_otlp_histograms: true` on the signalfx exporter.
7. **Instrumentation must load before application code** (`--require`).
8. **The access token needs BOTH Ingest and API scopes** (section 2.1).
9. **HEC: leave indexer acknowledgement unchecked** (section 2.1).
10. **The HEC index must be in the token's Allowed Indexes.**
11. **HEC hostnames vary and may not be provisioned** (section 2.1).
12. **Docker Compose prefers shell env over `.env`.** Scripts must not
    export `SPLUNK_*`. A `.env` edit does not reach a running container:
    use `docker compose up -d --force-recreate <service>`.
13. **TMS vs MMS** (section 2.6).

=============================================================
Out of scope -- do not attempt
=============================================================

- **Splunk APM > AI Agent Monitoring.** Documented instrumentation is
  Python-only (`splunk-otel-util-genai`); no Node.js path exists. It also
  expects `invoke_agent`/`invoke_workflow`/`execute_tool` span semantics.
  **If this repo is Python and has real agent/workflow structure, say so:
  it may be reachable, and that changes the plan.**
- **Splunk-side LLM evals** (hallucination, toxicity, relevance). Needs a
  platform licence AND shipping prompt/response content to Splunk. That
  content is PII, so it is a data protection review, not a config toggle.
  Flag it, do not enable it.
- **Log Observer Connect.** Needs a licensed non-trial Splunk platform.

Prefer a local eval harness instead: a golden question set run against
the live agent, checking expected sources and required phrases, plus the
drift detectors in 2.5. That covers regression and drift without sending
a single prompt off the stack.

=============================================================
What I want from you
=============================================================

1. Audit this repo: what exists, what is missing, what conflicts.
2. Ask me about the runtime/language, which MCP servers are in use,
   whether SurrealDB is already emitting OTLP, and whether a Splunk
   platform licence is available.
3. Propose a plan covering the four priorities, stating for each numbered
   trap how it is handled or why it does not apply.
4. Give each priority a verification step that proves data reached
   Splunk, not merely that code runs. "Tests pass" is not evidence for
   telemetry: the sister project had 63 passing tests while emitting zero
   logs for weeks.
````
