# Epic: 042 -- Azure Monitor as a parallel observability backend

Status: in-progress
Created: 2026-09-09
Theme: azure-monitor, otel-core
Lead: @tom

## Goal

Add Azure Monitor as a second telemetry destination alongside Splunk so the
same traffic, the same traces and an equivalent set of dashboards can be
compared like for like, without disturbing the working Splunk setup.

The comparison itself is the outcome, not the dashboard. Several charts cannot
be reproduced faithfully in either direction, and recording where each backend
genuinely wins or loses is the deliverable that carries forward into product
and architecture decisions.

## Scope

**Included**

- A collector configuration that can export to Splunk only, Azure Monitor
  only, or both in parallel, selected by environment variable
- Documentation for configuring Azure Monitor as the endpoint
- An Azure Workbook plus alert rules deployed as code, mirroring the 31
  Splunk charts and 3 SignalFlow drift detectors
- A demo talk track for the Azure surfaces, runnable off the same traffic
  simulator invocation as the Splunk one
- A written parity-findings comparison
- Ready-to-paste prompts so another coding agent can recreate this work

**Explicitly excluded**

- Native OTLP plus Entra ID ingestion (documented as the production track in
  044, not built -- it needs a DCE/DCR, an ARM template, a Monitoring Metrics
  Publisher role assignment, and is still in preview)
- Azure Monitor Agent and AKS add-on ingestion paths
- Azure Managed Grafana
- Azure Monitor workspace and the metrics namespace, so no metric alerts with
  Dynamic Thresholds
- Container Insights and VM Insights onboarding
- Any change to the Splunk config, dashboards, or detectors
- Any change to `api/src/` application code, with ONE exception taken
  deliberately: the `session.id` instrumentation defect found during
  runtime validation was fixed at source, because it silently broke the
  same chart on both backends and no dashboard-side workaround could be
  the right answer. See `docs/splunk-vs-azure-monitor.md` section 6.
- Action groups or notification wiring on the alert rules, matching the empty
  notification lists on the Splunk detectors

## Child items

<!-- List backlog/in-progress/done task numbers as they're created. Keep in
     sync with each child task's Epic: field. -->

- [x] 043 -- Collector dual-export plumbing for Azure Monitor (@tom) -- done 2026-09-09
- [x] 044 -- Azure Monitor configuration documentation (@tom) -- done 2026-09-09
- [x] 045 -- Azure Workbook and alert rules as code (@tom) -- done 2026-09-09, runtime-validated
- [x] 046 -- Splunk vs Azure Monitor parity findings (@tom) -- done 2026-09-09, real measured figures
- [ ] 047 -- Azure Monitor demo talk track (@tom) -- written and mechanically
      verified; the only outstanding gate is a live portal walkthrough
- [x] 048 -- Learnings prompts: Azure port and playwright-mcp handoff (@tom) -- done 2026-09-09

Five of six shipped. The epic stays open on 047 alone, which needs a human
clicking through the Azure portal after a simulator run -- the same class of
gate 041 still holds for the Splunk track. Everything a script can check on
047 is already green.

## Notes

### Why parallel export rather than a switch

Collector pipelines fan out to every exporter listed, so both backends receive
byte-identical telemetry from one traffic run. That makes the comparison
genuinely controlled: same spans, same metrics, two destinations, no
second instrumentation to account for. This is why 043 keeps the Splunk
`gen_ai.usage.prompt_tokens` / `completion_tokens` aliases rather than
tidying them away -- removing them would be a small optimisation that costs
the experiment its control.

### Ingestion path decision

Uses the community `azure_monitor` collector exporter, authenticated by
`APPLICATIONINSIGHTS_CONNECTION_STRING`. One environment variable, no Entra
identity, no DCE/DCR, no ARM orchestration, and it works from Docker on a
laptop. Data lands in the classic Application Insights schema, which is what
Workbooks and the App Insights UI expect.

