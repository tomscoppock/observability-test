# Demo Talk Track 2: Splunk Observability Cloud

A scripted walkthrough of the Splunk Observability Cloud surfaces for the RAG
Agent stack. Total runtime: ~14 minutes.

**Second of three.** Run [track 1](demo-talk-track-1-opentelemetry.md) first
if the audience needs the vendor-neutral argument;
[track 3](demo-talk-track-3-azure.md) covers Azure Monitor and runs off the
same simulator invocation, so the two product demos can be presented back to
back without regenerating traffic.

Each section includes:
- **[SHOW]** -- what to click/navigate to in Splunk
- **[SAY]** -- the voice-over script
- **[HIGHLIGHT]** -- specific data points or patterns to call out
- **[CHART]** -- reference to the specific chart name on the demo dashboard

---

## Pre-demo preparation

**0. Confirm the collector is healthy before anything else.** Match the
tab-delimited LEVEL field. Grepping for the word "error" matches hundreds of
metric names and attribute values from the debug exporter, not log lines
(measured: 381 naive matches against one real line on a healthy stack).

```bash
docker compose logs otel-collector | awk -F'	' '$2 ~ /^(error|warn|fatal)$/'
```

```powershell
docker compose logs otel-collector | Select-String -Pattern "`t(error|warn|fatal)`t"
```

One `warn` about `root_path` from `host_metrics` is expected in Docker and is
harmless. Anything else, stop and fix it before presenting.

> **Before presenting**, generate telemetry data so the service map and
> dashboard charts have data to show. The easiest way is the automated
> simulation script:
>
> 1. Start the stack: `docker compose up -d`
> 2. Run the traffic simulator (default 2 rounds, ~8 minutes total):
>    - **Linux/macOS:** `./scripts/simulate-demo-traffic.sh`
>    - **Windows:** `.\scripts\simulate-demo-traffic.ps1`
> 3. The script uploads sample documents, sends 20 varied chat messages
>    per round across 3 simulated user sessions, scrapes URLs (if MCP
>    is configured), and generates deliberate errors so the service map
>    shows health colours instead of grey.
>
> 4. Wait ~2 minutes after the script finishes for metrics to flush
>    through the OTel Collector to Splunk.
> 5. In Splunk, set the time picker to **Last 15 minutes** (or a window
>    that covers your recent activity). The service map and charts only
>    show data within the selected time range -- if the window is too
>    narrow or too old, nodes will appear grey or missing.
> 6. **Open Splunk Cloud Platform in a second browser tab**, signed in,
>    on **Search & Reporting**. Section 7 switches products, and you do
>    not want to be logging in on camera.
>
> **Options:**
> - `--rounds N` / `-Rounds N` -- run N rounds (default 2)
> - `--duration M` / `-DurationMinutes M` -- loop rounds for M minutes
>   instead of a fixed count. Good for building a baseline while you
>   rehearse; the drift detectors need roughly an hour of traffic before
>   they mean anything.
> - `--load light|heavy` / `-Load light|heavy` -- `light` is the default
>   and unchanged. `heavy` triples chat volume and quarters the pauses,
>   for busier-looking charts. **Every chat message is a real LLM API
>   call**, so a long heavy run costs real money. Start with a short
>   duration to gauge the rate.
> - `--no-errors` / `-NoErrors` -- skip error traffic (all-green map)
> - `--errors` -- include error traffic (default)
>
> **For Playwright MCP scrape traffic**, set in `.env` before running:
> ```
> MCP_PLAYWRIGHT_URL=http://host.docker.internal:8100/mcp
> MCP_PLAYWRIGHT_API_KEY=<your-key>
> ```
> Then rebuild: `docker compose up -d --build`
>
> **Manual alternative:** Upload documents via the chat UI, send 3-5
> chat messages, and optionally scrape a URL. The simulation script
> simply automates this with realistic timing and multiple sessions.

---

## Opening (~30 seconds)

**[SHOW]** Open Splunk Observability Cloud and find the demo dashboard:

1. In the main menu on the left, select **Dashboards**.
2. Type `RAG Agent` in the search field at the top of the page.
3. Click the **RAG Agent -- Observability** dashboard group name to
   list the dashboards inside it.

You will see four tabs: **Service Overview**, **RAG Pipeline**, **LLM
and AI**, and **Infrastructure**. Start on the **Service Overview** tab.

**[SAY]** "What you're looking at is a fully instrumented RAG agent
stack -- a Node.js API backed by SurrealDB for document and vector
storage, connected to an external browser automation service via the
Model Context Protocol, and calling OpenAI for embeddings and chat
completions. Every service in this stack emits OpenTelemetry telemetry
-- traces, metrics, and logs -- through a single OTel Collector into
Splunk Observability Cloud. Let me walk you through what this gives us."

---

## Section 1: Service Map and Infrastructure (~2 minutes)

**[SHOW]** In the main menu select **APM**, then **Service map**. Set
the filter bar up left to right:

1. **Time range** -- `Last 15 minutes`, or whatever window covers the
   traffic you generated.
2. **Environment** -- `dev`.

Leave **Service** empty here; you want the whole map, not one node.

**[SAY]** "The service map is auto-generated from trace data -- we
didn't configure it, Splunk built it from the parent-child span
relationships. You can see `rag-api` at the centre, with edges to
`surrealdb` for database operations and `playwright-mcp` for web
scraping."

> **Presenter note -- node colours:** Splunk colour-codes nodes by
> health: green = healthy, yellow = elevated errors, red = critical.
> Nodes appear **grey** when there is insufficient data in the selected
> time window to calculate error rates. If all nodes are grey, widen
> the time picker or generate more traffic. After a few chat messages
> and a scrape, `rag-api` should turn green.

> **Presenter note -- SurrealDB edge:** The `rag-api` -> `surrealdb`
> edge appears because our DB spans use `SpanKind.CLIENT` with
> `server.address` and `peer.service` attributes pointing to the
> SurrealDB host. If the edge is missing, ensure you have sent at
> least one chat message (which triggers `db.vectorSearch` and
> `db.hasDocuments` spans) and that the time window covers that
> activity.

**[HIGHLIGHT]** Point out the edge between `rag-api` and
`playwright-mcp` -- this is the cross-service MCP dependency. If you
ran a scrape, this edge will be visible.

**[SHOW]** Click the `rag-api` node. A side panel opens on the right
with that service's RED metrics; from there select the service name to
open the full service view.

**[SAY]** "The service view gives us RED metrics -- Request rate, Error
rate, and Duration -- without any manual setup. Splunk derives these
automatically from trace data using Monitoring MetricSets. This is a
key benefit of the platform: you get baseline observability for free,
just by sending traces."

**[CHART]** `rag-api Requests`, `surrealdb Requests`,
`playwright-mcp Requests`, `Error Rate %` (Service Overview tab)

**[SHOW]** Leave APM and return to the **RAG Agent -- Observability**
dashboard (main menu > **Dashboards**, or the browser Back button).
Switch to the **Infrastructure** tab and point to the SurrealDB charts.

**[SAY]** "Now let's look at the infrastructure layer. SurrealDB 3.2
has native OpenTelemetry support -- it pushes metrics directly to our
collector. We can see CPU usage, memory consumption, transaction rates,
and HTTP activity. This is infrastructure monitoring and application
monitoring in one place -- we can correlate a spike in API latency with
a spike in database CPU without switching tools."

**[CHART]** `SurrealDB Process Health`, `SurrealDB Transaction Rate`,
`SurrealDB HTTP Activity` (Infrastructure tab)

**[HIGHLIGHT]** "Notice how SurrealDB's transaction rate correlates
with the API request rate -- every chat query triggers a vector search
transaction, and every upload triggers insert transactions. This
correlation is automatic because both services report to the same
collector."

**[SHOW]** Scroll to the container metric charts.

**[CHART]** `Container CPU Usage`, `Container Memory Usage`,
`Container Network I/O` (Infrastructure tab)

**[SAY]** "We also have Docker container metrics -- CPU, memory, and
network I/O per container. The OTel Collector reads these directly from
the Docker daemon socket via its docker_stats receiver. So if the API
container is hitting its memory limit or the database container is
CPU-bound, we see it right here alongside the application metrics. No
separate infrastructure monitoring tool needed."

**[SAY]** "From a governance perspective, this unified view means one
team can own the full observability stack. There's no gap between 'the
app team's dashboard' and 'the infra team's dashboard' -- it's all
here, correlated by time and service."

---

## Section 2: RAG Pipeline Performance (~2 minutes)

**[SHOW]** Still on the dashboard, switch to the **Service Overview**
tab. Point to the request rate and latency charts.

**[CHART]** `Request Rate`, `Error Rate %`, `Service Latency (P50/P90/P99)`,
`Error Count by Endpoint` (Service Overview tab)

**[SAY]** "These are the core health signals. Request rate tells us
throughput -- a sudden drop to zero means the service is down. Error
rate is the primary quality signal. And latency percentiles show us
both typical experience (P50) and worst-case (P99). A widening gap
between P50 and P99 is a red flag for inconsistent performance."

> **Presenter note -- two corrections landed on this tab, worth knowing if
> anyone has seen an older screenshot.**
>
> These charts used to count every request **twice**. `service.request`
> emits two MetricSets for the same traffic, an endpoint-level one carrying
> `sf_dimensionalized='true'` and a service-level one where that property is
> absent, and a filter that does not mention it matches both. All eight
> affected charts now filter on it. Measured: 132 unfiltered versus 66
> filtered versus 58 in Azure for the same window. Note that Error Rate %
> was always correct, because a ratio doubles top and bottom -- which is
> exactly why the defect survived so long.
>
> Also, **the latency numbers on this tab are nanoseconds**, while the RAG
> Pipeline and LLM tabs are milliseconds. `service.request` is nanoseconds;
> the `span_metrics` connector sets `unit: ms`. Splunk renders the shape
> correctly either way, so trends are trustworthy and only the absolute
> value needs care. Both traps are written up in `docs/splunk-setup.md`
> section 27.

**[SHOW]** Switch to the **RAG Pipeline** tab. Point to the pipeline
breakdown charts.

