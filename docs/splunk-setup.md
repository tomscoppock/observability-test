# Splunk Observability Cloud -- Setup and Dashboard Guide

Step-by-step guide for building dashboards and alerts in Splunk
Observability Cloud for the observability-test RAG Agent stack.

> **Prerequisite:** The OTel Collector must be exporting data to Splunk.
> Check **APM > Overview** for the `rag-api` service. If missing, see
> [opentelemetry.md](opentelemetry.md).

---

## Table of Contents

### APM (rag-api service)

1. [How our data reaches Splunk](#1-how-our-data-reaches-splunk)
2. [Verify data is arriving](#2-verify-data-is-arriving)
3. [Explore the APM service map](#3-explore-the-apm-service-map)
4. [Use built-in APM dashboards](#4-use-built-in-apm-dashboards)
5. [Create a dashboard group and dashboard](#5-create-a-dashboard-group-and-dashboard)
6. [Tutorial: Request rate chart](#6-tutorial-request-rate-chart)
7. [Tutorial: Error rate chart](#7-tutorial-error-rate-chart)
8. [Tutorial: Latency percentile chart](#8-tutorial-latency-percentile-chart)
9. [Tutorial: Top endpoints chart](#9-tutorial-top-endpoints-chart)

### Infrastructure Monitoring (SurrealDB)

10. [SurrealDB telemetry pipeline](#10-surrealdb-telemetry-pipeline)
11. [Tutorial: SurrealDB process health chart](#11-tutorial-surrealdb-process-health-chart)
12. [Tutorial: SurrealDB transaction performance chart](#12-tutorial-surrealdb-transaction-performance-chart)
13. [Tutorial: SurrealDB HTTP and network chart](#13-tutorial-surrealdb-http-and-network-chart)

### RAG Pipeline Observability

14. [Tutorial: RAG upload pipeline chart](#14-tutorial-rag-upload-pipeline-chart)
15. [Tutorial: RAG chat pipeline chart](#15-tutorial-rag-chat-pipeline-chart)
16. [Tutorial: Embedding and LLM token usage chart](#16-tutorial-embedding-and-llm-token-usage-chart)
17. [Tutorial: RAG error rate detector](#17-tutorial-rag-error-rate-detector)

### Alerts and Operations

18. [Create detectors (alerts)](#18-create-detectors-alerts)
19. [Dashboard best practices](#19-dashboard-best-practices)

### Cross-Service Monitoring (MCP)

20. [MCP service monitoring](#20-mcp-service-monitoring)
21. [Tutorial: MCP scrape latency chart](#21-tutorial-mcp-scrape-latency-chart)

### Dashboard Automation

22. [Spanmetrics connector and Custom MetricSets](#22-spanmetrics-connector-and-custom-metricsets)
23. [Automated dashboard setup](#23-automated-dashboard-setup)

### Reference

24. [Quick reference](#24-quick-reference)

---

## 1. How our data reaches Splunk

Understanding the data pipeline helps you know what metrics are available
and where they come from.

```
Node.js API (rag-api)               SurrealDB 3.2+ (surrealdb)
  |                                    |
  |  OTel SDK auto-instrumentation:    |  Native OTLP telemetry:
  |    - Traces (spans)                |    - Metrics (surrealdb.*)
  |    - Metrics (histograms)          |    - Traces (tx, rpc, http)
  |    - Logs (when configured)        |    - Logs (structured)
  |                                    |
  v                                    v
  +------------------------------------+
                    |
            OTel Collector (otel-collector container)
                    |
                    |  Three export pipelines:
                    |    Traces  --> otlp_http/splunk  --> Splunk APM
                    |    Metrics --> signalfx           --> Splunk IM
                    |    Logs    --> otlp_http/splunk_logs --> Splunk Log Observer
                    |
                    |  The spanmetrics connector generates metrics
                    |  from ALL spans (including INTERNAL/CLIENT):
                    |    duration  -- histogram of span durations (ms)
                    |    calls     -- counter of span invocations
                    |
                    v
            Splunk Observability Cloud
                    |
                    |  APM derives Monitoring MetricSets (MMS) from traces:
                    |    service.request  -- histogram containing count + duration
                    |    spans            -- per-span histogram (SERVER/CONSUMER only)
                    |    traces           -- per-trace histogram
                    |
                    |  Infrastructure Monitoring receives direct metrics:
                    |    surrealdb.*      -- gauges, counters, histograms
                    |    duration/calls   -- from spanmetrics connector
                    |
                    v
            Dashboards, Alerts, Service Map
```

**Key concept -- Monitoring MetricSets (MMS) and spanmetrics:**

Splunk APM automatically creates histogram metrics from your trace data.
The primary one is `service.request` (an MMS metric). Because it is a
histogram, a single metric contains both the request **count** and the
request **duration** (latency). You extract different values by applying
different functions:

| What you want | Function to apply | Example SignalFlow |
|---|---|---|
| Request count | `count()` | `histogram('service.request').count()` |
| Latency median | `median()` | `histogram('service.request').median()` |
| Latency P90 | `percentile(pct=90)` | `histogram('service.request').percentile(pct=90)` |
| Latency P99 | `percentile(pct=99)` | `histogram('service.request').percentile(pct=99)` |
| Min latency | `min()` | `histogram('service.request').min()` |
| Max latency | `max()` | `histogram('service.request').max()` |

**Important:** MMS only covers spans with `span.kind = SERVER` or
`CONSUMER` (i.e. HTTP endpoint spans). Custom spans like
`chat.pipeline`, `db.vectorSearch`, and `chat <model>` have
`span.kind = INTERNAL` or `CLIENT` and are invisible to MMS.

To get latency and call-count metrics for ALL spans, this project uses
the **spanmetrics connector** in the OTel Collector. It generates two
metrics -- `traces.span.metrics.duration` (histogram) and
`traces.span.metrics.calls` (counter) -- with dimensions
`service.name`, `span.name`, `gen_ai.operation.name`, etc. These are
queryable in SignalFlow with
`histogram('traces.span.metrics.duration', ...)` and
`data('traces.span.metrics.calls', ...)`. See
[opentelemetry.md](opentelemetry.md#spanmetrics-connector) for full
details.

**Dimension names:** APM dimensions use the `sf_` prefix:

| Dimension | Meaning |
|---|---|
| `sf_service` | Service name (e.g. `rag-api`) |
| `sf_environment` | Deployment environment (e.g. `dev`) |
| `sf_error` | `true` or `false` |
| `sf_operation` | Endpoint/operation name |
| `sf_httpMethod` | HTTP method (GET, POST, etc.) |

---

## 2. Verify data is arriving

1. Sign in to [Splunk Observability Cloud](https://app.signalfx.com).
2. Select **APM** from the left navigation.
3. On the **Overview** page, look for `rag-api` in the services table.
4. You should see request rate, error rate, and latency values.

If the service does not appear, check:

- Collector logs: `docker compose logs otel-collector`
- Environment variables: `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` in `.env`
- API telemetry: see [docker-commands.md](docker-commands.md#viewing-otel-telemetry)

---

## 3. Explore the APM service map

> **What:** A real-time dependency graph of your instrumented services.
> **Why:** Quickly see which services are healthy, which have errors, and
> how they depend on each other.
> **How:** Built automatically from trace span data -- every span's
> parent-child relationship creates an edge in the graph.

1. Navigate to **APM > Service map**.
2. Set **Environment** to `dev` (matches your `OTEL_DEPLOYMENT_ENV`).
3. Set the **Time range** (e.g. last 15 minutes).
4. You should see the `rag-api` node. Click it to open the sidebar with:
   - Request rate, error rate, and latency charts
   - Downstream dependencies
5. **Red indicators** on nodes or edges = elevated error rates.
6. Click **Breakdown** to split by span tag (e.g. `http.route`).
7. Click any chart to see matching example traces.
8. Click **View Dashboard** to open the built-in APM dashboard for that
   service (preserves your current filters).

---

## 4. Use built-in APM dashboards

> **What:** Pre-built, read-only dashboards auto-populated from trace data.
> **Why:** Instant visibility without creating anything -- request rate,
> latency, latency distribution, and error rate are already charted.
> **How:** Splunk generates these from the `service.request` MMS.

1. Select **Dashboards** from the left navigation.
2. Expand the **Built-in** section.
3. Select **APM Services**.
4. Use the filter bar at the top:
   - **Service:** `rag-api`
   - **Environment:** `dev`
   - **Time range:** as needed

**What you see:**

| Chart | Description |
|---|---|
| Request Rate | Requests per second over time |
| Request Latency | Latency trend (median) |
| Request Latency Distribution | Histogram of latency values |
| Error Rate | Percentage of errored requests |

**To customise:** Built-in dashboards are read-only. Click **Actions
(...) > Save as** to create an editable copy in your own dashboard group.

---

## 5. Create a dashboard group and dashboard

> **What:** A dashboard group is a folder that holds related dashboards.
> A dashboard is a page of charts.
> **Why:** Organise your monitoring by service, team, or environment.
> **How:** Groups and dashboards are metadata in Splunk -- they don't
> affect data collection.

### Step 1: Create a dashboard group

1. Click **Create (+)** in the top navigation bar.
2. Select **Dashboard Group**.
3. Enter a name: `RAG Agent -- Observability`.
4. Click **Create**.

**What happens:** Splunk creates the group and drops you into a new,
empty dashboard with the same name. This is your first dashboard inside
the group.

### Step 2: Rename the dashboard

1. Click **Dashboard actions (...) > Rename**.
2. Enter a name: `Service Health`.
3. Click **OK** / **Save**.

You now have:

```
RAG Agent -- Observability  (group)
  |-- Service Health        (dashboard, currently empty)
```

### Step 3: Add charts

The dashboard is in edit mode. You can now add charts using the tutorials
below. Each tutorial creates one chart. After adding charts:

1. **Drag charts** by their top edge to reposition them.
2. **Resize charts** by dragging their corners or edges.
3. Click **Save** on the dashboard when done.

---

## 6. Tutorial: Request rate chart

> **What:** How many requests per second the `rag-api` service is handling.
> **Why:** Baseline for capacity planning; a sudden drop to zero means the
> service is down.
> **How:** Uses the `service.request` histogram MMS with a `count()`
> function, then applies a `Rate` analytic to convert to per-second.

### Builder tab

1. Click **Create (+) > Chart** (or **New chart** on the dashboard).
2. You are in the **Edit chart** view. At the bottom, ensure the
   **Builder** tab is selected.
3. In the **Data selection** column for variable **A**, type
   `service.request` and select it from the dropdown.
4. In the **Analytics** column, you should see a function selector
   (since `service.request` is a histogram). Select **Count**.
5. Still in **Analytics**, click **+ Add analytics** and select **Rate**
   to convert the count to requests/second.
6. In the **Filter** column, click **Add filters**:
   - `sf_service` = `rag-api`
   - `sf_environment` = `dev`
7. In the right-hand **Configuration** panel:
   - **Chart title:** `Request Rate`
   - **Visualization type:** `Single value` (for a headline number) or
     `Line` (for a trend over time)
8. Click **Save**.

### SignalFlow tab

1. Click **Create (+) > Chart**.
2. Select the **SignalFlow** tab at the bottom.
3. Enter:

```signalflow
A = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')).count().rate().publish(label='Request Rate')
```

4. Set **Chart title** to `Request Rate` in the Configuration panel.
5. Click **Save**.

### JSON tab

The **JSON** tab shows the raw chart definition (Splunk Charts API
format). You can paste a complete JSON definition here to create a chart
programmatically. This is useful for version-controlling chart definitions
or copying charts between orgs. The JSON is auto-generated from whatever
you build in the Builder or SignalFlow tabs -- you rarely need to edit it
directly.

---

## 7. Tutorial: Error rate chart

> **What:** The percentage of requests that result in an error.
> **Why:** The primary indicator of service health -- a spike means
> something is broken.
> **How:** Compares errored request count to total request count from the
> `service.request` MMS, using the `sf_error` dimension to filter.

### Builder tab

1. Click **Create (+) > Chart**.
2. In **Data selection** for variable **A**, select `service.request`.
3. In **Analytics**, select **Count**.
4. In **Filter**, click **Add filters**:
   - `sf_service` = `rag-api`
   - `sf_environment` = `dev`
   - `sf_error` = `true`
5. Click **Add plot** to create variable **B**.
6. In **Data selection** for **B**, select `service.request`.
7. In **Analytics** for **B**, select **Count**.
8. In **Filter** for **B**, add:
   - `sf_service` = `rag-api`
   - `sf_environment` = `dev`
   (no `sf_error` filter -- this is the total)
9. Click **Add plot** to create variable **C**.
10. Click the **Data selection** for **C** and select **Enter formula**.
    Type: `(A / B) * 100`
11. Hide plots A and B (click the eye icon next to each) so only the
    percentage line shows.
12. In **Configuration**:
    - **Chart title:** `Error Rate %`
    - **Visualization type:** `Line`
13. Click **Save**.

### SignalFlow tab

```signalflow
A = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev') and filter('sf_error', 'true')).count().publish(label='Errors', enable=False)
B = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')).count().publish(label='Total', enable=False)
C = (A / B * 100).publish(label='Error Rate %')
```

---

## 8. Tutorial: Latency percentile chart

> **What:** How long requests take, shown as P50 (median), P90, and P99.
> **Why:** P50 shows typical user experience; P99 shows worst-case. A
> widening gap between P50 and P99 suggests inconsistent performance.
> **How:** The `service.request` histogram MMS stores duration data.
> Applying `percentile(pct=N)` extracts the Nth percentile latency.

### Builder tab (single percentile)

1. Click **Create (+) > Chart**.
2. In **Data selection** for variable **A**, select `service.request`.
3. In **Analytics**, select **Percentile** and set the value to `50`.
4. In **Filter**, click **Add filters**:
   - `sf_service` = `rag-api`
   - `sf_environment` = `dev`
5. In **Configuration**:
   - **Chart title:** `Latency P50`
   - **Visualization type:** `Line`
6. Click **Save**.
7. Repeat for P90 (percentile = 90) and P99 (percentile = 99).

### Builder tab (all percentiles on one chart)

1. Click **Create (+) > Chart**.
2. Variable **A**: `service.request`, Analytics = **Percentile** (50),
   Filter = `sf_service` = `rag-api`, `sf_environment` = `dev`.
3. Click **Add plot** for variable **B**: same metric, same filters,
   Analytics = **Percentile** (90).
4. Click **Add plot** for variable **C**: same metric, same filters,
   Analytics = **Percentile** (99).
5. In **Configuration**:
   - **Chart title:** `Service Latency (P50 / P90 / P99)`
   - **Visualization type:** `Line`
6. Click **Save**.

### SignalFlow tab

```signalflow
filter_ = filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')
A = histogram('service.request', filter=filter_).percentile(pct=50).publish(label='P50')
B = histogram('service.request', filter=filter_).percentile(pct=90).publish(label='P90')
C = histogram('service.request', filter=filter_).percentile(pct=99).publish(label='P99')
```

---

## 9. Tutorial: Top endpoints chart

> **What:** Which API endpoints receive the most traffic.
> **Why:** Identifies hot paths for optimisation and helps spot unexpected
> traffic patterns.
> **How:** Groups the `service.request` count by the `sf_operation`
> dimension (which maps to the endpoint/route).

### Builder tab

1. Click **Create (+) > Chart**.
2. In **Data selection** for variable **A**, select `service.request`.
3. In **Analytics**, select **Count**, then click **+ Add analytics** and
   select **Top** with N = 10.
4. In **Filter**, add:
   - `sf_service` = `rag-api`
   - `sf_environment` = `dev`
5. In **Configuration**:
   - **Chart title:** `Top Endpoints`
   - **Visualization type:** `List`
6. Click **Save**.

### SignalFlow tab

```signalflow
A = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')).count().top(count=10).publish(label='Top Endpoints')
```

---

## 10. SurrealDB telemetry pipeline

SurrealDB 3.1+ includes a unified OpenTelemetry pipeline that pushes
metrics, traces, and logs over OTLP when `SURREAL_TELEMETRY_PROVIDER=otlp`
is set. Our stack upgraded from 3.0.5 (no OTel support) to 3.2.4.

```
SurrealDB 3.2.4 (surrealdb container)
  |
  |  SURREAL_TELEMETRY_PROVIDER=otlp enables:
  |    - Metrics (surrealdb.* gauges, counters, histograms)
  |    - Traces  (transaction + RPC + HTTP spans)
  |    - Logs    (structured log records)
  |
  |  OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
  |
  v
OTel Collector (same instance as rag-api)
  |
  |  Same three export pipelines:
  |    Metrics --> signalfx          --> Splunk IM
  |    Traces  --> otlp_http/splunk  --> Splunk APM
  |    Logs    --> otlp_http/splunk_logs --> Splunk Log Observer
  |
  v
Splunk Observability Cloud
```

**Key difference from rag-api:** These are **infrastructure metrics** --
direct gauge/counter/histogram values pushed by SurrealDB itself, not
derived from traces. You use `data('metric.name')` in SignalFlow (not
`histogram('service.request')`).

### Available metrics

| Scope | Metric | Type | Description |
|---|---|---|---|
| `surrealdb.process` | `surrealdb.process.cpu_percent` | Gauge | CPU usage percentage |
| | `surrealdb.process.memory` | Gauge | Memory usage (bytes) |
| | `surrealdb.process.uptime` | Gauge | Seconds since start |
| | `surrealdb.build.info` | Gauge | Always 1; version in attributes |
| `surrealdb.transaction` | `surrealdb.transaction` | Counter | Transaction count |
| | `surrealdb.transaction.duration` | Histogram | Transaction duration |
| | `surrealdb.transaction.kv_ops` | Counter | Key-value operations |
| | `surrealdb.transaction.keys_read` | Counter | Keys read |
| | `surrealdb.transaction.keys_written` | Counter | Keys written |
| | `surrealdb.transaction.key_bytes_read` | Counter | Bytes read (keys) |
| | `surrealdb.transaction.value_bytes_read` | Counter | Bytes read (values) |
| | `surrealdb.transaction.key_bytes_written` | Counter | Bytes written (keys) |
| | `surrealdb.transaction.value_bytes_written` | Counter | Bytes written (values) |
| `surrealdb.http` | `surrealdb.http.request` | Counter | HTTP request count |
| | `surrealdb.http.request.duration` | Histogram | HTTP request duration |
| | `surrealdb.http.request.size` | Histogram | Request body size |
| | `surrealdb.http.response.size` | Histogram | Response body size |
| | `surrealdb.http.active_requests` | Gauge | In-flight HTTP requests |
| `surrealdb.rpc` | `surrealdb.rpc` | Counter | RPC call count |
| | `surrealdb.rpc.duration` | Histogram | RPC call duration |
| `surrealdb.network` | `surrealdb.network.received` | Counter | Bytes received |
| | `surrealdb.network.sent` | Counter | Bytes sent |

### Verify SurrealDB data in Splunk

1. Navigate to **Metric Finder** (left nav > **Metrics**).
2. Search for `surrealdb`.
3. You should see the metrics listed above. If not, check:
   - `docker compose logs otel-collector` for export errors
   - `docker compose logs surrealdb` for telemetry init messages
   - Ensure `SURREAL_TELEMETRY_PROVIDER=otlp` is set in `docker-compose.yml`

---

## 11. Tutorial: SurrealDB process health chart

> **What:** CPU usage, memory consumption, and uptime of the SurrealDB
> instance.
> **Why:** Detect resource exhaustion before it causes query failures or
> OOM kills.
> **How:** SurrealDB pushes `surrealdb.process.*` gauge metrics via OTLP.
> These are direct measurements, not derived from traces.

### Builder tab

1. Click **Create (+) > Chart**.
2. In **Data selection** for variable **A**, type
   `surrealdb.process.cpu_percent` and select it.
3. In **Filter**, click **Add filters**:
   - `service.name` = `surrealdb`
4. Click **Add plot** for variable **B**.
5. In **Data selection** for **B**, select
   `surrealdb.process.memory`.
6. In **Filter** for **B**, add `service.name` = `surrealdb`.
7. In **Configuration**:
   - **Chart title:** `SurrealDB Process Health`
   - **Visualization type:** `Line`
   - Optionally set **B** to a secondary Y-axis (click the plot
     settings gear icon for B > **Y-axis** > **Right**) since CPU (%)
     and memory (bytes) have different scales.
8. Click **Save**.

### SignalFlow tab

```signalflow
A = data('surrealdb.process.cpu_percent', filter=filter('service.name', 'surrealdb')).publish(label='CPU %')
B = data('surrealdb.process.memory', filter=filter('service.name', 'surrealdb')).publish(label='Memory (bytes)')
```

### JSON tab

As with APM charts, the JSON tab shows the raw chart definition. Use it
to version-control or copy SurrealDB charts between environments.

---

## 12. Tutorial: SurrealDB transaction performance chart

> **What:** Transaction throughput, duration, and data volume flowing
> through SurrealDB.
> **Why:** Transactions are the core unit of work in SurrealDB. Monitoring
> throughput and duration reveals query performance degradation, lock
> contention, or data growth issues.
> **How:** SurrealDB pushes `surrealdb.transaction.*` counters and
> histograms. Use `rate()` on counters to get per-second throughput.

### Builder tab (transaction rate)

1. Click **Create (+) > Chart**.
2. In **Data selection** for variable **A**, select
   `surrealdb.transaction`.
3. In **Analytics**, click **+ Add analytics** and select **Rate** to
   convert the counter to transactions/second.
4. In **Filter**, add `service.name` = `surrealdb`.
5. In **Configuration**:
   - **Chart title:** `SurrealDB Transaction Rate`
   - **Visualization type:** `Line`
6. Click **Save**.

### Builder tab (KV throughput)

1. Click **Create (+) > Chart**.
2. Variable **A**: `surrealdb.transaction.keys_read`, Analytics = **Rate**,
   Filter = `service.name` = `surrealdb`.
3. Click **Add plot** for variable **B**:
   `surrealdb.transaction.keys_written`, Analytics = **Rate**,
   same filter.
4. In **Configuration**:
   - **Chart title:** `SurrealDB KV Throughput (keys/s)`
   - **Visualization type:** `Line`
5. Click **Save**.

### SignalFlow tab

```signalflow
# Transaction rate
A = data('surrealdb.transaction', filter=filter('service.name', 'surrealdb')).rate().publish(label='Tx/s')

# KV read/write throughput
B = data('surrealdb.transaction.keys_read', filter=filter('service.name', 'surrealdb')).rate().publish(label='Keys Read/s')
C = data('surrealdb.transaction.keys_written', filter=filter('service.name', 'surrealdb')).rate().publish(label='Keys Written/s')

# Data volume
D = data('surrealdb.transaction.value_bytes_read', filter=filter('service.name', 'surrealdb')).rate().publish(label='Bytes Read/s')
E = data('surrealdb.transaction.value_bytes_written', filter=filter('service.name', 'surrealdb')).rate().publish(label='Bytes Written/s')
```

---

## 13. Tutorial: SurrealDB HTTP and network chart

> **What:** HTTP request rate, active connections, and network I/O for the
> SurrealDB HTTP API.
> **Why:** The rag-api communicates with SurrealDB over HTTP. Monitoring
> HTTP metrics shows whether the database API layer is a bottleneck.
> **How:** SurrealDB pushes `surrealdb.http.*` and `surrealdb.network.*`
> metrics. Active requests is a gauge; the rest are counters/histograms.

### Builder tab

1. Click **Create (+) > Chart**.
2. Variable **A**: `surrealdb.http.request`, Analytics = **Rate**,
   Filter = `service.name` = `surrealdb`.
3. Click **Add plot** for variable **B**:
   `surrealdb.http.active_requests`, no analytics needed (it is a gauge),
   same filter.
4. In **Configuration**:
   - **Chart title:** `SurrealDB HTTP Activity`
   - **Visualization type:** `Line`
   - Set **B** to secondary Y-axis if scales differ.
5. Click **Save**.

### Builder tab (network I/O)

1. Click **Create (+) > Chart**.
2. Variable **A**: `surrealdb.network.received`, Analytics = **Rate**,
   Filter = `service.name` = `surrealdb`.
3. Click **Add plot** for variable **B**:
   `surrealdb.network.sent`, Analytics = **Rate**, same filter.
4. In **Configuration**:
   - **Chart title:** `SurrealDB Network I/O (bytes/s)`
   - **Visualization type:** `Area`
5. Click **Save**.

### SignalFlow tab

```signalflow
# HTTP activity
A = data('surrealdb.http.request', filter=filter('service.name', 'surrealdb')).rate().publish(label='HTTP Req/s')
B = data('surrealdb.http.active_requests', filter=filter('service.name', 'surrealdb')).publish(label='Active Requests')

# Network I/O
C = data('surrealdb.network.received', filter=filter('service.name', 'surrealdb')).rate().publish(label='Received bytes/s')
D = data('surrealdb.network.sent', filter=filter('service.name', 'surrealdb')).rate().publish(label='Sent bytes/s')
```

---

## 14. Tutorial: RAG upload pipeline chart

> **What:** Duration breakdown of the file upload pipeline -- how long
> chunking, embedding, and database insertion take for each upload.
> **Why:** Identifies which step is the bottleneck (usually embedding).
> **How:** Uses custom spans from the upload route: `upload.pipeline`,
> `upload.chunk`, `embeddings <model>`, `db.insertDocument`,
> `db.insertChunks`.
>
> **Note:** Embedding span names follow the gen_ai semantic convention
> `{operation} {model}` (e.g. `embeddings text-embedding-3-small`).
> The automated dashboard uses `gen_ai.operation.name` = `embeddings`
> to filter model-independently. The queries below use the
> `duration` histogram from the spanmetrics connector (see
> [opentelemetry.md](opentelemetry.md#spanmetrics-connector)).

### Finding upload traces

1. Navigate to **APM > Traces**.
2. Filter by `sf_service` = `rag-api` and `sf_operation` contains `upload`.
3. Click a trace to see the waterfall view.

### Builder tab (upload latency by step)

1. Click **Create (+) > Chart**.
2. In **Data selection** for variable **A**, select `duration`.
3. In **Analytics**, select **Percentile (50)**.
4. In **Filter**, add:
   - `service.name` = `rag-api`
   - `span.name` = `upload.pipeline`
5. Click **Add plot** for variable **B**: same metric, filter by
   `gen_ai.operation.name` = `embeddings`.
6. Click **Add plot** for variable **C**: same metric, filter
   `span.name` = `db.insertChunks`.
7. In **Configuration**:
   - **Chart title:** `RAG Upload Pipeline Latency`
   - **Visualization type:** `Line`
8. Click **Save**.

### SignalFlow tab

```signalflow
filter_ = filter('service.name', 'rag-api') and filter('deployment.environment', 'dev')
A = histogram('traces.span.metrics.duration', filter=filter_ and filter('span.name', 'upload.pipeline')).percentile(pct=50).publish(label='Total Upload')
B = histogram('traces.span.metrics.duration', filter=filter_ and filter('gen_ai.operation.name', 'embeddings')).percentile(pct=50).publish(label='Embedding')
C = histogram('traces.span.metrics.duration', filter=filter_ and filter('span.name', 'db.insertChunks')).percentile(pct=50).publish(label='DB Insert')
```

---

## 15. Tutorial: RAG chat pipeline chart

> **What:** Duration breakdown of the chat pipeline -- query embedding,
> vector search, document fetch, and LLM completion.
> **Why:** Shows where chat latency comes from. LLM completion is usually
> the slowest step; vector search should be fast.
> **How:** Uses custom spans from the chat route: `chat.pipeline`,
> `chat.pipeline.stream`, `embeddings <model>`, `db.vectorSearch`,
> `chat <model>`.
>
> **Note:** LLM and embedding span names follow the gen_ai semantic
> convention `{operation} {model}` (e.g. `chat gpt-4o-mini`,
> `embeddings text-embedding-3-small`). The automated dashboard uses
> `gen_ai.operation.name` to filter model-independently. The queries
> below use the `duration` histogram from the spanmetrics connector
> (see [opentelemetry.md](opentelemetry.md#spanmetrics-connector)).

### Builder tab (chat latency by step)

1. Click **Create (+) > Chart**.
2. Variable **A**: `duration`, Analytics = **Percentile (50)**, Filter =
   `service.name` = `rag-api`, `span.name` = `chat.pipeline`.
3. Variable **B**: same, filter `gen_ai.operation.name` = `embeddings`.
4. Variable **C**: same, `span.name` = `db.vectorSearch`.
5. Variable **D**: same, filter `gen_ai.operation.name` = `chat`.
6. In **Configuration**:
   - **Chart title:** `RAG Chat Pipeline Latency`
   - **Visualization type:** `Line`
7. Click **Save**.

### SignalFlow tab

```signalflow
filter_ = filter('service.name', 'rag-api') and filter('deployment.environment', 'dev')
A = histogram('traces.span.metrics.duration', filter=filter_ and filter('span.name', 'chat.pipeline')).percentile(pct=50).publish(label='Total Chat')
B = histogram('traces.span.metrics.duration', filter=filter_ and filter('gen_ai.operation.name', 'embeddings')).percentile(pct=50).publish(label='Query Embedding')
C = histogram('traces.span.metrics.duration', filter=filter_ and filter('span.name', 'db.vectorSearch')).percentile(pct=50).publish(label='Vector Search')
D = histogram('traces.span.metrics.duration', filter=filter_ and filter('gen_ai.operation.name', 'chat')).percentile(pct=50).publish(label='LLM Completion')
```

---

## 16. Tutorial: Embedding and LLM token usage chart

> **What:** Track token consumption for embedding and LLM API calls.
> **Why:** Tokens directly translate to API cost. Monitoring usage helps
> control spending and detect anomalies (e.g. unexpectedly large prompts).
> **How:** Custom span attributes `gen_ai.usage.prompt_tokens` and
> `gen_ai.usage.completion_tokens` are set on embedding and LLM spans.
> These appear as span tags in Splunk APM.

### Using Tag Spotlight

1. Navigate to **APM > Tag Spotlight**.
2. Set **Service** = `rag-api`, **Environment** = `dev`.
3. Search for tag `gen_ai.usage.prompt_tokens`.
4. This shows the distribution of token counts across requests.

### Using Trace Analyzer

1. Navigate to **APM > Traces**.
2. Filter by `sf_service` = `rag-api`.
3. Click any chat trace.
4. In the waterfall, click the LLM span (named `chat <model>`, e.g.
   `chat gpt-4o-mini`).
5. In the span details panel, look for:
   - `gen_ai.usage.prompt_tokens`
   - `gen_ai.usage.completion_tokens`
   - `gen_ai.request.model`
   - `gen_ai.response.finish_reason`

### Custom chart (using spanmetrics duration)

With the spanmetrics connector enabled, you can chart LLM latency
using the `duration` histogram metric:

```signalflow
filter_ = filter('service.name', 'rag-api') and filter('deployment.environment', 'dev')
A = histogram('traces.span.metrics.duration', filter=filter_ and filter('gen_ai.operation.name', 'chat')).percentile(pct=50).publish(label='LLM Latency')
```

No manual Splunk UI configuration is needed -- the spanmetrics
connector generates these metrics automatically from trace spans.

---

## 17. Tutorial: RAG error rate detector

> **What:** Alert when the RAG pipeline has elevated error rates,
> specifically for embedding API or LLM API failures.
> **Why:** External API failures (rate limits, auth issues, outages)
> directly break the RAG pipeline. Early detection prevents user impact.
> **How:** Monitor error rate on the upload and chat endpoints.

### Upload error detector

1. Click **Create (+) > Detector**.
2. **Name:** `RAG Upload -- Error Rate`
3. **Signal:** Use SignalFlow:

```signalflow
errors = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_operation', 'POST /api/upload') and filter('sf_error', 'true')).count()
total = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_operation', 'POST /api/upload')).count()
(errors / total * 100).publish(label='Upload Error Rate %')
```

4. **Condition:** Static threshold -- above 10% for 5 minutes
5. **Severity:** Warning
6. Add notification, click **Activate**.

### Chat error detector

1. Click **Create (+) > Detector**.
2. **Name:** `RAG Chat -- Error Rate`
3. **Signal:** Use SignalFlow:

```signalflow
errors = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_operation', 'POST /api/chat') and filter('sf_error', 'true')).count()
total = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_operation', 'POST /api/chat')).count()
(errors / total * 100).publish(label='Chat Error Rate %')
```

4. **Condition:** Static threshold -- above 10% for 5 minutes
5. **Severity:** Warning
6. Add notification, click **Activate**.

---

## 18. Create detectors (alerts)

> **What:** A detector monitors a signal and triggers alerts when a
> condition is met.
> **Why:** Get notified when the service is down, error rate spikes, or
> latency degrades -- before users report it.
> **How:** Detectors evaluate SignalFlow streams against conditions over
> time and generate events/notifications.

### 18.1 Service-down detector

1. Navigate to **APM > Service map**.
2. Click the `rag-api` service node.
3. In the sidebar, click **More (...) > Create Detector**.
4. **Name:** `rag-api -- No Requests`
5. **Metric:** Request rate
6. **Condition:** Static threshold -- request rate at or below 0 for 5
   minutes
7. **Scope:** environment = `dev`, service = `rag-api`
8. **Severity:** Critical
9. Add a notification (email, Slack, PagerDuty, etc.)
10. Click **Activate**.

### 18.2 Error rate spike detector

1. From the service map or a dashboard chart, click the **bell icon** on
   the error rate chart.
2. Select **New Detector From Chart**.
3. **Name:** `rag-api -- Error Rate Spike`
4. **Metric:** Error rate
5. **Condition:** Choose one:
   - **Static threshold** -- e.g. error rate above 5%
   - **Sudden change** -- detects abrupt spikes
   - **Historical anomaly** -- deviation from normal behaviour
6. **Scope:** environment = `dev`, service = `rag-api`
7. **Severity:** Warning or Critical
8. Add notification, click **Activate**.

### 18.3 High latency detector

1. From a dashboard, click the **bell icon** on a latency chart.
2. Select **New Detector From Chart**.
3. **Name:** `rag-api -- High Latency P99`
4. **Metric:** Latency (P99)
5. **Condition:** Static threshold -- above 2000ms
6. **Scope:** environment = `dev`, service = `rag-api`
7. **Severity:** Warning
8. Click **Activate**.

### Alert condition types

| Condition | Use when |
|---|---|
| **Static threshold** | You know the acceptable range (e.g. error rate < 5%) |
| **Sudden change** | Detect abrupt changes regardless of absolute value |
| **Historical anomaly** | Detect deviation from normal historical patterns |

### 18.4 SurrealDB high memory detector

1. Click **Create (+) > Detector**.
2. **Name:** `SurrealDB -- High Memory`
3. **Signal:** Enter SignalFlow:
   ```signalflow
   data('surrealdb.process.memory', filter=filter('service.name', 'surrealdb'))
   ```
4. **Condition:** Static threshold -- above your container memory limit
   (e.g. 512MB = 536870912 bytes)
5. **Severity:** Warning
6. Add notification, click **Activate**.

### AutoDetect detectors

Splunk provides default detectors for service latency, error rate, and
request rate. Check **Alerts > AutoDetect** to review and enable them.

---

## 19. Dashboard best practices

| Area | Guidance |
|---|---|
| **Organisation** | Group dashboards by team or service, not by metric |
| **Variables** | Use dashboard variables for environment/service instead of duplicating dashboards |
| **Layout** | Wall displays: 3-5 charts/row, 3-5 rows. Laptops: 2-4 charts/row |
| **RED metrics** | Put Request rate, Error rate, Duration (latency) at the top |
| **Text notes** | Add a text chart explaining scope, thresholds, and runbook links |
| **Consistency** | Same units (ms for latency, % for rates, req/s for throughput) across charts |
| **Filters** | Apply consistent `sf_service` and `sf_environment` filters across all charts |
| **Linking** | Link detectors to charts so alert state is visible on the dashboard |
| **Troubleshooting** | Use **Actions (...) > Troubleshoot from this Time Window** to jump to APM |

---

## 20. MCP service monitoring

> **What:** Monitor the cross-service relationship between `rag-api` and
> the external `playwright-mcp` server.
> **Why:** The web scrape feature depends on an external MCP service.
> Monitoring this dependency reveals connection failures, latency
> bottlenecks, and helps attribute errors to the correct service.
> **How:** Both services export traces to the same OTel Collector with
> W3C trace context propagation, so Splunk APM automatically discovers
> the dependency and shows it on the service map.

### Viewing the MCP dependency on the service map

1. Navigate to **APM > Service map**.
2. Set **Environment** to `dev`.
3. You should see two service nodes: `rag-api` and `playwright-mcp`,
   connected by an edge.
4. Click the edge between them to see RED metrics for the dependency:
   - Request rate (scrape calls per minute)
   - Error rate (failed MCP calls)
   - Latency (round-trip time for MCP tool calls)
5. Click `playwright-mcp` to see its service view with downstream
   tool-level breakdown.

> **Note:** The `playwright-mcp` service only appears on the service map
> when it has sent traces recently. If it does not appear, verify:
> - The Playwright MCP server is running and has
>   `OTEL_EXPORTER_OTLP_ENDPOINT` set
> - A scrape request has been made (to generate trace data)
> - Both services export to the same collector or backend

### Viewing distributed traces

1. Navigate to **APM > Traces** (or select a trace from the service map).
2. Filter by `sf_service` = `rag-api` and look for traces containing
   `scrape.pipeline` or `mcp.scrape` operations.
3. Click a trace to see the waterfall view spanning both services:

```
[rag-api] POST /api/scrape                    (Express auto-span)
  [rag-api] scrape.pipeline                   (route handler)
    [rag-api] mcp.scrape                      (mcp-client.js)
      [rag-api] HTTP POST playwright-mcp/mcp  (auto-instrumented fetch)
        [playwright-mcp] POST /mcp            (ASGI middleware)
          [playwright-mcp] mcp.tool.session_create
      [rag-api] HTTP POST playwright-mcp/mcp
        [playwright-mcp] POST /mcp
          [playwright-mcp] mcp.tool.browser_navigate
      ...
    [rag-api] scrape.chunk                    (chunker)
    [rag-api] embeddings text-embedding-3-small
    [rag-api] db.insertDocument
    [rag-api] db.insertChunks
```

4. Use **Breakdown** on the `rag-api` node to split by `sf_operation`
   and see which MCP tool calls are slowest.

### Key span attributes for MCP monitoring

| Attribute | Set by | Description |
|---|---|---|
| `mcp.server.url` | `rag-api` | URL of the MCP server |
| `mcp.session_id` | `rag-api` | Browser session ID |
| `scrape.target_url` | `rag-api` | URL being scraped |
| `scrape.text_length` | `rag-api` | Extracted text length |
| `mcp.tool.name` | `playwright-mcp` | Tool function name |

---

## 21. Tutorial: MCP scrape latency chart

> **What:** Track the end-to-end latency of MCP scrape operations and
> break it down by tool call.
> **Why:** Scraping is the slowest operation in the RAG pipeline.
> Understanding where time is spent (navigation vs. text extraction vs.
> session management) helps optimise the pipeline.
> **How:** Uses the `spans` histogram MMS filtered by MCP-related
> operations.

### Builder tab

1. Click **Create (+) > Chart**.
2. Variable **A**: `spans`, Analytics = **Median**, Filter =
   `sf_service` = `rag-api`, `sf_operation` = `mcp.scrape`.
3. Variable **B**: same, `sf_service` = `playwright-mcp`,
   `sf_operation` = `mcp.tool.browser_navigate`.
4. Variable **C**: same, `sf_service` = `playwright-mcp`,
   `sf_operation` = `mcp.tool.browser_get_text`.
5. In **Configuration**:
   - **Chart title:** `MCP Scrape Latency`
   - **Visualization type:** `Line`
6. Click **Save**.

### SignalFlow tab

```signalflow
filter_api = filter('service.name', 'rag-api') and filter('deployment.environment', 'dev')
filter_mcp = filter('service.name', 'playwright-mcp') and filter('deployment.environment', 'dev')
A = histogram('traces.span.metrics.duration', filter=filter_api and filter('span.name', 'mcp.scrape')).percentile(pct=50).publish(label='Total Scrape')
B = histogram('traces.span.metrics.duration', filter=filter_mcp and filter('span.name', 'mcp.tool.browser_navigate')).percentile(pct=50).publish(label='Navigate')
C = histogram('traces.span.metrics.duration', filter=filter_mcp and filter('span.name', 'mcp.tool.browser_get_text')).percentile(pct=50).publish(label='Get Text')
```

---

## 22. Spanmetrics connector and Custom MetricSets

> **What:** The spanmetrics connector in the OTel Collector generates
> `duration` and `calls` metrics from ALL trace spans, making custom
> span latency available in dashboard charts without manual Splunk
> configuration.
> **Why:** Splunk's built-in MMS (`histogram('service.request', ...)`)
> only covers spans with `span.kind = SERVER` or `CONSUMER`. Custom
> spans like `chat.pipeline`, `db.vectorSearch`, and `chat <model>`
> have `span.kind = INTERNAL` or `CLIENT` and are invisible to MMS.
> **How:** The spanmetrics connector is configured in
> `otel-collector-config.yaml` and runs automatically. No manual
> Splunk UI steps are needed for the dashboard to work.

### How it works

| Metric source | Covers | Manual setup? |
|---|---|---|
| `histogram('service.request', ...)` (MMS) | SERVER/CONSUMER spans only | No (automatic) |
| `histogram('traces.span.metrics.duration', ...)` (spanmetrics) | ALL spans (INTERNAL, CLIENT, SERVER) | No (automatic) |
| `data('traces.span.metrics.calls', ...)` (spanmetrics) | ALL spans | No (automatic) |

The spanmetrics connector is wired as an exporter in the traces
pipeline and a receiver in the metrics pipeline:

```
Traces pipeline --> spanmetrics connector --> Metrics pipeline --> signalfx --> Splunk
```

The signalfx exporter has `send_otlp_histograms: true` to forward the
`duration` histogram metric to Splunk.

### Dashboard metric sources

| Dashboard tab | Metric | Source |
|---|---|---|
| Service Overview | `histogram('service.request', ...)` | Splunk MMS (automatic) |
| RAG Pipeline | `histogram('traces.span.metrics.duration', ...)`, `data('traces.span.metrics.calls', ...)` | Spanmetrics connector |
| LLM and AI | `histogram('traces.span.metrics.duration', ...)`, `data('gen_ai.client.token.usage', ...)` | Spanmetrics + OTel SDK |
| Infrastructure | `data('container.*')`, `data('surrealdb.*')` | Docker stats + SurrealDB |

### Optional: Custom MetricSets for Tag Spotlight

Custom MetricSets (TMS) are **not required** for the dashboard to work.
However, if you want to use Splunk's **Tag Spotlight** feature to
analyse span tags interactively, you can optionally create a Custom
MetricSet:

1. Navigate to **Settings > APM & RUM MetricSets**.
2. Click **+ Add Custom MetricSet**.
3. Select tag `gen_ai.operation.name`, scope = `rag-api`.
4. Click **Start Analysis**, then **Create**.

This is purely optional -- the dashboard charts work without it.

---

## 23. Automated dashboard setup

Instead of creating charts manually, you can use the provided automation
script to create the entire dashboard group via the Splunk Observability
Cloud REST API.

> **Important:** The RAG Pipeline and LLM tabs require the spanmetrics
> connector to be running in the OTel Collector. This is already
> configured in `otel-collector-config.yaml` -- just ensure the
> collector is running (`docker compose up -d`).

### Prerequisites

- `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` set in your `.env` file
- `curl` and `jq` (Linux/macOS) or PowerShell 5.1+ (Windows)
- OTel Collector running with spanmetrics connector (default config)

### Using the setup script

**Linux/macOS:**

```bash
./scripts/setup-splunk-dashboard.sh
```

**Windows (PowerShell):**

```powershell
.\scripts\setup-splunk-dashboard.ps1
```

The script:

1. Reads `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` from `.env`
2. Creates (or reuses) a dashboard group named `RAG Agent -- Observability`
3. Deletes any existing dashboards in the group (clean slate)
4. Creates 4 dashboard tabs:
   - **Service Overview** (8 charts) -- request counters, error rate,
     latency, top endpoints
   - **RAG Pipeline** (7 charts) -- chat/upload/scrape latency,
     embedding latency, DB operations, vector search, sessions
   - **LLM and AI** (5 charts) -- token counters, token usage over
     time, LLM call latency, embedding API latency
   - **Infrastructure** (6 charts) -- container CPU/memory/network,
     SurrealDB process health, transactions, HTTP activity
5. Deletes the empty auto-created default dashboard
6. Outputs the dashboard group URL on success

**Total: 26 charts across 4 dashboards** (aligned to the demo talk
track).

The script is idempotent -- running it again deletes and recreates all
dashboards cleanly.

### Chart definitions

The chart definitions are stored in [`splunk/dashboard.json`](../splunk/dashboard.json).
The file contains a `dashboardGroup` object with a `dashboards` array.
Each dashboard has a `name`, optional `description`, and a `charts`
array. Each chart includes its SignalFlow program, visualization type,
and layout width.

### REST API reference

The script uses these Splunk Observability Cloud API endpoints:

| Resource | Endpoint | Method |
|---|---|---|
| Dashboard group | `https://api.{REALM}.signalfx.com/v2/dashboardgroup` | GET, POST |
| Dashboard | `https://api.{REALM}.signalfx.com/v2/dashboard` | GET, POST, DELETE |
| Chart | `https://api.{REALM}.signalfx.com/v2/chart` | POST |

All requests require the `X-SF-Token` header with your access token.

See the [Splunk Observability Cloud API reference](https://dev.splunk.com/observability/reference/)
for full documentation.

> **Note:** All dashboard metrics are fully automated -- no manual
> Splunk UI configuration is needed. The spanmetrics connector generates
> `duration` and `calls` metrics from trace spans automatically.

---

## 24. Quick reference

| Action | Where |
|---|---|
| View service map | APM > Service map |
| View built-in dashboards | Dashboards > Built-in > APM Services |
| Create dashboard group | Create (+) > Dashboard Group |
| Create chart | Create (+) > Chart |
| Create detector | APM > Service map > select service > More (...) > Create Detector |
| Find available metrics | Metrics (left nav) |
| View/manage alerts | Alerts (left nav) |
| View traces | APM > Traces |
| Tag analysis | APM > Tag Spotlight |
| Find SurrealDB metrics | Metrics > search `surrealdb` |
| SurrealDB infra metrics | `data('surrealdb.*')` in SignalFlow |
| APM histogram metrics | `histogram('service.request')` in SignalFlow |
| Spanmetrics duration | `histogram('traces.span.metrics.duration')` in SignalFlow |
| Spanmetrics calls | `data('traces.span.metrics.calls')` in SignalFlow |
| View MCP dependency | APM > Service map > look for `playwright-mcp` node |
| MCP distributed traces | APM > Traces > filter `mcp.scrape` operation |
| Automate dashboard | Run `scripts/setup-splunk-dashboard.sh` |

---

*Last updated: 2026-09-06*
