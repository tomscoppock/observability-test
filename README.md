# Observability Test

A learning and testing project for observability across infrastructure,
cloud, databases, LLMs, and AI agents. Built as a Docker Compose RAG agent
stack instrumented with OpenTelemetry, feeding telemetry to multiple
observability backends.

## What this is

A hands-on project to explore and compare observability approaches:

1. **Splunk Observability Cloud** (free edition) -- implemented
2. **Azure Monitor / Application Insights** -- implemented
3. **Grafana / Tempo / Prometheus / Loki** -- future phase

Splunk and Azure Monitor can run **at the same time**, receiving
byte-identical telemetry from one traffic run. That turns a vendor comparison
from an argument into a measurement: see
[docs/splunk-vs-azure-monitor.md](docs/splunk-vs-azure-monitor.md), where
counters match exactly between the two and every divergence has a stated
cause.

The application under observation is a RAG (Retrieval-Augmented Generation)
agent that can scrape web pages or accept file uploads, store them with
embeddings in SurrealDB, and answer questions about the content via a
swappable LLM backend.

## Take the learnings, not the code

**This is the project's main deliverable.** The point of a spike is what you
learn, and the learnings here are not discoverable by reading the code: they
are the silent failures, the wrong units and the empty-but-plausible charts
that cost days to find.

They are packaged as **paste-ready prompts** in [`prompts/`](prompts/). Hand
one to a coding agent in another repo and it should instrument that service
without repeating any of it. Pick one, two or three:

| Prompt | Use it when | Depends on |
|---|---|---|
| [1. OpenTelemetry instrumentation](prompts/01-otel-instrumentation.md) | You want vendor-neutral instrumentation: traces, metrics and logs into a collector, nothing vendor-specific | nothing |
| [2. Splunk Observability Cloud](prompts/02-splunk-backend.md) | You want Splunk APM, Infrastructure Monitoring, dashboards and detectors as code | prompt 1 |
| [3. Azure Monitor](prompts/03-azure-monitor-backend.md) | You want Application Insights, a Workbook and alert rules as code | prompt 1 |
| [4. MCP or sidecar handoff](prompts/04-mcp-service-handoff.md) | A second service needs to reach the same backend | prompt 1 |

Prompts 2 and 3 compose: a collector pipeline fans out to every exporter
listed, so one service can feed both backends at once. Run prompt 1 first and
on its own, because the instrumentation is the durable asset and the backend
is a config file.

See [`prompts/README.md`](prompts/README.md) for how to combine them, and
[docs/implementation-playbook.md](docs/implementation-playbook.md) for the
same material as reference documentation, including all 33 traps.

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
     +--------v---------+
     | OTel Collector   |
     | (contrib image)  |
     +--+----------+----+
        |          |
   SPLUNK PATH   AZURE PATH
        |          |
   +----+----+     |
   | traces  |     | traces + metrics + logs
   | metrics | logs|
   v         v     v
+----------+ +-----------+ +------------------------+
| Splunk   | | Splunk    | | Application Insights   |
| Observ.  | | Cloud     | | requests, dependencies,|
| Cloud    | | Platform  | | customMetrics, traces, |
| (APM,    | | (HEC log  | | exceptions -- ALL in   |
| Infra)   | |  indexes) | | one resource           |
+----------+ +-----------+ +------------------------+
```

**Splunk needs two products; Azure needs one.** On the Splunk path, traces
and metrics go to Observability Cloud while logs go to Splunk Cloud Platform
via HEC, because Splunk deprecated native log ingest into Observability Cloud
in January 2024. On the Azure path all three signals land in a single
Application Insights resource, correlated by `operation_Id`.

That asymmetry is the largest single capability difference the project
surfaced, and it is not visible on any chart. See
[docs/architecture.md](docs/architecture.md) for the full split,
[docs/splunk-setup.md](docs/splunk-setup.md) and
[docs/azure-monitor-setup.md](docs/azure-monitor-setup.md) for setup.

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
| [Implementation Playbook](docs/implementation-playbook.md) | Transferable OTel-to-Splunk and OTel-to-Azure know-how, and the 34 traps |
| [Splunk Setup](docs/splunk-setup.md) | Dashboards, alerts, and what free/trial accounts cannot do |
| [Azure Monitor Setup](docs/azure-monitor-setup.md) | Azure Monitor as an endpoint: provisioning, config selection, workbook deployment |
| [Splunk vs Azure Monitor](docs/splunk-vs-azure-monitor.md) | Where the two backends genuinely differ, in both directions |
| [Demo Talk Track 1: OpenTelemetry](docs/demo-talk-track-1-opentelemetry.md) | ~12 min. The "why": one instrumentation, two backends, and what vendor-neutral does and does not buy |
| [Demo Talk Track 2: Splunk](docs/demo-talk-track-2-splunk.md) | ~14 min demo of the Splunk surfaces |
| [Demo Talk Track 3: Azure](docs/demo-talk-track-3-azure.md) | ~16 min demo of the Azure surfaces, off the same simulator run |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

### Reuse elsewhere

| Resource | Description |
|---|---|
| [`prompts/`](prompts/) | **Paste-ready prompts** for instrumenting another codebase. Pick 1, 2 or 3 |
| [Implementation Playbook](docs/implementation-playbook.md) | The 33 traps and the full OTel / Splunk / Azure build guides |

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
| 002 | OTel Collector Pipeline to Splunk | done |
| 003 | Node.js OTel Instrumentation | done |
| 004 | RAG Document Ingestion and Chat | done |
| 005 | LLM Observability with gen_ai Semconv | done |
| 025 | Splunk Demo and Dashboard Automation | done |
| 042 | Azure Monitor as a Parallel Backend | in-progress (5 of 6) |
