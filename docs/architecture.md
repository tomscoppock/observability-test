# Architecture

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

+-------------------+
| OTel Collector    |
| (contrib image)   |
+---+---+---+-------+
    |   |   |
    v   v   v
 Splunk Azure Grafana
```

## Services

### Nginx (port 80)

- Serves the static chat UI from `/usr/share/nginx/html`
- Reverse-proxies `/api/*` requests to the Node.js API container
- Depends on the API being healthy before starting

### Node.js API (port 3000)

- Express application with OTel SDK 2.x instrumentation
- Instrumentation loads before app code via `--require ./src/instrumentation.js`
- Endpoints: `GET /health`, `POST /api/chat` (stub, then RAG)
- Connects to SurrealDB for document storage and retrieval
- Calls LLM backend via OpenAI-compatible API

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

### Telemetry flow

1. OTel SDK in Node.js API auto-instruments HTTP, Express, and DB calls
2. SDK exports traces, metrics, and logs via OTLP HTTP to the collector
3. Collector batches and forwards to configured backends
4. Backends (Splunk/Azure/Grafana) store and visualise the data

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
| browser | nginx | HTTP | 80 |