**[CHART]** `RAG Chat Pipeline Latency`, `RAG Upload Pipeline Latency`
(RAG Pipeline tab)

> **Presenter note -- what makes these charts possible, and it is not a
> Splunk feature.** Splunk's Monitoring MetricSets only cover SERVER and
> CONSUMER spans, so the internal and client spans behind this pipeline
> produce no metrics on their own. What fills the gap is the `span_metrics`
> **connector**: one of the four OpenTelemetry Collector component types
> (receivers, processors, exporters, connectors), which derives duration and
> call-count metrics from every span regardless of kind.
>
> Say "switched on", not "installed". It ships in the upstream
> `otel/opentelemetry-collector-contrib` image, so it is a block of YAML
> rather than a plugin or a dependency. That distinction matters here: this
> is a standard OpenTelemetry capability compensating for a vendor
> limitation, which is a decent advert for the architecture rather than an
> embarrassment for it.

**[SAY]** "This is where it gets interesting for RAG specifically. We
instrument each step of the pipeline with custom spans -- embedding
generation, vector search, LLM completion. The chat pipeline chart
breaks down where time is spent. Typically, the LLM completion
dominates -- 80-90% of total latency. Vector search in SurrealDB is
fast, usually under 50ms. If that changes, we'll see it here
immediately."

**[HIGHLIGHT]** "The upload pipeline shows a different pattern --
embedding generation is the bottleneck there, because we're embedding
multiple chunks in a single API call. This kind of per-step visibility
is only possible because we use OpenTelemetry's manual instrumentation
alongside the auto-instrumentation."

**[CHART]** `Active Sessions` (RAG Pipeline tab)

**[SAY]** "Distinct user sessions in the window, counted from a span
attribute the application sets from an `X-Session-Id` header."

> **Presenter note -- this chart has a story, and it is a good one.** It read
> zero for a long time, and the cause was in the application rather than in
> Splunk. The API set `session.id` from Express middleware using
> `trace.getActiveSpan()`, which returns the *middleware* span rather than
> the HTTP server span, so the tag never reached the request. **The same bug
> broke the equivalent Azure Monitor chart identically**, which is the tell:
> when one chart is empty on two independent backends, suspect the
> instrumentation, not the vendor.
>
> Fixing it needed a second step here that Azure did not need. Grouping
> `service.request` by a span tag requires indexing it as a Monitoring
> MetricSet dimension, and Splunk has **no public API for MetricSets** --
> it is a UI-only operation. So the chart reads the `span_metrics` connector
> instead, where a configured dimension arrives as a real metric dimension.
> That keeps the whole dashboard deployable as code. If asked about
> cardinality: the app sets the tag on server spans only and never invents
> one, which bounds the cost. See `docs/splunk-vs-azure-monitor.md`
> section 6.

**[CHART]** `Top Endpoints` (Service Overview tab)

**[SAY]** "The top endpoints chart shows traffic distribution. In a
healthy system, chat requests dominate. If upload or scrape traffic
suddenly spikes, that could indicate automated abuse or a
misconfigured client."

---

## Section 3: Token Economics (~1.5 minutes)

**[SHOW]** Switch to the **LLM and AI** tab. Point to the token usage
charts.

**[CHART]** `Total Input Tokens`, `Total Output Tokens`,
`Token Usage Over Time` (LLM and AI tab)

**[SAY]** "Token usage is where observability meets cost management.
Every LLM and embedding API call costs money, and the cost scales
directly with token consumption. We record token usage as OTel
histogram metrics following the gen_ai semantic conventions --
`gen_ai.client.token.usage` with dimensions for input vs. output
tokens, model name, and operation type."

**[HIGHLIGHT]** "Input tokens are typically much higher than output
tokens for RAG -- because we're sending the retrieved context plus the
user's question. A sudden spike in input tokens could mean our
retrieval is pulling too many chunks, or a user is sending very long
messages."

**[SAY]** "For cost projection, you can multiply token counts by the
per-token price. GPT-4o-mini is roughly $0.15 per million input tokens
and $0.60 per million output tokens. At 1000 requests per day with an
average of 2000 input tokens, that's about $0.30/day or $9/month just
for chat completions. Embeddings are cheaper but add up with bulk
uploads."

**[SAY]** "From a compliance standpoint, token tracking gives you an
audit trail of AI usage. You can answer questions like 'how much did
we spend on AI this month?' and 'which endpoints consume the most
tokens?' -- questions that finance and compliance teams increasingly
ask."

---

## Section 4: Cross-Service Tracing -- MCP (~2 minutes)

**[SHOW]** In the main menu select **APM**, then **Traces**. This page
is Trace Analyzer. Set the filter bar up left to right:

1. **Time range** -- `Last 15 minutes`, or whatever window covers your
   simulator run.
2. **Environment** -- `dev`.
3. **Service** -- `rag-api`.
4. **Add filters** -- tag `scrape.url`, operator `=`, value `*`. Only
   the scrape path sets this attribute, so it isolates scrape traces
   and nothing else.
5. Set the sample ratio selector to **all traces** rather than 10%, and
   leave the **Errors only** toggle off.

The traces table now lists scrape requests only. Sort by duration and
pick one that ran a full page load.

