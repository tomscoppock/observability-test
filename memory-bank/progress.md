# Progress

Last refreshed: 2026-08-18

## Works

- Project tracking framework fully set up (.ai/, memory-bank/, .archon/,
  .roo/rules/, .roomodes, AGENTS.md, CLAUDE.md).
- Epic 001 code complete: docker-compose.yml, api/ (Express + OTel SDK),
  nginx/ (reverse proxy + chat UI), otel-collector-config.yaml.
- All config externalised to .env (LLM, embedding, SurrealDB, OTel,
  Splunk, MCP).
- Three-layer secret enforcement (.gitignore, .claude/settings.json,
  .rooignore) in sync.
- Board validation passes (13 tasks, 5 epics, 0 errors).

## Left to do

> Refreshed 2026-09-08. **Epic 025 is closed and `.ai/in-progress/` is
> empty.** Epics 001-005 and tasks 006-039 are done; see `.ai/STATUS.md`
> and `.ai/done/` for the authoritative trail.

- **040 (backlog, high)** -- the only substantive item left. A
  coding-agent prompt applying this spike's OTel and Splunk learnings to
  the Knowledge Discovery agent: MCP discoverability, token consumption,
  SurrealDB infrastructure monitoring, APM/latency analysis. Prompt
  written; needs review against that repo and a Plan Mode run there.
- **034 (backlog, low)** -- web search toggle. Unrelated to
  observability.
- Optional follow-up, not tracked as a task: no test covers the OTel SDK
  wiring in `instrumentation.js`. The positional-argument bug that
  dropped 100% of logs was invisible to all 63 tests because they mock
  the logger provider. A meaningful test would be integration-level
  against a real or fake OTLP endpoint.

### Capability boundaries (not bugs, do not re-investigate)

Both established empirically and documented in `docs/splunk-setup.md`
Section 26, and covered in the demo talk track Section 7:

- **Log Observer Connect** needs a licensed non-trial Splunk platform.
  Logs DO reach Splunk Cloud Platform via HEC and are searchable there
  with `trace_id`/`span_id`; only the single-pane view in Observability
  Cloud is missing. A licence fixes it with no code changes.
- **APM AI Agent Monitoring and Splunk-side evals** are unreachable from
  Node.js: Splunk's instrumentation is Python-only, and the screens key
  off `invoke_agent`/`invoke_workflow` semantics. Evals additionally need
  a platform licence and prompt/response capture, which is a PII/data
  protection decision. A licence alone would NOT unlock these.

## Known issues

- `SPLUNK_HEC_INSECURE_SKIP_VERIFY=true` is currently required because
  the Splunk Cloud Platform trial's HEC port serves Splunk's default
  self-signed certificate. Revert to `false` on a properly provisioned
  instance.
- The documented `http-inputs-<stack>.splunkcloud.com` HEC hostname does
  not resolve on this trial; HEC is reachable on the main stack hostname
  at port 8088 instead.
- Log Observer Connect is unavailable on Splunk Cloud Platform trials
  (Splunk's own documented restriction), so trace-to-log correlation in
  Observability Cloud cannot be demonstrated on the current account.
- OTel SDK packages are experimental (0.x) and caret-ranged, so minor
  bumps can change APIs silently. This already caused a real outage: a
  `BatchLogRecordProcessor` constructor signature change (positional to
  options object) silently dropped every log record, invisible to the
  test suite because tests mock the logger provider. When telemetry goes
  missing, set `OTEL_LOG_LEVEL=debug` on the api service -- SDK export
  failures are otherwise completely silent.
- No test covers `instrumentation.js`'s SDK wiring.
