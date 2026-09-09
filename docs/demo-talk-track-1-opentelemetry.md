# Demo Talk Track 1: OpenTelemetry and avoiding lock-in

The "why" track. Runtime approximately 12 minutes.

Run this **before** track 2 (Splunk) or track 3 (Azure). It makes the case
that the instrumentation is the asset and the backend is a configuration
file, then the product tracks demonstrate it twice.

This track needs no dashboard. It is code, config and one command, which is
itself the argument: if the interesting part were vendor-specific, there
would be nothing to show here.

Last updated: 2026-09-09

Markers used throughout:

- **[SHOW]** -- what to open or run
- **[SAY]** -- voice-over
- **[HIGHLIGHT]** -- the point to land

Presenter-only asides appear as blockquotes beginning
`> **Presenter note:**`.

---

## Pre-demo preparation

1. Bring the stack up in **dual** mode so both backends are live:

   ```bash
   OTEL_COLLECTOR_CONFIG=./otel-collector-config.dual.yaml \
     docker compose up -d --build
   ```

2. Confirm the collector is healthy. Match the tab-delimited LEVEL field --
   grepping for the word "error" matches hundreds of metric names and
   attribute values from the debug exporter, not log lines:

   ```bash
   docker compose logs otel-collector | awk -F'\t' '$2 ~ /^(error|warn|fatal)$/'
   ```

   One `warn` about `root_path` from `host_metrics` is expected in Docker.

3. Run the traffic simulator at least 15 minutes ahead. Every chat message is
   a real LLM API call and costs money:

   ```bash
   ./scripts/simulate-demo-traffic.sh --duration 10
   ```

4. Have three files open in an editor: `api/src/instrumentation.js`,
   `otel-collector-config.yaml`, and `docs/splunk-vs-azure-monitor.md`.

---

## Opening (~1 minute)

**[SAY]** "Before I show you either vendor's dashboards, I want to show you
the thing underneath both of them, because that is the part that survives a
procurement decision."

**[SAY]** "This is a RAG agent: chat UI, Node API, vector database, an LLM,
and an MCP server for web scraping. It is instrumented once, with
OpenTelemetry. Right now that single instrumentation is feeding Splunk and
Azure Monitor simultaneously, from the same traffic, and I can prove the two
agree."

**[HIGHLIGHT]** "Nothing in the application knows which vendor is on the
other end. There is no Splunk SDK, no Application Insights package, and no
vendor distribution of the collector."

---

## Section 1: What the application actually knows (~2 minutes)

**[SHOW]** Open `api/src/instrumentation.js`. Scroll to the exporter block.

**[SAY]** "Here is the entire export configuration. Three OTLP exporters
pointed at a hostname from an environment variable. That is the total extent
of the application's knowledge about where telemetry goes."

**[SHOW]** Point at `OTEL_EXPORTER_OTLP_ENDPOINT`.

**[SAY]** "One variable. It names a collector, not a vendor."

**[SHOW]** Open `api/src/llm.js` and find the span attributes on the chat
span.

**[SAY]** "And here is the part that makes the data portable rather than just
the transport. These are `gen_ai.*` attributes from the OpenTelemetry
semantic conventions: operation name, provider, request model, response
model, input tokens, output tokens. Standard names, agreed across the
industry, not invented by us and not owned by a vendor."

**[HIGHLIGHT]** "That matters more than it sounds. Both vendors' AI-specific
dashboards key off these names. Emitting the convention is what makes a
vendor's prebuilt content light up without writing a line of vendor code."

> **Presenter note:** if someone asks about the two odd-looking aliases
> `gen_ai.usage.prompt_tokens` and `gen_ai.usage.completion_tokens`, they are
> deliberate. Splunk's MetricSet compatibility wanted the OpenAI-style names.
> They cost a few dozen bytes and are kept precisely so the application emits
> byte-identical telemetry to both backends. Removing them would be a small
> optimisation that costs the experiment its control.

---

## Section 2: The swap (~2 minutes)

**[SHOW]** Open `otel-collector-config.yaml`, scroll to the `exporters`
block, then to `service.pipelines`.

**[SAY]** "This is the collector. The exporters are named here and only here.
Switching from Splunk to Azure Monitor is editing this file, or in our case
choosing a different one."

**[SHOW]** In a terminal:

```bash
ls otel-collector-config*.yaml
```

**[SAY]** "Three configurations. Splunk only, Azure only, and both in
parallel. Which one runs is one environment variable."

**[SHOW]** Point at the `docker-compose.yml` volume line:

```yaml
- ${OTEL_COLLECTOR_CONFIG:-./otel-collector-config.yaml}:/etc/otelcol/config.yaml:ro
```

**[SAY]** "No rebuild, no code change, no redeploy of the application. The
container restarts and telemetry goes somewhere else."

**[HIGHLIGHT]** "That is the lock-in argument in one line of YAML. The cost
of changing your mind about a vendor is a config file and a collector
restart."

> **Presenter note -- one honest caveat, worth volunteering.** The pipelines
> are not perfectly symmetric. `span_metrics` and `host_metrics` feed Splunk
> only, and `cumulative_to_delta` runs on the Azure path only. Those
> differences exist because the two backends genuinely need different inputs,
> not because the abstraction leaks. Tracks 2 and 3 explain each one. If you
> gloss over it and someone reads the dual config later, it looks like you
> were hiding something.

---

## Section 3: Both at once, and the proof (~3 minutes)

**[SAY]** "Fan-out is the part people do not expect. A collector pipeline
sends to every exporter listed, so running two backends is not a migration
exercise. It is a list with two entries."

**[SHOW]** Open `otel-collector-config.dual.yaml`, point at the traces
pipeline:

```yaml
exporters: [debug, otlp_http/splunk, azure_monitor, span_metrics]
```

**[SAY]** "Same spans, same traffic run, two vendors. Which means the
comparison is controlled: no second instrumentation, no sampling difference,
no timing difference in what was captured."

> **Presenter note -- head this off before someone asks.** Three of those
> four entries are exporters. `span_metrics` is not: it is a **connector**,
> and connectors are one of the four component types the OpenTelemetry
> Collector defines, alongside receivers, processors and exporters. A
> connector bridges two pipelines by acting as an exporter on one end and a
> receiver on the other, which is why it shows up in an `exporters:` list
> here and again as a receiver in the metrics pipeline below.
>
> It is worth being explicit that this is **built into the collector**, not
> something we installed. It ships in the upstream
> `otel/opentelemetry-collector-contrib` image we already run. Nothing to
> add, no vendor plugin, no third-party dependency -- it is configuration.
> If it reads as a bolt-on, the lock-in argument gets weaker than it should
> be, because a standard OTel component doing this work is precisely the
> point.

**[SHOW]** Scroll down to the `connectors:` block, then to the
`metrics/splunk` pipeline where `span_metrics` appears again, this time as a
receiver.

**[SAY]** "Here it is doing both jobs. It reads every span leaving the traces
pipeline and derives request-rate, error-rate and duration metrics from them,
then feeds those into the metrics pipeline as if they had arrived from the
application."

**[HIGHLIGHT]** "Which is a good illustration of the wider point. That is a
standard OpenTelemetry component turning traces into metrics, in the
collector, once. Without it we would need a vendor agent to do the same job,
and we would need a different one per vendor."

**[SHOW]** Run the comparison:

```bash
python3 scripts/compare_backends.py --offset 1h
```

**[HIGHLIGHT]** Point at the counter rows.

**[SAY]** "Request count identical. Token counts identical to the digit.
Database call counts identical. These are the same events, counted twice by
two vendors, and they agree."

**[SAY]** "The percentile rows differ by up to fourteen percent, and that is
not an error, it is a finding. Splunk interpolates from fixed histogram
buckets, and the widest of those buckets is exactly where LLM latencies land.
Azure computes over raw span durations. Neither is wrong; they are answering
slightly different questions."

> **Presenter note:** this table is the most persuasive artefact in the
> project, and it only exists because of the vendor-neutral instrumentation.
> You cannot build it if each vendor needs its own agent, because then you
> are comparing two instrumentations rather than two backends. Say that out
> loud.

---

## Section 4: What you get out of the box, and where each is limited (~3 minutes)

**[SAY]** "Emitting the standard conventions buys you prebuilt content on
both platforms without writing dashboards. But the two are limited in
different and quite instructive ways."

