# Demo Talk Track -- RAG Agent Observability

A scripted walkthrough for demonstrating the Splunk Observability Cloud
dashboard for the RAG Agent stack. Total runtime: ~12 minutes.

Each section includes:
- **[SHOW]** -- what to click/navigate to in Splunk
- **[SAY]** -- the voice-over script
- **[HIGHLIGHT]** -- specific data points or patterns to call out
- **[CHART]** -- reference to the specific chart name on the demo dashboard

---

## Opening (~30 seconds)

**[SHOW]** Open Splunk Observability Cloud. Navigate to the `RAG Agent
-- Observability` dashboard group and select the `Demo Dashboard`.

**[SAY]** "What you're looking at is a fully instrumented RAG agent
stack -- a Node.js API backed by SurrealDB for document and vector
storage, connected to an external browser automation service via the
Model Context Protocol, and calling OpenAI for embeddings and chat
completions. Every service in this stack emits OpenTelemetry telemetry
-- traces, metrics, and logs -- through a single OTel Collector into
Splunk Observability Cloud. Let me walk you through what this gives us."

---

## Section 1: Service Map and Infrastructure (~2 minutes)

**[SHOW]** Navigate to **APM > Service map**. Set environment to `dev`.

**[SAY]** "The service map is auto-generated from trace data -- we
didn't configure it, Splunk built it from the parent-child span
relationships. You can see `rag-api` at the centre, with edges to
`surrealdb` for database operations and `playwright-mcp` for web
scraping. The colour coding shows health at a glance -- green means
healthy, yellow is elevated errors, red is critical."

**[HIGHLIGHT]** Point out the edge between `rag-api` and
`playwright-mcp` -- this is the cross-service MCP dependency.

**[SHOW]** Click the `rag-api` node to open the service view.

**[SAY]** "The service view gives us RED metrics -- Request rate, Error
rate, and Duration -- without any manual setup. Splunk derives these
automatically from trace data using Monitoring MetricSets. This is a
key benefit of the platform: you get baseline observability for free,
just by sending traces."

**[CHART]** `Service Health Overview`

**[SHOW]** Switch to the Demo Dashboard. Point to the SurrealDB charts.

**[SAY]** "Now let's look at the infrastructure layer. SurrealDB 3.2
has native OpenTelemetry support -- it pushes metrics directly to our
collector. We can see CPU usage, memory consumption, transaction rates,
and HTTP activity. This is infrastructure monitoring and application
monitoring in one place -- we can correlate a spike in API latency with
a spike in database CPU without switching tools."

**[CHART]** `SurrealDB Process Health`, `SurrealDB Transaction Rate`,
`SurrealDB HTTP Activity`

**[HIGHLIGHT]** "Notice how SurrealDB's transaction rate correlates
with the API request rate -- every chat query triggers a vector search
transaction, and every upload triggers insert transactions. This
correlation is automatic because both services report to the same
collector."

**[SHOW]** Scroll to the container metric charts.

**[CHART]** `Container CPU Usage`, `Container Memory Usage`,
`Container Network I/O`

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

**[SHOW]** Point to the request rate and latency charts on the dashboard.

**[CHART]** `Request Rate`, `Error Rate %`, `Service Latency (P50/P90/P99)`

**[SAY]** "These are the core health signals. Request rate tells us
throughput -- a sudden drop to zero means the service is down. Error
rate is the primary quality signal. And latency percentiles show us
both typical experience (P50) and worst-case (P99). A widening gap
between P50 and P99 is a red flag for inconsistent performance."

**[SHOW]** Point to the RAG pipeline breakdown charts.

**[CHART]** `RAG Chat Pipeline Latency`, `RAG Upload Pipeline Latency`

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

**[CHART]** `Top Endpoints`

**[SAY]** "The top endpoints chart shows traffic distribution. In a
healthy system, chat requests dominate. If upload or scrape traffic
suddenly spikes, that could indicate automated abuse or a
misconfigured client."

---

## Section 3: Token Economics (~1.5 minutes)

**[SHOW]** Point to the token usage charts on the dashboard.

**[CHART]** `Token Usage (Input)`, `Token Usage (Output)`

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

**[SHOW]** Navigate to **APM > Traces**. Filter for traces containing
both `rag-api` and `playwright-mcp`.

**[SAY]** "This is distributed tracing in action. When a user scrapes
a web page, the request flows from our Node.js API to the Playwright
MCP server -- a completely separate Python service. OpenTelemetry's
W3C trace context propagation automatically links the spans across the
HTTP boundary. We didn't write any correlation code -- the OTel
auto-instrumentation handles it."

**[SHOW]** Click a scrape trace to open the waterfall view.

**[SAY]** "In the waterfall, you can see the full journey: the Express
route handler creates a `scrape.pipeline` span, which calls
`mcp.scrape`. Inside that, we see individual HTTP calls to the MCP
server, and on the MCP side, each tool invocation -- `session_create`,
`browser_navigate`, `browser_get_text`, `session_close` -- appears as
a child span. Then back in the API, we see chunking, embedding, and
database insertion."

**[CHART]** `MCP Scrape Latency`

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

**[SHOW]** Navigate back to the dashboard. Open **APM > Tag Spotlight**
for `rag-api`.

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

**[SHOW]** Navigate to **APM > Traces** and filter for chat operations.
Click a trace and expand the `llm.chatCompletion` span.

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

## Closing (~30 seconds)

**[SHOW]** Return to the Demo Dashboard overview.

**[SAY]** "To summarise what we've seen: a single OpenTelemetry
pipeline gives us infrastructure monitoring, application performance
management, cost tracking, cross-service tracing, security signals,
and quality indicators -- all in one platform. The key benefits are:

**For engineering:** Full-stack visibility from database transactions
to LLM completions, with distributed tracing across service
boundaries. No blind spots.

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

The following chart names must match exactly between this talk track
and the dashboard automation script (`splunk/dashboard.json`):

| # | Chart name | Talk track section |
|---|---|---|
| 1 | Service Health Overview | S1: Infrastructure |
| 2 | SurrealDB Process Health | S1: Infrastructure |
| 3 | SurrealDB Transaction Rate | S1: Infrastructure |
| 4 | Request Rate | S2: RAG Pipeline |
| 5 | Error Rate % | S2: RAG Pipeline |
| 6 | Service Latency (P50/P90/P99) | S2: RAG Pipeline |
| 7 | RAG Chat Pipeline Latency | S2: RAG Pipeline |
| 8 | RAG Upload Pipeline Latency | S2: RAG Pipeline |
| 9 | Token Usage (Input) | S3: Token Economics |
| 10 | Token Usage (Output) | S3: Token Economics |
| 11 | Top Endpoints | S2: RAG Pipeline |
| 12 | MCP Scrape Latency | S4: Cross-Service |
| 13 | SurrealDB HTTP Activity | S1: Infrastructure |
| 14 | SurrealDB Network I/O | S1: Infrastructure |
| 15 | Container CPU Usage | S1: Infrastructure |
| 16 | Container Memory Usage | S1: Infrastructure |
| 17 | Container Network I/O | S1: Infrastructure |

> **Note:** Charts 15-17 use the OTel Collector's `docker_stats`
> receiver, which reads container metrics from the Docker daemon
> socket. This is enabled by default in `docker-compose.yml` and
> `otel-collector-config.yaml` -- no extra setup needed.

---

*Last updated: 2026-09-04*
