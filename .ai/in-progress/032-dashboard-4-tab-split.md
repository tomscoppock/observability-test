# Plan: 032 -- Split dashboard into 4 tabs with improved charts

Status: **in-progress** <!-- planning | in-progress | in-review | done -->
Created: 2026-09-04
Owner: @tom
Epic: 025
Theme: llm-observability

## Problem / goal

The current Splunk dashboard is a single flat tab ("Demo Dashboard")
with 17 charts in no logical order. The dashboard group also has an
empty auto-created default tab ("RAG AGENT -- OBSERVABILITY") that
serves no purpose. Issues:

1. **No visual grouping** -- charts for infrastructure, RAG pipeline,
   LLM costs, and service health are interleaved.
2. **Missing charts** -- no per-service request counters, no LLM call
   latency, no embedding latency, no DB operation breakdown, no
   session tracking.
3. **Redundant charts** -- Token Usage is split into two separate
   charts (Input and Output) when one chart with two lines is clearer.
4. **Wrong chart types** -- Service Health Overview was a List (now
   SingleValue but still a single counter, not per-service).
5. **No alignment to demo flow** -- the talk track walks through
   service overview -> RAG pipeline -> LLM/tokens -> infrastructure,
   but the dashboard doesn't match this order.

**Goal:** Restructure into 4 dashboards (tabs) within the existing
dashboard group, each aligned to a section of the demo talk track,
with new charts and improved SignalFlow queries.

## Expected behaviour

After running the setup script, the "RAG Agent -- Observability"
dashboard group contains 4 dashboards (tabs):

### Tab 1: Service Overview (8 charts)

| # | Chart | Type | SignalFlow |
|---|-------|------|-----------|
| 1 | rag-api Requests | SingleValue | `histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')).count().sum().publish(label='rag-api')` |
| 2 | surrealdb Requests | SingleValue | `histogram('service.request', filter=filter('sf_service', 'surrealdb') and filter('sf_environment', 'dev')).count().sum().publish(label='surrealdb')` |
| 3 | playwright-mcp Requests | SingleValue | `histogram('service.request', filter=filter('sf_service', 'playwright-mcp') and filter('sf_environment', 'dev')).count().sum().publish(label='playwright-mcp')` |
| 4 | Error Rate % | SingleValue | `A = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev') and filter('sf_error', 'true')).count().publish(label='Errors', enable=False)\nB = histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')).count().publish(label='Total', enable=False)\nC = (A / B * 100).publish(label='Error Rate %')` |
| 5 | Request Rate | Line | existing query |
| 6 | Service Latency (P50/P90/P99) | Line | existing query |
| 7 | Error Count by Endpoint | List | `histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev') and filter('sf_error', 'true')).count().sum(by=['sf_operation']).top(count=5).publish(label='Errors by Endpoint')` |
| 8 | Top Endpoints | List | existing query |

### Tab 2: RAG Pipeline (7 charts)

| # | Chart | Type | SignalFlow |
|---|-------|------|-----------|
| 1 | Chat Pipeline Latency | Line | existing query |
| 2 | Upload Pipeline Latency | Line | existing query |
| 3 | MCP Scrape Latency | Line | existing query |
| 4 | Embedding Latency | Line | `filter_ = filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')\nA = histogram('spans', filter=filter_ and filter('sf_operation', 'embeddings.embedTexts')).percentile(pct=50).publish(label='P50')\nB = histogram('spans', filter=filter_ and filter('sf_operation', 'embeddings.embedTexts')).percentile(pct=90).publish(label='P90')` |
| 5 | DB Operation Breakdown | List | `histogram('spans', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev') and filter('sf_operation', 'db.*')).count().sum(by=['sf_operation']).publish(label='DB Operations')` |
| 6 | Vector Search Latency | Line | `filter_ = filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')\nA = histogram('spans', filter=filter_ and filter('sf_operation', 'db.vectorSearch')).percentile(pct=50).publish(label='P50')\nB = histogram('spans', filter=filter_ and filter('sf_operation', 'db.vectorSearch')).percentile(pct=90).publish(label='P90')` |
| 7 | Active Sessions | SingleValue | `histogram('service.request', filter=filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')).count().sum(by=['session.id']).count().publish(label='Active Sessions')` |

### Tab 3: LLM and AI (5 charts)

