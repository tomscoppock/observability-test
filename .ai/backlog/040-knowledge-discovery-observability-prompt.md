# 040 -- Apply OTel/Splunk learnings to the Knowledge Discovery agent

Status: backlog
Priority: high
Assignee: @tom
Epic: 025
Theme: otel-instrumentation, llm-observability, splunk-observability
Tags: non-code
Repo: TungstenKnowledgeDiscovery
Stage: assessment

## Description

Carry everything learned in this observability-test spike across to the
full Knowledge Discovery agent, focusing on MCP discoverability, token
consumption, infrastructure monitoring (it also runs SurrealDB), and
APM/latency analysis. The deliverable is the ready-to-paste coding-agent
prompt below, not code in this repo.

## Acceptance criteria

- [ ] Prompt reviewed and adjusted for the Knowledge Discovery repo's
      actual stack (language, service names, MCP servers in use)
- [ ] Prompt run in the Knowledge Discovery repo, in Plan Mode first
- [ ] Resulting plan reviewed before implementation
- [ ] Cross-check that the four pitfalls in "Non-obvious traps" below are
      explicitly handled, since each one cost hours here

## Notes

Source material: `docs/opentelemetry.md`, `docs/splunk-setup.md`
(especially Sections 22, 25, 26), `docs/architecture.md`,
`docs/troubleshooting.md`, `otel-collector-config.yaml`, and
`.ai/done/036-logs-correlation-and-verification.md`.

The single most valuable thing in this prompt is the **Non-obvious
traps** section. Every item there was a silent failure, meaning the
system looked healthy while emitting nothing. Two of them cost most of a
day.

---

## The prompt

Paste the block below into Claude Code, in the Knowledge Discovery repo,
in Plan Mode.

````text
I want to add production-grade OpenTelemetry observability to this
Knowledge Discovery agent, exporting to Splunk. A sister project
(observability-test) already solved this end to end, and I want to apply
its learnings rather than rediscover them. Start in Plan Mode and ask me
about anything ambiguous before proposing a plan.

## Priorities, in order

1. **MCP discoverability** -- this agent calls MCP servers. I want each
   MCP server to appear as its own node on the Splunk APM service map,
   with distributed traces that cross the HTTP boundary into the MCP
   server and back, and per-tool latency and error rates.
2. **Token consumption** -- full LLM cost attribution: input/output/total
   tokens broken down by provider, model and operation, suitable for
   answering "what did this feature cost last week".
3. **Infrastructure monitoring** -- this agent uses SurrealDB. I want
   host, container and SurrealDB metrics in Splunk Infrastructure
   Monitoring, correlated with APM traces.
4. **APM and latency analysis** -- latency percentiles per internal
   operation (retrieval, embedding, LLM call, MCP tool call), not just
   per HTTP endpoint.

## Architecture to follow

- Upstream `otel/opentelemetry-collector-contrib` image, NOT a vendor
  distribution. This keeps the backend swappable (Splunk today, Azure
  Monitor or Grafana later) with no application changes.
- All configuration via `.env`, nothing hardcoded.
- Three signals, but note they do NOT all go to the same place:
  - Traces  -> `otlp_http/splunk` -> Splunk Observability Cloud (APM)
  - Metrics -> `signalfx`         -> Splunk Observability Cloud (Infra)
  - Logs    -> `splunk_hec`       -> Splunk Cloud Platform, via HEC
- Logs go to Splunk Cloud Platform because Splunk deprecated native Log
  Observer (direct log ingest into Observability Cloud) in January 2024.
  Observability Cloud reads them back in place via Log Observer Connect,
  which needs a licensed non-trial Splunk platform instance. Do not
  build against the old `v2/log/otlp` endpoint; it is a dead path.

## Non-obvious traps -- please handle all of these explicitly

These are silent failures. In each case the system reports itself
healthy while emitting nothing, so they are extremely expensive to
diagnose after the fact.

1. **Log processor constructor shape.** In `@opentelemetry/sdk-logs`
   0.2xx+, `BatchLogRecordProcessor` takes an OPTIONS OBJECT:
   `new BatchLogRecordProcessor({ exporter })`. Passing the exporter
   positionally leaves `options.exporter` undefined and every export
   throws internally, discarding 100% of logs. It is invisible because
   OTel's `diag` logger is a no-op by default, and invisible to tests
   that mock the logger provider. Verify the installed version's
   signature rather than trusting any example, including this one.
2. **Add an `OTEL_LOG_LEVEL` passthrough** on the app service from day
   one (default empty). OTel SDK export failures are silent without it.
   This is the only reason trap 1 was ever found.
3. **Pin or review OTel 0.x versions.** These packages are caret-ranged
   and pre-1.0; minor bumps change APIs. Trap 1 was introduced by a
   caret range resolving to a version with a changed constructor.
4. **The `splunk_hec` exporter rejects an empty `endpoint` or `token` at
   config-validation time**, which stops the ENTIRE collector, traces
   and metrics included. Give both non-empty placeholder defaults in
   docker-compose so an unconfigured checkout still boots. Verify with
   `docker run ... validate --config`.
5. **Splunk's built-in Monitoring MetricSets only cover SERVER and
   CONSUMER spans.** Your LLM calls, DB queries and MCP tool calls are
   INTERNAL/CLIENT spans, so they produce no metrics by default. Add the
   `spanmetrics` connector and declare the dimensions you want to break
   down by (provider, model, operation, tool name). This is essential
   for priority 4.
6. **Splunk drops cumulative histograms.** Set
   `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` on the app,
   and `send_otlp_histograms: true` on the signalfx exporter.
