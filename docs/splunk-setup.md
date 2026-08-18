# Splunk Observability Cloud -- Setup and Dashboard Guide

This guide walks through setting up dashboards, alerts, and monitoring in
Splunk Observability Cloud for the observability-test RAG Agent stack.

> **Prerequisite:** Data must already be flowing from the OTel Collector to
> Splunk. Verify by checking **APM > Overview** -- you should see the
> `rag-api` service listed. If not, see
> [opentelemetry.md](opentelemetry.md) for collector configuration.

---

## Table of Contents

1. [Verify data is arriving](#1-verify-data-is-arriving)
2. [Explore the APM service map](#2-explore-the-apm-service-map)
3. [Use built-in APM dashboards](#3-use-built-in-apm-dashboards)
4. [Create a dashboard group](#4-create-a-dashboard-group)
5. [Create a custom dashboard](#5-create-a-custom-dashboard)
6. [Add application health charts](#6-add-application-health-charts)
7. [Use Chart Builder and SignalFlow](#7-use-chart-builder-and-signalflow)
8. [Create detectors (alerts)](#8-create-detectors-alerts)
9. [Dashboard best practices](#9-dashboard-best-practices)
10. [Next steps](#10-next-steps)

---

## 1. Verify data is arriving

Before building dashboards, confirm telemetry is flowing:

1. Sign in to [Splunk Observability Cloud](https://app.signalfx.com).
2. Select **APM** from the left navigation menu.
3. On the **Overview** page, look for `rag-api` in the services table.
4. If you see request rate, error rate, and latency data, you are ready.

If the service does not appear:

- Check the OTel Collector logs: `docker compose logs otel-collector`
- Verify `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` are set in your `.env`
- Ensure the API container is sending traces (see
  [docker-commands.md](docker-commands.md#viewing-otel-telemetry))

---

## 2. Explore the APM service map

The service map shows dependencies between your instrumented services.

1. Navigate to **APM > Service map**.
2. Set the **Environment** filter to `dev` (or your `OTEL_DEPLOYMENT_ENV`
   value).
3. Set the **Time range** (e.g. last 15 minutes).
4. You should see the `rag-api` service node. Select it to view:
   - Request rate, error rate, and latency charts in the sidebar
   - Downstream dependencies (SurrealDB, external APIs, etc.)
5. Red indicators on nodes or edges signal elevated error rates.
6. Use **Breakdown** to split a service by any indexed span tag (e.g.
   `http.method`, `http.route`).
7. Select any chart to view matching example traces.

> **Tip:** From the service map sidebar, select **View Dashboard** to open
> the built-in APM dashboard for that service with your current filters
> preserved.

---

## 3. Use built-in APM dashboards

Splunk provides pre-built dashboards that are automatically populated when
APM data arrives. These are read-only templates.

### Access built-in dashboards

1. Select **Dashboards** from the left navigation menu.
2. Expand the **Built-in** section.
3. Select **APM Services** for service/endpoint dashboards, or **APM
   business transactions** for transaction dashboards.
4. Use the filter bar to select:
   - **Service:** `rag-api`
   - **Environment:** `dev`
   - **Time range:** as needed

### What you get out of the box

The built-in APM dashboard includes:

| Chart | Description |
|---|---|
| Request Rate | Requests per second over time |
| Request Latency | Latency trend line |
| Request Latency Distribution | Histogram of latency values |
| Error Rate | Percentage of requests resulting in errors |

### Save a copy for customisation

Built-in dashboards cannot be edited directly. To customise:

1. Open the dashboard actions menu **(...)**.
2. Select **Save as**.
3. Choose or create a dashboard group (see next section).
4. The saved copy is now fully editable.

---

## 4. Create a dashboard group

Dashboard groups organise dashboards by team, service, or environment.

1. Select **Create (+)** in the top navigation bar.
2. Select **Dashboard Group**.
3. Enter a name, e.g. `RAG Agent -- Observability`.
4. Optionally add a description.
5. Select **Create**.

Splunk automatically creates a dashboard with the same name inside the
group. You can rename it via **Actions (...) > Rename**.

### Suggested group structure

| Group Name | Purpose |
|---|---|
| `RAG Agent -- Observability` | Main operational dashboards |
| `RAG Agent -- SLOs` | Service level objectives and error budgets |
| `RAG Agent -- Infrastructure` | Docker, host, and collector health |

---

## 5. Create a custom dashboard

1. Navigate to **Dashboards**.
2. Select **Create (+) > Dashboard**.
3. You land on an empty dashboard in edit mode.
4. Add charts using one of:
   - **Browse metrics sidebar** (simple charts)
   - **Create (+) > Chart** (Chart Builder for advanced charts)
5. Rename the dashboard: **Actions (...) > Rename**.
6. Save to your dashboard group.

### Recommended layout

| Row | Charts |
|---|---|
| **Top** | Service status (single value), Request rate, Error rate |
| **Second** | Latency P50, Latency P90, Latency P99 |
| **Third** | Top endpoints by request count, Top endpoints by error rate |
| **Bottom** | Text note with links, Detector status, Troubleshooting links |

---

## 6. Add application health charts

### 6.1 Request rate chart

1. Select **Create (+) > Chart**.
2. In the **Signal** field, search for the request rate metric (APM
   auto-generates metrics from traces).
3. Filter by:
   - `service.name` = `rag-api`
   - `deployment.environment` = `dev`
4. Select chart type: **Line** for trends, or **Single Value** for current
   rate.
5. Set the unit to `requests/sec`.
6. Name the chart: `Request Rate`.
7. **Save and close**.

### 6.2 Error rate chart

1. Select **Create (+) > Chart**.
2. Search for the error rate metric.
3. Apply the same service and environment filters.
4. Select chart type: **Line**.
5. Set the unit to `%`.
6. Name the chart: `Error Rate`.
7. Optionally add a static threshold line (e.g. 5%) via the **Axes** tab
   using a **High watermark**.
8. **Save and close**.

### 6.3 Latency percentile charts

1. Select **Create (+) > Chart**.
2. Search for the latency metric.
3. Select **Add Analytics** and choose **Percentile**.
4. Set the percentile value (e.g. `50` for P50).
5. Filter by service and environment.
6. Set the unit to `ms`.
7. Name the chart: `Latency P50`.
8. **Save and close**.
9. Repeat for P90 and P99.

**Alternative -- multiple percentiles on one chart:**

1. Create a chart with the latency metric.
2. Add three plot lines (A, B, C), each with a different percentile
   analytic (50, 90, 99).
3. Name each plot: `P50`, `P90`, `P99`.
4. Use the left Y-axis for all three.

### 6.4 Top endpoints chart

1. Select **Create (+) > Chart**.
2. Search for the request rate metric.
3. Select **Add Analytics > Top** and set N = 10.
4. Group by `sf_endpoint` or `http.route`.
5. Select chart type: **List** or **Column**.
6. Name the chart: `Top Endpoints`.
7. **Save and close**.

---

## 7. Use Chart Builder and SignalFlow

### Graphical Chart Builder

The Chart Builder is the primary tool for creating charts:

1. Select **Create (+) > Chart**.
2. In the **Plot Editor** tab:
   - Enter a metric name in the **Signal** field (type-ahead search helps).
   - Or select **Browse** to use the metrics sidebar.
3. Add **Filters** to scope the data (service, environment, etc.).
4. Select **Add Analytics** for functions:
   - **Sum**, **Count**, **Mean** -- basic aggregations
   - **Percentile** -- for latency analysis
   - **Timeshift** -- compare with historical data
   - **Top/Bottom** -- show highest/lowest N values
   - **Exclude** -- filter time series by value
5. Configure chart type, axes, units, colours, and resolution.
6. **Save and close**.

### SignalFlow mode

For advanced analytics, switch to SignalFlow:

1. Open a chart in Chart Builder.
2. Select **View SignalFlow** on the Plot Editor tab.
3. Edit the SignalFlow program directly.
4. Select **View builder** to return to graphical mode (if the program is
   convertible).

**Example -- error percentage:**

```signalflow
A = data('service.request.count', filter=filter('service.name', 'rag-api') and filter('sf_error', 'true'))
B = data('service.request.count', filter=filter('service.name', 'rag-api'))
C = (A / B * 100).publish(label='Error %')
```

> **Note:** Use the actual metric names from your environment. APM
> auto-generates metrics from trace data -- check the Metric Finder
> (**Navigation > Metric Finder**) to discover available metrics.

### Useful SignalFlow patterns

| Pattern | SignalFlow |
|---|---|
| Moving average (5 min) | `data('metric').mean(over='5m').publish()` |
| Compare with yesterday | `data('metric').timeshift('1d').publish()` |
| Rate of change | `data('metric').delta().publish()` |

---

## 8. Create detectors (alerts)

Detectors monitor signals and trigger alerts when conditions are met.

### 8.1 Service-down detector

Detect when the `rag-api` service stops receiving requests:

1. Navigate to **APM > Service map**.
2. Select the `rag-api` service node.
3. In the service panel, select **More (...) > Create Detector**.
4. Name it: `rag-api -- No Requests`.
5. Select metric: **Request rate**.
6. Select condition: **Static threshold**.
7. Configure: request rate **at or below 0** for **5 minutes**.
8. Scope: environment = `dev`, service = `rag-api`.
9. Set severity: **Critical**.
10. Add notification (email, Slack, PagerDuty, etc.).
11. Select **Activate**.

> **Tip:** For services with naturally idle periods, use a longer duration
> window or consider a **Sudden change** condition instead.

### 8.2 Error rate spike detector

Detect when error rate exceeds a threshold:

1. From the service map or an APM dashboard chart, select the bell icon
   on the error rate chart.
2. Select **New Detector From Chart**.
3. Name it: `rag-api -- Error Rate Spike`.
4. Select metric: **Error rate**.
5. Choose one of:
   - **Static threshold** -- e.g. error rate above 5%
   - **Sudden change** -- detects abrupt spikes
   - **Historical anomaly** -- deviation from normal behaviour
6. Scope: environment = `dev`, service = `rag-api`.
7. Set severity: **Warning** or **Critical**.
8. Add notification integration.
9. Select **Activate**.

### 8.3 High latency detector

1. From an APM dashboard, select the bell icon on the latency chart.
2. Select **New Detector From Chart**.
3. Name it: `rag-api -- High Latency P99`.
4. Select metric: **Latency** (P99).
5. Select condition: **Static threshold** -- e.g. above 2000ms.
6. Scope: environment = `dev`, service = `rag-api`.
7. Set severity: **Warning**.
8. Select **Activate**.

### Alert condition types

| Condition | Use when |
|---|---|
| **Static threshold** | You know the acceptable range (e.g. error rate < 5%) |
| **Sudden change** | You want to detect abrupt changes regardless of absolute value |
| **Historical anomaly** | You want to detect deviation from normal historical patterns |

### AutoDetect detectors

Splunk provides default **AutoDetect** detectors for:

- Service latency
- Error rate
- Request rate

These are available by default and can supplement your custom detectors.
Check **Alerts & Detectors > AutoDetect** to review and enable them.

---

## 9. Dashboard best practices

### Organisation

- **Group by team or service**, not by individual metric.
- Use **dashboard variables** for environment/service selection instead of
  duplicating dashboards per environment.
- Keep draft dashboards in your **User** group; publish reviewed dashboards
  to a shared **Custom** group.

### Layout

- **Wall displays:** 3-5 charts per row, 3-5 rows per dashboard.
- **Laptop screens:** 2-4 charts per row.
- Put **RED metrics** (Request rate, Error rate, Duration/latency) at the
  top.
- Add **text note** charts explaining scope, thresholds, ownership, and
  runbook links.

### Consistency

- Use consistent titles and abbreviations across charts.
- Use consistent units (ms for latency, % for rates, req/s for throughput).
- Use consistent time ranges across related charts.
- Use consistent colour schemes.

### Filters

- Apply consistent `service.name` and `deployment.environment` filters
  across all charts on a dashboard.
- Use dashboard-level filter overrides to avoid per-chart filter
  duplication.

### Linking

- Link detectors to the charts they monitor so alert state is visible on
  the dashboard.
- Use **Actions (...) > Troubleshoot from this Time Window** to jump from
  a dashboard chart to the APM troubleshooting view.

---

## 10. Next steps

With dashboards and basic alerts in place, consider:

| Task | Description |
|---|---|
| **Add OTel SDK instrumentation** | Add custom spans and metrics for business-specific signals (backlog item 011) |
| **Add custom logger** | Route application logs through OTel to Splunk (backlog item 012) |
| **Tag Spotlight** | Use APM > Tag Spotlight to analyse request/error rate by span tag |
| **Trace Analyzer** | Use APM > Trace Analyzer to inspect individual trace waterfalls |
| **SLO tracking** | Define service level objectives using Splunk's SLO features |
| **gen_ai instrumentation** | Add LLM-specific spans and token metrics (backlog items 017-018) |

---

## Quick reference

| Action | Navigation |
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

*Last updated: 2026-08-18*
