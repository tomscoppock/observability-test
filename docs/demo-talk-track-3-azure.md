# Demo Talk Track 3: Azure Monitor

Scripted walkthrough of the Azure Monitor surfaces for the RAG agent stack.
Runtime approximately 16 minutes.

**Third of three.** Run [track 1](demo-talk-track-1-opentelemetry.md) first
if the audience needs the vendor-neutral argument.
[Track 2](demo-talk-track-2-splunk.md) covers Splunk and runs off the **same**
simulator invocation, so the two product demos can be presented back to back
without regenerating traffic.

Last updated: 2026-09-09

Markers used throughout:

- **[SHOW]** -- what to navigate to and click
- **[SAY]** -- voice-over
- **[HIGHLIGHT]** -- the data point to call out
- **[CHART]** -- the workbook item name, which must match exactly

Presenter-only asides appear as blockquotes beginning
`> **Presenter note:**`.

---

## Pre-demo preparation

Do all of this at least 15 minutes before presenting. The drift rules need
longer, see below.

1. Bring the stack up in **dual** mode, so both backends receive identical
   telemetry and either deck can be presented from the same run:

   ```bash
   OTEL_COLLECTOR_CONFIG=./otel-collector-config.dual.yaml \
     docker compose up -d --build
   ```

   ```powershell
   $env:OTEL_COLLECTOR_CONFIG = './otel-collector-config.dual.yaml'
   docker compose up -d --build
   ```

2. Confirm the collector is healthy. An invalid config or an empty connection
   string stops every pipeline, not just the Azure one:

   ```bash
   # Match the tab-delimited LEVEL field. Grepping for the word "error"
   # matches hundreds of metric names and attribute values from the debug
   # exporter, not log lines.
   docker compose logs otel-collector | awk -F'	' '$2 ~ /^(error|warn|fatal)$/'
   ```

   ```powershell
   docker compose logs otel-collector | Select-String -Pattern "`t(error|warn|fatal)`t"
   ```

   One `warn` about `root_path` from `host_metrics` is expected in Docker and
   is harmless. Anything else, stop and fix it before presenting.

3. Run the traffic simulator. Every chat message is a real LLM API call, so
   this costs money:

   ```bash
   ./scripts/simulate-demo-traffic.sh --duration 10
   ```

   Options: `--rounds N`, `--duration M`, `--load light|heavy`,
   `--no-errors`. `heavy` quarters the pauses and triples chat volume.

4. Wait approximately 2 minutes after the simulator finishes for the metric
   flush and Log Analytics ingestion.

5. Verify all five signals actually arrived, in the Application Insights
   **Logs** blade. Every one must return rows:

   ```kql
   requests      | summarize count() by cloud_RoleName
   dependencies  | summarize count() by name
   customMetrics | summarize count() by name
   traces        | summarize count() by severityLevel
   exceptions    | summarize count()
   ```

6. Set the workbook **Time range** parameter to `Last hour`.

7. Note the three session IDs the simulator prints. They are used in Section 6.

> **Presenter note -- drift rules:** the three scheduled query rules in
> Section 7 need roughly an hour of traffic before their baselines mean
> anything, and they carry sample-size guards that suppress them below 30
> baseline observations. If you want them to have evaluated at least once,
> start the stack an hour ahead. If you cannot, present the rule definitions
> rather than their state, and say so.

> **Presenter note -- MCP:** `playwright-mcp` is an external service. If
> `MCP_PLAYWRIGHT_URL` is not set the simulator skips its scrape phase, and
> the MCP chart in Section 4 will be empty. Check before presenting rather
> than discovering it live.

---

## Opening (~30 seconds)

**[SHOW]** In the Azure portal, go to **Application Insights** and open the
`appi-rag-agent` resource. From the left navigation, select **Workbooks**,
then open **RAG Agent -- Observability** from the gallery.

**[SAY]** "This is the same RAG agent, instrumented once with vendor-neutral
OpenTelemetry, reporting into Azure Monitor. The important thing about what
you are about to see is that the application knows nothing about Azure. There
is no Azure SDK in it, no Application Insights package, no vendor
instrumentation. One collector configuration change is the entire difference,
and right now that collector is sending the identical telemetry to Splunk at
the same time."

**[SHOW]** Point out the five tabs across the top: **Service Overview**,
**RAG Pipeline**, **LLM and AI**, **Infrastructure**, **Logs and Traces**.

**[SAY]** "Four of these mirror the Splunk dashboard tab for tab. The fifth
has no Splunk equivalent in this project, and we will get to why."