7. **Instrumentation must load before application code**, via
   `node --require ./src/instrumentation.js src/index.js` or the
   language equivalent.

## Splunk-side setup traps

8. **`SPLUNK_ACCESS_TOKEN` needs BOTH Ingest and API scopes** if one
   token serves both the collector (ingest) and any dashboard-automation
   script (management API). Splunk shows a warning when you combine
   them; it is expected and should be overridden. With API only, scripts
   work while the collector 401s on `/v2/datapoint` and silently drops
   everything. For API, the `power` role grants dashboard/detector
   writes.
9. **HEC token: leave "Enable indexer acknowledgement" UNCHECKED.** When
   on, HEC requires an `X-Splunk-Request-Channel` header the collector
   does not send, and every request fails with HTTP 400 "Data channel is
   missing".
10. **The HEC target index must appear in the token's Allowed Indexes**,
    or HEC returns 400 "Incorrect index". Avoid the `history` index; it
    is Splunk's internal search-history index.
11. **HEC endpoint hostnames vary and may not be provisioned.** Splunk
    documents `https://http-inputs-<stack>.splunkcloud.com/services/collector`
    (port 8088 on trials), but that DNS record does not always exist. If
    it fails to resolve, check the main stack hostname on port 8088.
    Diagnose by comparing the cert SANs on port 443 against DNS.
12. **Docker Compose gives shell environment variables precedence over
    `.env`.** Any script that exports `SPLUNK_*` into the shell will
    poison later `docker compose up` calls in that same terminal, and
    `--force-recreate` cannot help. Read `.env` into LOCAL variables in
    any helper script; never set process environment variables.
13. **MetricSets: TMS vs MMS.** Troubleshooting MetricSets power Tag
    Spotlight; Monitoring MetricSets power dashboards, alerting and
    13-month retention. Indexing a tag as TMS will not make it available
    to dashboards.

## Scope boundaries -- do not attempt these

- **Splunk APM > AI Agent Monitoring.** The documented instrumentation is
  Python-only (`splunk-otel-util-genai`); there is no Node.js path. It
  also expects `invoke_agent` / `invoke_workflow` / `execute_tool` span
  semantics. If this agent IS Python and genuinely has agent/workflow
  structure, it may be reachable, so tell me if you think that applies
  here rather than assuming.
- **Splunk-side LLM evals** (hallucination, toxicity, relevance scoring).
  Requires a platform licence AND shipping prompt/response content to
  Splunk. That content contains PII, so it is a data protection review,
  not a config toggle. Flag it, do not enable it.
- **Log Observer Connect setup.** Needs a licensed non-trial Splunk
  platform instance.

## Specific guidance per priority

**MCP discoverability.** W3C `traceparent` headers propagate across the
HTTP boundary automatically with HTTP auto-instrumentation on both sides,
so traces span into MCP servers without manual context plumbing. Set
`peer.service` on outbound MCP spans so the service map draws the edge.
Add span attributes for the tool name and arguments shape (not values, to
avoid leaking content), and add the tool name as a `spanmetrics`
dimension so per-tool latency and error rate become chartable. Watch the
networking trap: inside Docker, `localhost` means the container, so use
`host.docker.internal` to reach the host.

**Token consumption.** Use OTel GenAI semantic conventions rather than
custom names. Emit `gen_ai.operation.name`, `gen_ai.provider.name`,
`gen_ai.request.model`, `gen_ai.response.model`,
`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
`gen_ai.usage.total_tokens`, and `gen_ai.response.finish_reasons`.
Record token counts as a histogram with a `gen_ai.token.type`
(input/output) dimension, and mirror provider/model as spanmetrics
dimensions so cost can be sliced without MetricSet configuration. Cover
the streaming path too; it is easy to instrument the non-streaming call
and silently lose usage data on streams.

**Infrastructure monitoring (SurrealDB).** SurrealDB 3.1+ has native OTLP
telemetry: set `SURREAL_TELEMETRY_PROVIDER=otlp` and point
`OTEL_EXPORTER_OTLP_ENDPOINT` at the collector for `surrealdb.*` metrics,
traces and logs with no extra code. Add the `hostmetrics` and
`docker_stats` receivers, plus the `resourcedetection` processor, which is
what sets `host.name` and enables Related Content correlation between APM
and Infrastructure. Note that Splunk Database Monitoring does NOT support
SurrealDB (only MS SQL Server, PostgreSQL and Oracle); it will appear as
an inferred service via the `db.system` attribute. Add `db.query.text`
(sanitized, no parameter values) and `db.namespace` to DB spans for
trace-level query detail.

**APM and latency analysis.** Percentiles come from
`histogram('service.request')` for HTTP endpoints, and from the
spanmetrics `duration` histogram for internal operations. Build charts
per operation rather than per endpoint, since the interesting latency
lives in retrieval, embedding and LLM calls. Consider detectors that
compare a short window mean against a longer baseline (e.g. 5m vs 1h) for
latency, token count and response length; that pattern gives drift
detection with no code changes.

## What I want from you

1. Read this repo and tell me what already exists versus what is missing.
2. Ask me about anything ambiguous, especially the language/runtime, the
   MCP servers in use, and whether a Splunk platform licence is available.
3. Propose a plan covering the four priorities, explicitly stating how
   each numbered trap above is handled or why it does not apply.
4. Include a verification step per priority that proves data actually
   arrived in Splunk, not merely that the code runs. "Tests pass" is not
   evidence for telemetry; the sister project had 63 passing tests while
   emitting zero logs.
````
