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
4. Collector batches and forwards to configured backends
5. Backends (Splunk/Azure/Grafana) store and visualise the data

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
