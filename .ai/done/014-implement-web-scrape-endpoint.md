# 014 -- Implement web scrape endpoint using Playwright MCP (@tom)

Status: done
Priority: medium
Assignee: @tom
Epic: 004
Theme: rag-agent, mcp-services, otel-instrumentation
Tags:
Blocked by: 007, 013
Blocked:
Completed: 2026-09-04

## Description

Created a `POST /api/scrape` endpoint that accepts a URL, uses the
external Playwright MCP server to fetch and render the page, extracts
visible text content, chunks it, generates embeddings, and stores
everything in SurrealDB. Also added OpenTelemetry instrumentation to the
Playwright MCP server itself for distributed tracing across both services.

## Implementation

### Part B: Playwright MCP OTel instrumentation (Playwright-MCP-Demo repo)

Commit: `41a3a4d` in `tomcotter7/Playwright-MCP-Demo`

- Added OTel packages to `requirements.txt` (opentelemetry-api,
  opentelemetry-sdk, opentelemetry-exporter-otlp-proto-http,
  opentelemetry-instrumentation-asgi)
- Added OTel SDK initialization to `server.py` (TracerProvider,
  BatchSpanProcessor, OTLPSpanExporter, W3C TraceContextTextMapPropagator)
- Wrapped ASGI app with `OpenTelemetryMiddleware` (inside APIKeyMiddleware
  so unauthenticated requests don't create spans)
- Added `@traced_tool` decorator to all 14 MCP tool functions (spans
  named `mcp.tool.<function_name>`)
- Updated `.env.example` and `README.md` with OTel configuration

### Part A: Scrape endpoint (observability-test repo)

Commit: `fd5b5c4`

New files:
- `api/src/mcp-client.js` -- MCP client wrapper using
  `@modelcontextprotocol/sdk` with `StreamableHTTPClientTransport`
- `api/src/routes/scrape.js` -- POST /api/scrape route with full pipeline
- `api/src/__tests__/mcp-client.test.js` -- 7 unit tests
- `api/src/__tests__/scrape-route.test.js` -- 6 unit tests

Modified files:
- `api/src/index.js` -- registered scrape route
- `api/package.json` -- added `@modelcontextprotocol/sdk` ^1.30.0
- `.env.example` -- added MCP_PLAYWRIGHT_URL, MCP_PLAYWRIGHT_API_KEY
- `docker-compose.yml` -- passed MCP env vars to api service
- `nginx/html/index.html` -- scrape form UI
- `nginx/html/app.js` -- scrape form handler
- `nginx/html/style.css` -- scrape form styling
- `docs/opentelemetry.md` -- distributed tracing section
- `docs/api-reference.md` -- POST /api/scrape endpoint docs
- `docs/configuration.md` -- MCP env vars

## Key decisions

- **Playwright MCP runs externally** -- not in Docker Compose. It's a
  standalone project (`Playwright-MCP-Demo`) that runs on the host or
  its own container. The RAG API connects to it via HTTP using
  `MCP_PLAYWRIGHT_URL`.
- **W3C trace context propagation** -- Node.js OTel auto-instrumentation
  auto-injects `traceparent` into `fetch()` calls made by the MCP SDK.
  The Playwright server's ASGI `OpenTelemetryMiddleware` auto-extracts it.
  No manual propagation code needed.
- **OTel middleware inside auth** -- `OpenTelemetryMiddleware` wraps the
  MCP app inside `APIKeyMiddleware` so unauthenticated requests don't
  create noisy spans.

## Acceptance criteria

- [x] `POST /api/scrape` accepts `{ url: "..." }`
- [x] Playwright MCP service fetches and renders the page
- [x] Text content extracted from the rendered HTML
- [x] Content chunked into manageable pieces
- [x] Embeddings generated for each chunk via the configured embedding API
- [x] Document and chunks stored in SurrealDB
- [x] Returns document ID and chunk count on success
- [x] OTel spans cover the full pipeline (mcp.scrape, scrape.pipeline, scrape.chunk)
- [x] Distributed traces span both services (rag-api + playwright-mcp)
- [x] 40 tests pass (13 new, 27 existing)

## Notes

The Playwright MCP server must be running and accessible at
`MCP_PLAYWRIGHT_URL` for the scrape endpoint to work. Both services must
export to the same OTel Collector for distributed traces to correlate.
