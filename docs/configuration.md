# Configuration

All configuration is centralised in the `.env` file at the project root.
Copy `.env.example` to `.env` and fill in your values.

## Environment variables

### LLM Configuration

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `openai` | Provider name: `openai`, `gemma`, `qwen` |
| `LLM_API_BASE_URL` | `https://api.openai.com/v1` | Base URL for the OpenAI-compatible API |
| `LLM_API_KEY` | (empty) | API key for the LLM provider |
| `LLM_MODEL` | `gpt-4o-mini` | Model name to use |

### Embedding Configuration

| Variable | Default | Description |
|---|---|---|
| `EMBEDDING_API_BASE_URL` | `https://api.openai.com/v1` | Base URL for embedding API |
| `EMBEDDING_API_KEY` | (empty) | API key for embedding provider |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |

### SurrealDB

| Variable | Default | Description |
|---|---|---|
| `SURREAL_URL` | `http://surrealdb:8000` | SurrealDB connection URL |
| `SURREAL_USER` | `root` | Database username |
| `SURREAL_PASS` | `root` | Database password |
| `SURREAL_NS` | `observability` | Namespace |
| `SURREAL_DB` | `rag` | Database name |

### OpenTelemetry

| Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | Collector OTLP HTTP endpoint |
| `OTEL_SERVICE_NAME` | `rag-api` | Service name in telemetry |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=dev` | Extra resource attributes (key=value,key=value) |

### Splunk Observability Cloud

| Variable | Default | Description |
|---|---|---|
| `SPLUNK_ACCESS_TOKEN` | (empty) | Splunk ingest token |
| `SPLUNK_REALM` | `us1` | Splunk realm (us0, us1, eu0, etc.) |
| `SPLUNK_INGEST_URL` | `https://ingest.us1.signalfx.com` | Splunk ingest endpoint |

### Azure Monitor (future)

| Variable | Default | Description |
|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | (commented out) | App Insights connection string |

### MCP Services

| Variable | Default | Description |
|---|---|---|
| `YOU_COM_API_KEY` | (empty) | You.com API key for web search |

### Board (project tracking)

| Variable | Default | Description |
|---|---|---|
| `BOARD_BASE_URL` | `https://github.com/ORG/REPO/blob/main` | Base URL for board links |

## Swapping LLM providers

All LLM calls use the OpenAI-compatible completions API pattern
(`POST {LLM_API_BASE_URL}/chat/completions`). To switch providers,
update these three variables in `.env`:

### OpenAI

```env
LLM_PROVIDER=openai
LLM_API_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

### Gemma (via Ollama)

```env
LLM_PROVIDER=gemma
LLM_API_BASE_URL=http://host.docker.internal:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=gemma2:9b
```

### Qwen (via Ollama)

```env
LLM_PROVIDER=qwen
LLM_API_BASE_URL=http://host.docker.internal:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5:7b
```

### Azure OpenAI

```env
LLM_PROVIDER=openai
LLM_API_BASE_URL=https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT
LLM_API_KEY=your-azure-key
LLM_MODEL=gpt-4o-mini
```

After changing `.env`, restart the API:

```bash
docker compose restart api
```

## Swapping observability backends

The OTel Collector config (`otel-collector-config.yaml`) controls where
telemetry is sent. The `.env` file provides credentials. See
[OpenTelemetry](opentelemetry.md) for details on adding Splunk, Azure
Monitor, or Grafana exporters.