**[SAY]** "Splunk's out-of-the-box experience is genuinely the cleaner of the
two. Service map, Tag Spotlight, Trace Analyzer, Related Content between APM
and infrastructure -- these are polished, coherent products, and you land in
them without configuring anything."

**[HIGHLIGHT]** "What limits Splunk here is commercial and structural, not
UX. Log Observer Connect needs a licensed, non-trial platform, so the
single-pane log-and-trace view is gated behind a purchase. And the AI Agent
Monitoring screens are documented for Python only, so a Node service cannot
reach them regardless of what it emits."

**[SAY]** "Azure is the mirror image. The out-of-the-box product surface is
plainer, and there is no infrastructure experience at all for a stack like
this. But all three signals land in one resource with no licence gate, and
the prebuilt AI content is reachable from any language, because it keys off
the OpenTelemetry conventions rather than a vendor SDK."

> **Presenter note -- the agent dashboards, and be precise here.** Both
> vendors ship agent-oriented AI dashboards, and **neither fully populates
> from this application**, for the same underlying reason: this is a RAG
> pipeline making direct LLM calls, not an agent framework. Both key off
> agent span semantics -- `invoke_agent`, `execute_tool`, `gen_ai.agent.name`
> -- that we do not emit.
>
> The important nuance is *why* each is unreachable. Splunk's is unreachable
> because the instrumentation is Python-only: a language restriction we
> cannot close from Node. Azure's is unreachable because of span **naming**:
> a convention we could adopt. That is the difference between a wall and a
> to-do item, and it is worth stating plainly rather than lumping both under
> "does not work".

**[SAY]** "So the fair summary is that Splunk gives you a better product
today and charges you for the best parts, and Azure gives you a more open
surface with less polish. Neither of those is a consequence of
OpenTelemetry. Both are visible only because we could run them side by side."

---

## Section 5: What vendor-neutral does NOT give you (~2 minutes)

**[SAY]** "I want to be straight about the limits, because 'write once, run
anywhere' oversells it."

**[SAY]** "The telemetry is portable. The **interpretation** of it is not."

**[SHOW]** Open `docs/splunk-vs-azure-monitor.md`, scroll to the measured
numbers section.

**[HIGHLIGHT]** "One: units. The same duration arrives in nanoseconds in one
Splunk metric and milliseconds in another, and milliseconds in Azure. The
transport was identical; the semantics on arrival were not."

**[HIGHLIGHT]** "Two: aggregation. Azure discards histogram buckets at
ingest, so a true P90 cannot be recovered from the metric. We only get one
because the same value happens to be on the span as well."

**[HIGHLIGHT]** "Three: querying. Splunk needs a high-cardinality tag indexed
before a dashboard can group by it, and that indexing has no public API.
Azure needs no such step because its store is log-backed. That is an
architectural difference between the two products, and no amount of
OpenTelemetry makes it go away."

**[SAY]** "So the honest claim is not that vendors become interchangeable. It
is that the expensive, invasive, code-level work is done once, and what
remains per vendor is configuration and dashboard authoring."

---

## Closing (~1 minute)

**[SAY]** "Three things to take away."

**[SAY]** "The instrumentation is an asset with a longer life than the vendor
contract. It lives in the application, it uses agreed semantic conventions,
and it does not name a vendor."

**[SAY]** "Running two backends in parallel is cheap enough to do during an
evaluation, which turns a procurement argument into a measurement."

**[SAY]** "And the per-vendor work that remains is real but bounded, and we
wrote all of it down. Every trap we hit is in a playbook, and the whole thing
is packaged as prompts another team can hand to a coding agent."

**[SHOW]** Open `prompts/README.md`.

**[SAY]** "Pick one, two or three. Instrumentation on its own, plus Splunk,
plus Azure. That is the deliverable."

---

## Related

- [demo-talk-track-2-splunk.md](demo-talk-track-2-splunk.md) -- the Splunk
  product demo
- [demo-talk-track-3-azure.md](demo-talk-track-3-azure.md) -- the Azure
  product demo, runnable off the same simulator invocation
- [splunk-vs-azure-monitor.md](splunk-vs-azure-monitor.md) -- the evidence
  behind every comparison claim above
- [implementation-playbook.md](implementation-playbook.md) -- all 33 traps
- [`prompts/`](../prompts/) -- the reusable deliverable
