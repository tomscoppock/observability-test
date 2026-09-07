# OpenTelemetry

## Overview

This project uses OpenTelemetry (OTel) to collect and export traces,
metrics, and logs from the Node.js API. The telemetry pipeline has two
parts:

1. **OTel SDK** (in the API) -- instruments the application code
2. **OTel Collector** (separate container) -- receives, processes, and
   exports telemetry to backends

## SDK setup

The OTel SDK is initialised in `api/src/instrumentation.js`. It loads
before any application code via the `--require` flag:

```
node --require ./src/instrumentation.js src/index.js
```

This ensures all libraries (Express, HTTP, etc.) are patched by the
auto-instrumentations before they are imported by the application.

### What gets instrumented automatically

The `@opentelemetry/auto-instrumentations-node` meta-package includes
instrumentations for:

- HTTP client and server (incoming/outgoing requests)
- Express routes and middleware
- DNS lookups
- And many more (see [full list](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/metapackages/auto-instrumentations-node))

The `fs` instrumentation is disabled (too noisy for a learning project).

### Exporters

When `OTEL_EXPORTER_OTLP_ENDPOINT` is set (default in Docker:
`http://otel-collector:4318`), the SDK exports via OTLP HTTP:

- Traces: `{endpoint}/v1/traces`
- Metrics: `{endpoint}/v1/metrics` (every 15 seconds)
- Logs: `{endpoint}/v1/logs` (batched)

When the endpoint is not set (local dev without collector), the SDK
falls back to console/noop -- no errors, just no export.

## Collector configuration

The collector config lives at `otel-collector-config.yaml` in the
project root. It is mounted into the container at
`/etc/otelcol/config.yaml`.

### Current config

The collector uses three separate exporters for Splunk, one per signal
type, plus the debug exporter for local troubleshooting. The
**spanmetrics connector** bridges the traces and metrics pipelines,
generating duration and call-count metrics from all spans.

| Signal | Exporter | Splunk destination |
|---|---|---|
| **Traces** | `otlp_http/splunk` | Splunk APM (`/v2/trace/otlp`) |
| **Traces** | `spanmetrics` (connector) | Metrics pipeline (generates `duration` + `calls`) |
| **Metrics** | `signalfx` | Splunk Infrastructure Monitoring |
| **Logs** | `otlp_http/splunk_logs` | Splunk Log Observer (`/v2/log/otlp`) |
| **All** | `debug` | Collector stdout (always on) |

**Receivers:**

| Receiver | Signal | Purpose |
|---|---|---|
| `otlp` (gRPC + HTTP) | Traces, Metrics, Logs | App telemetry from Node.js API and SurrealDB |
| `docker_stats` | Metrics | Container CPU/memory/network via Docker socket |
| `hostmetrics` | Metrics | Host-level CPU, memory, filesystem, network |
| `spanmetrics` (connector) | Metrics | RED metrics derived from trace spans |

**Processors:**

| Processor | Pipelines | Purpose |
|---|---|---|
| `gen_ai_normalizer` | Traces | Normalise OpenLLMetry spans to gen_ai.* semconv |
| `filter/logs` | Logs | Drop DEBUG/TRACE log records (severity < INFO) to reduce Splunk ingest |
| `resourcedetection` | All | Set `host.name` for Splunk Related Content correlation |
| `batch` | All | Batch telemetry for efficient export |
| `resource/splunk` | All | Add `deployment.environment` resource attribute |

### Spanmetrics connector

The `spanmetrics` connector generates RED (Request/Error/Duration)
metrics from trace spans. Unlike Splunk's built-in MMS (which only
covers `SERVER`/`CONSUMER` spans), the connector processes ALL spans
including `INTERNAL` and `CLIENT` -- making custom span latency
available in dashboard charts.

**Metrics generated:**

| Metric | Type | Description |
|---|---|---|
| `traces.span.metrics.duration` | Histogram | Span duration in milliseconds |
| `traces.span.metrics.calls` | Counter | Number of span invocations |

**Dimensions (available as SignalFlow filters):**

| Dimension | Source | Example |
|---|---|---|
| `service.name` | Resource attribute | `rag-api` |
| `span.name` | Span name | `chat.pipeline`, `db.vectorSearch` |
| `span.kind` | Span kind | `SPAN_KIND_INTERNAL`, `SPAN_KIND_CLIENT` |
| `status.code` | Span status | `STATUS_CODE_OK`, `STATUS_CODE_ERROR` |
| `deployment.environment` | Resource attribute | `dev` |
| `gen_ai.operation.name` | Span attribute (custom dimension) | `chat`, `embeddings` |

**SignalFlow examples:**

```signalflow
# Chat pipeline latency (P50)
A = histogram('traces.span.metrics.duration', filter=filter('service.name', 'rag-api') and filter('span.name', 'chat.pipeline')).percentile(pct=50).publish(label='P50')

# LLM call latency by gen_ai operation
A = histogram('traces.span.metrics.duration', filter=filter('service.name', 'rag-api') and filter('gen_ai.operation.name', 'chat')).percentile(pct=50).publish(label='LLM P50')

# DB operation call counts
A = data('traces.span.metrics.calls', filter=filter('service.name', 'rag-api') and filter('span.name', 'db.vectorSearch')).sum().publish(label='Vector Searches')
```

The signalfx exporter must have `send_otlp_histograms: true` to
forward the `traces.span.metrics.duration` histogram to Splunk. This is
already configured. The default namespace prefix is `traces.span.metrics`.

### Required environment variables

Set these in your `.env` file (see `.env.example`):

| Variable | Example | Description |
|---|---|---|
| `SPLUNK_ACCESS_TOKEN` | `abc123...` | Splunk Observability Cloud ingest token |
| `SPLUNK_REALM` | `us1` | Your Splunk realm (us0, us1, eu0, etc.) |

The collector config derives all endpoints from `SPLUNK_REALM`:
- Traces: `https://ingest.{realm}.signalfx.com/v2/trace/otlp`
- Metrics: auto-derived by the signalfx exporter
- Logs: `https://ingest.{realm}.signalfx.com`

### Viewing telemetry locally

The debug exporter prints all telemetry to the collector's stdout:

```bash
docker compose logs -f otel-collector
```

