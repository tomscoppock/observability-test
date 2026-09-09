# 047 -- Azure Monitor demo talk track

Status: backlog
Priority: medium
Assignee: @tom
Epic: 042
Theme: azure-monitor
Tags: non-code, docs
Blocked by: 045
Stage: runtime-validation-pending

## Description

A scripted demo walkthrough of the Azure Monitor surfaces, runnable back to
back with the Splunk talk track off a single traffic simulator invocation.

## Acceptance criteria

- [x] `docs/demo-talk-track-3-azure.md` created
- [x] Reuses the established `[SHOW]` / `[SAY]` / `[HIGHLIGHT]` / `[CHART]`
      marker set and `> **Presenter note:**` asides
- [x] Every `[SHOW]` names the surface before naming controls, and gives an
      explicit click path -- the standard 041 set for the Splunk track
- [x] Multi-control steps numbered, literal UI labels in bold, literal values
      in backticks
- [x] Pre-demo preparation section covering the dual config, the simulator
      command, the flush wait, and the time picker
- [x] Runs off the same simulator invocation as the Splunk track, so the two
      can be presented consecutively without regenerating traffic
- [x] Covers Application Map, all five workbook tabs, Transaction Search and
      end-to-end trace detail, logs in the same resource as spans, and Smart
      Detection plus the three scheduled query rules
- [x] Closing boundaries section states the histogram percentile loss, the
      absent infrastructure product, and the detection-latency gap
- [x] Chart name reference table at the end, matching the workbook exactly
- [x] ASCII only, British English

## Runtime validation checklist

Chart names are now checked automatically, so the manual pass only has to
cover what a script cannot see: that the named Azure portal controls exist
and that each panel actually renders.

```bash
python3 scripts/check_talk_tracks.py     # names, counts, reference tables
python3 scripts/compare_backends.py      # every comparison query returns data
```

- [x] **Chart names verified mechanically** against `azure/workbook.json`.
      `check_talk_tracks.py` errors on a `[CHART]` marker that names nothing,
      a chart missing from a reference table, and a per-tab count that does
      not match. Zero errors as of 2026-09-09.
- [x] **All 32 workbook queries run and return rows**, validated against the
      live resource.

Remaining, and needs a human in a browser after a simulator run:

- [ ] Opening: **Workbooks** in the App Insights left nav lists
      **RAG Agent -- Observability**
- [ ] S1: **Investigate > Application map** renders, `rag-api` node clickable,
      side panel shows **Investigate performance**
- [ ] S2-S5: all five workbook tabs switch correctly and no panel is empty
- [ ] S4: **Investigate > Transaction search**, Event types **Dependency**,
      search `mcp.scrape` returns rows and a span's **Custom Properties**
      shows the `gen_ai.*` attributes
- [ ] S6: clicking a **Trace ID** in `Recent errors` opens the transaction
      view (the `OpenBladeSearch` formatter actually works)
- [ ] S7: **Monitoring > Alerts > Alert rules** lists the three rules, and
      **Condition** shows the query
- [ ] S7: **Investigate > Smart Detection** exists on this resource
- [ ] S8: **Azure Managed Grafana** is reachable and its bundled Azure /
      Insights / Applications dashboards render against this App Insights
      resource
- [ ] S8: the **Agent Framework** dashboard populates its LLM and token
      panels and leaves the agent/tool panels empty, as section 6a of the
      comparison predicts. If the agent panels DO populate, something emits
      agent spans that we did not account for -- investigate before
      presenting it
- [ ] Timing: the whole deck lands within ~16 minutes

Do not tick the acceptance criteria above on the strength of the document
reading well. 041 is still open on exactly this gate for the Splunk track.

## Notes

Keep the Splunk track's chart name reference table pattern, and keep it
accurate. It had drifted to 26 charts against a 31-chart dashboard, with five
LLM and AI charts missing entirely. **Both fixed 2026-09-09**, and the drift
is now caught mechanically by `scripts/check_talk_tracks.py`, which errors on
a `[CHART]` marker naming nothing, a chart absent from a reference table, and
a per-tab count that disagrees with the dashboard. Run it after any dashboard
change; a stale talk track fails in front of an audience.

The section ordering should not simply mirror the Splunk track. Azure's
strengths sit in different places: Application Map is free where Splunk needed
`peer.service` hand-set, and logs sitting beside spans is the single largest
capability difference the spike surfaces. Lead with what Azure does well and
be equally direct about the Infrastructure tab, where the charts render but
the product behind them does not exist.

Plan: `~/.claude/plans/ok-if-i-wanted-lazy-catmull.md`