---

## Section 1: Application Map (~1.5 minutes)

**[SHOW]** Leave the workbook. In the Application Insights left navigation,
under **Investigate**, select **Application map**.

**[SAY]** "This is the service topology, and nobody built it. Azure inferred
it from the trace data."

**[HIGHLIGHT]** The `rag-api` node, the `surrealdb` dependency, and the
`playwright-mcp` node if MCP traffic ran. Point at the call counts and average
durations on the edges.

**[SHOW]** Click the `rag-api` node. In the panel that opens on the right,
note the request and failure counts, then select **Investigate performance**.

**[SAY]** "Failure rate, call volume and latency per node and per edge, with
no configuration."

> **Presenter note -- this is a genuine Azure win, and worth naming as one.**
> Getting the equivalent service map edges in Splunk required hand-setting
> `peer.service` on outbound calls, which is documented in the implementation
> playbook section 1.5. Here it came free because all three services report
> into one Application Insights resource. Do not oversell it beyond that:
> a single-resource topology is the easy case.

**[SHOW]** Return to the workbook via the browser back button.

---

## Section 2: Service Overview, the RED signals (~2 minutes)

**[SHOW]** In the workbook, select the **Service Overview** tab.

**[CHART]** `Requests and error rate by service`

**[SAY]** "Request count and error rate for all three services in one view.
The error rate is deliberately non-zero: the simulator drives a handful of
real failures so there is something to investigate."

**[HIGHLIGHT]** The error rate percentage on the `rag-api` tile.

**[CHART]** `Request rate (rag-api)`

**[CHART]** `Service latency P50 / P90 / P99 (ms)`

**[SAY]** "Latency distribution over time. And here is the first honest
difference from the Splunk deck: these percentiles are computed from raw
per-request durations. On the Splunk side the same chart interpolates from a
fixed set of histogram buckets, and the widest of those buckets are two to
five seconds and five to ten seconds, which is exactly where LLM calls land.
So the two dashboards will show different P90s for the same traffic, and this
is the more accurate one."

> **Presenter note:** if asked which is "right" -- Azure's number is the more
> accurate one for the same data. Splunk's approach is cheaper to query at
> scale, because it reads pre-aggregated series rather than scanning raw rows.
> That is a real trade-off, not a defect. It is written up in
> `docs/splunk-vs-azure-monitor.md` section 1.

**[CHART]** `Error count by endpoint (top 5)`

**[CHART]** `Top endpoints (top 10)`

**[SAY]** "Endpoint breakdown by volume and by errors."

> **Presenter note:** `/health` will dominate `Top endpoints`, because
> Docker's healthcheck and the Nginx upstream probe both hit it. That is
> deliberately not filtered out, so this chart matches the Splunk one exactly.
> Mention it before someone asks.

---

## Section 3: RAG Pipeline (~2 minutes)

**[SHOW]** Select the **RAG Pipeline** tab.

**[CHART]** `RAG chat pipeline latency, P50 by step (ms)`

**[SAY]** "This is the whole retrieval-augmented generation path broken into
its four steps: total chat time, the vector search against SurrealDB, the LLM
completion, and the query embedding. The shape of this chart is the answer to
'why is the chat slow', and it is almost always the LLM completion."

**[HIGHLIGHT]** The gap between `Total Chat` and `LLM Completion`. That gap is
everything the application does that is not waiting on the model.

**[SAY]** "There is something structurally interesting here. Every one of
these spans is an internal or client span, not an HTTP server span. On the
Splunk side, getting metrics out of them meant switching on the
`span_metrics` connector, because Splunk's metric sets only cover server
spans. In Azure these are already rows in the dependencies table with their
own duration, so there is nothing to configure at all."

> **Presenter note -- say "switching on", not "adding".** `span_metrics` is a
> **connector**, one of the four OpenTelemetry Collector component types
> alongside receivers, processors and exporters. It ships in the upstream
> `otel/opentelemetry-collector-contrib` image, so enabling it is a block of
> YAML, not an install, a plugin or a dependency. Track 1 explains connectors
> properly if the audience has not seen it.
>
> Describing it as something we bolted on makes the Splunk path sound more
> bespoke than it is, and makes a standard OTel capability sound like vendor
> tooling.

**[HIGHLIGHT]** "And here it is not merely unnecessary, it would make things
worse. The connector emits a histogram, and Application Insights discards
histogram buckets at ingest, so routing it here would give us strictly less
than the raw table we are already reading."

