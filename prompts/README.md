# Reusable instrumentation prompts

**Paste-ready prompts that carry this project's hard-won learnings into
another codebase.** Hand one to a coding agent and it should instrument a
service without the silent failures, empty dashboards and wrong-by-a-
factor-of-1000 charts that this project hit first.

Every snippet in them is copied from working, verified code in this
repository, not written fresh for the prompt. Every trap listed was found by
something breaking here, usually quietly.

## Pick what you need

| Prompt | Use it when | Depends on |
|---|---|---|
| [1. OpenTelemetry instrumentation](01-otel-instrumentation.md) | You want vendor-neutral instrumentation. Traces, metrics and logs into a collector, and nothing vendor-specific | nothing |
| [2. Splunk Observability Cloud](02-splunk-backend.md) | You want Splunk APM, Infrastructure Monitoring, dashboards and detectors as code | prompt 1 |
| [3. Azure Monitor](03-azure-monitor-backend.md) | You want Application Insights, a Workbook and alert rules as code | prompt 1 |
| [4. MCP or sidecar handoff](04-mcp-service-handoff.md) | A second service needs to reach the same backend | prompt 1 |

**Prompts 2 and 3 are not mutually exclusive.** Collector pipelines fan out
to every exporter listed, so one service can feed both backends from one
traffic run. That is how this project produced a controlled comparison
rather than an approximate one.

### Common combinations

| Goal | Run |
|---|---|
| Instrument now, choose a backend later | 1 |
| Splunk shop | 1, then 2 |
| Azure shop | 1, then 3 |
| Evaluating both, or migrating | 1, then 2 and 3 |
| Any of the above, plus an MCP server | add 4 |

Run prompt 1 **first and on its own**. The instrumentation is the durable
asset; a backend is a collector config change. Bolting a vendor onto missing
instrumentation produces empty dashboards and a long debugging session, which
is the single most common way this goes wrong.

## What these are worth

The prompts exist because the learnings are not discoverable from the code.
As a sample of what each one already handles:

- An OTel logs processor that discards **100% of logs** while 63 unit tests
  pass, because the exporter was passed positionally instead of in an
  options object.
- A `session.id` attribute set from Express middleware landing on the wrong
  span, silently breaking the same chart on **two independent backends** and
  looking like a vendor problem on both.
- Splunk's `service.request` being in **nanoseconds** while the spanmetrics
  connector's duration is milliseconds, so one dashboard shows two time units
  under the same label.
- That same metric **double-counting** every request unless filtered on
  `sf_dimensionalized`, which ratios hide and counts do not.
- An Azure workbook deploying `Succeeded` with a non-existent KQL function
  in twelve queries, because `serializedData` is an opaque string to ARM.
- An empty credential in one exporter taking down **every** signal, traces
  and metrics included.

## Full reference

The prompts are self-contained by design, so they can travel to a repo where
this documentation does not exist. If you have this repo to hand, the same
material is organised as documentation:

| Document | Contents |
|---|---|
| [Implementation Playbook](../docs/implementation-playbook.md) | The canonical version: 33 traps, plus OTel, Splunk and Azure implementation guides |
| [Splunk vs Azure Monitor](../docs/splunk-vs-azure-monitor.md) | Where the two backends genuinely differ, with measured figures |
| [Splunk setup](../docs/splunk-setup.md) | 27 sections on Splunk specifically |
| [Azure Monitor setup](../docs/azure-monitor-setup.md) | Azure specifically |

**Edit the playbook first, then mirror into these prompts.** The duplication
is deliberate, because the prompts travel to repos where the docs do not
exist, but it means the playbook is the source of truth and these files are
copies.