See [Docker Commands > Viewing OTel Telemetry](docker-commands.md#viewing-otel-telemetry)
for filtering commands.

### Verifying Splunk export

After setting `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` in `.env`:

1. Restart the collector: `docker compose up -d --force-recreate otel-collector`
2. Check for export errors: `docker compose logs otel-collector | findstr "error"`
3. Open Splunk Observability Cloud -> APM -> look for service `rag-api`
4. Check Infrastructure Monitoring for metrics from `rag-api`

### Adding Azure Monitor exporter (future)

```yaml
exporters:
  azuremonitor:
    connection_string: "${APPLICATIONINSIGHTS_CONNECTION_STRING}"
```

## Package versions

The project uses OTel JS SDK 2.x (stable API, experimental SDK):

| Package | Version range | Notes |
|---|---|---|
| `@opentelemetry/api` | ^1.9.0 | Stable API |
| `@opentelemetry/sdk-node` | ^0.200.0 | Experimental SDK |
| `@opentelemetry/auto-instrumentations-node` | ^0.56.0 | Meta-package |
| `@opentelemetry/exporter-trace-otlp-http` | ^0.200.0 | OTLP trace exporter |
| `@opentelemetry/exporter-metrics-otlp-http` | ^0.200.0 | OTLP metrics exporter |
| `@opentelemetry/exporter-logs-otlp-http` | ^0.200.0 | OTLP logs exporter |
| `@opentelemetry/sdk-metrics` | ^2.0.0 | Metrics SDK |
| `@opentelemetry/sdk-logs` | ^0.200.0 | Logs SDK |
| `@opentelemetry/resources` | ^2.0.0 | Resource detection |
| `@opentelemetry/semantic-conventions` | ^1.28.0 | Attribute constants |

## gen_ai semantic conventions (Task 018)

The API instruments all LLM and embedding calls with spans and metrics
that follow the [gen_ai semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai)
-- the official OTel standard for generative AI observability.

### Span naming and kind

Span names follow the `{operation} {model}` pattern required by the spec:

| Module | Span name example | SpanKind |
|---|---|---|
| `llm.js` | `chat gpt-4o-mini` | `CLIENT` |
| `embeddings.js` | `embeddings text-embedding-3-small` | `CLIENT` |

`SpanKind.CLIENT` is used because the API acts as a client calling an
external LLM/embedding service.

### Span attributes

Both modules set the following attributes on every span:

| Attribute | Type | Example | Notes |
|---|---|---|---|
| `gen_ai.operation.name` | string | `chat` / `embeddings` | Operation type |
| `gen_ai.system` | string | `openai` | Legacy; kept for backward compat |
| `gen_ai.provider.name` | string | `openai` | New semconv field (from `LLM_PROVIDER` env) |
| `gen_ai.request.model` | string | `gpt-4o-mini` | Requested model |
| `gen_ai.response.model` | string | `gpt-4o-mini-2024-07-18` | Actual model returned by API |
| `gen_ai.request.temperature` | float | `0.3` | Chat only |
| `gen_ai.request.message_count` | int | `3` | Chat only -- number of messages sent |
| `gen_ai.request.input_count` | int | `5` | Embeddings only -- number of texts |
| `gen_ai.response.id` | string | `chatcmpl-abc123` | Chat only -- completion ID |
| `gen_ai.response.finish_reasons` | string[] | `["stop"]` | Chat only -- array per spec |
| `gen_ai.response.dimensions` | int | `1536` | Embeddings only |
| `gen_ai.usage.input_tokens` | int | `150` | Prompt / input tokens |
| `gen_ai.usage.output_tokens` | int | `42` | Chat only -- completion tokens |
| `gen_ai.usage.total_tokens` | int | `192` | Embeddings only (when available) |
| `server.address` | string | `api.openai.com` | Target host |
| `server.port` | int | `443` | Target port |
| `error.type` | string | `Error` | Set on errors only |

### Token usage metrics

Both modules record token usage as OTel histogram metrics via
`gen_ai.client.token.usage` (unit: `{token}`). This enables dashboards
and alerts on token consumption without querying span data.

| Metric | Dimensions | Recorded by |
|---|---|---|
| `gen_ai.client.token.usage` | `gen_ai.token.type=input` | `llm.js`, `embeddings.js` |
| `gen_ai.client.token.usage` | `gen_ai.token.type=output` | `llm.js` only |

Each metric data point carries these attributes:

- `gen_ai.operation.name` -- `chat` or `embeddings`
- `gen_ai.provider.name` -- e.g. `openai`
- `gen_ai.request.model` -- requested model name
- `gen_ai.response.model` -- actual model returned
- `gen_ai.token.type` -- `input` or `output`

The metrics are exported via the same OTLP pipeline as other application
metrics (every 15 seconds to the OTel Collector).

> **SignalFlow note:** Because `gen_ai.client.token.usage` is an OTel
> **histogram**, it must be queried with `histogram()` in SignalFlow --
> not `data()`. The signalfx exporter sends histograms in OTLP format
> when `send_otlp_histograms: true` is set. Example:
> `histogram('gen_ai.client.token.usage', filter=filter('gen_ai.token.type', 'input')).sum().publish(label='Input Tokens')`
>
> **Temporality:** Splunk Observability Cloud requires **delta**
> aggregation temporality for histogram metrics. The OTel SDK defaults
> to cumulative, which Splunk drops silently. Set
> `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` on the
> application container (see `docker-compose.yml`).

### Error handling

On failure, spans are marked with status code `ERROR` and include:

- `error.type` attribute (e.g. `TypeError`, `Error`)
- Exception recorded via `span.recordException(err)`
- Error message in span status

### Verifying gen_ai spans

After a chat request, check the collector debug output:

```bash
docker compose logs otel-collector | findstr "gen_ai"
```

In Splunk APM, filter traces by `gen_ai.operation.name = chat` or look
for spans named `chat gpt-4o-mini`.

For token metrics, check Infrastructure Monitoring for the
`gen_ai.client.token.usage` histogram.

## gen_ai normalizer processor (Task 017)

The `gen_ai.*` attributes are the official OTel semantic conventions for
LLM observability. The normalizer processor in the OTel Collector is
configured to convert proprietary attribute names from auto-instrumentation
SDKs (e.g. Traceloop/OpenLLMetry `traceloop.entity.*`, `llm.*`) to the
standard `gen_ai.*` format before export.

### Configuration

The processor is defined in `otel-collector-config.yaml`:

```yaml
processors:
  gen_ai_normalizer:
    sources:
      - name: openllmetry
```

It runs in the **traces pipeline only**, before `batch` and
`resource/splunk`:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [gen_ai_normalizer, batch, resource/splunk]
      exporters: [debug, otlp_http/splunk]
```

### Built-in sources

The processor ships with two built-in source mappings that require no
custom configuration:

| Source | SDK | Attribute prefix |
|---|---|---|
| `openllmetry` | Traceloop / OpenLLMetry | `traceloop.*`, `llm.*` |
| `openinference` | Arize / OpenInference | `openinference.*` |

Custom sources can be added with explicit `mappings` if needed.

### Current status

The processor is configured and running in the pipeline. However, the API
currently uses **manual OTel instrumentation** (custom spans via
`tracer.startActiveSpan()` in `llm.js` and `embeddings.js`) rather than
the Traceloop OpenLLMetry SDK. Since the API calls LLM/embedding APIs via
raw `fetch()` (not the OpenAI Node.js SDK), the Traceloop SDK has nothing
to auto-instrument, so the processor is currently a **safe no-op**.

To activate normalisation, a future task would switch from raw `fetch()`
to the official OpenAI Node.js SDK and add `@traceloop/node-server-sdk`
for auto-instrumentation. The normaliser would then convert all
Traceloop-emitted spans to `gen_ai.*` semconv automatically.

### Verifying normalisation

After a chat request, check the collector debug output for `gen_ai.*`
attributes:

```bash
docker compose logs otel-collector | findstr "gen_ai"
```

## Distributed tracing across MCP services (Task 014)

The web scrape feature connects the Node.js API to an external
[Playwright MCP server](https://github.com/tomcotter7/Playwright-MCP-Demo)
via the Model Context Protocol (MCP). Both services are instrumented with
OpenTelemetry, and W3C trace context (`traceparent` / `tracestate`) is
propagated automatically across the HTTP boundary so that a single scrape
request produces a unified trace spanning both services.

### How it works

1. The Node.js API creates a span `mcp.scrape` and calls the Playwright
   MCP server via `@modelcontextprotocol/sdk` (Streamable HTTP transport).
2. The Node.js OTel auto-instrumentation (`@opentelemetry/instrumentation-http`)
   automatically injects the `traceparent` header into the outgoing
   `fetch()` request.
3. The Playwright MCP server's ASGI `OpenTelemetryMiddleware` extracts
   the `traceparent` header and creates a child server span.
4. Each MCP tool call (e.g. `session_create`, `browser_navigate`,
   `browser_get_text`) is wrapped with a `@traced_tool` decorator that
   creates a child span named `mcp.tool.<function_name>`.
5. All spans from both services share the same trace ID and appear as a
   single trace in Splunk APM (or any OTel-compatible backend).

### Trace structure

A typical scrape request produces this span hierarchy:

```
[rag-api] POST /api/scrape                    (Express auto-span)
  [rag-api] scrape.pipeline                   (route handler)
    [rag-api] mcp.scrape                      (mcp-client.js)
      [rag-api] HTTP POST playwright-mcp/mcp  (auto-instrumented fetch)
        [playwright-mcp] POST /mcp            (ASGI middleware)
          [playwright-mcp] mcp.tool.session_create
      [rag-api] HTTP POST playwright-mcp/mcp
        [playwright-mcp] POST /mcp
          [playwright-mcp] mcp.tool.browser_navigate
      [rag-api] HTTP POST playwright-mcp/mcp
        [playwright-mcp] POST /mcp
          [playwright-mcp] mcp.tool.browser_get_text
      ...
    [rag-api] scrape.chunk                    (chunker)
    [rag-api] embeddings text-embedding-3-small  (gen_ai semconv span)
    [rag-api] db.insertDocument               (SurrealDB)
    [rag-api] db.insertChunks                 (SurrealDB)
```

### Configuration

Both services must export to the same OTel Collector (or compatible
backend) for traces to be correlated:

**Node.js API** (already configured via `docker-compose.yml`):
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`
- `OTEL_SERVICE_NAME=rag-api`

**Playwright MCP server** (set in its own `.env`):
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318`
  (if running outside Docker) or `http://otel-collector:4318` (if on
  the same Docker network)
- `OTEL_SERVICE_NAME=playwright-mcp`

### Verifying distributed traces

1. Scrape a URL via the UI or curl:
   ```bash
   curl -X POST http://localhost/api/scrape \
     -H "Content-Type: application/json" \
     -d '{"url":"https://example.com"}'
   ```
2. Check the collector debug output for spans from both services:
   ```bash
   docker compose logs otel-collector | findstr "playwright-mcp"
   ```
3. In Splunk APM, search for traces containing both `rag-api` and
    `playwright-mcp` service names.

## Collector receiver authentication (design decision)

The OTLP receiver in `otel-collector-config.yaml` does **not** require
authentication (no API key, no bearer token). This is a deliberate
design decision for this dev/learning stack:

### Why no auth on the receiver

1. **Standard default** -- the upstream OTel Collector ships with no
   receiver auth. This is the configuration used in most tutorials,
   quickstarts, and dev setups.
2. **Internal infrastructure** -- the collector is an internal component
   (like a database or message queue) that sits inside the Docker network
   or on localhost. It's not exposed to the public internet.
3. **Auth at the boundary** -- security is applied where data leaves the
   trusted network: the collector uses `SPLUNK_ACCESS_TOKEN` to
   authenticate with Splunk's cloud ingest endpoints. Services inside the
   network talk to the collector unauthenticated.
