# 045 -- Azure Workbook and alert rules as code

Status: done
Priority: high
Assignee: @tom
Epic: 042
Theme: azure-monitor
Blocked by: 043
Stage: implementation

## Description

Build the Azure-side equivalent of `splunk/dashboard.json` and
`splunk/detectors.json`: one Azure Workbook with tab groups mirroring the four
Splunk dashboard tabs, plus three scheduled query rules mirroring the three
SignalFlow drift detectors, both deployed idempotently by script.

## Acceptance criteria

- [x] `azure/workbook.json` holds the workbook payload as readable, diffable
      JSON (not hand-escaped inside a template)
- [x] `azure/workbook.bicep` deploys it via `Microsoft.Insights/workbooks`,
      using `loadTextContent` for `serializedData`
- [x] Workbook resource name is a deterministic `guid()` so redeploys update
      rather than duplicate
- [x] Four tab groups (Service Overview, RAG Pipeline, LLM and AI,
      Infrastructure) plus a fifth Logs and Traces tab
- [x] All 31 Splunk charts accounted for: two merges and two splits, giving
      30 parity items, each mapped in a table in the task or the doc
- [x] App Insights resource is a workbook parameter, not hardcoded, so the
      same JSON deploys to another subscription unchanged
- [x] Every query obeys the four KQL rules recorded on epic 042
- [x] `azure/alerts.bicep` deploys three `scheduledQueryRules`, kind
      `LogAlert`, severity 2, empty action groups
- [x] Response length and output token rules read span attributes, not
      `customMetrics`, and carry sample-size and non-zero-sigma guards
- [x] `scripts/setup-azure-workbook.sh` and `.ps1` behave identically, load
      `.env` without overriding exported vars, and are idempotent on re-run
- [x] Both scripts fail with a diagnostic, not a stack trace, when `az` is
      missing or unauthenticated
- [x] ASCII only in both scripts and all JSON/Bicep

## Runtime validation checklist

Cannot be ticked without a live App Insights resource. Resolve items 1-5
**before** finalising queries, because each changes a query that would
otherwise be written twice.

- [x] **Do resource attributes reach `customMetrics.customDimensions`? YES.**
      Verified 2026-09-09 against the live resource. A
      `container.cpu.usage.total` datapoint carries `container.name`,
      `container.id`, `container.image.name`, `container.hostname`,
      `container.runtime`, `deployment.environment`, `host.name` and
      `os.type`, all of which are resource attributes. So
      `transform/azure_dims` is **redundant** for `container.name`. Keeping
      it is still defensible as a deterministic guarantee rather than a
      reliance on undocumented behaviour, but it is not load-bearing.
- [x] **Is `compose.service` or `container.name` populated? `container.name`
      only.** Verified 2026-09-09. `compose.service` was **absent**, so the
      `coalesce(compose.service, container.name)` in the container charts is
      load-bearing and correct. Note the sample checked was the
      `playwright-mcp` container, which is not part of this Compose project
      and therefore carries no `com.docker.compose.*` labels for
      `container_labels_to_metric_labels` to map. Re-check against a
      Compose-managed container to see whether `compose.service` appears
      there.
- [x] **Bonus finding: `deployment.environment` DOES reach
      `customDimensions`.** The workbook queries deliberately drop the
      environment filter its Splunk counterparts carry, on the assumption
      it might not survive. It does, so that filter could be restored if a
      second environment ever exists.
- [x] Container metrics arrive with an EMPTY `cloud_RoleName`, because
      `docker_stats` sets no `service.name`. The container charts correctly
      do not filter on it; do not add such a filter.
- [x] **Histogram buckets ARE lost, and `valueStdDev` is NOT populated.**
      Verified 2026-09-09: a `gen_ai.client.response.length` datapoint arrived
      as `value` 1171, `valueSum` 1171, `valueCount` 2, `valueMin` 386,
      `valueMax` 785, `valueStdDev` empty. Confirms the Response Length chart
      had to source from the span attribute.
- [x] **`session.id` is on NEITHER `requests.session_Id` NOR
      `requests.customDimensions`.** It lands on `dependencies`, on the
      `middleware - <anonymous>` span, because `api/src/index.js` uses
      `trace.getActiveSpan()` inside Express middleware and that returns the
      middleware span, not the HTTP SERVER span. 1773 request rows, zero with
      either. **This is an application defect that breaks the Splunk chart
      too**, for the same reason and unfixably by indexing. Query reworked to
      read `dependencies` and drop sessions seen only once (a client sending
      no header gets a fresh UUID per request: 3 real sessions against 307
      phantoms, so a naive `dcount` reported 310).
      **The application has since been fixed** (`api/src/session-attributes.js`
      plus the http `startIncomingSpanHook` in `api/src/instrumentation.js`),
      so the workbook query is now the plain `requests`-based one with no
      workaround. Verified: 3 header-bearing requests out of 176 carry it,
      zero phantoms. Note Splunk additionally needs `session.id` indexed as a
      Monitoring MetricSet dimension, which 039 did not do. Full write-up in
      `docs/splunk-vs-azure-monitor.md` section 6.
