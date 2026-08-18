# System Patterns

<!-- Architecture patterns and conventions worth an agent knowing before
     it starts editing. Update rarely -- only when the project's shape
     actually changes. -->

## Architecture overview

```
Docker Compose Stack:
  Nginx (port 80)  -->  Node.js API (port 3000)  -->  SurrealDB (port 8000)
                              |
                              +--> LLM Backend (OpenAI-compat, via .env)
                              +--> MCP Services (Playwright, You.com)
                              |
                              +--> OTel Collector (OTLP on port 4318)
                                        |
                                        +--> Splunk Observability Cloud
                                        +--> Azure Monitor (future)
                                        +--> Grafana stack (future)
```

All services defined in `docker-compose.yml` at repo root. All config
from `.env`.

## Conventions

- **OTel instrumentation loads first:** `node --require ./src/instrumentation.js`
  in the Dockerfile CMD. If Express is imported before the SDK patches it,
  no spans will appear.
- **OTel JS SDK 2.x:** packages >= 2.0.0, Node.js >= 20.6.0
- **Upstream OTel Collector Contrib:** `otel/opentelemetry-collector-contrib`
  Docker image (not Splunk distribution)
- **LLM swappability:** All LLM calls use the OpenAI-compatible completions
  API pattern (`POST {LLM_API_BASE_URL}/chat/completions`). Switching
  providers = changing env vars.
- **gen_ai.* semantic conventions:** Official OTel direction for LLM
  observability. Use the gen-ai normalizer processor in the collector.
- **British English** spelling in all documentation and comments.
- **All secrets in `.env`:** never hardcoded, never committed. Three
  enforcement layers: `.gitignore`, `.claude/settings.json`, `.rooignore`.