| # | Chart | Type | SignalFlow |
|---|-------|------|-----------|
| 1 | Total Input Tokens | SingleValue | `data('gen_ai.client.token.usage', filter=filter('gen_ai.token.type', 'input') and filter('service.name', 'rag-api')).sum().publish(label='Input Tokens')` |
| 2 | Total Output Tokens | SingleValue | `data('gen_ai.client.token.usage', filter=filter('gen_ai.token.type', 'output') and filter('service.name', 'rag-api')).sum().publish(label='Output Tokens')` |
| 3 | Token Usage Over Time | Line | `A = data('gen_ai.client.token.usage', filter=filter('gen_ai.token.type', 'input') and filter('service.name', 'rag-api')).sum().publish(label='Input Tokens')\nB = data('gen_ai.client.token.usage', filter=filter('gen_ai.token.type', 'output') and filter('service.name', 'rag-api')).sum().publish(label='Output Tokens')` |
| 4 | LLM Call Latency (P50/P90/P99) | Line | `filter_ = filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')\nA = histogram('spans', filter=filter_ and filter('sf_operation', 'llm.chatCompletion')).percentile(pct=50).publish(label='P50')\nB = histogram('spans', filter=filter_ and filter('sf_operation', 'llm.chatCompletion')).percentile(pct=90).publish(label='P90')\nC = histogram('spans', filter=filter_ and filter('sf_operation', 'llm.chatCompletion')).percentile(pct=99).publish(label='P99')` |
| 5 | Embedding API Latency | Line | `filter_ = filter('sf_service', 'rag-api') and filter('sf_environment', 'dev')\nA = histogram('spans', filter=filter_ and filter('sf_operation', 'embeddings.embedTexts')).percentile(pct=50).publish(label='P50')` |

### Tab 4: Infrastructure (6 charts)

| # | Chart | Type | SignalFlow |
|---|-------|------|-----------|
| 1 | Container CPU Usage | Line | existing query |
| 2 | Container Memory Usage | Line | existing query |
| 3 | Container Network I/O | Area | existing query |
| 4 | SurrealDB Process Health | Line | existing query |
| 5 | SurrealDB Transaction Rate | Line | existing query |
| 6 | SurrealDB HTTP Activity | Line | existing query |

**Total: 26 charts across 4 dashboards** (up from 17 on 1 dashboard).

The empty default "RAG AGENT -- OBSERVABILITY" dashboard is deleted
(or left as-is if the API doesn't support deletion of the default).

## Edge cases / error states

- **Existing single dashboard:** The script must handle the case where
  the old "Demo Dashboard" already exists. Strategy: delete it and
  recreate as 4 new dashboards, or rename it and create 3 more.
  Decision: **delete old + create 4 new** (clean slate, idempotent).
- **Default dashboard:** Splunk auto-creates a default dashboard for
  each group. The script should detect and skip or delete it.
- **Chart name collisions:** Charts with the same name on different
  dashboards are fine -- the Splunk API uses chart IDs, not names.
- **Rate limits:** The script already has 200ms pauses between API
  calls. With 26 charts + 4 dashboards, this adds ~6s total.

## Files to create or modify

| File | Action | What changes |
|------|--------|--------------|
| `splunk/dashboard.json` | Rewrite | Change from single `dashboard` + `charts` to `dashboards[]` array with per-dashboard `charts[]` |
| `scripts/setup-splunk-dashboard.sh` | Modify | Loop over `dashboards[]` instead of single `dashboard`; delete old dashboard; handle default dashboard |
| `scripts/setup-splunk-dashboard.ps1` | Modify | Same changes as bash script |
| `docs/demo-talk-track.md` | Modify | Update chart references to include tab names |

## Functions / classes to add or change

### `scripts/setup-splunk-dashboard.sh`

- **Step 2 rewrite:** Loop over `jq '.dashboards | length'` to create
  multiple dashboards in the group, each with their own charts.
- **Delete old dashboard:** Before creating new ones, find and delete
  any dashboard named "Demo Dashboard" in the group.
- **Chart layout:** SingleValue charts get `width: 3` (4 per row),
  Line/Area get `width: 6` (2 per row), List gets `width: 4` (3 per
  row).

### `scripts/setup-splunk-dashboard.ps1`

- Same structural changes as the bash script.

## Tests to write

- None (infrastructure automation, tested by running the script).

## Dependencies to add or upgrade

- None.

## Out of scope

- **colorScale thresholds on SingleValue charts** -- the Splunk Charts
  API supports this but it adds complexity to the JSON schema. Defer
  to a follow-up if the basic SingleValue counters look good enough.
- **Terraform alternative** -- still deferred from Plan 028.
- **Custom chart sizing** -- use simple 2-column or 4-column grid;
  don't try to pixel-perfect the layout.
- **Deleting the auto-created default dashboard** -- Splunk may not
  allow this via API. If not, leave it empty.

---

## Implementation checklist

<!-- Checked off during the Implement phase. -->

- [x] Rewrite `splunk/dashboard.json` with 4-dashboard structure
- [x] Update `scripts/setup-splunk-dashboard.sh` to loop over dashboards
- [x] Update `scripts/setup-splunk-dashboard.ps1` to loop over dashboards
- [x] Update `docs/demo-talk-track.md` chart references with tab names
- [ ] Run setup script against live Splunk instance to verify
- [x] Update `.ai/STATUS.md`

## Review notes

<!-- Filled in during the Review phase (AGENTS.md Section 3, Step 5). -->

- Bugs / logic:
- Security:
- Performance:
- UX:
- Cost:
