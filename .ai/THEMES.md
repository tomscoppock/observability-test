# Themes

Registered themes (labels). A theme is a tag, not a folder -- one or more
per epic, inherited by child tasks unless overridden. Register a theme here
before first use so `generate_board.py` and status queries have a
consistent set to group by.

| Theme | Description | Engineering workflow? |
|---|---|---|
| `otel-core` | OpenTelemetry Collector setup, pipeline config, processors, exporters. | yes |
| `otel-instrumentation` | OTel SDK instrumentation in Node.js -- traces, metrics, logs, custom spans. | yes |
| `splunk-observability` | Splunk Observability Cloud integration, dashboards, alerts. | yes |
| `azure-monitor` | Azure Monitor / Application Insights integration (future phase). | yes |
| `grafana-stack` | Grafana / Tempo / Prometheus / Loki integration (future phase). | yes |
| `rag-agent` | RAG agent application -- chat UI, API layer, document ingestion, retrieval. | yes |
| `llm-integration` | LLM provider integration -- swappable backends, OpenAI-compat layer. | yes |
| `llm-observability` | LLM-specific observability -- gen_ai semconv, token tracking, latency, cost. | yes |
| `database` | SurrealDB setup, schema, embeddings storage, query observability. | yes |
| `mcp-services` | MCP service integration -- Playwright, You.com, and future tools. | yes |
| `infrastructure` | Docker Compose, networking, container health, infra-level telemetry. | yes |
| `project-tracking` | The tracking system itself -- board, reporting, process improvements. | yes |

"Engineering workflow?" -- `yes` means tasks under this theme default to the
full plan/implement/validate/review/ship sequence in `AGENTS.md` Section 3;
`no` means they default to the lighter Clarify/Do/Ship path unless a specific
task overrides it with its own `Tags:` field.
