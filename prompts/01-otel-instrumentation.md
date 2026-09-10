# Prompt 1: OpenTelemetry instrumentation (backend-agnostic)

Instruments a Node.js service with OpenTelemetry and gets telemetry into an
OTel Collector. **Says nothing about where the telemetry goes** -- pair it
with prompt 2 (Splunk) or prompt 3 (Azure Monitor), or both.

Use this alone if you only want vendor-neutral instrumentation and will
decide on a backend later. That is a legitimate and recommended order: the
instrumentation is the durable asset, the backend is a config file.

**Copy everything between the fences into your coding agent.**

````text
Instrument this project with OpenTelemetry.

Start in PLAN MODE. Before proposing anything:
  1. Read the repo and report what already exists: is there an OTel
     Collector? Which SDK and version? Are traces, metrics AND logs all
     exported, or only some?
  2. Report what is missing against the requirements below.
  3. Ask me about the runtime/language, which MCP servers are in use, and
     anything else ambiguous. Do not guess, and do not start writing code
     until I approve a plan.

This prompt deliberately does NOT choose an observability backend. Export
OTLP to a collector and stop there. A backend is a collector config change,
and keeping that decision out of the application is the entire point.

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
OpenTelemetry implementation
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
const { sessionAttributes } = require('./session-attributes'); // see 1.2b

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const sdkOptions = {
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'knowledge-discovery',
    [ATTR_SERVICE_VERSION]: '0.1.0',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }, // too noisy

      // Request-scoped attributes MUST be stamped on the SERVER span, and
      // this is the hook that guarantees it: incoming-only, and its return
      // value is applied as the server span is created. See trap 14 -- do
      // NOT do this from Express middleware with trace.getActiveSpan().
      '@opentelemetry/instrumentation-http': {
        startIncomingSpanHook: (request) => sessionAttributes(request.headers),
      },
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

## 1.2b Request-scoped attributes (session id, tenant, user) -- get this right

