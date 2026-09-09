# Observability Test

A learning and testing project for observability across infrastructure,
cloud, databases, LLMs, and AI agents. Built as a Docker Compose RAG agent
stack instrumented with OpenTelemetry, feeding telemetry to multiple
observability backends.

## What this is

A hands-on project to explore and compare observability approaches:

1. **Splunk Observability Cloud** (free edition) -- first target
2. **Azure Monitor / Application Insights** -- implemented, and runnable in
   parallel with Splunk off the same traffic
3. **Grafana / Tempo / Prometheus / Loki** -- future phase

The application under observation is a RAG (Retrieval-Augmented Generation)
agent that can scrape web pages or accept file uploads, store them with
embeddings in SurrealDB, and answer questions about the content via a
swappable LLM backend.

## Architecture

```
+----------+     +----------------+     +------------+
|  Nginx   |---->|  Node.js API   |---->|  SurrealDB |
| (Chat UI)|     |  (Express)     |     | (docs/emb) |
+----------+     +-------+--------+     +------------+
                         |
              +----------+----------+
              |                     |
     +--------v--------+   +-------v--------+
     | MCP Services    |   | LLM Backend    |
     | (Playwright,    |   | (OpenAI/Gemma/ |
     |  You.com)       |   |  Qwen via .env)|
     +-----------------+   +----------------+
              |
     +--------v--------+
     | OTel Collector   |
     | (contrib image)  |
     +--+-----------+---+
        |           |
        | traces    | logs
        | metrics   | (HEC)
        v           v
  +-------------+  +------------------+
  | Splunk      |  | Splunk Cloud     |
  | Observability|  | Platform /       |
  | Cloud (APM, |  | Enterprise       |
  | Infra Mon)  |  | (log indexes)    |
  +-------------+  +------------------+
```

Traces and metrics go to Splunk Observability Cloud; logs go to Splunk
Cloud Platform via HEC, because Splunk deprecated native log ingest into
Observability Cloud in January 2024. See
[docs/architecture.md](docs/architecture.md) for the full split and
[docs/splunk-setup.md](docs/splunk-setup.md) for setup.

### Switching or doubling up the backend

Azure Monitor is wired in as a second destination. Which backend receives
telemetry is chosen by `OTEL_COLLECTOR_CONFIG` in `.env`, with no application
change:

| Value | Backend |
|---|---|
| `./otel-collector-config.yaml` (default) | Splunk only |
| `./otel-collector-config.azure.yaml` | Azure Monitor only |
| `./otel-collector-config.dual.yaml` | Both, in parallel |

Dual mode sends byte-identical telemetry to both backends from one traffic
run, which is what makes a side-by-side comparison controlled rather than
approximate. See [docs/azure-monitor-setup.md](docs/azure-monitor-setup.md)
to get started and
[docs/splunk-vs-azure-monitor.md](docs/splunk-vs-azure-monitor.md) for where
the two genuinely differ. Grafana remains a future phase.

All services run in Docker Compose. All configuration is in `.env`.

## Documentation

Full documentation is in the [`docs/`](docs/) folder:

| Guide | Description |
|---|---|
| [Getting Started](docs/getting-started.md) | Prerequisites, initial setup, first run |
| [Docker Commands](docs/docker-commands.md) | All Docker Compose commands for the stack |
| [API Reference](docs/api-reference.md) | Endpoints, request/response formats |
| [Configuration](docs/configuration.md) | Environment variables and how to swap providers |
| [Architecture](docs/architecture.md) | System design, service topology, data flow |
| [OpenTelemetry](docs/opentelemetry.md) | OTel SDK setup, collector config, instrumentation |
| [Implementation Playbook](docs/implementation-playbook.md) | Transferable OTel-to-Splunk and OTel-to-Azure know-how, and the 33 traps |
| [Splunk Setup](docs/splunk-setup.md) | Dashboards, alerts, and what free/trial accounts cannot do |
| [Azure Monitor Setup](docs/azure-monitor-setup.md) | Azure Monitor as an endpoint: provisioning, config selection, workbook deployment |
| [Splunk vs Azure Monitor](docs/splunk-vs-azure-monitor.md) | Where the two backends genuinely differ, in both directions |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Quick start

```bash
# 1. Copy and fill in environment variables
cp .env.example .env
# Edit .env with your API keys, Splunk token, etc.

# 2. Start all services
docker compose up -d --build

# 3. Open the chat UI
open http://localhost
```

See [Getting Started](docs/getting-started.md) for the full walkthrough.

## Project tracking

This project uses the [TLabs Project Tracking](https://github.com/MrLesk/Backlog.md)
framework for task management. AI agents (Claude Code, Zoo/Roo Code) read
`AGENTS.md` as the canonical charter.

```
.ai/STATUS.md       -- Current state (read this first)
.ai/CONVENTIONS.md  -- Team roster, overrides
.ai/THEMES.md       -- Registered themes
.ai/backlog/        -- Not started
.ai/in-progress/    -- Active work
.ai/done/           -- Completed (audit trail)
.ai/epics/          -- Multi-task milestones
```

Generate a kanban board snapshot:

```bash
python3 scripts/generate_board.py
```

## Technology stack

| Component | Technology | Notes |
|---|---|---|
| Chat UI | Nginx + vanilla HTML/CSS/JS | Static files, reverse proxy to API |
| API | Node.js (Express) | OTel SDK 2.x instrumented |
| Database | SurrealDB | Documents, chunks, vector embeddings |
| Telemetry | OpenTelemetry Collector (contrib) | OTLP receiver, batch processor, multi-backend export |
| LLM | OpenAI / Gemma / Qwen | Swappable via `.env`, OpenAI-compatible API |
| MCP | Playwright, You.com | Web scraping, search |
| Observability | Splunk -> Azure Monitor -> Grafana | Phased rollout |

## Key design decisions

- **Upstream OTel Collector Contrib** (not Splunk distribution) -- more
  portable, makes switching backends trivial
- **OTel JS SDK 2.x** -- latest stable, requires Node.js >= 20.6.0
- **`gen_ai.*` semantic conventions** -- official OTel direction for LLM
  observability (via the gen-ai normalizer processor)
- **All config in `.env`** -- swap LLMs, collectors, databases without
  touching code
- **OTel instrumentation loads first** -- `node --require ./src/instrumentation.js`
  in the Dockerfile CMD

## Epics

| # | Title | Status |
|---|---|---|
| 001 | Docker Compose RAG Agent Stack | done |
| 002 | OTel Collector Pipeline to Splunk | not-started |
| 003 | Node.js OTel Instrumentation | not-started |
| 004 | RAG Document Ingestion and Chat | not-started |
| 005 | LLM Observability with gen_ai Semconv | not-started |