Microsoft's recommended production path is native OTLP ingestion via
`otlphttp/azuremonitor` plus the `azure_auth` extension. It needs collector
>= 0.148, an Entra identity that works from outside Azure, a DCE and DCR
deployed by ARM template, and a role assignment, and it remains in preview.
Documented in 044, deliberately not built.

### Corrections to existing repo content, found during analysis

- `otlp_http` at `otel-collector-config.yaml:113` is **correct**, not a typo.
  Per the collector core README, `otlp_http` is now the canonical component
  name and `otlphttp` is the deprecated alias. No change needed. Recorded
  here because it looks like a typo and has been queried before.
- The snippet at `docs/opentelemetry.md:204` names the exporter
  `azuremonitor`. The real component type is `azure_monitor` with an
  underscore. As written it would fail config validation and stop the whole
  collector. Fixed in 043.

### The App Insights schema mapping every child depends on

| OTel | App Insights table |
|---|---|
| Span kind SERVER, CONSUMER | `requests` |
| Span kind CLIENT, PRODUCER, INTERNAL | `dependencies` |
| Span attributes | `customDimensions` on both tables |
| Log records | `traces`, correlated by `operation_Id` |
| Span events (exceptions) | `exceptions`, only if span events are enabled |
| Metrics, all kinds | `customMetrics` |
| `service.name` | `cloud_RoleName` |

Four query rules that are easy to get wrong and that every KQL query in 045
must obey:

1. Use `valueSum` and `valueCount`, never `value`. Counter total is
   `sum(valueSum)`. Histogram mean is `sum(valueSum) / sum(valueCount)`.
   Gauge reading is `avg(valueSum)`.
2. `customDimensions` values are strings even for numeric span attributes, so
   every numeric read is `tolong(tostring(customDimensions[...]))`.
3. `success` is a string in the classic view and a bool in the workspace view.
   Always `tobool(success) == false`.
4. Array attributes serialise as JSON text, so
   `gen_ai.response.finish_reasons` needs `parse_json(...)[0]`.

### Where parity breaks, in summary

The full write-up is 046's deliverable. The headline items, so no child task
rediscovers them:

- **`spanmetrics` is redundant on the Azure side and should be dropped from
  its pipeline.** Splunk needs the connector because its MetricSets cover only
  SERVER and CONSUMER spans; App Insights has no such gap because every CLIENT
  and INTERNAL span is a `dependencies` row with its own duration. The two
  backends will disagree on P90 and P99, and Azure will be more correct,
  because Splunk interpolates across bucket boundaries exactly where LLM
  latencies land.
- **Histogram percentiles do not survive ingest.** Buckets are flattened to
  sum/count/min/max. A true P90 is recoverable here only because the same
  values are redundantly on the span. Do not claim Azure preserves OTel
  histogram distributions.
- **App Insights has no infrastructure product.** The four Infrastructure
  charts are reproducible; Splunk's Infrastructure Navigators and
  APM-to-Infrastructure Related Content have no App Insights counterpart, so
  `resourcedetection`'s `host.name` buys nothing on the Azure side.
- **Drift detectors detect later in Azure, structurally.** Scheduled query
  rules have a floor of 5-minute evaluation plus Log Analytics ingestion
  latency; Splunk evaluates on the streaming pipeline seconds behind.
- **Azure wins on logs, Application Map and Smart Detection.** Logs land in
  the same resource as spans with no second product and no licence gate, where
  the Splunk side is blocked on Log Observer Connect needing a non-trial
  licence. Against that, App Insights retains 90 days versus 13 months for
  Splunk MetricSets.

### Security

The App Insights connection string embeds an ingestion key and is a
credential. `.env` only. Unlike the Splunk access token it **cannot be
rotated** -- remediation for a leak is creating a new App Insights resource
and repointing, which loses continuity of the data. The existing `.env.*`
globs in `.gitignore`, `.claude/settings.json` `permissions.deny` and
`.rooignore` already cover it, so 043 verifies rather than edits.

### Plan

`~/.claude/plans/ok-if-i-wanted-lazy-catmull.md`
