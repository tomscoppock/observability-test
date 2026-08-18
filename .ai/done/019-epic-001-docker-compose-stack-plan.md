# Plan: 019 -- Epic 001: Docker Compose RAG Agent Stack (@tom)

Status: **in-progress**
Created: 2026-08-18
Owner: @tom

## Problem / goal

Stand up the full Docker Compose stack so all services (Nginx, Node.js API,
SurrealDB, OTel Collector) start, communicate, and are ready for
instrumentation work in Epics 002-005.

## Expected behaviour

`docker compose up -d` starts all 4 services. The chat UI is accessible at
`http://localhost`. The API health endpoint responds at
`http://localhost/api/health`. SurrealDB is reachable from the API.
The OTel Collector receives OTLP on port 4318 and logs to stdout.

## Edge cases / error states

- SurrealDB fails to start if volume permissions are wrong -- use a named volume
- OTel Collector config syntax errors -- validate YAML before starting
- Nginx fails if upstream API isn't ready -- add depends_on with healthcheck
- Port conflicts if 80, 3000, 4318, or 8000 are already in use locally

## Files to create or modify

- `docker-compose.yml` -- all service definitions
- `api/Dockerfile` -- Node.js API container
- `api/package.json` -- Express + OTel SDK dependencies
- `api/src/index.js` -- Express app with health and stub chat endpoints
- `api/src/instrumentation.js` -- OTel SDK stub (console exporter)
- `api/.dockerignore` -- exclude node_modules from build context
- `nginx/nginx.conf` -- reverse proxy config + static file serving
- `nginx/html/index.html` -- chat UI page
- `nginx/html/style.css` -- minimal chat styling
- `nginx/html/app.js` -- vanilla JS chat client
- `otel-collector-config.yaml` -- minimal OTLP receiver + debug exporter

## Functions / classes to add or change

- `api/src/index.js`: Express app, `GET /health`, `POST /api/chat` (stub)
- `api/src/instrumentation.js`: `NodeSDK` setup with console exporter
- `nginx/html/app.js`: `sendMessage()`, `appendMessage()`, event listeners

## Tests to write

- Manual: `docker compose up -d` starts all services
- Manual: `curl http://localhost/api/health` returns `{"status":"ok"}`
- Manual: `curl -X POST http://localhost/api/chat -H 'Content-Type: application/json' -d '{"message":"hello"}'` returns stub response
- Manual: Chat UI loads at `http://localhost` and sends/receives messages

## Dependencies to add or upgrade

- `express` (latest stable)
- `@opentelemetry/api` (>= 1.9.0)
- `@opentelemetry/sdk-node` (>= 2.0.0)
- `@opentelemetry/auto-instrumentations-node`
- `@opentelemetry/exporter-trace-otlp-http`
- `@opentelemetry/exporter-metrics-otlp-http`
- `@opentelemetry/exporter-logs-otlp-http`
- `@opentelemetry/resources`
- `@opentelemetry/semantic-conventions`
- `cors` (for API CORS support)
- `dotenv` (for local development outside Docker)

## Out of scope

- Actual RAG logic (Epic 004)
- Splunk exporter in OTel Collector (Epic 002)
- Full OTel instrumentation (Epic 003) -- just the stub here
- MCP services (Epic 004)
- LLM integration (Epic 004/005)

---

## Implementation checklist

- [x] Create `api/package.json` with all dependencies
- [x] Create `api/src/instrumentation.js` (OTel SDK stub with console exporter)
- [x] Create `api/src/index.js` (Express app, health endpoint, stub chat)
- [x] Create `api/Dockerfile` (node:22-alpine, --require instrumentation)
- [x] Create `api/.dockerignore`
- [x] Create `otel-collector-config.yaml` (OTLP receiver + debug exporter)
- [x] Create `nginx/nginx.conf` (reverse proxy + static files)
- [x] Create `nginx/html/index.html` (chat UI)
- [x] Create `nginx/html/style.css` (minimal styling)
- [x] Create `nginx/html/app.js` (vanilla JS chat client)
- [x] Create `docker-compose.yml` (all 4 services)
- [ ] Test: `docker compose up -d` starts all services (Docker Desktop not running)
- [ ] Test: health endpoint responds
- [ ] Test: chat UI loads and sends messages

## Review notes

- Bugs / logic: No issues found. Express app validates input on POST /api/chat.
  Instrumentation.js gracefully handles missing OTEL_EXPORTER_OTLP_ENDPOINT.
- Security: No hardcoded secrets. All credentials via .env with ${VAR:-default}
  fallbacks in docker-compose.yml. SurrealDB root/root defaults are acceptable
  for local dev only. .env is gitignored.
- Performance: Batch processor in OTel collector (512 batch, 5s timeout).
  PeriodicExportingMetricReader at 15s interval. fs instrumentation disabled
  (too noisy).
- UX: Chat UI is minimal but functional. System message explains stub state.
  Error messages displayed in red.
- Cost: All images are free/open-source. No cloud resources consumed until
  Splunk/Azure exporters are configured in later epics.
