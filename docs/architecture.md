# Architecture

> For the transferable version of this design, including the traps that
> make it hard to rebuild, see the
> [Implementation Playbook](implementation-playbook.md).

## System overview

```
                    +------------------+
                    |    Browser       |
                    +--------+---------+
                             |
                             | HTTP :80
                             v
                    +--------+---------+
                    |     Nginx        |
                    |  (static files   |
                    |   + reverse      |
                    |     proxy)       |
                    +--------+---------+
                             |
                    /api/*   |   /*
                    +--------+---------+
                    |                  |
           +-------v-------+   Static HTML/CSS/JS
           |  Node.js API  |   (chat UI)
           |  (Express)    |
           +---+---+---+---+
               |   |   |
    +----------+   |   +----------+
    |              |              |
+---v---+    +----v----+    +----v----+
|Surreal|    |   LLM   |    |  MCP    |
|  DB   |    | Backend |    |Services |
+-------+    +---------+    +---------+

All services emit telemetry via OTLP:

+---------------------------+
|      OTel Collector       |
|     (contrib image)       |
+--+---------+--------+-----+
   |         |        |
   | traces  | metrics|  logs
   |         |        |
   v         v        v
+--------------------+  +----------------------+
| Splunk             |  | Splunk Cloud         |
| Observability Cloud|  | Platform (or         |
| (formerly SignalFx)|  | Splunk Enterprise)   |
|                    |  |                      |
| - APM (traces)     |  | - Indexes/stores     |
| - Infra Monitoring |  |   raw log events     |
|   (metrics)        |  | - Received via HEC   |
+--------------------+  +----------------------+

(Azure Monitor is a second, selectable backend -- see below.
 Grafana remains a future phase. Both are collector config
 changes only -- see docs/opentelemetry.md)
```

**Traces and metrics go to a different Splunk product than logs.** This
is not a design preference, it is forced by Splunk: they deprecated
native Log Observer (direct log ingest into Observability Cloud) in
January 2024. Logs must now live in a Splunk Cloud Platform or Splunk
Enterprise instance, which Observability Cloud then reads in place via
Log Observer Connect rather than storing a copy. So:

| Signal | Exporter | Destination |
|---|---|---|
| Traces | `otlp_http/splunk` | Splunk Observability Cloud (APM) |
| Metrics | `signalfx` | Splunk Observability Cloud (Infrastructure Monitoring) |
| Logs | `splunk_hec/logs` | Splunk Cloud Platform / Enterprise, via HEC |

