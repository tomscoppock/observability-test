# Plan: 028 -- Dashboard automation (Splunk REST API)

Status: **done** <!-- planning | in-progress | in-review | done -->
Created: 2026-09-04
Owner: @tom
Epic: 025
Theme: llm-observability

## Problem / goal

The current `docs/splunk-setup.md` walks through creating dashboard
charts manually via the Splunk UI. This is error-prone, time-consuming,
and produces inconsistent results. We need a reproducible, automated way
to create the demo dashboard so that:

1. The same dashboard is created every time (idempotent).
2. The dashboard is 100% aligned to the demo talk track (task 027).
3. Setup can be done via a single command or script.
4. The dashboard definition is version-controlled alongside the code.

## Expected behaviour

When this is done:

1. A dashboard definition file exists at
   `splunk/dashboard.json` (Splunk Charts API format) or
   `splunk/main.tf` (Terraform signalfx provider) that defines:

   **Dashboard group:** `RAG Agent -- Observability`
   **Dashboard:** `Demo Dashboard`

   **Charts (aligned to demo talk track sections):**

   | # | Chart name | Type | Signal source | Talk track section |
   |---|---|---|---|---|
   | 1 | Service Health Overview | List | `service.request` count by service | S1: Infrastructure |
   | 2 | SurrealDB Process Health | Line | `surrealdb.process.cpu_percent`, `surrealdb.process.memory` | S1: Infrastructure |
   | 3 | SurrealDB Transaction Rate | Line | `surrealdb.transaction` rate | S1: Infrastructure |
   | 4 | Request Rate | Line | `service.request` count rate | S2: RAG Pipeline |
   | 5 | Error Rate % | Line | `service.request` error/total | S2: RAG Pipeline |
   | 6 | Service Latency (P50/P90/P99) | Line | `service.request` percentiles | S2: RAG Pipeline |
   | 7 | RAG Chat Pipeline Latency | Line | `spans` by operation | S2: RAG Pipeline |
   | 8 | RAG Upload Pipeline Latency | Line | `spans` by operation | S2: RAG Pipeline |
   | 9 | Token Usage (Input) | Line | `gen_ai.client.token.usage` input | S3: Token Economics |
   | 10 | Token Usage (Output) | Line | `gen_ai.client.token.usage` output | S3: Token Economics |
   | 11 | Top Endpoints | List | `service.request` count top 10 | S2: RAG Pipeline |
   | 12 | MCP Scrape Latency | Line | `spans` mcp.scrape median | S4: Cross-Service |
   | 13 | SurrealDB HTTP Activity | Line | `surrealdb.http.request` rate | S1: Infrastructure |
   | 14 | SurrealDB Network I/O | Area | `surrealdb.network.*` rate | S1: Infrastructure |

2. A setup script exists at `scripts/setup-splunk-dashboard.sh` (or
   `.ps1` for Windows) that:
   - Reads `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` from `.env`
   - Uses the Splunk Observability Cloud REST API to create the
     dashboard group, dashboard, and all charts
   - Is idempotent (checks if dashboard exists before creating)
   - Outputs the dashboard URL on success

3. Alternatively (or additionally), a Terraform config at
   `splunk/main.tf` using the `splunk-otel/signalfx` provider that
   can `terraform apply` to create the same dashboard.

4. `docs/splunk-setup.md` is updated with a new section pointing to
   the automation script as an alternative to manual chart creation.

## Edge cases / error states

- Script must handle missing `SPLUNK_ACCESS_TOKEN` gracefully (error
  message, not a crash).
- Script must handle API rate limits (Splunk API has rate limits).
- Dashboard group may already exist (script should find and reuse it).
- Charts may already exist (script should update, not duplicate).
- The Splunk REST API for dashboards uses a specific JSON schema --
  need to verify against current API docs.

## Files to create or modify

- `splunk/dashboard.json` -- new, the dashboard definition
- `scripts/setup-splunk-dashboard.sh` -- new, the setup script (bash)
- `scripts/setup-splunk-dashboard.ps1` -- new, PowerShell equivalent
- `docs/splunk-setup.md` -- add section pointing to automation

## Functions / classes to add or change

- None (scripts and config only)

## Tests to write

- None (infrastructure automation, tested by running the script)

## Dependencies to add or upgrade

- `curl` or `Invoke-RestMethod` (already available)
- Optional: Terraform + `splunk-otel/signalfx` provider

## Out of scope

- Creating detectors/alerts via automation (could be a follow-up)
- Terraform state management (local state is fine for this dev project)
- CI/CD pipeline for dashboard deployment
- Custom Splunk apps or add-ons

---

## Implementation checklist

- [x] Web-search the Splunk Observability Cloud REST API for dashboard
      and chart creation endpoints, confirm current schema
- [x] Web-search the Terraform signalfx provider for dashboard resources
- [x] Decide on approach: REST API script vs. Terraform vs. both
      (Decision: REST API scripts only -- simpler, no Terraform dependency)
- [x] Create `splunk/dashboard.json` with all 14 chart definitions
- [x] Create `scripts/setup-splunk-dashboard.sh` (bash)
- [x] Create `scripts/setup-splunk-dashboard.ps1` (PowerShell)
- [x] Test the script against a live Splunk Observability Cloud instance
      -- run successfully against the eu2 org: 4 dashboards and 3
      detectors created/updated, idempotent on re-run. Note it requires
      `SPLUNK_ACCESS_TOKEN` to carry the **API** scope with the `power`
      role, in addition to Ingest for the collector (see
      docs/configuration.md).
      (deferred -- requires live credentials; script structure verified)
- [x] Add automation section to `docs/splunk-setup.md`
- [x] Cross-reference chart names against task 027 talk track
- [x] Self-review for idempotency, error handling, and completeness

## Review notes

- Bugs / logic:
- Security: Script reads SPLUNK_ACCESS_TOKEN from .env -- must not
  echo it to stdout or commit it.
- Performance:
- UX:
- Cost:
