# Progress

Last refreshed: 2026-08-18

## Works

- Project tracking framework fully set up (.ai/, memory-bank/, .archon/,
  .roo/rules/, .roomodes, AGENTS.md, CLAUDE.md).
- Epic 001 code complete: docker-compose.yml, api/ (Express + OTel SDK),
  nginx/ (reverse proxy + chat UI), otel-collector-config.yaml.
- All config externalised to .env (LLM, embedding, SurrealDB, OTel,
  Splunk, MCP).
- Three-layer secret enforcement (.gitignore, .claude/settings.json,
  .rooignore) in sync.
- Board validation passes (13 tasks, 5 epics, 0 errors).

## Left to do

- Start Docker Desktop and validate Epic 001 stack with
  `docker compose up -d --build`.
- Epic 002: OTel Collector Pipeline to Splunk (tasks 009, 010).
- Epic 003: Node.js OTel Instrumentation (tasks 011, 012).
- Epic 004: RAG Document Ingestion and Chat (tasks 013, 014, 015, 016).
- Epic 005: LLM Observability with gen_ai Semconv (tasks 017, 018).

## Known issues

- Docker Desktop not running on dev machine.
- OTel SDK packages are experimental (0.x) -- may have breaking changes
  between minor versions.