Trace-to-log correlation therefore spans two products: the log records
carry `trace_id`/`span_id` (attached by `logger.js` from the active
span), and Log Observer Connect uses those to join them back to the
traces in APM. See [splunk-setup.md](splunk-setup.md#log-observer-connect-splunk-cloud-platform)
for the full setup, including the licensing constraint that Log Observer
Connect is not available on Splunk Cloud Platform trial accounts.

### The Azure Monitor leg

Azure Monitor is a second, selectable destination. It takes all three
signals into **one** Application Insights resource, which is the sharpest
architectural contrast with the Splunk split above:

```
+--------------------+
|  OTel Collector    |
+---+------------+---+
    |            |
    | Splunk     | Azure
    | (as above) |
    v            v
              +--------------------------+
              | Application Insights     |
              | - requests, dependencies |
              | - customMetrics          |
              | - traces, exceptions     |
              | All correlated by        |
              | operation_Id             |
              +--------------------------+
```

| Signal | Exporter | Destination table |
|---|---|---|
| Traces (SERVER, CONSUMER) | `azure_monitor` | `requests` |
| Traces (CLIENT, PRODUCER, INTERNAL) | `azure_monitor` | `dependencies` |
| Metrics | `azure_monitor` | `customMetrics` |
| Logs | `azure_monitor` | `traces` |
| Span events | `azure_monitor` | `exceptions` |

Which backend is active is chosen by `OTEL_COLLECTOR_CONFIG` on the
collector's config bind mount:

| Config file | Backend |
|---|---|
| `otel-collector-config.yaml` (default) | Splunk only |
| `otel-collector-config.azure.yaml` | Azure Monitor only |
| `otel-collector-config.dual.yaml` | Both, in parallel |

In dual mode, traces and logs are single fan-out pipelines: collector
pipelines send to every exporter listed, so both backends receive
byte-identical data. Metrics is split into `metrics/splunk` and
`metrics/azure`, because the two backends need different inputs.
`spanmetrics` and `hostmetrics` are Splunk-only; `cumulative_to_delta` and
`transform/azure_dims` are Azure-only. The reasoning for each is in
[splunk-vs-azure-monitor.md](splunk-vs-azure-monitor.md), and the setup is in
[azure-monitor-setup.md](azure-monitor-setup.md).

## Services

### Nginx (port 80)

- Serves the static chat UI from `/usr/share/nginx/html`
- Reverse-proxies `/api/*` requests to the Node.js API container
- Depends on the API being healthy before starting

### Node.js API (port 3000)

- Express application with OTel SDK 2.x instrumentation
- Instrumentation loads before app code via `--require ./src/instrumentation.js`
- Endpoints: `GET /health`, `POST /api/chat`, `POST /api/upload`,
  `POST /api/scrape`
- Connects to SurrealDB for document storage and retrieval
- Calls LLM backend via OpenAI-compatible API
- Calls Playwright MCP server for web scraping (via `@modelcontextprotocol/sdk`)

### SurrealDB (port 8000)

- Multi-model database (document + graph + vector)
- Stores scraped/uploaded documents, text chunks, and embeddings
- Data persisted in a Docker named volume (`surreal-data`)

### OTel Collector (ports 4317, 4318)

- Receives telemetry via OTLP (gRPC on 4317, HTTP on 4318)
- Processes with batch processor
- Exports to configured backends (debug/stdout initially)
- Uses the upstream `otel/opentelemetry-collector-contrib` image

## Data flow

### Chat request

1. User types message in browser chat UI
2. Browser sends `POST /api/chat` to Nginx
3. Nginx proxies to Node.js API
4. API queries SurrealDB for relevant document chunks (RAG)
5. API sends context + question to LLM backend
6. LLM returns response
7. API returns response to browser
8. Browser displays response

### Web scrape request

1. User pastes a URL in the scrape form and clicks Scrape
2. Browser sends `POST /api/scrape` to Nginx
3. Nginx proxies to Node.js API
4. API connects to the Playwright MCP server via Streamable HTTP transport
5. MCP server creates a browser session, navigates to the URL, extracts
   visible text, and closes the session
6. API chunks the text, generates embeddings, and stores in SurrealDB
7. API returns document ID and chunk count to browser
8. User can now ask questions about the scraped content via chat

### Telemetry flow

1. OTel SDK in Node.js API auto-instruments HTTP, Express, and DB calls
2. SDK exports traces, metrics, and logs via OTLP HTTP to the collector
3. Playwright MCP server (external) also exports traces via OTLP HTTP
   to the same collector -- W3C `traceparent` headers propagate trace
   context across the HTTP boundary automatically
4. Collector batches and forwards each signal to its own destination:
   traces and metrics to Splunk Observability Cloud, logs to Splunk
   Cloud Platform via HEC (see the split described above)
5. Log records carry `trace_id`/`span_id`, so Log Observer Connect can
   join them back to the corresponding APM traces across the two
   products

## Playwright MCP server (external)

The Playwright MCP server is a **separate project**
([Playwright-MCP-Demo](https://github.com/tomcotter7/Playwright-MCP-Demo))
that runs outside Docker Compose. It provides browser automation
capabilities via the Model Context Protocol (MCP).

- **Transport:** Streamable HTTP (`POST /mcp`) -- stateless mode
- **Auth:** API key via `x-api-key` header
- **OTel:** Python OTel SDK with ASGI middleware and `@traced_tool`
  decorator on all MCP tool functions
- **Connection:** The RAG API connects to it via `MCP_PLAYWRIGHT_URL`
  (configured in `.env`)

The server is not included in `docker-compose.yml` because:
1. It requires a full Chromium browser (heavy dependency)
2. It's a reusable standalone tool, not specific to this project
3. It may run on a different host or in its own container

To use the scrape feature, start the Playwright MCP server separately
and set `MCP_PLAYWRIGHT_URL` and `MCP_PLAYWRIGHT_API_KEY` in `.env`.

## Docker networking

All services share a default Docker Compose network. Service names
(`api`, `surrealdb`, `otel-collector`, `nginx`) resolve as hostnames
within the network.

| From | To | Protocol | Port |
|---|---|---|---|
| nginx | api | HTTP | 3000 |
| api | surrealdb | HTTP | 8000 |
| api | otel-collector | HTTP | 4318 |
| api | LLM backend | HTTPS | 443 (external) |
| api | Playwright MCP | HTTP | configurable (external) |
| Playwright MCP | otel-collector | HTTP | 4318 (via host) |
| browser | nginx | HTTP | 80 |