**[CHART]** `RAG upload pipeline latency, P50 by step (ms)`

**[CHART]** `Vector search latency P50 / P90 (ms)`

**[CHART]** `DB operation breakdown`

**[SAY]** "Every SurrealDB operation, by call count and median latency."

**[HIGHLIGHT]** `db.vectorSearch` near the top by volume.

> **Presenter note:** this query filters on `db.system == 'surrealdb'`, which
> is a semantic filter. The Splunk equivalent has to enumerate all thirteen
> `db.*` span names explicitly, because wildcards are not valid in that
> position. Small, but a real ergonomics difference, and it means this chart
> picks up a new DB operation automatically where the Splunk one needs
> editing.

**[CHART]** `Active sessions`

**[SAY]** "Distinct user sessions in the window, counted from a span
attribute directly, with no index configuration and no decision in advance
that session was a dimension worth keeping."

> **Presenter note -- this chart has a story, and it is a good one to tell.**
> It read 0 for a while, and the cause was in the application, not in either
> backend. The API set `session.id` from an Express middleware using
> `trace.getActiveSpan()`, which returns the *middleware* span rather than
> the HTTP server span, so the attribute never reached the request record. It
> also invented a random session id when the client sent no header, which
> turned every healthcheck into a phantom user: 3 real sessions against 307
> phantoms. Both are fixed in `api/src/session-attributes.js`.
>
> Two things worth saying out loud if the audience is technical. First, the
> same bug broke the Splunk chart identically, and no amount of MetricSet
> indexing would have fixed it, because the tag was on the wrong span. When
> the same chart is empty on two independent backends, suspect the
> instrumentation. Second, now that it is fixed, Splunk still needs
> `session.id` indexed as a Monitoring MetricSet dimension before it can
> group by it, and Azure needs no equivalent step. **That** is the real
> backend difference this chart illustrates, and it is a genuine Azure
> ergonomics win rather than a Splunk defect.

---

## Section 4: MCP and cross-service tracing (~2 minutes)

**[SHOW]** Still on the **RAG Pipeline** tab.

**[CHART]** `MCP scrape latency, P50 by step (ms)`

**[SAY]** "This crosses a service boundary. The RAG API calls out to a
Playwright MCP server, and the trace context propagates, so we see both sides:
the total scrape from the API's point of view, and the individual browser tool
calls inside the MCP server."

**[HIGHLIGHT]** The difference between `Total Scrape` and the sum of
`Navigate` and `Get Text`. That residue is MCP protocol overhead.

**[SHOW]** Leave the workbook. In the Application Insights left navigation,
under **Investigate**, select **Transaction search**. Then:

1. Set the time range to **Last hour**.
2. In **Event types**, select **Dependency**.
3. In the search box, enter `mcp.scrape` and press Enter.
4. Click any result row.

**[SAY]** "This is the end-to-end transaction view. Every span in the trace,
in order, across both services."

**[HIGHLIGHT]** In the timeline, the point where the trace crosses from
`rag-api` into `playwright-mcp`. Expand a span and show its **Custom
Properties**.

**[SAY]** "Those custom properties are the raw OpenTelemetry span attributes.
Every attribute the application set is here, queryable, with no indexing step
and no decision in advance about which ones matter."

> **Presenter note:** this is the counterpart to Splunk's Tag Spotlight
> section, and the trade-off runs the other way. Splunk requires you to index
> tags as Custom MetricSets before they are groupable, which is a
> configuration burden but gives you fast pre-aggregated pivots. Azure lets
> you query any attribute immediately but scans raw rows to do it. Neither is
> strictly better; be even-handed here.

**[SHOW]** Return to the workbook.

---

## Section 5: Token economics (~2 minutes)

**[SHOW]** Select the **LLM and AI** tab.

**[CHART]** `Total tokens by type`

**[HIGHLIGHT]** The input and output token totals.

**[SAY]** "Input and output tokens for the window. This is the number finance
asks for, and it comes from the `gen_ai` semantic conventions, so it is
provider-agnostic. Swap the model in the .env file and this keeps working."

**[SAY]** "At GPT-4o-mini pricing, fifteen cents per million input tokens and
sixty cents per million output tokens, you can put a currency figure on that
directly. The reason it is worth splitting input from output is the four-times
price difference between them, and RAG is input-heavy by construction, because
every question carries retrieved context with it."

**[CHART]** `LLM provider and model`

