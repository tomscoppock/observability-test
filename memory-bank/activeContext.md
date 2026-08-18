# Active Context

Last refreshed: 2026-08-18

## Current focus

Epic 001 (Docker Compose RAG Agent Stack) is complete. All code files
created and reviewed. Docker validation pending -- Docker Desktop needs
to be started, then run `docker compose up -d --build`.

Next up: Epic 002 (OTel Collector Pipeline to Splunk) or Epic 003
(Node.js OTel Instrumentation), depending on whether Splunk signup
(task 010) is done first.

## Recent changes

- Created `api/` directory: package.json, Dockerfile, .dockerignore,
  src/index.js (Express + health + stub chat), src/instrumentation.js
  (OTel SDK with OTLP exporters).
- Created `nginx/` directory: nginx.conf (reverse proxy), html/index.html,
  html/style.css, html/app.js (vanilla JS chat client).
- Created `otel-collector-config.yaml` (OTLP receiver + debug exporter).
- Created `docker-compose.yml` (4 services: nginx, api, surrealdb,
  otel-collector).
- Tasks 006, 007, 008 moved to done. Epic 001 marked done.
- Plan 019 moved to done with review notes.

## Open questions

- Docker Desktop not running -- need to validate the stack actually starts.
- OTel SDK package versions use caret ranges (^0.200.0 etc.) -- will
  resolve to latest on first `npm ci`. Verify no breaking changes.
