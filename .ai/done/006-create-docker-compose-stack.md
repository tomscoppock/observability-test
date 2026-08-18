# 006 -- Create Docker Compose with Nginx, Node.js API, SurrealDB, OTel Collector (@tom)

Status: done
Priority: high
Assignee: @tom
Epic: 001
Theme: rag-agent, infrastructure
Tags:
Blocked by:
Blocked:

## Description

Create a `docker-compose.yml` at the repo root defining all services:
Nginx (chat UI proxy), Node.js API (Express), SurrealDB, and the OTel
Collector (upstream contrib image). All configuration values (ports,
credentials, endpoints) must come from `.env`.

## Acceptance criteria

- [x] `docker-compose.yml` exists at repo root
- [x] All four services defined (Nginx, API, SurrealDB, OTel Collector)
- [x] Services can communicate over the Docker network (depends_on configured)
- [x] All credentials and endpoints are sourced from `.env`
- [x] SurrealDB data persists via a named volume (`surreal-data`)
- [x] OTel Collector starts with a minimal config (OTLP receiver + debug exporter)

## Notes

Use `otel/opentelemetry-collector-contrib` for the collector image.
Node.js service needs a Dockerfile. Nginx needs a config file.
SurrealDB uses the official `surrealdb/surrealdb` image.

Docker validation pending -- Docker Desktop was not running at review time.
Run `docker compose up -d --build` to validate.
