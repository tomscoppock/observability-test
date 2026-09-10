#!/usr/bin/env python3
"""
Splunk AI Agent Monitoring -- standalone smoke test.

Uses Splunk's own `splunk-otel-util-genai` code-based instrumentation to
send a single Workflow > AgentInvocation > LLMInvocation trace with
histogram metrics through the existing OTel Collector to Splunk.

No real LLM call is made -- the response is simulated.  The purpose is
to confirm whether Splunk's Python SDK produces telemetry that the
AI Overview / AI Agents screens accept, isolating the question from
our Node.js instrumentation.

Usage
-----
    cd scripts/splunk-ai-smoke-test
    python -m venv .venv
    .venv\\Scripts\\activate        # Windows
    # source .venv/bin/activate   # macOS / Linux
    pip install -r requirements.txt
    python smoke_test.py

Environment variables (set in shell or .env alongside this script):
    OTEL_EXPORTER_OTLP_ENDPOINT           default http://localhost:4318
    OTEL_SERVICE_NAME                     default splunk-ai-smoke-test
    OTEL_RESOURCE_ATTRIBUTES              default deployment.environment=dev
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE  forced to delta
    OTEL_INSTRUMENTATION_GENAI_EMITTERS   forced to span_metric
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT  forced to SPAN_ONLY
"""

from __future__ import annotations

import os
import sys
import time

# ---------------------------------------------------------------------------
# Force the env vars Splunk requires BEFORE importing any OTel packages.
# ---------------------------------------------------------------------------
os.environ.setdefault("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
os.environ.setdefault("OTEL_SERVICE_NAME", "splunk-ai-smoke-test")
os.environ.setdefault(
    "OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=dev"
)

# These three are mandatory for AI Agent Monitoring:
os.environ["OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE"] = "delta"
os.environ["OTEL_INSTRUMENTATION_GENAI_EMITTERS"] = "span_metric"
os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "SPAN_ONLY"

# Optional: enable debug logging for the GenAI utility
os.environ.setdefault("OTEL_INSTRUMENTATION_GENAI_DEBUG", "true")

# ---------------------------------------------------------------------------
# OTel SDK bootstrap -- mirrors what `opentelemetry-instrument` does.
# ---------------------------------------------------------------------------
from opentelemetry import trace  # noqa: E402
from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import BatchSpanProcessor  # noqa: E402
from opentelemetry.sdk.resources import Resource  # noqa: E402
from opentelemetry.sdk.metrics import MeterProvider  # noqa: E402
from opentelemetry.sdk.metrics.export import (  # noqa: E402
    PeriodicExportingMetricReader,
)
from opentelemetry.sdk._logs import LoggerProvider  # noqa: E402
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor  # noqa: E402
from opentelemetry import metrics as metrics_api  # noqa: E402
from opentelemetry import _logs as logs_api  # noqa: E402

# OTLP HTTP exporters (the collector listens on 4318 for HTTP)
from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # noqa: E402
    OTLPSpanExporter,
)
from opentelemetry.exporter.otlp.proto.http.metric_exporter import (  # noqa: E402
    OTLPMetricExporter,
)
from opentelemetry.exporter.otlp.proto.http._log_exporter import (  # noqa: E402
    OTLPLogExporter,
)


def _parse_resource_attributes(raw: str) -> dict[str, str]:
    """Parse 'k1=v1,k2=v2' into a dict."""
    attrs: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if "=" in pair:
            k, v = pair.split("=", 1)
            attrs[k.strip()] = v.strip()
    return attrs


def setup_otel() -> None:
    """Configure the OTel SDK with OTLP HTTP exporters."""
    endpoint = os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"]
    service_name = os.environ["OTEL_SERVICE_NAME"]
    res_raw = os.environ.get("OTEL_RESOURCE_ATTRIBUTES", "")

    res_attrs = _parse_resource_attributes(res_raw)
    res_attrs["service.name"] = service_name
    resource = Resource.create(res_attrs)

    # Traces
    tp = TracerProvider(resource=resource)
    tp.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces"))
    )
    trace.set_tracer_provider(tp)

    # Metrics (delta temporality is set via env var above)
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{endpoint}/v1/metrics"),
        export_interval_millis=5000,
    )
    mp = MeterProvider(resource=resource, metric_readers=[reader])
    metrics_api.set_meter_provider(mp)

    # Logs / Events
    lp = LoggerProvider(resource=resource)
    lp.add_log_record_processor(
        BatchLogRecordProcessor(
            OTLPLogExporter(endpoint=f"{endpoint}/v1/logs")
        )
    )
    logs_api.set_logger_provider(lp)

    print(f"[smoke] OTel SDK configured -- endpoint={endpoint}")
    print(f"[smoke] service.name={service_name}")
    print(f"[smoke] resource.attributes={res_attrs}")


# ---------------------------------------------------------------------------
# Splunk GenAI utility -- code-based instrumentation
# ---------------------------------------------------------------------------
def run_smoke_test() -> None:
    """Send one Workflow > Agent > LLM invocation using Splunk's SDK."""
    # These imports must come AFTER the OTel SDK is initialised.
    from opentelemetry.util.genai.types import (
        Workflow,
        AgentInvocation,
        LLMInvocation,
        InputMessage,
        OutputMessage,
        Text,
    )
    from opentelemetry.util.genai.handler import get_telemetry_handler

    handler = get_telemetry_handler()

    user_question = "What is the company leave policy?"

    # --- Workflow ---
    workflow = Workflow(
        name="rag_pipeline",
        workflow_type="retrieval_augmented_generation",
        input_messages=[
            InputMessage(
                role="user",
                parts=[Text(content=user_question)],
            )
        ],
    )
    handler.start_workflow(workflow)
    print("[smoke] Started workflow: rag_pipeline")

    # --- Agent ---
    agent = AgentInvocation(
        name="knowledge_agent",
        agent_type="rag",
        model="gpt-4o-mini",
        system_instructions="You are a helpful HR assistant.",
        input_messages=workflow.input_messages,
    )
    handler.start_agent(agent)
    print("[smoke] Started agent: knowledge_agent")

    # --- LLM call (simulated) ---
    llm_call = LLMInvocation(
        request_model="gpt-4o-mini",
        operation="chat",
        input_messages=[
            InputMessage(
                role="system",
                parts=[
                    Text(
                        content="You are a helpful HR assistant. "
                        "Answer based on company policy documents."
                    )
                ],
            ),
            InputMessage(
                role="user",
                parts=[Text(content=user_question)],
            ),
        ],
    )
    llm_call.provider = "openai"
    llm_call.framework = "native-client"
    handler.start_llm(llm_call)
    print("[smoke] Started LLM invocation: chat / gpt-4o-mini")

    # Simulate latency
    time.sleep(0.35)

    # Simulated response
    assistant_text = (
        "According to the company leave policy, employees are entitled "
        "to 25 days of annual leave per year, plus public holidays. "
        "Leave requests should be submitted at least two weeks in advance "
        "through the HR portal."
    )

    llm_call.output_messages = [
        OutputMessage(
            role="assistant",
            parts=[Text(content=assistant_text)],
            finish_reason="stop",
        )
    ]
    llm_call.input_tokens = 42
    llm_call.output_tokens = 51

    handler.stop_llm(llm_call)
    print("[smoke] Stopped LLM invocation (42 in / 51 out tokens)")

    agent.output_result = assistant_text
    handler.stop_agent(agent)
    print("[smoke] Stopped agent: knowledge_agent")

    workflow.final_output = assistant_text
    handler.stop_workflow(workflow)
    print("[smoke] Stopped workflow: rag_pipeline")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print("=" * 60)
    print("Splunk AI Agent Monitoring -- Python smoke test")
    print("=" * 60)

    setup_otel()
    print()

    run_smoke_test()
    print()

    # Give the batch exporters time to flush
    print("[smoke] Waiting 10 s for batch exporters to flush ...")
    time.sleep(10)

    # Explicit shutdown to force final flush
    trace.get_tracer_provider().shutdown()  # type: ignore[union-attr]
    metrics_api.get_meter_provider().shutdown()  # type: ignore[union-attr]
    logs_api.get_logger_provider().shutdown()  # type: ignore[union-attr]

    print("[smoke] Done. Check Splunk APM > AI Overview / AI Agents.")
    print(
        "[smoke] If those screens populate, the issue is in the Node.js "
        "telemetry format."
    )
    print(
        "[smoke] If they remain empty, the issue is account/backend "
        "configuration."
    )


if __name__ == "__main__":
    main()
