# 006 -- Create Docker Compose with Nginx, Node.js API, SurrealDB, OTel Collector

Status: backlog
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

- [ ] `docker-compose.yml` exists at repo root
- [ ] All four services start with `docker compose up`
- [ ] Services can communicate over the Docker network
- [ ] All credentials and endpoints are sourced from `.env`
- [ ] SurrealDB data persists via a named volume
- [ ] OTel Collector starts with a minimal config (OTLP receiver + logging exporter)

## Notes

Use `otel/opentelemetry-collector-contrib` for the collector image.
Node.js service needs a Dockerfile. Nginx needs a config file.
SurrealDB uses the official `surrealdb/surrealdb` image.