> **Presenter note -- why not just filter on both services:** selecting
> two values inside one **Service** filter is a Boolean OR in Splunk
> APM, so `rag-api` + `playwright-mcp` returns traces containing
> *either* service, not both. Filtering on the `scrape.url` tag is the
> reliable way to get the cross-service traces. If you would rather
> filter by service, set **Service** to `playwright-mcp` on its own:
> in this stack every trace that reaches the MCP server was started by
> `rag-api`, so both services are present by construction.

> **Presenter note -- no `playwright-mcp` in the dropdown?** The MCP
> server runs outside this Compose stack, from a separate project (see
> [architecture.md](architecture.md)). If it is not running and
> instrumented, no `playwright-mcp` service is reported and the scrape
> traces show `rag-api` spans only: `scrape.pipeline` -> `mcp.scrape`
> -> the auto-instrumented HTTP client span. The pipeline story still
> works, you just cannot show the far side of the boundary. Check the
> **Service** dropdown lists `playwright-mcp` during rehearsal, not on
> camera.

**[SAY]** "This is distributed tracing in action. When a user scrapes
a web page, the request flows from our Node.js API to the Playwright
MCP server -- a completely separate Python service. OpenTelemetry's
W3C trace context propagation automatically links the spans across the
HTTP boundary. We didn't write any correlation code -- the OTel
auto-instrumentation handles it."

**[SHOW]** Select the **Trace ID** in the traces table to open the
trace **Waterfall**. Expand the **Trace flow** section above the
waterfall -- it is collapsed by default, and it draws the services
involved with lines for the parent-child links between them. That is
the cleanest single visual for the cross-service point.

> **Presenter note -- highlighting the MCP hop:** inside the waterfall,
> **Add filters** takes span tag values and highlights matching spans in
> blue. Filter on `mcp.session_id` to light up just the MCP spans. Leave
> the **Matches only** switch off so the highlighted spans stay in
> context with the rest of the trace.

**[SAY]** "In the waterfall, you can see the full journey: the Express
route handler creates a `scrape.pipeline` span, which calls
`mcp.scrape`. Inside that, we see individual HTTP calls to the MCP
server, and on the MCP side, each tool invocation -- `session_create`,
`browser_navigate`, `browser_get_text`, `session_close` -- appears as
a child span. Then back in the API, we see chunking, embedding, and
database insertion."

**[CHART]** `MCP Scrape Latency` (RAG Pipeline tab)

**[HIGHLIGHT]** "Navigation is usually the slowest MCP tool call --
it's waiting for the page to load. Text extraction is fast. Session
creation and teardown add overhead. If the MCP server is slow or
unreachable, you'll see it immediately in this chart and in the error
rate."

**[SAY]** "This cross-service visibility is a key architectural
benefit. The Model Context Protocol gives us tool interoperability --
any MCP-compatible server can provide capabilities to our agent. And
OpenTelemetry gives us observability across that boundary. Together,
they mean we can compose AI agent systems from independent services
without losing visibility."

---

## Section 5: Security and Threat Detection (~2 minutes)

**[SHOW]** In the main menu select **APM**, then **Tag spotlight**. Set
the filter bar:

1. **Time range** -- `Last 15 minutes`.
2. **Environment** -- `dev`.
3. **Service** -- `rag-api`.

Each indexed span tag gets its own box of request, error and duration
charts. Open `gen_ai.operation.name` to show `chat` against
`embeddings`, then `gen_ai.usage.completion_tokens`, which is the box
that backs the token-anomaly point in the script below.

