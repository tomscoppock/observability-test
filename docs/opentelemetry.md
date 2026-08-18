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

### Current config (Epic 001 -- debug only)

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s

exporters:
  debug:
    verbosity: detailed

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
```

### Viewing telemetry

With the debug exporter, all telemetry is printed to the collector's
stdout:

```bash
docker compose logs -f otel-collector
```

### Adding Splunk exporter (Epic 002)

Will add a `splunk_hec` exporter to the collector config:

```yaml
exporters:
  debug:
    verbosity: detailed
  splunk_hec:
    token: "${SPLUNK_ACCESS_TOKEN}"
    endpoint: "${SPLUNK_INGEST_URL}"
    source: "otel"
    sourcetype: "otel"
```

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

## gen_ai semantic conventions (Epic 005)

The `gen_ai.*` attributes are the official OTel direction for LLM
observability. They will be added in Epic 005 using the gen-ai
normalizer processor in the collector.
