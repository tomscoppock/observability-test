# Product Context

## What this project is

A learning and testing project for observability across infrastructure,
cloud, databases, LLMs, and AI agents. The application under observation is
a Docker Compose RAG (Retrieval-Augmented Generation) agent stack that can
scrape web pages or accept file uploads, store them with embeddings in
SurrealDB, and answer questions about the content via a swappable LLM
backend (OpenAI, Gemma, Qwen).

The observability layer uses OpenTelemetry (OTel) to collect traces,
metrics, and logs, feeding them to multiple backends: Splunk Observability
Cloud (free edition) first, then Azure Monitor and Grafana.

## Who it's for

Tom Coppock (@tom) -- solo learning/testing project for building practical
observability skills across the full stack.

## High-level scope

In scope:
- Docker Compose stack: Nginx (chat UI), Node.js API (Express), SurrealDB,
  OTel Collector (upstream contrib)
- OTel instrumentation: auto-instrumentation + custom spans/metrics/logs
- LLM observability: gen_ai.* semantic conventions, token tracking
- RAG pipeline: web scraping, file upload, embedding, vector search, chat
- Observability backends: Splunk (phase 1), Azure Monitor (phase 2),
  Grafana (phase 3)
- MCP services: Playwright (scraping), You.com (search)

Out of scope:
- Production deployment / scaling
- Advanced RAG techniques (re-ranking, hybrid search) -- future work
- Cost calculation dashboards -- future work
