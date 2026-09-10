# Configuration

All configuration is centralised in the `.env` file at the project root.
Copy `.env.example` to `.env` and fill in your values.

## Environment variables

### LLM Configuration

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `openai` | Provider name: `openai`, `azure`, `gemma`, `qwen` |
| `LLM_API_BASE_URL` | `https://api.openai.com/v1` | Base URL for the OpenAI-compatible API |
| `LLM_API_KEY` | (empty) | API key for the LLM provider |
| `LLM_MODEL` | `gpt-4o-mini` | Model name to use |

### Embedding Configuration

| Variable | Default | Description |
|---|---|---|
| `EMBEDDING_API_BASE_URL` | `https://api.openai.com/v1` | Base URL for embedding API |
| `EMBEDDING_API_KEY` | (empty) | API key for embedding provider |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |
| `EMBEDDING_DIMENSIONS` | `3072` | Output dimensions (must match MTREE index in `db/schema.surql`) |

### Azure OpenAI

| Variable | Default | Description |
|---|---|---|
| `AZURE_API_VERSION` | `2024-10-21` | Azure OpenAI API version (appended as `?api-version=`) |

Azure endpoints are **auto-detected** by URL pattern: if the base URL
contains `.openai.azure.com` or `.cognitiveservices.azure.com`, the code
automatically uses the `api-key` header (instead of `Authorization:
Bearer`) and appends the `api-version` query parameter. No code changes
are needed -- just set the correct base URL format (see
[Swapping LLM providers](#azure-openai) below).

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
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `false` | Capture LLM prompt and response text as span attributes. **Off by default. Sends PII if enabled** -- see below |

### Capturing prompt and response content

Splunk's AI Agent Monitoring (**APM > AI trace data**, AI Interactions) and
its platform-side evaluations have nothing to show without the actual prompt
and response text on the spans. OpenTelemetry keeps that content off by
default, deliberately: prompts routinely contain names, account numbers and
proprietary business logic.

This variable is the switch. Add it to `.env`:

```bash
# ---------- LLM content capture ----------
# Captures prompt and response text as span attributes, which is what
# Splunk's AI trace data and evaluation screens read.
#
# OFF BY DEFAULT and it must stay off outside a test system: enabling it
# sends every prompt and every answer to your observability backend.
#
#   false      (default) no content leaves the application
#   SPAN_ONLY  content on the span -- the value Splunk's setup guide uses
#   true / 1   accepted as equivalent to SPAN_ONLY
#   EVENT_ONLY deliberately NOT honoured (see docs/splunk-setup.md s28)
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
```

Then rebuild the API for the change to take effect:

```bash
docker compose up -d --build api
```

Or enable it for one run without editing `.env` at all:

```bash
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY \
  docker compose up -d --build api
```

```powershell
$env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = 'SPAN_ONLY'
docker compose up -d --build api
```

Confirm which mode a running container is in:

```bash
docker inspect observability-test-api-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GENAI_CAPTURE
```

When enabled the LLM spans gain `gen_ai.input.messages` and
`gen_ai.output.messages`, capped at 8192 characters of text, with
`gen_ai.capture.truncated=true` when clipping occurred.

Both are JSON strings in the shape the OpenTelemetry GenAI conventions
require, which Splunk's AI Interactions view parses:

```json
[{"role":"assistant","parts":[{"type":"text","content":"According to ..."}]}]
```

The shape is not cosmetic. Free text there throws inside Splunk's
`JSON.parse` and blanks the trace page. See
[splunk-setup.md](splunk-setup.md) section 28a.

> **The point of the flag is that the same image is safe in production and
> useful on a test system.** Identical configuration shape, different value.
> If you ever enable it against real traffic, mask PII first -- Splunk's own
> documentation recommends exactly that. Full reasoning, and what it does
> and does not unlock, in [splunk-setup.md](splunk-setup.md) section 28.

### Splunk Observability Cloud (traces + metrics)

| Variable | Default | Description |
|---|---|---|
| `SPLUNK_ACCESS_TOKEN` | (empty) | Splunk token. **Needs BOTH Ingest and API scopes** -- see below |
| `SPLUNK_REALM` | `us1` | Splunk realm (us0, us1, eu0, eu2, etc.) |

**`SPLUNK_ACCESS_TOKEN` does two jobs, so it needs two scopes.** The OTel
Collector uses it to *ingest* traces and metrics, and
`scripts/setup-splunk-dashboard.*` uses it against the *management API*
to create dashboards, charts and detectors. When creating the token,
enable **both Ingest and API**. Splunk shows a warning when you combine
them; that warning is expected here and can be overridden.

With only API, the dashboard script works while the collector silently
401s on `/v2/datapoint` and drops every span and datapoint. With only
Ingest, the reverse. For the API side, the `power` role is what grants
write access to dashboards and detectors.

If you would rather not combine scopes, split them into two tokens and
point the collector and the script at different variables. This project
uses one token for simplicity.

The collector derives the ingest endpoint from `SPLUNK_REALM` directly --
there is no separate `SPLUNK_INGEST_URL` variable.

### Splunk Cloud Platform (logs, via HEC)

Logs do not go to Observability Cloud -- native Log Observer was
deprecated by Splunk in January 2024. See
[splunk-setup.md](splunk-setup.md#log-observer-connect-splunk-cloud-platform)
for the full architecture.

| Variable | Default | Description |
|---|---|---|
| `SPLUNK_HEC_URL` | (empty) | Splunk Cloud Platform HEC endpoint -- see note below, format varies by deployment |
| `SPLUNK_HEC_TOKEN` | (empty) | HEC token, generated in Splunk Web |
| `SPLUNK_HEC_INDEX` | `main` | Target index for log events |
| `SPLUNK_HEC_SOURCETYPE` | `otel` | Sourcetype assigned to log events |
| `SPLUNK_HEC_INSECURE_SKIP_VERIFY` | `false` | Set `true` only against a Splunk instance still using its default self-signed cert (e.g. an unprovisioned trial) -- never in production |

**`SPLUNK_HEC_URL` format varies.** Splunk documents
`https://http-inputs-<stack>.splunkcloud.com/services/collector` as the
standard pattern, but on some trials that hostname is never actually
provisioned in DNS. If so, check whether HEC is reachable directly on
the main stack hostname at port 8088 instead -- see
[splunk-setup.md](splunk-setup.md#log-observer-connect-splunk-cloud-platform)
for the diagnostic steps and why `SPLUNK_HEC_INSECURE_SKIP_VERIFY` may
also be needed in that case.

### Azure Monitor

| Variable | Default | Description |
|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | inert placeholder | App Insights connection string. **A credential** -- see the warning below |
| `AZURE_SUBSCRIPTION_ID` | (empty) | Target subscription. Defaults to the `az` CLI's current subscription if unset |
| `AZURE_RESOURCE_GROUP` | `rg-observability-test` | Resource group the setup script creates |
| `AZURE_LOCATION` | `uksouth` | Azure region for all created resources |
| `AZURE_APP_INSIGHTS_NAME` | `appi-rag-agent` | Application Insights resource name |
| `AZURE_LOG_ANALYTICS_NAME` | `law-rag-agent` | Log Analytics workspace name (App Insights is workspace-based, so this is required) |
| `AZURE_TAG_PURPOSE` | (empty) | Value for the `Purpose` tag on the resource group |
| `AZURE_TAG_RESPONSIBLE_OWNER` | (empty) | Value for the `Responsible Owner` tag on the resource group |

`scripts/setup-azure-monitor.sh` / `.ps1` creates the resource group, the Log
Analytics workspace and the Application Insights resource, tags the resource
group with `Purpose` and `Responsible Owner`, and prints the connection string
to paste into `.env`. You need an `az login` and nothing else.

> **The connection string cannot be rotated.** It embeds an ingestion key, so
> unlike `SPLUNK_ACCESS_TOKEN` there is no rotate-in-place remedy. If it
> leaks, the fix is creating a new Application Insights resource and
> repointing, which loses continuity of the data. Keep it in `.env` only.

### Choosing the observability backend

| Variable | Default | Description |
|---|---|---|
| `OTEL_COLLECTOR_CONFIG` | `./otel-collector-config.yaml` | Which collector config to mount, and therefore which backend receives telemetry |

| Value | Backend |
|---|---|
| `./otel-collector-config.yaml` | Splunk only |
| `./otel-collector-config.azure.yaml` | Azure Monitor only |
| `./otel-collector-config.dual.yaml` | Both, in parallel |

Dual mode sends byte-identical telemetry to both backends from one traffic
run, which is what makes a side-by-side comparison controlled rather than
approximate. See [azure-monitor-setup.md](azure-monitor-setup.md).

### MCP Services

| Variable | Default | Description |
|---|---|---|
| `MCP_PLAYWRIGHT_URL` | (empty) | Playwright MCP server URL (e.g. `http://host.docker.internal:8765/mcp`) |
| `MCP_PLAYWRIGHT_API_KEY` | (empty) | API key for the Playwright MCP server |
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

Azure OpenAI uses a different URL format and auth header. The code
auto-detects Azure endpoints by URL pattern -- no `LLM_PROVIDER` change
is needed, but setting it to `azure` is recommended for clarity.

The base URL must include `/openai/deployments/{deployment-name}`. The
code appends `/chat/completions` or `/embeddings` and the `?api-version=`
query parameter automatically.

```env
# --- LLM ---
LLM_PROVIDER=azure
LLM_API_BASE_URL=https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-LLM-DEPLOYMENT
LLM_API_KEY=your-azure-api-key
LLM_MODEL=gpt-4o-mini

# --- Embeddings ---
EMBEDDING_API_BASE_URL=https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-EMBEDDING-DEPLOYMENT
EMBEDDING_API_KEY=your-azure-api-key
EMBEDDING_MODEL=text-embedding-3-large

# --- Azure API version (optional, defaults to 2024-10-21) ---
# AZURE_API_VERSION=2024-10-21
```

> **Important:** Do NOT include `/embeddings`, `/chat/completions`, or
> `?api-version=` in the base URL -- the code adds these automatically.
> For example, use:
>
> ```
> https://ai-core-llms.openai.azure.com/openai/deployments/text-embedding-3-large
> ```
>
> Not:
>
> ```
> https://ai-core-llms.openai.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2024-10-21
> ```

After changing `.env`, restart the API:

```bash
docker compose restart api
```

## Swapping observability backends

The OTel Collector config (`otel-collector-config.yaml`) controls where
telemetry is sent. The `.env` file provides credentials. See
[OpenTelemetry](opentelemetry.md) for details on adding Splunk, Azure
Monitor, or Grafana exporters.
