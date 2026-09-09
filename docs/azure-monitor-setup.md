# Azure Monitor Setup

How to configure Azure Monitor as a telemetry endpoint for this stack, either
instead of Splunk or alongside it.

The Splunk setup is unchanged by any of this. The backend is chosen by which
collector config file is mounted, and the Splunk baseline file
(`otel-collector-config.yaml`) is deliberately left static.

For where the two backends genuinely differ, read
[splunk-vs-azure-monitor.md](splunk-vs-azure-monitor.md). This document is
about getting it working.

## Contents

- [Quick start](#quick-start)
- [What the setup script creates](#what-the-setup-script-creates)
- [Environment variables](#environment-variables)
- [Choosing a backend](#choosing-a-backend)
- [Verifying ingest](#verifying-ingest)
- [How OpenTelemetry maps onto Application Insights](#how-opentelemetry-maps-onto-application-insights)
- [Deploying the workbook and alert rules](#deploying-the-workbook-and-alert-rules)
- [The production path: native OTLP with Entra ID](#the-production-path-native-otlp-with-entra-id)
- [Troubleshooting](#troubleshooting)

## Quick start

Nothing needs creating by hand in the Azure portal. You need an `az login`
and a subscription you can create resource groups in.

```bash
# 1. Authenticate
az login

# 2. Set the two required tag values in .env (see below), then create
#    the resource group, Log Analytics workspace and App Insights resource
./scripts/setup-azure-monitor.sh

# 3. Paste the connection string it prints into .env

# 4. Point the collector at Azure Monitor
OTEL_COLLECTOR_CONFIG=./otel-collector-config.azure.yaml \
  docker compose up -d --force-recreate otel-collector

# 5. Deploy the workbook and the three drift-detection alert rules
./scripts/setup-azure-workbook.sh

# 6. Generate traffic so the panels have something to show
./scripts/simulate-demo-traffic.sh --duration 10
```

PowerShell equivalents:

```powershell
az login
.\scripts\setup-azure-monitor.ps1
# paste the connection string into .env
$env:OTEL_COLLECTOR_CONFIG = './otel-collector-config.azure.yaml'
docker compose up -d --force-recreate otel-collector
.\scripts\setup-azure-workbook.ps1
.\scripts\simulate-demo-traffic.ps1 -DurationMinutes 10
```

Both setup scripts are idempotent. Re-running updates in place rather than
creating duplicates.

## What the setup script creates

`scripts/setup-azure-monitor.sh` / `.ps1` creates three resources:

| Order | Resource | Why |
|---|---|---|
| 1 | Resource group | Tagged with `Purpose` and `Responsible Owner`, both read from `.env` |
| 2 | Log Analytics workspace | Application Insights is workspace-based now, so this is a hard requirement rather than an option |
| 3 | Application Insights | The ingest target. All three signals land in this one resource |

It then prints the connection string. It does **not** write to `.env` for you,
because that file holds credentials and is deliberately outside what tooling
here touches.

Both resource group tags are treated as mandatory. The script fails before
creating anything if either value is missing, rather than creating an untagged
resource group that then has to be corrected by hand.

## Environment variables

`.env.example` is excluded from agent tooling by
`.claude/settings.json` (`permissions.deny`) and `.rooignore`, alongside
`.env` itself, so this block has to be added by hand. Paste it into both
`.env.example` (with placeholder values) and `.env` (with real ones):

```bash
# ---------- Observability backend selection ----------
# Which collector config to mount. Chooses where telemetry goes.
#   ./otel-collector-config.yaml        Splunk only (default)
#   ./otel-collector-config.azure.yaml  Azure Monitor only
#   ./otel-collector-config.dual.yaml   both, in parallel
OTEL_COLLECTOR_CONFIG=./otel-collector-config.yaml

# ---------- Azure Monitor ----------
# CREDENTIAL. Printed by scripts/setup-azure-monitor.*. Never commit.
# This CANNOT be rotated -- see the warning below.
APPLICATIONINSIGHTS_CONNECTION_STRING=

# Used by scripts/setup-azure-monitor.* and scripts/setup-azure-workbook.*
# Leave AZURE_SUBSCRIPTION_ID empty to use the az CLI's current subscription.
AZURE_SUBSCRIPTION_ID=
AZURE_RESOURCE_GROUP=rg-observability-test
AZURE_LOCATION=uksouth
AZURE_APP_INSIGHTS_NAME=appi-rag-agent
AZURE_LOG_ANALYTICS_NAME=law-rag-agent

# Resource group tags. Both are REQUIRED -- the setup script refuses to
# run without them.
AZURE_TAG_PURPOSE=
AZURE_TAG_RESPONSIBLE_OWNER=
```

> **The connection string cannot be rotated.** It embeds an ingestion key.
> Unlike `SPLUNK_ACCESS_TOKEN`, there is no rotate-in-place remedy: if it
> leaks, the fix is creating a new Application Insights resource and
> repointing the collector, which loses continuity of everything already
> ingested. Treat it accordingly.

The existing `.env` and `.env.*` patterns in `.gitignore`,
`.claude/settings.json` and `.rooignore` already cover these, so no
ignore-file changes are needed. Verify rather than edit, per
[AGENTS.md](../AGENTS.md) Section 6.

## Choosing a backend

Three collector configs, selected by `OTEL_COLLECTOR_CONFIG`:

| File | Traces | Metrics | Logs |
|---|---|---|---|
| `otel-collector-config.yaml` | Splunk APM | Splunk (signalfx) | Splunk Cloud Platform (HEC) |
| `otel-collector-config.azure.yaml` | App Insights | App Insights | App Insights |
| `otel-collector-config.dual.yaml` | Both | Both (split pipelines) | Both |

```bash
# Splunk only (the default -- no variable needed)
docker compose up -d --force-recreate otel-collector

# Azure Monitor only
OTEL_COLLECTOR_CONFIG=./otel-collector-config.azure.yaml \
  docker compose up -d --force-recreate otel-collector

# Both in parallel
OTEL_COLLECTOR_CONFIG=./otel-collector-config.dual.yaml \
  docker compose up -d --force-recreate otel-collector
```

**Dual mode is what makes a comparison meaningful.** Collector pipelines fan
out to every exporter listed, so both backends receive byte-identical
telemetry from one traffic run. Same spans, same metrics, two destinations,
no second instrumentation to account for.

The metrics signal is the one exception and is split into two pipelines,
because the two backends need different inputs:

| | `metrics/splunk` | `metrics/azure` |
|---|---|---|
| Receivers | `otlp`, `docker_stats`, `hostmetrics`, `spanmetrics` | `otlp`, `docker_stats` |
| Extra processors | none | `cumulative_to_delta`, `transform/azure_dims` |

`spanmetrics` is Splunk-only because Splunk's MetricSets cover only SERVER and
CONSUMER spans, so without the connector its LLM, DB and MCP spans produce no
metrics at all. App Insights has no such gap. `hostmetrics` is Splunk-only
because its purpose is Related Content correlation, which App Insights has no
counterpart for. `cumulative_to_delta` is Azure-only because
`customMetrics` has no counter semantics. Full reasoning in
[splunk-vs-azure-monitor.md](splunk-vs-azure-monitor.md).

Receiver *instances* are shared across pipelines of the same type, so
`docker_stats` appearing in both scrapes the Docker socket once, not twice.

### Validating a config before you run it

An invalid collector config stops the collector entirely, taking every signal
down with it. Check first:

```bash
docker run --rm \
  -v "$(pwd)/otel-collector-config.azure.yaml:/etc/otelcol/config.yaml:ro" \
  -e APPLICATIONINSIGHTS_CONNECTION_STRING='InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://localhost/' \
  -e OTEL_DEPLOYMENT_ENV=dev \
  otel/opentelemetry-collector-contrib:latest validate --config /etc/otelcol/config.yaml
```

```powershell
$cfg = (Resolve-Path .\otel-collector-config.azure.yaml).Path
docker run --rm -v "${cfg}:/etc/otelcol/config.yaml:ro" `
  -e "APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://localhost/" `
  -e OTEL_DEPLOYMENT_ENV=dev `
  otel/opentelemetry-collector-contrib:latest validate --config /etc/otelcol/config.yaml
```

Silence means success.

## Verifying ingest

Ingest can take a couple of minutes to become queryable. Generate traffic,
wait, then run these five in the Application Insights **Logs** blade. All five
should return rows:

```kql
requests      | summarize count() by cloud_RoleName
dependencies  | summarize count() by name
customMetrics | summarize count() by name
traces        | summarize count() by severityLevel
exceptions    | summarize count()
```

What each proves:

| Query | Proves |
|---|---|
| `requests` | SERVER spans arrived. Expect `rag-api`, and `surrealdb` if it is emitting |
| `dependencies` | CLIENT and INTERNAL spans arrived. Expect `chat gpt-4o-mini`, `db.vectorSearch`, `chat.pipeline` |
| `customMetrics` | Metrics arrived. Expect `gen_ai.client.token.count` and `container.*` |
| `traces` | Application logs arrived. `severityLevel >= 1` only, since the collector drops DEBUG and below |
| `exceptions` | `spaneventsenabled: true` is working. Empty here after error traffic means span events are not being exported |

If `customMetrics` returns rows but the container charts are unlabelled, check
whether `compose.service` or `container.name` is present:

```kql
customMetrics
| where name startswith 'container.'
| take 5
| project name, customDimensions
```

## How OpenTelemetry maps onto Application Insights

The `azure_monitor` exporter maps OTel onto the classic Application Insights
schema. Everything in the workbook depends on this:

| OTel | App Insights table | Notes |
|---|---|---|
| Span kind SERVER, CONSUMER | `requests` | Native `duration` in ms, plus `success`, `resultCode`, `itemCount` |
| Span kind CLIENT, PRODUCER, INTERNAL | `dependencies` | Native `duration` in ms, plus `target`, `type`, `data` |
| Span attributes | `customDimensions` | On both tables |
| Log records | `traces` | Correlated to spans by `operation_Id` |
| Span events / `recordException` | `exceptions` | Only with `spaneventsenabled: true` |
| Metrics, all kinds | `customMetrics` | `valueSum`, `valueCount`, `valueMin`, `valueMax` |
| `service.name` resource attribute | `cloud_RoleName` | One resource holds all services |

### Four query rules that are easy to get wrong

1. **Use `valueSum` and `valueCount`, never `value`.** A counter total is
   `sum(valueSum)`. A histogram mean is `sum(valueSum) / sum(valueCount)`. A
   gauge reading is `avg(valueSum)`.
2. **`customDimensions` values are strings**, even for numeric span
   attributes. `gen_ai.usage.output_tokens` reads back as `"420"`, so every
   numeric read needs `tolong(tostring(customDimensions[...]))`.
3. **`success` is a string in the classic view and a bool in the workspace
   view.** `tobool(success) == false` is correct in both.
4. **Array attributes serialise as JSON text.**
   `gen_ai.response.finish_reasons` reads back as `["stop"]`, so it needs
   `parse_json(...)[0]`.

### Delta temporality is required, not optional

`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` in
`docker-compose.yml` is commented as a Splunk requirement. It is also
required for Azure. The exporter attaches no counter semantics to a Sum data
point, so under cumulative temporality each exported point would be the
running total since process start and `sum(valueSum)` over a window would sum
a monotonic ramp. Leave it alone.

That variable only affects the Node SDK. Collector receivers ignore it, and
SurrealDB's Rust SDK defaults to cumulative, which is why
`cumulative_to_delta` exists in the Azure metrics pipeline for five specific
infrastructure counters.

## Deploying the workbook and alert rules

```bash
./scripts/setup-azure-workbook.sh              # workbook + 3 alert rules
./scripts/setup-azure-workbook.sh --no-alerts  # workbook only
```

```powershell
.\scripts\setup-azure-workbook.ps1
.\scripts\setup-azure-workbook.ps1 -NoAlerts
```

| File | Deploys |
|---|---|
| `azure/workbook.json` | The workbook payload: five tabs, 29 parity items plus 3 log items |
| `azure/workbook.bicep` | `Microsoft.Insights/workbooks` |
| `azure/alerts.bicep` | Three `Microsoft.Insights/scheduledQueryRules` |

Two mechanics that matter if you edit these:

- The workbook resource **name must be a GUID**. It is derived
  deterministically from the resource group id via `guid()`, so redeploying
  updates the same workbook. `newGuid()` would create a fresh one every time.
- `properties.serializedData` is a JSON **string**, not an object. The payload
  therefore lives in `azure/workbook.json` and is parsed, augmented with the
  target resource id, and re-serialised inside the Bicep. That keeps
  `workbook.json` free of subscription-specific values, so the same file
  deploys to any subscription unchanged.

The three alert rules deploy at severity 2 (Warning) with **no action
groups**, matching the empty notification lists on the Splunk detectors. They
need roughly an hour of traffic before their baselines mean anything.

## The production path: native OTLP with Entra ID

This project uses the community `azure_monitor` exporter because it needs one
environment variable and works from Docker on a laptop. **Microsoft's
recommended path is different**, and anyone taking this to production should
know what it involves.

Native OTLP ingestion sends OTLP directly to Azure Monitor cloud endpoints
using the `otlp_http` exporter plus the Azure Authentication extension:

```yaml
extensions:
  azure_auth:
    use_default: true
    scopes:
      - https://monitor.azure.com/.default

exporters:
  otlp_http/azuremonitor:
    traces_endpoint: "https://<logs-dce-domain>/dataCollectionRules/<dcr-immutable-id>/streams/Microsoft-OTLP-Traces/otlp/v1/traces"
    logs_endpoint: "https://<logs-dce-domain>/dataCollectionRules/<dcr-immutable-id>/streams/Microsoft-OTLP-Logs/otlp/v1/logs"
    metrics_endpoint: "https://<metrics-dce-domain>/dataCollectionRules/<dcr-immutable-id>/streams/Custom-Metrics-Otel/otlp/v1/metrics"
    auth:
      authenticator: azure_auth
```

Prerequisites, none of which the connection-string path needs:

- Collector 0.132.0 or higher; **0.148.0 or higher** for the `azure_auth`
  syntax above, which is not backward compatible with earlier versions
- A Microsoft Entra identity. Managed identity on Azure VMs and Scale Sets;
  a workload identity or service principal anywhere else, including a laptop
- A Data Collection Endpoint and Data Collection Rule, deployed from the
  ARM template in the Azure Monitor Community repository
- The **Monitoring Metrics Publisher** role assigned to that identity on the
  DCR
- Destination workspaces: a Log Analytics workspace for logs and traces, and
  an Azure Monitor workspace for metrics
- Delta temporality and exponential histogram aggregation, which Application
  Insights experiences expect and require. This stack already sends delta;
  it sends explicit-bucket rather than exponential histograms

The shortcut is to create the Application Insights resource with **OTLP
support** set to **On**, which provisions the DCE, DCR and workspaces and
surfaces the three endpoint URLs on the resource Overview page.

**OTLP ingestion in Azure Monitor is in preview.** That, plus the Entra
identity requirement being awkward from outside Azure, is why this project
does not use it. Note also that the community components involved are
supported through community channels only; Azure support covers the Azure
resources, not the collector.

Sources:
[Ingest OTLP data into Azure Monitor with OTel Collector](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-protocol-ingestion),
[OpenTelemetry ingestion options](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-summary).

## Troubleshooting

### The whole collector is down after switching to Azure

Almost certainly the connection string. The `azure_monitor` exporter validates
it at config-decode time, and an **empty** value fails validation, which stops
every pipeline including traces and metrics. This is the same failure mode an
empty HEC token causes on the Splunk path.

`docker-compose.yml` supplies an inert placeholder default so this cannot
happen by accident. If you have overridden it with an empty string, restore
the placeholder or set a real value.

```bash
# The collector logs one record per line, tab-delimited, with the LEVEL as
# the second field. Match that field -- do NOT grep for "error".
docker compose logs otel-collector | awk -F'	' '$2 ~ /^(error|warn|fatal)$/'
```

```powershell
docker compose logs otel-collector | Select-String -Pattern "`t(error|warn|fatal)`t"
```

Grepping for the word `error` is useless here, and actively misleading. The
`debug` exporter runs at `verbosity: detailed`, so every metric name and
attribute value is printed: `system.network.errors`, `error_class: Str(-)`,
`outcome: Str(error)`. On a healthy collector that is several hundred
matches. Measured on this stack: 381 naive matches against **one** real log
line, which was a benign `host_metrics` note.

### `unknown type: "azuremonitor"`

The component type has an underscore: `azure_monitor`. The version without one
is not a valid type and will stop the collector.

Relatedly, `otlp_http` in the Splunk config is correct and not a typo:
`otlp_http` is the canonical component name and `otlphttp` is the deprecated
alias, not the other way round.

### Container charts are unlabelled or show one merged series

`container.name` and `container.id` arrive as **resource** attributes on the
`docker_stats` output. The `transform/azure_dims` processor copies
`container.name` and `compose.service` onto the data points so they reach
`customDimensions`. If the charts are still unlabelled, inspect what actually
arrived:

```kql
customMetrics
| where name startswith 'container.'
| take 5
| project name, customDimensions
```

### Infrastructure charts are straight diagonal ramps

A cumulative counter reaching `customMetrics` without delta conversion.
`customMetrics` has no counter concept, so the running total is charted
literally. Check that `cumulative_to_delta` is in the Azure metrics pipeline and
that the metric in question is in its strict `include` list. Five counters are
listed; gauges such as `container.memory.usage.total` and
`surrealdb.http.active_requests` are deliberately excluded, because
delta-converting a gauge is wrong.

### `exceptions` is empty after error traffic

`spaneventsenabled: true` is missing from the exporter config, or the key name
is wrong. A wrong key is itself a config-validation failure, so run `validate`
to distinguish "not set" from "misspelled".

### No token metrics, or nonsensical token totals

Check `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` is still set
in `docker-compose.yml`. Without it the counters arrive cumulative and
`sum(valueSum)` sums a ramp.

### Nothing at all arrives, and there are no errors

OTel SDK export failures are silent by default. Turn on diagnostics:

```bash
OTEL_LOG_LEVEL=debug docker compose up -d --force-recreate api
docker compose logs -f api
```

It is extremely noisy. Turn it off again afterwards.

## Related

- [splunk-vs-azure-monitor.md](splunk-vs-azure-monitor.md) -- where the two
  backends genuinely differ, in both directions
- [demo-talk-track-azure.md](demo-talk-track-azure.md) -- scripted demo of the
  Azure surfaces
- [implementation-playbook.md](implementation-playbook.md) -- how to rebuild
  all of this elsewhere, and what will silently break
- [configuration.md](configuration.md) -- the full environment variable
  reference
- [opentelemetry.md](opentelemetry.md) -- SDK and collector internals