Any attribute you want to slice dashboards by has to be on the **HTTP SERVER
span**, because that is the span every backend turns into its request record
(App Insights `requests`, Splunk's `service.request` metric). Put it anywhere
else and the charts are silently empty.

Keep the derivation in its own pure module, so it can be unit tested --
instrumentation.js starts the SDK on require and cannot be imported by tests:

```js
// src/session-attributes.js
'use strict';

const SESSION_ID_HEADER = 'x-session-id';   // Node lower-cases header names
const ATTR_SESSION_ID = 'session.id';       // OTel semantic convention
const MAX_SESSION_ID_LENGTH = 200;

function sessionAttributes(headers) {
  if (!headers) return {};
  // A repeated header arrives as an array; take the first value.
  const raw = headers[SESSION_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return {};
  const sessionId = value.trim();
  // Reject rather than truncate: truncating merges distinct sessions.
  // This is attacker-influenced input that lands in the telemetry backend
  // and, once indexed as a metric dimension, its cardinality budget.
  if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) return {};
  return { [ATTR_SESSION_ID]: sessionId };
}

module.exports = { sessionAttributes, SESSION_ID_HEADER, ATTR_SESSION_ID, MAX_SESSION_ID_LENGTH };
```

Two rules that both cost real debugging time to learn (traps 14 and 15):

1. **Never set it from Express middleware via `trace.getActiveSpan()`.** That
   returns the middleware layer's own INTERNAL span, not the request.
2. **Never invent the value when the header is absent.** A generated
   per-request id is not a session, and it makes every healthcheck look like
   a distinct user.

Verify it landed in the right place before building any chart on it:

```
# Splunk (Trace Analyzer): the tag must be present on the SERVER span,
# not only on a child span. Then index it as a Monitoring MetricSet
# dimension -- see section 2.6 -- or dashboards still cannot group by it.

# App Insights equivalent, if you also run that backend:
requests | extend s = tostring(customDimensions['session.id'])
| summarize total = count(), withSession = countif(isnotempty(s))
```

`withSession` should equal the number of requests that actually carried the
header, and no more.

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
  resource_detection:
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
      processors: [resource_detection, batch, resource/splunk]
      exporters: [debug, otlp_http/splunk, spanmetrics]
    metrics:
      receivers: [otlp, docker_stats, hostmetrics, spanmetrics]
      processors: [resource_detection, batch, resource/splunk]
      exporters: [debug, signalfx]
    logs:
      receivers: [otlp]
      processors: [filter/logs, resource_detection, batch, resource/splunk]
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
Non-obvious traps -- handle ALL of these explicitly
=============================================================

Every one of these was found the hard way in the source project. Most are
SILENT: the system reports itself healthy while emitting nothing.

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

4. **Instrumentation must load before application code** (`--require`).

5. **Docker Compose prefers shell env over `.env`.** Scripts must not
    export `SPLUNK_*`. A `.env` edit does not reach a running container:
    use `docker compose up -d --force-recreate <service>`.

6. **`trace.getActiveSpan()` in Express middleware is NOT the server span.**
    With `@opentelemetry/instrumentation-express` active, each middleware
    layer gets its own INTERNAL span, and that is what is active inside your
    handler. So an attribute set there lands on `middleware - <anonymous>`
    and never reaches the SERVER span. **Every chart that groups a
    SERVER-span metric by that tag then returns nothing, and no amount of
    MetricSet indexing fixes it** -- the tag is on the wrong span, so
    indexing it changes nothing. Measured in the source project: 1773
    request records, zero carrying the attribute; 382 middleware spans
    carrying it. Use the http instrumentation's `startIncomingSpanHook`
    instead (section 1.2b), and confirm the option exists in your installed
    version:
    `node_modules/@opentelemetry/instrumentation-http/build/src/types.d.ts`.

7. **Never invent a request-scoped id when the client did not send one.**
    `req.headers['x-session-id'] || crypto.randomUUID()` looks harmless and
    poisons every distinct-count: each healthcheck and upstream probe becomes
    a separate "session". Measured in the source project: 3 real sessions
    against 307 single-request phantoms, so `dcount` reported 310. Absent
    means absent -- leave the attribute unset. Also handle the repeated
    header (Node gives an array) and cap the length, rejecting rather than
    truncating, since truncation silently merges distinct sessions.

8. **Collector component names: several common ones are deprecated
    aliases.** They still work, but the collector logs a warning on startup
    and `otelcol validate` does NOT flag them, so they are invisible unless
    you read the boot log. On collector 0.160: `cumulativetodelta` ->
    `cumulative_to_delta`, `resourcedetection` -> `resource_detection`,
    `hostmetrics` -> `host_metrics`, `spanmetrics` -> `span_metrics`.
    Going the OTHER way and equally counter-intuitive: **`otlp_http` is the
    canonical exporter name and `otlphttp` is the deprecated alias**, not
    the reverse. It looks like a typo. Do not "fix" it.

    Also, OTTL statements in a `transform` processor's `context: datapoint`
    want the explicit `datapoint.attributes[...]` prefix. The bare
    `attributes[...]` form works but the collector rewrites it and warns.

9. **In PowerShell, a failing CLI probe aborts the whole setup script.**
    If you ship bash/PowerShell script pairs, know that Windows PowerShell
    5.1 wraps a native command's stderr in an ErrorRecord, so under
    `$ErrorActionPreference = 'Stop'` any CLI call that writes to stderr
    becomes a TERMINATING error. A "does this resource exist yet?" probe
    therefore aborts the script on the very first run, and the error message
    blames the missing resource rather than the redirect. Bash is unaffected
    (a failing command in an `if` condition does not trigger errexit), which
    is exactly how such a pair passes review with only the bash half
    working. Route every CLI call through a helper that sets
    `$ErrorActionPreference = 'Continue'` for the duration and returns the
    exit code, and prefer commands that do not error on "absent".

10. **`Set-Content -Encoding utf8` writes a BOM in PowerShell 5.1.** If the
    project has an ASCII-only rule for scripts and config, your own tooling
    will break it. In 5.1 `-Encoding utf8` means UTF-8 WITH BOM, so three
    bytes (EF BB BF) land at the start of every rewritten file. It is
    invisible in editors and in `git diff`. It broke this project's tracker:
    a `#` heading preceded by a BOM stopped matching a title regex, so a
    file that existed reported as missing.

        # WRONG in 5.1
        $text | Set-Content file.md -Encoding utf8
        # Correct, and version-independent
        [System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($false)))

    PowerShell 7+ defaults to BOM-less UTF-8, so code that is clean on a
    developer's PS7 can still corrupt files on a 5.1 host. Detect it in
    whatever check enforces the ASCII rule:
    `head -c3 file | od -An -tx1 | grep -q 'ef bb bf'`

11. DO NOT GREP COLLECTOR LOGS FOR "error". The debug exporter at
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


12. **ARRAY SPAN ATTRIBUTES ARE SILENTLY DROPPED BY SOME EXPORTERS.**
    The OpenTelemetry GenAI spec defines gen_ai.response.finish_reasons as
    an ARRAY. Emit it -- and also emit a scalar companion, because array
    attributes do not survive every backend.

    Measured in the source project: the collector received the attribute
    perfectly...

        -> gen_ai.response.finish_reasons: Slice(["stop"])

    ...and 254 chat spans reached the backend carrying ZERO of them. The
    azure_monitor exporter maps an attribute to customDimensions only when
    it is a string or boolean, and to customMeasurements when it is a
    number. An array is neither, so it is dropped in transit. No query
    recovers it, because the data never arrives.

        const reasons = choices.map((c) => c.finish_reason || 'unknown');
        span.setAttribute('gen_ai.response.finish_reasons', reasons);
        span.setAttribute('gen_ai.response.finish_reason', reasons.join(','));

    Three things to generalise:

      - AUDIT EVERY ARRAY-VALUED ATTRIBUTE YOU SET. This one surfaced only
        because a demo script told a presenter to point at it, live.
        Anything array-shaped is presumed missing until seen in the backend.
      - VERIFY AT THE DESTINATION, NOT THE COLLECTOR. The debug exporter
        showed it correctly. Everything upstream of the vendor was fine,
        which is exactly what lets this class of bug survive review.
      - EMITTING THE STANDARD IS NOT THE SAME AS THE STANDARD BEING USABLE.
        Where spec compliance and backend compatibility conflict, satisfy
        both rather than picking one.

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
