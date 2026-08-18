# Project Status

Last updated: 2026-08-18

## Active work (per person)

| Assignee | Item | Epic | Since |
|---|---|---|---|

(No active work -- Epic 001 complete, ready for Epic 002.)

## Recently completed

- 006 -- Create Docker Compose stack (@tom) -- done 2026-08-18
- 007 -- Create Node.js API skeleton (@tom) -- done 2026-08-18
- 008 -- Create basic chat UI (@tom) -- done 2026-08-18
- Epic 001 -- Docker Compose RAG Agent Stack -- done 2026-08-18

## Next up (top of backlog, per theme)

### otel-core

- 009 -- Configure OTel Collector with OTLP receiver and Splunk exporter (@tom, high)
- 010 -- Sign up for Splunk Observability Cloud free edition and get realm/token (@tom, high)

### otel-instrumentation

- 011 -- Add OTel SDK 2.x instrumentation to Node.js API (@tom, high)
- 012 -- Add custom logger service wrapping OTel logs API (@tom, high)

### database

- 013 -- Set up SurrealDB schema for documents and embeddings (@tom, medium)

### rag-agent / mcp-services

- 014 -- Implement web scrape endpoint using Playwright MCP (@tom, medium)
- 015 -- Implement file upload endpoint for HTML, TXT, MD, PDF (@tom, medium)
- 016 -- Implement RAG chat endpoint with swappable LLM backend (@tom, high)

### llm-observability

- 017 -- Add gen_ai normalizer processor to OTel Collector (@tom, medium)
- 018 -- Instrument LLM calls with gen_ai.* spans and token metrics (@tom, high)

## Blockers

- Docker Desktop not running on dev machine -- start it to validate Epic 001
  with `docker compose up -d --build`.

## Numbering

Next free backlog/epic/task number: **020**

<!-- Increment every time a numbered item is created in backlog/,
     in-progress/, epics/, or done/. Numbers are never reused. -->
