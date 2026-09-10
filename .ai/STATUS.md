# Project Status

Last updated: 2026-09-09

## Active work (per person)

- **Epic 042 -- Azure Monitor as a parallel observability backend (@tom)** --
  **five of six children shipped 2026-09-09.** 043 (collector dual-export),
  044 (setup docs), 045 (workbook + alert rules, runtime-validated), 046
  (parity findings with real measured figures) and 048 (learnings prompts)
  are all in `.ai/done/`. The epic stays open on **047 alone**.

  Working against the live tenant: resource group, Log Analytics workspace and
  App Insights created; workbook and three drift rules deployed; all 32
  workbook queries run and return rows; both backends compared over one shared
  window with counters matching exactly.

  **047 -- Azure demo talk track** is written and everything mechanically
  checkable is green (`scripts/check_talk_tracks.py` reports zero errors
  against `azure/workbook.json`). The only outstanding gate is a human
  clicking through the Azure portal after a simulator run, to confirm the
  named controls exist. Same class of gate 041 still holds for the Splunk
  track. Checklist is in the task file.

  Application code was changed once under this epic, deliberately and against
  the original scope: the `session.id` instrumentation defect. It was setting
  the attribute on the Express middleware span rather than the HTTP server
  span, which broke the same chart on BOTH backends and could not honestly be
  worked around in either dashboard. Fixed in `api/src/session-attributes.js`.

  **Talk tracks renumbered and a third added (2026-09-09).**
  `demo-talk-track-1-opentelemetry.md` is new: the vendor-neutral "why" track
  covering lock-in, the dual-backend proof, and an even-handed out-of-the-box
  comparison. The two product decks are now
  `demo-talk-track-2-splunk.md` and `demo-talk-track-3-azure.md`.

  Track 3 gained a section on Azure's prebuilt content. Verified against live
  telemetry rather than assumed: Azure Managed Grafana's bundled dashboards
  query App Insights with no proprietary plugin, and its **Agent Framework**
  dashboard **partly** populates -- LLM and token panels yes, agent and tool
  panels no, because this is a RAG pipeline rather than an agent framework.
  Written up as comparison section 6a, and it sharpens what 037 concluded:
  Splunk's AI screens are unreachable because the instrumentation is
  Python-only (a wall), Azure's because of span naming (a to-do). Both
  vendors' agent dashboards are empty here, for asymmetric reasons.

  **Two corrections and one new capability, 2026-09-10, found while walking
  the Splunk demo:**

  - **`gen_ai.response.finish_reasons` never reached Azure.** It is an array
    per the OTel spec, and the `azure_monitor` exporter drops array
    attributes outright (254 chat spans, zero carrying it, while the
    collector debug output showed `Slice(["stop"])` arriving fine). The app
    now emits a scalar `gen_ai.response.finish_reason` companion. This also
    invalidated a rule I had documented in five places claiming arrays
    "serialise as JSON text" -- they do not, they vanish. Now playbook trap
    34.
  - **Splunk AI Agent Monitoring is NOT licence-blocked.** That claim was an
    assumption, not something the vendor documents, and it was wrong. The
    real gate is prompt/response content capture, which is off by default.
    The "Python-only" framing was also too broad: the documentation is
    Python-shaped, but the requirement is span attributes, which any language
    can emit. What genuinely remains unreachable is the *agent-level* view,
    because this is a RAG pipeline with no `invoke_agent` spans -- the same
    reason Azure's equivalent dashboard is empty. Written up as
    `docs/splunk-setup.md` section 28.
  - **New: opt-in content capture.** `api/src/genai-content.js` honours the
    standard `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`, off by
    default, emitting `gen_ai.input.messages` / `gen_ai.output.messages` as
    JSON strings with an 8k cap. Verified end to end. The env vars alone do
    nothing for a hand-instrumented service, since they are read by GenAI
    auto-instrumentation, so the capture is implemented manually. 15 new
    tests, suite now 89.
  - **Correction to that capture, same day.** The first implementation put
    the raw prompt and answer text on those attributes. Splunk's AI
    Interactions view calls `JSON.parse` on them, so clicking a chat span
    threw `Unexpected token 'A', "According "... is not valid JSON` and its
    error boundary blanked the trace page. The GenAI conventions define a
    normative schema that instrumentations MUST follow: an array of
    messages, each `{ role, parts }`, each text part `{ type, content }`.
    Truncation also has to clip the text inside the structure, not the
    serialised document, or long conversations emit invalid JSON. Both
    fixed, verified on the wire; now playbook trap 35 and
    `docs/splunk-setup.md` section 28a. Suite 89 -> 96.
  - **Evaluations are self-service, not an entitlement.** The remaining open
    question from the item above is closed: per Splunk's setup guide the
    scores need the LLM Providers integration under Data Management >
    Available integrations, which is why the AI Details panel reads
    "Status: not evaluated". Not yet configured here.

  Splunk-side work done under this epic, beyond the Azure deliverables:
  eight dashboard charts fixed for double counting, the Active Sessions chart
  rewritten onto `span_metrics`, deprecated collector aliases migrated, and
  `docs/splunk-setup.md` section 27 plus talk-track presenter notes added.

- **041 -- Talk track click paths (@tom)** -- doc edits complete, awaiting
  live-tenant verification. Unchanged by 042.

- **041 -- Talk track click paths (@tom)** -- doc edits complete, awaiting
  live-tenant verification. Rewrote every `[SHOW]` in
  `docs/demo-talk-track-2-splunk.md` to give explicit navigation, and fixed three
  instructions that did not work as written: the Section 4 two-service
  filter (Splunk ORs multiple values inside one filter), the Section 6
  `llm.chatCompletion` span name (does not exist; it is `chat gpt-4o-mini`),
  and Section 5's Tag Spotlight assumptions (`gen_ai.response.finish_reasons`
  is not one of the five tags 039 indexed). Remaining gate is a literal
  walkthrough in the live org after a simulator run -- checklist is in the
  task file.

## Recently completed

- Epic 042 -- Azure Monitor as a parallel backend (@tom) -- **5 of 6 done 2026-09-09**
  - 043 -- Collector dual-export plumbing (@tom) -- done 2026-09-09
  - 044 -- Azure Monitor configuration documentation (@tom) -- done 2026-09-09
  - 045 -- Azure Workbook and alert rules as code (@tom) -- done 2026-09-09 (runtime-validated: 32/32 queries return rows)
  - 046 -- Splunk vs Azure Monitor parity findings (@tom) -- done 2026-09-09 (real measured figures, counters match exactly)
  - 048 -- Learnings prompts (@tom) -- done 2026-09-09 (playbook now 33 traps; 040 at 22, 048 prompt A at 20)

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

### azure-monitor

**Epic 042 -- Azure Monitor as a parallel observability backend** (@tom).
Fold Azure Monitor in as a second destination so the same traffic and the
same traces can be compared against Splunk like for like, without
disturbing the Splunk setup. Six children, all authored 2026-09-09:

- **043 -- Collector dual-export plumbing** (high). Three config files
  selected by `OTEL_COLLECTOR_CONFIG`; `azure_monitor` exporter,
  `cumulative_to_delta`, `transform/azure_dims`; split metrics pipelines in
  dual mode. No application code changed. Both new configs validate.
- **044 -- Azure Monitor configuration documentation** (high).
  `docs/azure-monitor-setup.md`, including the native-OTLP-plus-Entra
  production track documented but not built.
- **045 -- Azure Workbook and alert rules as code** (high). `azure/`
  workbook JSON plus two Bicep templates, and four setup scripts
  (provisioning and workbook deployment, bash and PowerShell). Blocked by
  043. **Carries the six-item runtime validation checklist.**
- **046 -- Splunk vs Azure Monitor parity findings** (high).
  `docs/splunk-vs-azure-monitor.md`. Written up with every claim labelled
  Verified / Reasoned / Unverified. Blocked by 043 and 045 for the
  measured-numbers table.
- **047 -- Azure Monitor demo talk track** (medium).
  `docs/demo-talk-track-3-azure.md`, runnable off the same simulator
  invocation as the Splunk deck. Blocked by 045 for live walkthrough.
- **048 -- Learnings prompts** (medium). Two pasteable coding-agent
  prompts, plus Part 3 and traps 14-22 added to
  `docs/implementation-playbook.md`. Prompt B's leading finding is that
  `playwright-mcp` needs no changes at all, because it already exports to
  the shared collector and pipelines fan out.

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

Next free backlog/epic/task number: **049**

<!-- Increment every time a numbered item is created in backlog/,
     in-progress/, epics/, or done/. Numbers are never reused. -->
