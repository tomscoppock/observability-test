# Implementation Playbook: OpenTelemetry to Splunk

Transferable know-how from building this stack, condensed into one place.

Where [opentelemetry.md](opentelemetry.md) and [splunk-setup.md](splunk-setup.md)
document *what this project's configuration is*, this playbook documents
*how to build it again somewhere else, and what will silently break*.

Every snippet here is copied from working, verified code in this
repository. Versions are those in `api/package.json`, proven against a
live Splunk org on 2026-09-08.

> To apply this to another project, see
> `.ai/backlog/040-knowledge-discovery-observability-prompt.md`, which
> wraps this material into a self-contained coding-agent prompt.

## Contents

- [The traps](#the-traps) -- read this first
- [Part 1: OpenTelemetry implementation](#part-1-opentelemetry-implementation)
- [Part 2: Splunk setup](#part-2-splunk-setup)
- [Scope boundaries](#scope-boundaries)

---

## The traps

Every item here is a **silent failure**: the system reports itself
healthy while emitting nothing. Two of them cost most of a day each.
This section is the reason this document exists.

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
