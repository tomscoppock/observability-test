# Prompt 4: MCP or sidecar service handoff

For a **second service** (an MCP server, a sidecar, any separately-deployed
component) whose telemetry needs to reach the same backend as the main
application.

Read the first section before doing anything. There is a good chance the
correct answer is to change nothing, and an agent handed this task without
that warning will add a duplicate exporter or a second collector and split
your service map for no reason.

**Copy everything between the fences into your coding agent.**

````text
Task: make this service's telemetry reach Azure Monitor.

READ THIS FIRST, BEFORE PLANNING ANYTHING.

There is a good chance the correct answer is TO CHANGE NOTHING.

This service is expected to export OTLP to a SHARED OpenTelemetry
Collector, identifying itself with service.name=playwright-mcp. OTel
Collector pipelines FAN OUT to every exporter listed in them. So if that
shared collector has had an azure_monitor exporter added to its
pipelines, this service's traces and metrics are ALREADY reaching Azure
Monitor, with no change on this side at all.

So START IN PLAN MODE and establish which situation you are in before
proposing any change:

  Q1. Does this service export OTLP to a collector it does not own
      (an OTEL_EXPORTER_OTLP_ENDPOINT pointing at another host or
      container), or does it run its own collector, or does it export
      SDK-direct to a backend?

  Q2. What is its service.name / OTEL_SERVICE_NAME?

Report the answers, then follow the matching case. Ask me if it is
unclear. Do NOT add an exporter before establishing that one is needed:
adding a second export path produces DUPLICATE telemetry, and adding a
second Application Insights resource SPLITS the Application Map so the
service topology stops showing the calling service at all.

-------------------------------------------------------------
CASE 1 -- exports to a shared collector (MOST LIKELY)
-------------------------------------------------------------

Correct action: CHANGE NOTHING IN THIS REPO.

Verify instead. In the target Application Insights resource, Logs blade,
run:

    dependencies
    | where cloud_RoleName == 'playwright-mcp'
    | summarize count() by name

    requests
    | summarize count() by cloud_RoleName

Expect to see the tool spans (for example mcp.tool.browser_navigate,
mcp.tool.browser_get_text) in the first, and playwright-mcp among the
role names in the second if it emits server spans.

If rows come back: done. Report that no change was required and why.
That IS the deliverable. Do not manufacture work.

If NO rows come back, diagnose in this order before changing anything
here, because every one of these is a problem somewhere else:

  1. Is the shared collector actually running the config with the
     azure_monitor exporter? Check which config file is mounted.
  2. Is azure_monitor listed in that collector's TRACES pipeline, and
     in its metrics and logs pipelines?
  3. Did the collector start at all? An empty connection string fails
     config validation and stops the WHOLE collector, so the symptom is
     no telemetry from ANY service, not just this one.
  4. Is this service's OTEL_EXPORTER_OTLP_ENDPOINT reachable from
     inside its container? Wrong port (4317 gRPC versus 4318 HTTP) is
     the common error.
  5. Are OTel SDK export failures silent? They usually are. Set
     OTEL_LOG_LEVEL=debug temporarily. It is extremely noisy.

-------------------------------------------------------------
CASE 2 -- this service runs its OWN collector
-------------------------------------------------------------

Add the exporter to its pipelines. Do not remove the existing backend.

    exporters:
      azure_monitor:
        connection_string: "${APPLICATIONINSIGHTS_CONNECTION_STRING}"
        spaneventsenabled: true

    service:
      pipelines:
        traces:
          exporters: [<existing>, azure_monitor]
        metrics:
          processors: [<existing>, cumulative_to_delta]
          exporters: [<existing>, azure_monitor]
        logs:
          exporters: [<existing>, azure_monitor]

Use the SAME connection string as the calling service. A second
Application Insights resource splits the Application Map, and the
cross-service trace view is most of the value here.

Four things that will bite:

  - THE UNDERSCORE: azure_monitor, not azuremonitor. The latter is not
    a registered component type, so the collector refuses to start.
  - AN EMPTY CONNECTION STRING STOPS THE WHOLE COLLECTOR, because the
    exporter validates it at config-decode time. Give it a non-empty
    placeholder default:
      ${APPLICATIONINSIGHTS_CONNECTION_STRING:-InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://localhost/}
  - CUMULATIVE COUNTERS chart as diagonal ramps, because customMetrics
    has no counter concept. Add cumulative_to_delta with a STRICT include
    list naming only real counters -- delta-converting a gauge is
    wrong. Python OTel SDKs default to cumulative unless told
    otherwise, so also consider setting
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta.
  - spaneventsenabled DEFAULTS TO OFF, which silently discards every
    recorded exception. The exceptions table stays empty.

Validate before running. An invalid config is a total outage:

    docker run --rm -v "$(pwd)/<config>.yaml:/etc/otelcol/config.yaml:ro" \
      -e APPLICATIONINSIGHTS_CONNECTION_STRING='InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://localhost/' \
      otel/opentelemetry-collector-contrib:latest validate --config /etc/otelcol/config.yaml

-------------------------------------------------------------
CASE 3 -- exports SDK-direct, no collector
-------------------------------------------------------------

The simplest fix is NOT to add an Azure exporter to the SDK. Repoint
this service at the shared collector instead:

    OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector-host>:4318

Then you are in Case 1, and you get the backend fan-out, the shared
processors and the single-resource Application Map for free, with no
Azure-specific code in this service at all. That last point is the whole
argument for having a collector.

Only add an Azure Monitor SDK exporter directly if there is a specific
reason the collector is unreachable, and say what that reason is.

-------------------------------------------------------------
IN ALL CASES
-------------------------------------------------------------

  - The connection string is a CREDENTIAL. Environment or secret
    manager, never the repo. It CANNOT be rotated: if it leaks, the
    remedy is a new App Insights resource, losing data continuity.
  - Do not change span names or attributes to suit Azure. Nothing here
    requires it, and changing them breaks the other backend's
    dashboards.
  - Finish with the verification queries from Case 1. A config that
    validates is not evidence that telemetry arrived.
````
