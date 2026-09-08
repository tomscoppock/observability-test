# 041 -- Give every demo talk track scene an explicit click path (@tom)

Status: in-progress
Priority: medium
Assignee: @tom
Epic: none
Theme: llm-observability
Tags: non-code, docs

## Description

Rewrite the `[SHOW]` navigation throughout `docs/demo-talk-track.md` so a
presenter who has never opened Splunk Observability Cloud can run the demo
from the document alone. Fix three instructions that do not work as written.

## Acceptance criteria

- [x] Every `[SHOW]` block names the surface it is on (dashboard, which APM
      page, or Splunk Cloud Platform) before naming controls
- [x] Multi-control steps are numbered, with literal UI labels in bold and
      literal values in backticks
- [x] Section 4: the "traces containing both `rag-api` and `playwright-mcp`"
      filter is replaced with one that works (multiple values in one
      **Service** filter are OR, not AND)
- [x] Section 5: Tag Spotlight instructions name the five tags actually
      indexed by 039, and route `gen_ai.response.finish_reasons` to Trace
      Analyzer because it is not one of them
- [x] Section 6: `llm.chatCompletion` corrected to `chat gpt-4o-mini`
- [x] External `playwright-mcp` dependency flagged as a presenter note
- [x] ASCII-only check passes (no non-ASCII, no em dashes)
- [ ] **Walked end to end in the live tenant after a simulator run** --
      outstanding, needs Splunk access. This is the real test: every named
      control must exist and every filter must return non-empty results.

## Live verification checklist

Run `./scripts/simulate-demo-traffic.sh`, wait ~2 minutes, then follow the
document literally from the Opening:

- [ ] Opening: **Dashboards** > search `RAG Agent` finds the group
- [ ] S1: **Environment** filter accepts `dev`; clicking `rag-api` opens a
      side panel with the service name as a link
- [ ] S4: `scrape.url` `=` `*` returns scrape traces only
- [ ] S4: `rag-api` + `playwright-mcp` in one **Service** filter returns MORE
      traces than `playwright-mcp` alone (confirms the OR claim in the note)
- [ ] S4: **Service** dropdown lists `playwright-mcp` at all (external server)
- [ ] S4: **Trace flow** section exists above the waterfall
- [ ] S5: Tag Spotlight shows boxes for the five indexed tags, and no box for
      `gen_ai.response.finish_reasons`
- [ ] S6: the LLM span is named `chat gpt-4o-mini` in this tenant
- [ ] S6: `gen_ai.operation.name` `=` `chat` excludes embedding spans

Undocumented behaviour to settle while there: whether **Add Row** on the
**Service** filter ANDs across rows. If it does, S4's first presenter note can
offer it as a cleaner alternative to the `scrape.url` tag filter.

## Notes

Triggered by a question about `demo-talk-track.md:244-245`, then widened to
the whole document.

Three defects found, all verified rather than assumed:

1. **Section 4 filter is wrong.** Splunk APM combines multiple values inside
   one filter with Boolean OR, so `rag-api` + `playwright-mcp` in the
   **Service** filter returns traces containing either. Replaced with a
   `scrape.url` tag filter, since only the scrape path sets that attribute.
2. **Section 6 names a non-existent span.** `llm.chatCompletion` is emitted
   nowhere. The real span is `chat gpt-4o-mini` (`api/src/llm.js:73`,
   `chat ${model}`), already correct in `docs/opentelemetry.md:237`.
3. **Section 5 overstates Tag Spotlight.** 039 indexed five Custom MetricSets:
   `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.provider.name`,
   `gen_ai.usage.completion_tokens`, `db.system`.
   `gen_ai.response.finish_reasons` is NOT indexed, so it has no Tag Spotlight
   box. The section's spoken content is largely about finish reasons, so that
   part moves to Trace Analyzer, which supports unindexed tags.

Splunk UI mechanics verified against help.splunk.com (Trace Analyzer, Filter
data in Splunk APM, View and filter for spans within a trace, Tag Spotlight,
View dashboards) rather than from memory.

Open question for live verification: the docs do not state whether **Add Row**
on the **Service** filter ANDs across rows. The rewrite does not depend on it.

Plan: `~/.claude/plans/in-the-demo-talk-deep-pizza.md`