> **Presenter note -- which tags have boxes:** Tag Spotlight only shows
> tags indexed as MetricSets. This org has five active:
> `gen_ai.operation.name`, `gen_ai.request.model`,
> `gen_ai.provider.name`, `gen_ai.usage.completion_tokens` and
> `db.system`. Anything else will not appear here. See
> [splunk-setup.md Section 25](splunk-setup.md#tag-spotlight-setup) if
> you need to index another one -- it needs the admin role and about
> 8 minutes to populate, so do it well before you present.

> **Presenter note -- finish reasons are not in Tag Spotlight:**
> `gen_ai.response.finish_reasons` is not indexed, so it has no box.
> To show the finish-reason signal the script describes next, use Trace
> Analyzer instead, which searches unindexed tags: **APM > Traces**,
> **Environment** `dev`, **Service** `rag-api`, then **Add filters**
> with tag `gen_ai.response.finish_reasons`, operator `!=`, value
> `stop`. On a healthy run that returns nothing, which is itself the
> point worth making out loud.

**[SAY]** "Now let's talk about security -- an increasingly critical
concern for AI agent systems. Prompt injection is the number one
security threat for LLM applications. An attacker embeds malicious
instructions in user input or retrieved content, trying to override
the system prompt and make the agent do something unintended."

**[SAY]** "OpenTelemetry gives us several signals to detect this.
First, **token consumption anomalies** -- a prompt injection attempt
often results in unusually high input token counts, because the
attacker is injecting a long payload. A sudden spike in
`gen_ai.client.token.usage` for a single request is a red flag."

**[HIGHLIGHT]** "Second, **error patterns**. If the LLM returns an
unexpected finish reason -- like `content_filter` instead of `stop` --
that's recorded in the `gen_ai.response.finish_reasons` span
attribute. You can create a detector that alerts on non-`stop` finish
reasons."

**[SAY]** "Third, **unusual tool invocation patterns**. If an agent
suddenly starts calling tools it hasn't used before, or calling them
at an unusual rate, that could indicate agent subversion. Our MCP
scrape traces show exactly which tools were called and in what order."

**[SAY]** "For production deployments, you'd add dedicated security
instrumentation: input validation spans that record whether content
passed safety checks, output scanning for PII leakage, and rate
limiting per user. The OpenTelemetry pipeline is already in place --
you just add more span attributes and create detectors for the
patterns you care about."

**[SAY]** "From a governance perspective, the combination of
distributed tracing and structured logging gives you a complete audit
trail. You can reconstruct exactly what happened for any request --
what the user asked, what context was retrieved, what the LLM
generated, and what tools were invoked. This is essential for
compliance in regulated industries."

> **Note for presenter:** The security monitoring described here uses
> signals that are already available in the telemetry (token counts,
> finish reasons, error rates, tool invocation patterns). For
> production-grade prompt injection detection, consider adding:
> - A dedicated input validation span with a `security.check.passed`
>   attribute
> - Integration with a prompt injection classifier (e.g. Patronus,
>   Lakera Guard)
> - Log-based alerting on suspicious patterns in user messages

---

## Section 6: Quality and Eval Monitoring (~1.5 minutes)

**[SHOW]** Go back to **APM > Traces** and reset the filter bar for
chat traffic:

1. **Time range** -- `Last 15 minutes`.
2. **Environment** -- `dev`.
3. **Service** -- `rag-api`.
4. **Add filters** -- tag `gen_ai.operation.name`, operator `=`, value
   `chat`. Embeddings share the `gen_ai.*` namespace, so filtering on
   the operation rather than the namespace keeps them out.
5. Sample ratio: **all traces**.

**[SHOW]** Select a **Trace ID** to open the waterfall, then select the
`chat gpt-4o-mini` span. Open the **Tags** section of the span
properties panel on the right and point at
`gen_ai.response.finish_reason`, `gen_ai.usage.input_tokens` and
`gen_ai.usage.output_tokens`.

> **Presenter note -- singular, not plural, and here is why.** The
> OpenTelemetry spec defines `gen_ai.response.finish_reasons` as an **array**,
> and the application still emits it. But array-valued span attributes do not
> survive every backend: the `azure_monitor` exporter drops them outright,
> because it only maps strings, booleans and numbers. Measured: 254 chat
> spans reached Application Insights with zero finish reasons, while the
> collector debug output showed the array arriving perfectly.
>
> So the application now also emits a scalar `gen_ai.response.finish_reason`
> (singular), the same belt-and-braces approach as the
> `gen_ai.usage.prompt_tokens` aliases. **Point at the singular one** -- it
> is the one guaranteed to be present on both backends. If you only see the
> plural, or neither, the API has not been rebuilt since that change.

> **Presenter note -- the span name tracks the model:** spans follow the
> OpenTelemetry GenAI convention `{operation} {model}`, so the name is
> whatever `LLM_MODEL` is set to. On the default config that is
> `chat gpt-4o-mini`; against a Gemma or Qwen backend it will read
> `chat gemma2:9b` or similar. Check the name in rehearsal rather than
> reading this one off the page.

> **Presenter note -- showing the failure modes live:** to demonstrate
> truncation, add a filter on tag `gen_ai.response.finish_reason` with
> value `length`. To follow one user's whole conversation across
> separate traces, filter on the `session.id` tag, which the API sets on
> every request from the `X-Session-Id` header.

**[SAY]** "The final piece is quality monitoring -- how do we know the
agent is giving good answers? Traditional monitoring says 'the service
is up and responding' -- but for AI, a 200 OK response can still be a
hallucinated, irrelevant, or harmful answer."

**[SAY]** "Today, our telemetry captures several quality signals.
**Finish reasons** tell us if the model completed normally (`stop`) or
was cut off (`length`) or filtered (`content_filter`). A high rate of
`length` finish reasons means responses are being truncated -- the
context window is too small. **Token ratios** -- the ratio of output
to input tokens -- can indicate response quality. Very short responses
to long prompts might mean the model couldn't find relevant
information."

**[HIGHLIGHT]** "Empty or near-empty responses are another signal. If
`gen_ai.usage.output_tokens` is zero or very low, the model returned
nothing useful. You can create a detector for this."

> **Presenter note -- the "AI Details / Status: not evaluated" panel.** A
> presenter poking around this section will find it. It is not a
> misconfiguration, and it is **not licence-blocked** either -- an earlier
> version of this document said it was, and the vendor documentation does
> not say that.
>
> Splunk's AI screens need prompt and response **content** on the spans, and
> content capture is off by default for good reason. This stack can now turn
> it on:
>
> ```bash
> OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY \
>   docker compose up -d --build api
> ```
>
> If you want the AI screens populated for a demo, set that **before** the
> traffic run and give ingestion a couple of minutes. Leave it off and the
> panel reads "not evaluated", which is also a perfectly good thing to
> demonstrate -- see the framing below.
>
> Separately, the **platform-side evaluation scores** (hallucination,
> toxicity, bias, relevance) additionally need the LLM Providers integration
> under **Data Management > Available integrations**. That is self-service,
> not an entitlement -- Splunk calls the provider with your credentials to
> score the captured content. It has not been configured here, which is
> exactly why the panel reads "not evaluated". Full detail in
> `docs/splunk-setup.md` section 28.
>
> **If you enable capture, click into one chat span before you present.**
> Splunk parses these attributes as JSON in the browser, so malformed
> content blanks the trace page with "error occurred rendering the page"
> while every server-side check stays green. Section 28a has the shape.

**[SAY]** -- if content capture is OFF and you want to use that:
"Notice this says 'not evaluated'. That is a deliberate choice, not a gap.
Turning Splunk's evaluations on means sending every prompt and every answer
to the observability backend. For an agent answering questions over internal
HR documents, that is a decision for legal, not for me. So the switch exists,
it is off, and what we do instead is evaluate locally."

> **Presenter note -- what we run instead.** `scripts/run-eval.sh` runs a
> golden question set against the live agent and asserts on expected sources
> and key phrases, plus three drift detectors on response length, output
> tokens and latency. None of it sends a prompt off the stack. If you want
> something live here, run it before the demo and leave the output on
> screen.

**[SAY]** "For more sophisticated quality monitoring, the OpenTelemetry
GenAI semantic conventions (v1.38+) include a
`gen_ai.evaluation.result` event type. This lets you attach evaluation
scores -- groundedness, relevance, faithfulness -- directly to the
trace. The evaluation can run asynchronously and emit scores that
correlate with the original request trace."

**[SAY]** "The roadmap for this stack would be to add an evaluation
pipeline: after each chat response, run automated evals (using a
smaller model or rule-based checks) and record the scores as OTel
events. Then create detectors that alert when quality scores drop
below a threshold. This turns observability into a continuous quality
gate."

> **Note for presenter:** Automated eval integration is a future
> enhancement. The current stack provides the foundation (traces with
> gen_ai attributes). Adding evals would involve:
> - A post-response evaluation step in the chat route
> - Recording `gen_ai.evaluation.result` events via OTel
> - Detectors on evaluation score metrics

---

## Section 7: Log Analytics in Splunk Cloud Platform (~2 minutes)

> **Product switch.** This section leaves Splunk Observability Cloud and
> moves to **Splunk Cloud Platform**. Have it open in a second browser
> tab before you start, already signed in, so the switch is one click.

**[SAY]** "Everything so far has been traces and metrics. But when
something goes wrong, the question is usually 'what actually happened
inside that one request?' That is a logs question, and our logs carry
the full trace context, so we can reconstruct any single request end to
end."

**[SHOW]** Switch to the Splunk Cloud Platform browser tab. From the
app menu on the left of the Splunk bar, select **Search & Reporting**,
then run this in the search box:

```
index=main sourcetype=otel
```

Set the time picker to **Last 60 minutes**.

**[SAY]** "These are structured log records emitted by the agent through
OpenTelemetry, shipped to Splunk via HTTP Event Collector. Not scraped
text files, not a sidecar tailing stdout. The application emits them as
structured events, and every one is queryable the moment it lands."

**[SHOW]** Click the **arrow to expand a single event**, ideally an
`LLM completion received` line. Point at the extracted fields.

**[SAY]** "Look at what rides along with each record. The message body,
the severity, the service name, and critically **`trace_id` and
`span_id`**. The logger attaches the active span context automatically,
so every log line knows which request it belongs to and which operation
within that request emitted it. Nobody had to pass a correlation ID
around by hand."

**[HIGHLIGHT]** "That is the single most valuable field on the screen.
It turns a pile of log lines into a per-request narrative."

**[SHOW]** Click the **`trace_id` field value**, choose **Add to
search**, and run it. The search becomes something like:

```
index=main sourcetype=otel trace_id="608ae1bdc3ce433fc42886ce7baed4f8"
```

**[SAY]** "Now I have every log line from one single user question, in
order. Chat request received, embeddings generated for the query, vector
search against SurrealDB, LLM completion received with its token counts.
That is the complete story of one request, reconstructed from a field I
did not have to design or maintain."

**[HIGHLIGHT]** "This is the same `trace_id` you saw in APM a moment
ago. The correlation data is genuinely there and it is the same
identifier across both products, which matters for what I will say in a
minute about licensing."

**[SHOW]** Change the search to show only problems:

```
index=main sourcetype=otel severityText=ERROR
```

**[SAY]** "And because severity is a first-class field, error triage is
a filter rather than a grep. In an incident you would start here, grab
the `trace_id` off the failing request, and pull back the full narrative
in one search."

**[SAY]** "One cost point worth making, because it is a design decision
rather than an accident. The OTel Collector drops DEBUG and TRACE
records before they ever reach Splunk. You are not paying to index
developer noise, but the moment you need that detail you change one line
of collector config, not the application. Filtering happens in the
pipeline, not in the app and not at query time after you have already
paid to store it."

> **Note for presenter, verify before you demo:** confirm that
> `trace_id` actually appears as an **extracted field** in the left-hand
> field list, not just as text inside the raw event. Whether Splunk
> auto-parses the JSON depends on how the `otel` sourcetype is
> configured. If the fields are not extracted, either append `| spath`
> to the search, or set `KV_MODE = json` for that sourcetype. Find this
> out in rehearsal, not on camera.

> **Note for presenter:** if asked why logs are in a different product
> from traces, that is Section 8. Do not improvise an answer here; there
> is a precise one.

---

## Section 8: Boundaries -- what this stack does not do (~1.5 minutes)

> **Why this section exists:** it is more credible to name the edges of
> the demo than to let a knowledgeable viewer notice them first. Every
> item below was established empirically, not assumed. Full detail in
> [splunk-setup.md Section 26](splunk-setup.md#26-what-works-on-free--trial-accounts-and-what-does-not).

**[SHOW]** Stay on the Service Overview tab. Nothing to click here; this
is a spoken section.

**[SAY]** "Before I close, I want to be straight about where the edges
of this are, because three things you might expect to see are
deliberately not here."

**[SAY]** "**First, log correlation.** You just watched me pull back a
full request narrative by its `trace_id`, so the correlation data is
genuinely there and it is the same identifier APM uses. What is missing
is only the join between the two products. Splunk deprecated the old
native Log Observer in January 2024. Its replacement, Log Observer
Connect, reads logs in place from a Splunk platform instance rather than
storing a copy, and it requires a licensed non-trial platform."

**[HIGHLIGHT]** "So the gap is a click, not a capability. Today I copy a
`trace_id` from APM and paste it into Splunk search. On a licensed
account that becomes one click from the trace, with no code changes and
no pipeline changes. What you saw in Section 7 is already the hard part
working."

**[SAY]** "**Second, AI Agent Monitoring.** Splunk has a dedicated set
of AI agent screens, and Cisco is extending them further through the
Galileo acquisition announced in April. Our position here is more nuanced
than it first looked, and it is worth being accurate."

> **Presenter note -- this was revised after checking the vendor docs, and
> the earlier version of this deck was wrong.** We previously said the AI
> screens were unreachable because the instrumentation is Python-only. The
> documentation is Python-shaped, but the actual requirement is span
> attributes, and any language can emit those. What was really missing was
> prompt and response **content**, which is off by default. This stack can
> now emit it behind
> `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY`.
>
> What remains genuinely unavailable is the **agent-level** view, and that
> one is a data model difference rather than a vendor limitation: those
> screens key off `invoke_agent` and `invoke_workflow` semantics, and this
> is a RAG pipeline making direct LLM calls, so those spans do not exist.
> Azure's equivalent dashboard is empty for exactly the same reason.
>
> Say "LLM-level yes, agent-level no", not "Python-only". See
> `docs/splunk-setup.md` section 28.

**[SAY]** "The LLM-level screens are reachable: they key off the standard
`gen_ai` conventions we already emit, plus prompt and response content,
which is a switch we control. The agent-level screens are a different
matter, and not because of Splunk. They expect `invoke_agent` and
`invoke_workflow` spans, and this is a RAG pipeline making direct LLM calls,
so there are no agent invocations to report. Azure's equivalent dashboard is
empty for the same reason."

**[SAY]** "**Third, Splunk-side quality evals.** Splunk can score
responses for hallucination, relevance, toxicity and bias. That needs a
platform licence, and it needs prompt and response content shipped to
Splunk. For a RAG agent over internal documents, that is a data
protection decision rather than a config change, so it is out of scope
here by choice, not by accident."

**[HIGHLIGHT]** "What we do have is a local eval harness, running a
golden question set against the live agent, plus drift detectors on
token count, response length and latency. That covers regression and
drift without sending a single prompt off the stack."

**[HIGHLIGHT] -- worth being precise about, because the two gaps are
different in kind.** "Notice that those three are not the same sort of
problem. Log Observer Connect and the evals are **commercial**: the product
works, we have not bought it. AI Agent Monitoring is **technical**: it is
Python-only, so no amount of licence spend reaches it from a Node service."

**[SAY]** "And it is worth saying what that leaves on the table, because it
is not nothing. Splunk's out-of-the-box experience is the cleaner of the two
platforms in this comparison. Service map, Tag Spotlight, Trace Analyzer and
Related Content are polished and coherent, and we landed in all of them today
without building anything. The AI agent screens are more of the same, sitting
there fully built, and we simply cannot reach them from this runtime."

> **Presenter note -- the honest cross-vendor comparison, if it comes up.**
> Azure's equivalent agent dashboard is *also* empty for this application,
> and for a related but importantly different reason. It keys off the same
> agent span semantics (`invoke_agent`, `execute_tool`, `gen_ai.agent.name`),
> which we do not emit because this is a RAG pipeline making direct LLM
> calls, not an agent framework.
>
> The difference is what it would take to close. Azure's is a **naming**
> problem: adopt the GenAI agent conventions and the dashboard populates,
> because it reads standard OpenTelemetry. Splunk's is a **language** problem
> that no naming change fixes. So Splunk has the better product surface and
> the harder wall; Azure has the plainer surface and an open door. Do not
> flatten that into "neither works".

**[SAY]** "None of this is a limitation of OpenTelemetry. Every one of those
gaps is a vendor entitlement or a language support boundary, and because the
collector is upstream OpenTelemetry rather than a vendor distribution, the
same telemetry already flows to Azure Monitor in parallel, without touching
the application."

> **Note for presenter:** if asked "so would paying fix it?", the honest
> answer is that a licensed Splunk platform fixes log correlation
> immediately with no code change, and the AI agent screens would still
> need Python instrumentation plus agent/workflow span semantics. Do not
> promise the AI screens on a licence upgrade alone.

---

## Closing (~30 seconds)

**[SHOW]** Return to the **Service Overview** tab for a final summary.

**[SAY]** "To summarise what we've seen: a single OpenTelemetry
pipeline gives us infrastructure monitoring, application performance
management, cost tracking, cross-service tracing, per-request log
analytics, security signals, and quality indicators. One pipeline, one
instrumentation effort, three signals. The key benefits are:

**For engineering:** Full-stack visibility from database transactions
to LLM completions, with distributed tracing across service
boundaries, and every log line tagged with the trace it belongs to. No
blind spots, and no manual correlation IDs.

**For finance:** Token-level cost tracking and projection. Know
exactly what your AI spend is and where it's going.

**For security and compliance:** Audit trails for every AI interaction,
anomaly detection for prompt injection and agent subversion, and the
foundation for continuous quality monitoring.

**For architecture:** SurrealDB provides a unified document, vector,
and graph store with native OTel support. The Model Context Protocol
enables composable tool integration. Docker Compose makes the whole
stack reproducible. And OpenTelemetry ensures it's all observable,
with no vendor lock-in.

This is what production-ready AI observability looks like. Thank you."

---

## Chart name reference

Chart names must match `splunk/dashboard.json` exactly. Run
`python3 scripts/check_talk_tracks.py` after any dashboard change: it fails
on a name that does not exist, a chart missing from these tables, and a
per-tab count that does not match reality. This table drifted to 26 charts
against a 31-chart dashboard before that check existed.

The following chart names must match exactly between this talk track
and the dashboard automation script (`splunk/dashboard.json`). Charts
are organised across 4 dashboard tabs.

### Service Overview (8 charts)

| # | Chart name | Talk track section |
|---|---|---|
| 1 | rag-api Requests | S1: Infrastructure |
| 2 | surrealdb Requests | S1: Infrastructure |
| 3 | playwright-mcp Requests | S1: Infrastructure |
| 4 | Error Rate % | S2: RAG Pipeline |
| 5 | Request Rate | S2: RAG Pipeline |
| 6 | Service Latency (P50/P90/P99) | S2: RAG Pipeline |
| 7 | Error Count by Endpoint | S2: RAG Pipeline |
| 8 | Top Endpoints | S2: RAG Pipeline |

### RAG Pipeline (7 charts)

| # | Chart name | Talk track section |
|---|---|---|
| 9 | RAG Chat Pipeline Latency | S2: RAG Pipeline |
| 10 | RAG Upload Pipeline Latency | S2: RAG Pipeline |
| 11 | MCP Scrape Latency | S4: Cross-Service |
| 12 | Embedding Latency (P50/P90) | S2: RAG Pipeline |
| 13 | DB Operation Breakdown | S2: RAG Pipeline |
| 14 | Vector Search Latency (P50/P90) | S2: RAG Pipeline |
| 15 | Active Sessions | S2: RAG Pipeline |

### LLM and AI (10 charts)

| # | Chart name | Talk track section |
|---|---|---|
| 16 | LLM Provider and Model | S3: Token Economics |
| 17 | Embedding Model | S3: Token Economics |
| 18 | Total Input Tokens | S3: Token Economics |
| 19 | Total Output Tokens | S3: Token Economics |
| 20 | Token Usage Over Time | S3: Token Economics |
| 21 | LLM Tokens Over Time | S3: Token Economics |
| 22 | Embedding Tokens Over Time | S3: Token Economics |
| 23 | LLM Call Latency (P50/P90/P99) | S3: Token Economics |
| 24 | Embedding API Latency | S3: Token Economics |
| 25 | Response Length Over Time | S6: Quality and Eval Monitoring |

### Infrastructure (6 charts)

| # | Chart name | Talk track section |
|---|---|---|
| 26 | Container CPU Usage | S1: Infrastructure |
| 27 | Container Memory Usage | S1: Infrastructure |
| 28 | Container Network I/O | S1: Infrastructure |
| 29 | SurrealDB Process Health | S1: Infrastructure |
| 30 | SurrealDB Transaction Rate | S1: Infrastructure |
| 31 | SurrealDB HTTP Activity | S1: Infrastructure |

> **Note:** Charts 21-23 use the OTel Collector's `docker_stats`
> receiver, which reads container metrics from the Docker daemon
> socket. This is enabled by default in `docker-compose.yml` and
> `otel-collector-config.yaml` -- no extra setup needed.

---

*Last updated: 2026-09-09*