**[SAY]** "Provider, requested model, actual responding model, call count,
median latency and token totals in one table. The requested and responding
model columns are separate on purpose. They differ when a provider silently
routes you to a different snapshot, and that is worth catching."

**[CHART]** `Token usage over time (all operations)`

**[CHART]** `LLM tokens over time (chat only)`

**[CHART]** `Embedding tokens over time`

**[SAY]** "Split by operation, because chat and embedding cost different
amounts and scale with different things. Embedding volume follows document
ingestion; chat volume follows users."

**[CHART]** `LLM call latency P50 / P90 / P99 (ms)`

**[CHART]** `Response length over time (characters)`

**[SAY]** "Response length distribution. A sustained shift in this is one of
the cheapest available signals for model drift or a prompt regression, without
needing to evaluate output quality at all."

> **Presenter note -- an honest limitation, do not skip it.** That P90 comes
> from a span attribute, not from the histogram metric the application also
> emits. Application Insights pre-aggregates histograms at ingest and keeps
> only sum, count, min and max, so the buckets are gone and a true percentile
> cannot be recovered from the metric. It works here only because this
> application happens to record the same value on the span as well. An
> application that emitted only the histogram would have no P90 in Azure at
> all. If someone asks whether Azure Monitor preserves OpenTelemetry
> histograms, the answer is no.

---

## Section 6: Logs beside spans (~2 minutes)

**[SHOW]** Select the **Logs and Traces** tab.

**[SAY]** "This tab has no equivalent in the Splunk deck, and that is the
single biggest capability difference in the whole comparison."

**[CHART]** `Log volume by severity`

**[CHART]** `Exceptions by type`

**[CHART]** `Recent errors (click a Trace ID to correlate with its spans)`

**[SHOW]** In the `Recent errors` table, click a **Trace ID** value.

**[SAY]** "That log line and the trace it came from are in the same place,
correlated automatically, because the collector stamps trace and span IDs onto
every log record and Application Insights stores logs and spans in one
resource."

**[SAY]** "On the Splunk side, this same telemetry works, but it goes to a
different product. Logs ship to Splunk Cloud Platform over HTTP Event
Collector, and they are fully searchable there with the trace ID attached. But
seeing them next to the trace inside Observability Cloud needs Log Observer
Connect, and on a trial that is gated three separate ways: it is not offered
for Cloud Platform trials, its IP allow list is configured through a support
case, and trials cannot open support cases. So it is a licensing conversation,
not a configuration one."

**[HIGHLIGHT]** That this required zero additional configuration and zero
additional licence on the Azure side.

> **Presenter note:** be precise about the claim. The Splunk architecture is
> not broken; the logs are there and searchable, with correlation IDs intact.
> What is unavailable on a trial is the single-pane view. Overstating this
> invites a correction from anyone who knows the product.

---

## Section 7: Drift detection and Smart Detection (~1.5 minutes)

**[SHOW]** Leave the workbook. In the Application Insights left navigation,
under **Monitoring**, select **Alerts**, then **Alert rules**.

**[SAY]** "Three drift detectors, deployed as code from a Bicep template
alongside the workbook."

**[HIGHLIGHT]** The three rules: `LLM -- Response Length Anomaly`,
`LLM -- Output Token Anomaly`, `LLM -- Latency Anomaly`.

**[SHOW]** Click `LLM -- Response Length Anomaly`, then **Condition** to show
the query.

**[SAY]** "Each one compares the last five minutes against a one-hour baseline
and fires at three standard deviations. That is the same detection logic as
the Splunk detectors, deliberately, so the comparison is about the platform
rather than the maths."

**[SAY]** "Two things had to change to get here honestly. First, two of the
three read span attributes rather than the pre-aggregated metric, because you
cannot recover a standard deviation from per-interval means. Taking the
standard deviation of a set of averages understates the real variance and
gives you a detector that fires constantly. Second, these carry sample-size
guards the Splunk versions do not: at least thirty baseline observations and
five recent ones. Without those, a cold start with four LLM calls fires
everything immediately."

> **Presenter note -- the structural gap, state it plainly.** Scheduled query
> rules evaluate on a five-minute floor plus one to three minutes of Log
> Analytics ingestion latency. Splunk's detectors run on the streaming metric
> pipeline, seconds behind. Azure will detect the same drift later. That is
> architectural, not a tuning problem, and it is the clearest Splunk advantage
> in the alerting comparison.

**[SHOW]** In the left navigation, under **Investigate**, select **Smart
Detection**.

