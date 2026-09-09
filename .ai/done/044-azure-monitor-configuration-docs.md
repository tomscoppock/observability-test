# 044 -- Azure Monitor configuration documentation

Status: done
Priority: high
Assignee: @tom
Epic: 042
Theme: azure-monitor
Tags: non-code, docs

## Description

Document how to configure Azure Monitor as the telemetry endpoint: creating
the resource, finding the connection string, selecting a collector config,
running either backend or both, and verifying that each signal arrived.

## Acceptance criteria

- [x] `docs/azure-monitor-setup.md` created
- [x] Covers creating the Application Insights resource and where the
      connection string lives
- [x] Documents all three collector configs and how `OTEL_COLLECTOR_CONFIG`
      selects one, with the exact command for each of the three modes
- [x] Includes the OTel-to-App-Insights schema mapping table
- [x] Includes a verification KQL query per signal (traces, metrics, logs,
      exceptions) so a reader can prove ingest before trusting a chart
- [x] Documents the native OTLP plus Entra production track and its full
      prerequisite list, marked clearly as not built here and still in preview
- [x] Documents that the connection string cannot be rotated, and what a leak
      actually costs
- [x] Troubleshooting section covering the collector-stopping empty
      connection string, missing container dimensions, and ramping counters
- [x] Linked from `docs/README.md`, `README.md` and `docs/architecture.md`
- [x] British English, ASCII only

## Notes

**Completed 2026-09-09.** `docs/azure-monitor-setup.md` written and linked
from `docs/README.md`, `README.md` and `docs/architecture.md`. The
troubleshooting section was later corrected: it originally advised grepping
collector logs for "error", which matches hundreds of metric names and
attribute values from the debug exporter. It now matches the tab-delimited
log level. See playbook trap 30.

Mirror the structure of `docs/splunk-setup.md` but much shorter. That document
is 26 sections and 81 KB because Splunk needed a great deal of empirical
discovery; the Azure connection-string path is genuinely simpler and the doc
should reflect that rather than padding to match.

The native-OTLP section matters even though it is not built. It is Microsoft's
recommended path, so a reader who takes this to production needs to know it
exists and what it costs: collector >= 0.148 for the current `azure_auth`
syntax, an Entra identity that works from outside Azure, a DCE and DCR
deployed from the Azure Monitor Community ARM template, a Monitoring Metrics
Publisher role assignment on the DCR, and preview status. It also requires
delta temporality and exponential histograms, which this stack already sends
delta.

Plan: `~/.claude/plans/ok-if-i-wanted-lazy-catmull.md`
