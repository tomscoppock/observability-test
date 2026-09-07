# Epic: 025 -- Splunk Demo and Dashboard Automation

Status: **in-progress**
Created: 2026-09-04
Lead: @tom
Theme: llm-observability, splunk-observability, otel-core

## Goal

Deliver a polished, repeatable Splunk Observability Cloud demo for the
RAG Agent stack. Three deliverables:

1. **Accurate documentation** -- review and update `docs/splunk-setup.md`
   against current Splunk Observability Cloud UI/API (cross-checked with
   web search), add an explicit MCP-to-app relationship monitoring
   section, and ensure all steps are reproducible.

2. **Demo talk track** -- a scripted walkthrough document that showcases
   the finished dashboard, covering infrastructure-to-app relationships,
   token spend, latency, inter-service interplay, security threats
   (prompt injection, agent subversion), and eval-based quality
   monitoring. Voice-over highlights cost saving, compliance, security,
   governance, OTel benefits, Observability Cloud benefits, and
   architecture-specific benefits (SurrealDB as foundation).

3. **Dashboard automation** -- a reproducible way to create the demo
   dashboard via the Splunk Observability Cloud REST API (or Terraform
   provider), so the same dashboard is created every time, 100% aligned
   to the demo talk track. Either a script or a JSON/Terraform config
   that can be imported.

## Scope

| # | Child task | Description |
|---|---|---|
| 026 | Splunk docs review and MCP monitoring section | Review/update splunk-setup.md, add MCP section |
| 027 | Demo talk track | Scripted demo walkthrough document |
| 028 | Dashboard automation | Splunk API script/config for repeatable dashboard creation |
| 032 | Dashboard 4-tab split | Split single dashboard into 4 tabs |
| 033 | Spanmetrics connector | Custom span charts via spanmetrics connector |
| 035 | Fix token metrics dashboard | Fix histogram query bug in token charts |
| 036 | Logs correlation and verification | Verify logs pipeline, add log charts, document correlation |
| 037 | Splunk AI overview and Azure Foundry | Populate Splunk AI overview, research Azure Foundry OTLP |
| 038 | Evals and drift monitoring | Research and prototype quality/drift monitoring |
| 039 | Splunk OOTB features population | Populate all Splunk built-in views via standard OTel |

## Child items

- [x] 026 -- Splunk docs review and MCP monitoring section
- [ ] 027 -- Demo talk track
- [ ] 028 -- Dashboard automation (Splunk REST API / Terraform)
- [ ] 032 -- Dashboard 4-tab split
- [x] 033 -- Spanmetrics connector for custom span charts
- [ ] 035 -- Fix token metrics dashboard charts
- [ ] 036 -- Logs correlation and verification
- [ ] 037 -- Splunk AI overview and Azure Foundry monitoring
- [ ] 038 -- Evals and drift monitoring
- [ ] 039 -- Populate Splunk OOTB features via standard OTel

## Notes

- The Splunk Observability Cloud has a REST API for dashboards, charts,
  and detectors: `https://dev.splunk.com/observability/reference/api/`
- Terraform provider `splunk-otel/signalfx` can also manage dashboards
  declaratively.
- The demo talk track should reference specific chart names from the
  automated dashboard so they stay in sync.
- Security/eval monitoring may require custom span attributes or log
  patterns that don't exist yet -- the plan should note what's available
  today vs. what would need new instrumentation.
