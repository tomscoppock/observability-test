# Documentation

Comprehensive guides for the Observability Test project.

## Guides

| Document | Description |
|---|---|
| [Getting Started](getting-started.md) | Prerequisites, initial setup, first run |
| [Docker Commands](docker-commands.md) | All Docker Compose commands for the stack |
| [API Reference](api-reference.md) | Endpoints, request/response formats |
| [Configuration](configuration.md) | Environment variables and how to swap providers |
| [Architecture](architecture.md) | System design, service topology, data flow |
| [OpenTelemetry](opentelemetry.md) | OTel SDK setup, collector config, instrumentation |
| [Implementation Playbook](implementation-playbook.md) | **Start here to rebuild this elsewhere.** Transferable OTel-to-Splunk and OTel-to-Azure know-how, and the 33 traps |
| [Docker Desktop OTel](docker-desktop-otel.md) | Send Docker Desktop telemetry to the OTel Collector |
| [Splunk Setup](splunk-setup.md) | Dashboards, alerts, and monitoring in Splunk Observability Cloud |
| [Azure Monitor Setup](azure-monitor-setup.md) | Azure Monitor as an endpoint: resource provisioning, the three collector configs, workbook and alert deployment |
| [Splunk vs Azure Monitor](splunk-vs-azure-monitor.md) | Where the two backends genuinely differ, in both directions, chart by chart |
| [Demo Talk Track](demo-talk-track.md) | Scripted ~14 min demo walkthrough: Observability Cloud dashboards plus Splunk Cloud Platform log analytics |
| [Demo Talk Track: Azure](demo-talk-track-azure.md) | Scripted ~14 min Azure Monitor walkthrough, runnable off the same simulator invocation |
| [RAG Testing Guide](rag-testing-guide.md) | End-to-end testing of the RAG pipeline |
| [Troubleshooting](troubleshooting.md) | Common issues and fixes |

## Verification tooling

| Command | Checks |
|---|---|
| `python3 scripts/check_talk_tracks.py` | Every `[CHART]` marker and reference-table entry in both talk tracks names a chart that exists, and per-tab counts match the dashboards |
| `python3 scripts/compare_backends.py --markdown` | Captures the Azure side of the backend comparison table and names the Splunk chart to read for each row |
| `python3 scripts/validate_board.py --strict` | `.ai/` tracker data |

