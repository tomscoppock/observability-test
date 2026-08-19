# Splunk Observability Cloud -- Setup and Dashboard Guide

Step-by-step guide for building dashboards and alerts in Splunk
Observability Cloud for the observability-test RAG Agent stack.

> **Prerequisite:** The OTel Collector must be exporting data to Splunk.
> Check **APM > Overview** for the `rag-api` service. If missing, see
> [opentelemetry.md](opentelemetry.md).

---

## Table of Contents

1. [How our data reaches Splunk](#1-how-our-data-reaches-splunk)
2. [Verify data is arriving](#2-verify-data-is-arriving)
3. [Explore the APM service map](#3-explore-the-apm-service-map)
4. [Use built-in APM dashboards](#4-use-built-in-apm-dashboards)
5. [Create a dashboard group and dashboard](#5-create-a-dashboard-group-and-dashboard)
6. [Tutorial: Request rate chart](#6-tutorial-request-rate-chart)
7. [Tutorial: Error rate chart](#7-tutorial-error-rate-chart)
8. [Tutorial: Latency percentile chart](#8-tutorial-latency-percentile-chart)
9. [Tutorial: Top endpoints chart](#9-tutorial-top-endpoints-chart)
10. [Create detectors (alerts)](#10-create-detectors-alerts)
11. [Dashboard best practices](#11-dashboard-best-practices)
12. [Next steps](#12-next-steps)
13. [Quick reference](#13-quick-reference)

---

## 1. How our data reaches Splunk

Understanding the data pipeline helps you know what metrics are available
and where they come from.

```
Node.js API (rag-api)
  |
  |  OTel SDK auto-instrumentation creates:
  |    - Traces (spans with timing, status, attributes)
  |    - Metrics (http.server.duration histogram)
  |    - Logs (when configured)
  |
  v
OTel Collector (otel-collector container)
  |
  |  Three export pipelines:
  |    Traces  --> otlp_http/splunk  --> Splunk APM
  |    Metrics --> signalfx           --> Splunk IM
  |    Logs    --> splunk_hec/logs    --> Splunk Log Observer
  |
  v
Splunk Observability Cloud
  |
  |  APM derives Monitoring MetricSets (MMS) from traces:
  |    service.request  -- histogram containing count + duration
  |    spans            -- per-span histogram
  |    traces           -- per-trace histogram
  |
  v
Dashboards, Alerts, Service Map
```

**Key concept -- Monitoring MetricSets (MMS):**

Splunk APM automatically creates histogram metrics from your trace data.
The primary one is `service.request`. Because it is a histogram, a single
metric contains both the request **count** and the request **duration**
(latency). You extract different values by applying different functions:

| What you want | Function to apply | Example SignalFlow |
|---|---|---|
| Request count | `count()` | `histogram('service.request').count()` |
| Latency median | `median()` | `histogram('service.request').median()` |
| Latency P90 | `percentile(pct=90)` | `histogram('service.request').percentile(pct=90)` |
| Latency P99 | `percentile(pct=99)` | `histogram('service.request').percentile(pct=99)` |
| Min latency | `min()` | `histogram('service.request').min()` |
| Max latency | `max()` | `histogram('service.request').max()` |

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

## 10. Create detectors (alerts)

> **What:** A detector monitors a signal and triggers alerts when a
> condition is met.
> **Why:** Get notified when the service is down, error rate spikes, or
> latency degrades -- before users report it.
> **How:** Detectors evaluate SignalFlow streams against conditions over
> time and generate events/notifications.

### 10.1 Service-down detector

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

### 10.2 Error rate spike detector

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

### 10.3 High latency detector

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

### AutoDetect detectors

Splunk provides default detectors for service latency, error rate, and
request rate. Check **Alerts & Detectors > AutoDetect** to review and
enable them.

---

## 11. Dashboard best practices

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

## 12. Next steps

| Task | Description | Backlog |
|---|---|---|
| Add OTel SDK instrumentation | Custom spans and business metrics | 011 |
| Add custom logger | Route app logs through OTel to Splunk | 012 |
| Tag Spotlight | Analyse request/error rate by span tag | -- |
| Trace Analyzer | Inspect individual trace waterfalls | -- |
| SLO tracking | Define service level objectives | -- |
| gen_ai instrumentation | LLM-specific spans and token metrics | 017-018 |

---

## 13. Quick reference

| Action | Where |
|---|---|
| View service map | APM > Service map |
| View built-in dashboards | Dashboards > Built-in > APM Services |
| Create dashboard group | Create (+) > Dashboard Group |
| Create chart | Create (+) > Chart |
| Create detector | APM > Service map > select service > More (...) > Create Detector |
| Find available metrics | Navigation > Metric Finder |
| View/manage alerts | Alerts & Detectors |
| View traces | APM > Trace Analyzer |
| Tag analysis | APM > Tag Spotlight |

---

*Last updated: 2026-08-19*
