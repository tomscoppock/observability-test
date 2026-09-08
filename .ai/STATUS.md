# Project Status

Last updated: 2026-09-08

## Active work (per person)

(None -- Epic 025 closed 2026-09-08. Next up: 040, the capstone item.)

## Recently completed

- Epic 025 -- Splunk demo and dashboard automation (@tom) -- **done 2026-09-08**
- 039 -- Populate Splunk OOTB features via standard OTel (@tom) -- done 2026-09-08
- 038 -- Evals and drift monitoring (@tom) -- done 2026-09-08
- 037 -- Splunk AI overview and Azure Foundry (@tom) -- done 2026-09-08 (both Azure Foundry items descoped; AI overview established as unreachable from Node.js)
- 028 -- Dashboard automation (@tom) -- done 2026-09-08
- 027 -- Demo talk track (@tom) -- done 2026-09-08
- 036 -- Logs correlation and verification (@tom) -- done 2026-09-08
- 035 -- Fix token metrics dashboard (@tom) -- done 2026-09-07
- 033 -- Spanmetrics connector for custom span charts (@tom) -- done 2026-09-07
- 032 -- Dashboard 4-tab split (@tom) -- done 2026-09-07
- 031 -- Demo traffic simulation script (@tom) -- done 2026-09-07
- 030 -- Streaming chat with markdown rendering (@tom) -- done 2026-09-04
- 029 -- Docker Desktop OTel automation (@tom) -- done 2026-09-04
- Epic 025 -- Splunk demo and dashboard automation (@tom) -- done 2026-09-08
  - 026 -- Splunk docs review and MCP monitoring section (@tom) -- done 2026-09-04
  - 027 -- Demo talk track (@tom) -- done 2026-09-08 (added Section 7 covering trial/free boundaries explicitly)
  - 028 -- Dashboard automation (@tom) -- done 2026-09-08 (verified against the live eu2 org)
  - 031 -- Demo traffic simulation script (@tom) -- done 2026-09-07
  - 032 -- Dashboard 4-tab split (@tom) -- done 2026-09-07
  - 033 -- Spanmetrics connector (@tom) -- done 2026-09-07
  - 035 -- Fix token metrics dashboard (@tom) -- done 2026-09-07
  - 036 -- Logs correlation and verification (@tom) -- done 2026-09-08 (pivoted to HEC: native Log Observer deprecated Jan 2024; also fixed a silent BatchLogRecordProcessor bug that was dropping ALL app logs. App logs confirmed searchable in Splunk Cloud Platform; Log Observer Connect descoped, blocked on non-trial licence)
  - 037 -- Splunk AI overview and Azure Foundry (@tom) -- done 2026-09-08 (AI Agent Monitoring established as unreachable: Python-only instrumentation plus agent/workflow span semantics. Azure Foundry descoped: collector not publicly reachable from Azure)
  - 038 -- Evals and drift monitoring (@tom) -- done 2026-09-08 (response length metric, 3 drift detectors, golden Q&A harness in scripts/run-eval.*)
  - 039 -- Populate Splunk OOTB features (@tom) -- done 2026-09-08 (Tag Spotlight MetricSets indexed, Infrastructure host+container metrics verified via API, Log Observer Connect descoped)
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

- **040 -- Apply OTel/Splunk learnings to the Knowledge Discovery agent**
  (high). The capstone item: a ready-to-paste coding-agent prompt
  carrying this spike's learnings into the Knowledge Discovery repo,
  covering MCP discoverability, token consumption, SurrealDB
  infrastructure monitoring, and APM/latency analysis. The prompt is
  written and detailed (full SDK/collector/compose implementation plus
  Splunk setup, SignalFlow and detector snippets, all copied from
  verified working code here). Needs review against that repo's actual
  stack, then a Plan Mode run there.

  The same material is now canonical project documentation in
  `docs/implementation-playbook.md`, linked from the docs index, README,
  `opentelemetry.md`, `splunk-setup.md` and `architecture.md`. The
  duplication into 040 is deliberate: that prompt travels to another repo
  where these docs will not exist. Edit the playbook first, then mirror.

  **Authoring is complete as of 2026-09-08.** The task stays in backlog
  because its remaining acceptance criteria (run the prompt, review the
  resulting plan, confirm each trap is handled) can only be done in the
  Knowledge Discovery repo. Re-raise those in that repo's tracker when
  the work starts; nothing further is actionable here.

### rag-agent (backlog)

- 034 -- Web search toggle (low)

## Blockers

None blocking active work. Two capability boundaries recorded for the
record, both established empirically and documented in
`docs/splunk-setup.md` Section 26:

- **Log Observer Connect** -- requires a licensed, non-trial Splunk Cloud
  Platform or Splunk Enterprise instance. Three independent gates on a
  trial: not offered for Cloud Platform trials, its IP allow list is
  configured via a support case, and trials cannot open support cases.
  Logs DO reach Splunk Cloud Platform via HEC with `trace_id`/`span_id`
  and are fully searchable there; only the single-pane correlation view
  inside Observability Cloud is unavailable. Needs a licensing decision,
  no code changes.
- **APM > AI Agent Monitoring and Splunk-side evals** -- unreachable from
  this Node.js stack. Splunk's instrumentation is documented for Python
  only, and the screens key off `invoke_agent`/`invoke_workflow` span
  semantics rather than the `chat`/`embeddings` this app emits. The evals
  additionally need a platform licence and prompt/response content
  capture, the latter being a data protection decision (PII) rather than
  a config change. Both explicitly out of scope, and covered in the demo
  talk track Section 7.

## Numbering

Next free backlog/epic/task number: **041**

<!-- Increment every time a numbered item is created in backlog/,
     in-progress/, epics/, or done/. Numbers are never reused. -->