**[SAY]** "And separately from anything we configured, this arrives free with
the resource: automatic detection of latency degradation and failure-rate
anomalies, with no rules written. It is not a replacement for the three
detectors, because you cannot express a specific business signal like token
drift through it. But it is real, and leaving it out of the comparison would
understate Azure."

---

## Section 8: Prebuilt Azure content -- Grafana and the agent dashboards (~2 minutes)

**[SAY]** "Everything so far was a workbook we built. Now the part we did not
build, which is arguably the better argument for emitting standard
conventions."

**[SHOW]** In the Azure portal, open **Azure Managed Grafana** (or Grafana
with the Azure Monitor data source configured against this Application
Insights resource). Browse the bundled dashboards under **Azure / Insights /
Applications**.

**[SAY]** "Azure Managed Grafana ships dashboards that query Application
Insights through the Azure Monitor data source. No plugin to buy, no
proprietary agent. They run KQL against the same tables our workbook uses,
which means our telemetry is already in the right shape for them."

**[HIGHLIGHT]** "That is a real dividend from the semantic conventions. We
wrote our workbook by hand, but these came free, and they would have come
free for any service emitting the same `gen_ai.*` attributes."

**[SHOW]** Open the **Agent Framework** dashboard.

**[SAY]** "This one is more interesting, because it only partly populates,
and the reason is worth understanding rather than glossing over."

> **Presenter note -- the precise verdict, verified against this stack's live
> telemetry. Do not claim it "just works", and do not claim it fails.**
>
> The dashboard is designed for the Microsoft Agent Framework, but it reads
> plain OpenTelemetry GenAI conventions, so any framework emitting them can
> drive it. Checking what we actually emit:
>
> | It wants | We emit |
> |---|---|
> | `chat <model>` span | yes -- `chat gpt-5.4-mini` |
> | `gen_ai.client.token.usage` | yes |
> | `gen_ai.operation.name`, `provider.name`, `request.model`, `usage.*_tokens` | yes, all |
> | `gen_ai.client.operation.duration` | **no** |
> | `invoke_agent <agent>` span | **no** -- we emit `chat.pipeline` |
> | `execute_tool <func>` span | **no** -- we emit `mcp.tool.*` |
> | `gen_ai.agent.name` / `agent.id` / `conversation.id` | **no** -- we have `session.id` |
>
> So the LLM and token panels populate. The agent-level and tool-execution
> panels stay empty. The cause is not Azure and not OpenTelemetry: **this is
> a RAG pipeline making direct LLM calls, not an agent framework**, so the
> agent spans genuinely do not exist to be reported.

**[SAY]** "The token and model panels here are live, from our data, with
nothing built by us. The agent and tool panels are empty, because this
application is a RAG pipeline rather than an agent framework, so there are no
agent invocations to show."

**[HIGHLIGHT]** "And here is the part that matters for a platform decision.
That gap is a **naming** gap, not a platform wall. If we renamed
`chat.pipeline` to `invoke_agent rag-agent`, renamed our MCP tool spans to
`execute_tool`, and added `gen_ai.agent.name`, these panels would populate.
It is a handful of string changes in our own code."

**[SAY]** "Compare that with the Splunk side, where the equivalent AI Agent
screens are documented for Python only. From a Node service that is a wall no
amount of renaming or spending gets through. Same missing capability on
paper, completely different cost to close."

> **Presenter note:** resist the temptation to make the changes live during
> the demo. They are cheap but they are not free, and adopting agent span
> semantics for a pipeline that is not an agent would be dishonest
> instrumentation. The point to land is that the option exists and is
> costed, not that we should take it.

---

## Section 9: Boundaries (~1.5 minutes)

Spoken, no navigation. Say this out loud rather than letting someone find it
later.

**[SAY]** "Three things this does not do, and one asymmetry worth being
straight about."

**[SAY]** "First, histogram fidelity. As covered, Application Insights
pre-aggregates histograms at ingest. Distribution shape is lost. We recover
percentiles here only because this application redundantly records the same
values as span attributes. That is a property of this application, not of
Azure Monitor."

**[SAY]** "Second, infrastructure. The Infrastructure tab renders, and it
looks comparable to the Splunk one. It is not. Application Insights has no
infrastructure product. Splunk gives you Infrastructure Navigators, per-host
views, and automatic correlation between APM traces and infrastructure keyed
on hostname. Azure's equivalents, VM Insights and Container Insights, run off
the Azure Monitor Agent against a Log Analytics workspace, not off custom
metrics in an Application Insights resource. What you are looking at on that
tab is a hand-built workbook over custom metrics. That is the clearest Splunk
win in the comparison."

