# 046 -- Splunk vs Azure Monitor parity findings

Status: done
Priority: high
Assignee: @tom
Epic: 042
Theme: azure-monitor
Tags: non-code, docs
Blocked by: 043, 045

## Description

Write up where the two backends genuinely differ, in both directions. This is
the actual deliverable of the comparison: the workbook only makes the
comparison possible.

## Acceptance criteria

- [x] `docs/splunk-vs-azure-monitor.md` created
- [x] Per-chart notes wherever the Azure version is not a faithful
      reproduction, saying what changed and why
- [x] A "Splunk wins" table and an "Azure wins" table, each item marked as
      established empirically or as reasoned but unverified
- [x] Documents that the two backends will report different P90/P99 for the
      same traffic, and why Azure's is the more correct number
- [x] Documents the histogram flattening limit precisely, including the fact
      that percentiles are recoverable here only because the same values are
      redundantly on the span
- [x] Cost and retention section (Splunk pre-aggregate query cost vs Azure
      billable raw rows; 90 days vs 13 months)
- [x] Detection-latency comparison for the drift detectors
- [x] No claim stated as fact that has not been observed against live data;
      anything reasoned-but-unverified labelled as such

## Runtime validation checklist

- [x] Run the dual config, one simulator run, and record actual numbers per
      equivalent chart side by side
- [x] Verify whether the Splunk Active Sessions chart returns anything useful.
      **Answered, and not as expected.** It returned nothing, but the cause
      was an APPLICATION defect breaking both backends identically, not a
      Splunk indexing gap: `session.id` was being set on the Express
      middleware span rather than the HTTP server span. Fixed at source.
      Splunk then needed one extra step Azure did not (a `span_metrics`
      dimension, because MetricSet indexing has no public API). Both now
      report 4 = 4.

## Notes

**Completed 2026-09-09 with real measured figures**, captured over one
shared absolute window in dual mode via `scripts/compare_backends.py`.
Counters match exactly between the two backends; percentiles diverge by up to
14%, entirely explained by Splunk's bucket interpolation and largest exactly
where section 1 predicted.

The Active Sessions question this task flagged is answered, and the answer
was not what was expected: it was an application defect breaking BOTH
backends identically, not a Splunk indexing gap. Fixed at source.

Two Splunk defects were found by building the comparison, both now fixed and
documented in `docs/splunk-setup.md` section 27: `service.request` is in
nanoseconds while `traces.span.metrics.duration` is milliseconds, and
`service.request` double-counts without `filter('sf_dimensionalized','true')`.
An apparent "Azure is dropping data" gap was disproved by a controlled send
of 60 tagged requests returning 60 on both sides; the gap was in the
comparison harness (playbook trap 33).

Disagreements between the two dashboards are findings, not bugs. Every one
needs an explanation in the document, and a number that differs without an
explanation is the thing this task exists to prevent.

The temptation to make the comparison look even should be resisted in both
directions. The two largest asymmetries are not close:

- Logs land in App Insights `traces` in the same resource as the spans,
  correlated by `operation_Id`, with no second product and no licence gate.
  The Splunk equivalent is blocked on Log Observer Connect requiring a
  non-trial licence (recorded in `docs/splunk-setup.md` Section 26 and epic
  025's boundaries). That is a large Azure win and it is not represented in
  any of the 31 charts.
- App Insights has no infrastructure product at all. Splunk's Infrastructure
  Navigators and APM-to-Infrastructure Related Content, keyed on `host.name`,
  have no App Insights counterpart, so `resourcedetection` buys nothing on the
  Azure side. The Infrastructure tab will *look* comparable while the product
  around it is not. That is a large Splunk win.

Plan: `~/.claude/plans/ok-if-i-wanted-lazy-catmull.md`
