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
type, plus the debug exporter for local troubleshooting:

| Signal | Exporter | Splunk destination |
|---|---|---|
| **Traces** | `otlp_http/splunk` | Splunk APM (`/v2/trace/otlp`) |
| **Metrics** | `signalfx` | Splunk Infrastructure Monitoring |
| **Logs** | `otlp_http/splunk_logs` | Splunk Log Observer (`/v2/log/otlp`) |
| **All** | `debug` | Collector stdout (always on) |

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

## gen_ai normalizer processor (Task 017)

The `gen_ai.*` attributes are the official OTel semantic conventions for
LLM observability. The API's OpenLLMetry (Traceloop) SDK emits spans
with proprietary attribute names (`traceloop.entity.*`, `llm.*`). The
`gen_ai_normalizer` processor in the OTel Collector converts these to
the standard `gen_ai.*` format before export.

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