**[SAY]** "Third, cost and retention. Application Insights defaults to ninety
days; Splunk's metric sets retain thirteen months, which matters for any
long-term drift claim. And the query cost model inverts: Splunk reads
pre-aggregated series at fixed cost, Azure scans raw rows, and every span is a
billable row. At this volume it is irrelevant. At production volume it is a
design decision."

**[SAY]** "The asymmetry: we send Azure less infrastructure data on purpose.
Host metrics are dropped from the Azure pipeline, because nothing charts them,
their Splunk purpose has no Azure counterpart, and each CPU core and each
filesystem mount would become a separately billed row. That is a considered
choice, not an oversight, but it does mean the two backends are not receiving
byte-identical metrics even though they receive byte-identical traces."

---

## Closing (~30 seconds)

**[SHOW]** Return to the workbook, **Service Overview** tab.

**[SAY]** "The headline is not that one of these backends is better. It is
that the application was instrumented once, with vendor-neutral
OpenTelemetry, and both of these dashboards are running off the same spans
from the same traffic run, right now, in parallel. Swapping backend, or
running two, is a collector configuration change. The instrumentation is an
asset that outlives the vendor decision."

**[SAY]** "For engineering, per-step pipeline latency and trace-correlated
logs. For finance, token cost attributed by model and operation. For security
and compliance, every span attribute queryable without deciding in advance
what to index. For architecture, a documented, evidence-based comparison of
two backends rather than a vendor pitch."

---

## Chart name reference

Item names must match the workbook exactly. Source of truth is
`azure/workbook.json`.

### Service Overview (5 items, covering 8 Splunk charts)

| Item name | Talk track section |
|---|---|
| `Requests and error rate by service` | 2 |
| `Request rate (rag-api)` | 2 |
| `Service latency P50 / P90 / P99 (ms)` | 2 |
| `Error count by endpoint (top 5)` | 2 |
| `Top endpoints (top 10)` | 2 |

### RAG Pipeline (7 items)

| Item name | Talk track section |
|---|---|
| `RAG chat pipeline latency, P50 by step (ms)` | 3 |
| `RAG upload pipeline latency, P50 by step (ms)` | 3 |
| `MCP scrape latency, P50 by step (ms)` | 4 |
| `Embedding latency P50 / P90 (ms)` | 3 |
| `DB operation breakdown` | 3 |
| `Vector search latency P50 / P90 (ms)` | 3 |
| `Active sessions` | 3 |

### LLM and AI (9 items, covering 10 Splunk charts)

| Item name | Talk track section |
|---|---|
| `Total tokens by type` | 5 |
| `LLM provider and model` | 5 |
| `Embedding model` | 5 |
| `Token usage over time (all operations)` | 5 |
| `LLM tokens over time (chat only)` | 5 |
| `Embedding tokens over time` | 5 |
| `LLM call latency P50 / P90 / P99 (ms)` | 5 |
| `Embedding API latency P50 (ms)` | 5 |
| `Response length over time (characters)` | 5 |

### Infrastructure (8 items, covering 6 Splunk charts)

| Item name | Talk track section |
|---|---|
| `Container CPU usage (cores)` | 9 |
| `Container memory usage (MiB)` | 9 |
| `Container network I/O` | 9 |
| `SurrealDB process CPU (%)` | 9 |
| `SurrealDB process memory (MiB)` | 9 |
| `SurrealDB transaction rate` | 9 |
| `SurrealDB HTTP request rate` | 9 |
| `SurrealDB active HTTP requests` | 9 |

### Logs and Traces (3 items, no Splunk equivalent)

| Item name | Talk track section |
|---|---|
| `Log volume by severity` | 6 |
| `Exceptions by type` | 6 |
| `Recent errors (click a Trace ID to correlate with its spans)` | 6 |

29 parity items plus 3 log items. The 31-to-29 reduction is two merges and two
splits, mapped chart by chart in
[splunk-vs-azure-monitor.md](splunk-vs-azure-monitor.md) section 5.

## Related

- [demo-talk-track-2-splunk.md](demo-talk-track-2-splunk.md) -- the Splunk deck, runnable off
  the same simulator invocation
- [splunk-vs-azure-monitor.md](splunk-vs-azure-monitor.md) -- the evidence
  behind every comparison claim above
- [azure-monitor-setup.md](azure-monitor-setup.md) -- getting the stack into
  this state
