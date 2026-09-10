# Splunk AI Agent Monitoring -- Python Smoke Test

Standalone smoke test using Splunk's own `splunk-otel-util-genai` Python
SDK to determine whether the AI Overview and AI Agents screens in Splunk
Observability Cloud accept telemetry from this account/collector setup.

**No real LLM call is made** -- the script simulates a single
Workflow > AgentInvocation > LLMInvocation with fake token counts and a
canned response.  It sends traces, histogram metrics, and log events
through the existing OTel Collector (which must be running).

## Prerequisites

- Python 3.10+ (Splunk's GenAI utility requires it)
- The project's OTel Collector running (`docker compose up -d otel-collector`)
- Collector listening on `localhost:4318` (OTLP HTTP) -- the default

## Quick start (Windows)

```powershell
cd scripts\splunk-ai-smoke-test
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python smoke_test.py
```

## Quick start (macOS / Linux)

```bash
cd scripts/splunk-ai-smoke-test
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python smoke_test.py
```

## What it does

1. Bootstraps the OTel SDK (TracerProvider, MeterProvider, LoggerProvider)
   with OTLP HTTP exporters pointing at `localhost:4318`.
2. Sets the three mandatory env vars for AI Agent Monitoring:
   - `OTEL_INSTRUMENTATION_GENAI_EMITTERS=span_metric`
   - `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY`
   - `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta`
3. Uses Splunk's `get_telemetry_handler()` to create a
   Workflow > Agent > LLM invocation with simulated data.
4. Waits for batch exporters to flush, then shuts down cleanly.

## Interpreting results

| AI Overview / AI Agents | Meaning |
|---|---|
| **Populates** within ~2 min | Splunk's Python SDK produces the right signals. The issue is in the Node.js telemetry format -- we need to reverse-engineer what the Python SDK emits differently. |
| **Still empty** | The issue is NOT the telemetry format. It is account config, collector routing, or a backend-side gate. |

## Overriding defaults

| Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Collector OTLP HTTP endpoint |
| `OTEL_SERVICE_NAME` | `splunk-ai-smoke-test` | Service name in Splunk APM |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=dev` | Resource attributes |

## Cleanup

```powershell
# Windows
deactivate
Remove-Item -Recurse -Force .venv
```

```bash
# macOS / Linux
deactivate
rm -rf .venv
```

The `.venv` directory is already in `.gitignore`.