4. **Simplicity** -- adding auth to the receiver would require every
   service (Node.js API, SurrealDB, Playwright MCP) to carry and manage
   a token, adding complexity with no security benefit in a local dev
   environment.

### When to add receiver auth

Add authentication to the collector's OTLP receiver if:

- The collector is exposed to the **public internet** or a shared/untrusted
  network
- You're running a **multi-tenant** environment where you need to verify
  which service is sending data
- Your organisation requires **zero-trust** architecture where every hop
  needs authentication
- The collector is deployed as a **shared service** across teams

### How to add receiver auth (future reference)

The OTel Collector Contrib image includes the `bearertokenauth` extension.
To enable it:

1. Add the extension to `otel-collector-config.yaml`:

   ```yaml
   extensions:
     bearertokenauth:
       token: "${OTEL_COLLECTOR_AUTH_TOKEN}"

   receivers:
     otlp:
       protocols:
         grpc:
           endpoint: 0.0.0.0:4317
           auth:
             authenticator: bearertokenauth
         http:
           endpoint: 0.0.0.0:4318
           auth:
             authenticator: bearertokenauth

   service:
     extensions: [bearertokenauth]
     pipelines:
       # ... existing pipeline config unchanged
   ```

2. Add `OTEL_COLLECTOR_AUTH_TOKEN` to `.env` and `docker-compose.yml`
   (otel-collector service environment).

3. Configure each sending service to include the token:

   **Node.js API** (`api/src/instrumentation.js`):
   ```javascript
   // Add to OTLP exporter headers
   const exporter = new OTLPTraceExporter({
     headers: { Authorization: 'Bearer ' + process.env.OTEL_AUTH_TOKEN },
   });
   ```

   **Playwright MCP server** (`server.py`):
   ```python
   # Add to OTLPSpanExporter headers
   exporter = OTLPSpanExporter(
       headers={"Authorization": f"Bearer {os.getenv('OTEL_AUTH_TOKEN', '')}"},
   )
   ```

   **SurrealDB**: SurrealDB's built-in OTel exporter does not support
   custom headers. You would need to run a local collector sidecar
   without auth that forwards to the authenticated central collector.

4. Add `OTEL_AUTH_TOKEN` to each service's `.env.example` and
   `docker-compose.yml` environment section.

See the [OTel Collector bearertokenauth docs](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/extension/bearertokenauthextension)
for full configuration reference.
