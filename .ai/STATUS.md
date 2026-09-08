# Project Status

Last updated: 2026-09-07

## Active work (per person)

| Assignee | Item | Epic | Since |
|---|---|---|---|
| @tom | 027 -- Demo talk track | 025 | 2026-09-04 |
| @tom | 028 -- Dashboard automation | 025 | 2026-09-04 |
| @tom | 037 -- Splunk AI overview and Azure Foundry | 025 | 2026-09-07 |
| @tom | 038 -- Evals and drift monitoring | 025 | 2026-09-07 |
| @tom | 039 -- Populate Splunk OOTB features via standard OTel | 025 | 2026-09-07 |

## Recently completed

- 036 -- Logs correlation and verification (@tom) -- done 2026-09-08
- 035 -- Fix token metrics dashboard (@tom) -- done 2026-09-07
- 033 -- Spanmetrics connector for custom span charts (@tom) -- done 2026-09-07
- 032 -- Dashboard 4-tab split (@tom) -- done 2026-09-07
- 031 -- Demo traffic simulation script (@tom) -- done 2026-09-07
- 030 -- Streaming chat with markdown rendering (@tom) -- done 2026-09-04
- 029 -- Docker Desktop OTel automation (@tom) -- done 2026-09-04
- Epic 025 -- Splunk demo and dashboard automation (@tom) -- in progress
  - 026 -- Splunk docs review and MCP monitoring section (@tom) -- done 2026-09-04
  - 027 -- Demo talk track (@tom) -- in progress
  - 028 -- Dashboard automation (@tom) -- in progress
  - 031 -- Demo traffic simulation script (@tom) -- done 2026-09-07
  - 032 -- Dashboard 4-tab split (@tom) -- done 2026-09-07
  - 033 -- Spanmetrics connector (@tom) -- done 2026-09-07
  - 035 -- Fix token metrics dashboard (@tom) -- done 2026-09-07
  - 036 -- Logs correlation and verification (@tom) -- done 2026-09-08 (pivoted to HEC: native Log Observer deprecated Jan 2024; also fixed a silent BatchLogRecordProcessor bug that was dropping ALL app logs. App logs confirmed searchable in Splunk Cloud Platform; Log Observer Connect descoped, blocked on non-trial licence)
  - 037 -- Splunk AI overview and Azure Foundry (@tom) -- in progress (7/10 items done via 039)
  - 038 -- Evals and drift monitoring (@tom) -- in progress (response length metric + drift detectors documented)
  - 039 -- Populate Splunk OOTB features (@tom) -- in progress (gen_ai attrs + metrics done, user verification pending)
- 034 -- Web search toggle (@tom) -- backlogged
- 024 -- Admin tab with database management UI (@tom) -- done 2026-09-04
- 018 -- Instrument LLM calls with gen_ai.* spans and token metrics (@tom) -- done 2026-09-04
- 014 -- Implement web scrape endpoint using Playwright MCP (@tom) -- done 2026-09-04
- 017 -- Add gen_ai normalizer processor to OTel Collector (@tom) -- done 2026-09-03
- 013+015+016 -- RAG Pipeline (@tom) -- done 2026-09-01
- 022 -- Add Express error-handling middleware (@tom) -- done 2026-08-26
- 021 -- Fix Splunk HEC logs exporter 404 (@tom) -- done 2026-08-26
- 012 -- Add custom logger service wrapping OTel logs API (@tom) -- done 2026-08-26
- 011 -- Add OTel SDK 2.x instrumentation (@tom) -- done 2026-08-25 (was already complete from Epic 002)
- 010 -- Splunk Observability Cloud signup (@tom) -- done 2026-08-18
- 009 -- Configure OTel Collector with Splunk exporters (@tom) -- done 2026-08-18
- Epic 002 -- OTel Collector Pipeline to Splunk -- done 2026-08-18
- 006 -- Create Docker Compose stack (@tom) -- done 2026-08-18
- 007 -- Create Node.js API skeleton (@tom) -- done 2026-08-18
- 008 -- Create basic chat UI (@tom) -- done 2026-08-18
- Epic 001 -- Docker Compose RAG Agent Stack -- done 2026-08-18

## Next up (top of backlog, per theme)

### otel-instrumentation

(none -- 012 done, 021/022 done)

### database

(none -- 023 absorbed into 024, 024 done)

### rag-agent / mcp-services

(none -- 014 done, 013+015+016 done)

### llm-observability

(none -- 018, 026, 027, 028 done)

## Blockers

- **Log Observer Connect (tasks 036, 039)** -- requires a licensed,
  non-trial Splunk Cloud Platform or Splunk Enterprise instance. Splunk
  documents it as unavailable on Cloud Platform trials, which is what
  this project has. Logs themselves DO reach Splunk Cloud Platform via
  HEC and are searchable there; only the trace-to-log correlation UI
  inside Observability Cloud is blocked. Needs a licensing decision.
- **Azure Foundry OTLP export (task 037, stretch)** -- would need the
  collector publicly reachable from Azure, not possible in the current
  Docker-only setup.

## Numbering

Next free backlog/epic/task number: **040**

<!-- Increment every time a numbered item is created in backlog/,
     in-progress/, epics/, or done/. Numbers are never reused. -->