- [x] **`db.system` is present on 348 of 348 `db.*` dependencies.** 100%
      coverage, so the semantic filter is safe and the fallback to
      `name startswith 'db.'` is not needed.
- [x] **`exceptions` populates**, which proves `spaneventsenabled: true`
      works. Empty on the first check only because no error traffic had run.
- [x] Deploy, then deploy again -- verified idempotent, the deterministic
      `guid()` name updates in place rather than duplicating.
- [x] **All 32 queries run and all 32 return rows.** Validated
      programmatically against the live resource by extracting every query
      from `azure/workbook.json` and running it through
      `az monitor app-insights query`. Zero failures, zero empty panels.
      Note that a green ARM deployment proves nothing here: workbook
      `serializedData` is an opaque string, so bad KQL deploys successfully
      and only fails when a human opens the tab. That is playbook trap 25,
      found the hard way via a non-existent `percentileexact()`.

An empty panel is the failure mode that matters here. It is exactly what 033
and 035 had to fix on the Splunk side, both times because a query referenced
something the pipeline was not actually producing.

## Notes

**Completed 2026-09-09, including runtime validation.** Workbook and all
three alert rules deployed to the live resource; redeploy verified idempotent.
All 32 workbook queries were run programmatically against live data and all 32
return rows -- zero empty panels.

Three defects were found and fixed during that validation, none of which a
green ARM deployment would have caught, because workbook `serializedData` is
an opaque string to ARM and its KQL is never parsed at deploy time
(playbook trap 25):

- A non-existent `percentileexact()` in 12 queries. KQL has no exact
  percentile function.
- The alert rules failed to deploy at all: multi-period evaluation requires
  the query to project a `timestamp` datetime column, and an evaluation
  period is `windowSize`, not `evaluationFrequency` (playbook trap 24). Fixed
  properly rather than by weakening to one period, so the rules reproduce the
  Splunk `lasting='5m'` semantics exactly.
- The Active Sessions tile rendered a confident `0`, which traced back to an
  application defect affecting both backends. Fixed at source.

Two mechanics that will bite if missed. The workbook resource `name` must be a
GUID, so use `guid(resourceGroup().id, 'rag-agent-observability')` rather than
`newGuid()`, which would create a fresh workbook on every deployment. And
`serializedData` is a JSON *string*, so hand-escaping 30 queries into an ARM
template is not viable; `loadTextContent` from a separate file is what keeps
this reviewable and diffable.

Tabs come from a `type: 11` links item with `style: "tabs"` setting a
parameter, plus `conditionalVisibility` on `type: 12` group items. Without the
groups it is one long scroll rather than four dashboards.

The merges and splits are deliberate, not shortcuts:

- The four Service Overview SingleValues merge into one `tiles` item, because
  Workbooks has no SingleValue type and the idiom is one result row per tile.
  One `summarize by cloud_RoleName` gives all four plus an error-rate column,
  and puts the three services side by side where comparison is the point.
- The two token totals merge for the same reason.
- SurrealDB Process Health splits in two, because a 0-100 percentage and a
  hundreds-of-megabytes byte count cannot share a Workbooks y-axis. The Splunk
  chart has the same flaw; do not copy it.
- SurrealDB HTTP Activity splits because a per-second rate and an
  instantaneous in-flight gauge want different aggregations.

Considered and rejected: merging the LLM Provider and Embedding Model tables
(obscures the 1:1 mapping the spike demonstrates), and dropping Embedding API
Latency as a duplicate of Embedding Latency (the Splunk dashboard has the same
duplication; removing it makes the chart count harder to reconcile).

On the alert rules, the important finding is that **stddev cannot be recovered
from `customMetrics`**. Taking the standard deviation of pre-aggregated
per-interval means is not the standard deviation of the population and
silently understates variance, producing a hair-trigger detector. Two of the
three rules therefore read `dependencies` span attributes instead. The
sample-size guards (`n >= 30`, `m >= 5`, `sigma > 0`) are not present in the
Splunk versions and should be: without them a cold-start hour with four LLM
calls fires immediately.

Plan: `~/.claude/plans/ok-if-i-wanted-lazy-catmull.md`
