# Plan: 026 -- Splunk docs review and MCP monitoring section

Status: **done** <!-- planning | in-progress | in-review | done -->
Created: 2026-09-04
Owner: @tom
Epic: 025
Theme: llm-observability

## Problem / goal

The existing `docs/splunk-setup.md` was written during task 009/010 and
updated during 017/018. It needs a full accuracy review against the
current Splunk Observability Cloud UI and API (which may have changed),
cross-checked with web search for latest SignalFlow syntax, API
endpoints, and UI navigation paths.

Additionally, the doc has no section covering the **MCP service
relationship** -- how to monitor the `rag-api` to `playwright-mcp`
cross-service dependency in Splunk APM, including distributed trace
correlation, service map edges, and latency breakdown across the MCP
boundary.

## Expected behaviour

When this is done:

1. Every step in `docs/splunk-setup.md` has been verified against the
   current Splunk Observability Cloud UI (2026 Q3) and corrected where
   needed.
2. SignalFlow snippets have been validated against the current SignalFlow
   language reference.
3. A new section (between current sections 13 and 14, or as a new
   section 22+) covers **MCP service monitoring**:
   - How `rag-api` and `playwright-mcp` appear on the APM service map
   - How to view distributed traces spanning both services
   - How to create charts for MCP call latency, error rate, and
     throughput
   - SignalFlow examples filtering by `sf_service` for both services
4. The "last updated" date at the bottom is current.
5. Any stale references (e.g. "coming in Epic 004") are removed.

## Edge cases / error states

- Splunk UI navigation may differ between free-tier and enterprise
  editions -- note any differences found.
- The `playwright-mcp` service may not appear on the service map if it
  hasn't sent traces recently -- document how to verify.
- Some SignalFlow functions may have been deprecated -- check the
  [SignalFlow reference](https://dev.splunk.com/observability/docs/signalflow/).

## Files to create or modify

- `docs/splunk-setup.md` -- review all 21 existing sections, add MCP
  monitoring section(s)

## Functions / classes to add or change

- None (documentation only)

## Tests to write

- None (documentation only)

## Dependencies to add or upgrade

- None

## Out of scope

- Creating the actual dashboard (that's task 028)
- Writing the demo talk track (that's task 027)
- Adding new instrumentation code to the API or MCP server
- Changing the OTel Collector config

---

## Implementation checklist

- [x] Web-search Splunk Observability Cloud current UI navigation paths
      (2026) and compare against docs sections 1-9
- [x] Web-search current SignalFlow syntax reference and validate all
      SignalFlow snippets in the doc
- [x] Web-search SurrealDB OTel metric names (confirm `surrealdb.*`
      namespace is still current in 3.2+) and validate sections 10-13
- [x] Review sections 14-17 (RAG pipeline charts) for accuracy against
      actual span names emitted by the code
- [x] Review sections 18-21 (alerts, best practices, next steps, quick
      reference) for accuracy
- [x] Remove stale references (e.g. "coming in Epic 004", outdated
      backlog numbers in section 20)
- [x] Add new section: MCP service monitoring (service map, distributed
      traces, charts, SignalFlow)
- [x] Update "last updated" date
- [x] Self-review the full document for consistency and completeness

## Review notes

- Bugs / logic:
- Security:
- Performance:
- UX:
- Cost:
