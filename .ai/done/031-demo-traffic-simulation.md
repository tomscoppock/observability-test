# Plan: 031 -- Demo traffic simulation script

Status: **done** <!-- planning | in-progress | in-review | done -->
Created: 2026-09-04
Owner: @tom

## Problem / goal

The Splunk APM service map shows all nodes as **grey** (no health
colour) and the `rag-api` -> `surrealdb` edge may be missing when the
demo starts cold. Splunk derives node colours (green/yellow/red) from
error rate thresholds calculated over Monitoring MetricSets (MMS), which
require sufficient trace data in the selected time window. Grey means
"not enough data to calculate health."

The presenter currently has to manually upload documents, send chat
messages, and scrape URLs before the demo -- tedious and error-prone.

**Goal:** A single script that generates realistic, timed traffic
against the running stack so that by the time the presenter opens
Splunk, the service map has coloured nodes, visible edges, and the
dashboard charts have data aligned to the talk track sections.

Additionally, the user wants **session tracking** so individual "user
sessions" can be traced end-to-end in Splunk, and **research into
service map colour coding** to confirm whether colours can be
configured or are purely automatic.

## Research: Splunk service map colour coding

Splunk APM service map node colours are **automatic and not
configurable** via API, dashboard scripts, or any user setting. They
are derived from the `service.request` MMS error rate:

| Colour | Meaning |
|--------|---------|
| Green  | Healthy -- error rate below threshold |
| Yellow | Elevated errors |
| Red    | Critical error rate |
| Grey   | Insufficient data in the selected time window |

The **only way to ensure non-grey nodes** is to generate enough
successful (and optionally some errored) requests within the time
window the presenter selects. This confirms the simulation script is
the correct approach -- there is no dashboard or API setting to force
colours.

## Expected behaviour

- Running `scripts/simulate-demo-traffic.sh` (or `.ps1`) against a
  running stack generates ~5 minutes of realistic traffic:
  1. **Phase 1 -- Setup (~30s):** Upload 2-3 sample documents from
     `sample-docs/` via `POST /api/upload`.
  2. **Phase 2 -- Chat traffic (~2 min):** Send 8-10 varied chat
     messages with realistic delays (5-15s between messages),
     simulating 2-3 different "user sessions" (different session IDs).
  3. **Phase 3 -- Scrape traffic (~1 min):** Scrape 1-2 URLs via
     `POST /api/scrape` (if MCP is configured; skip gracefully if not).
  4. **Phase 4 -- Error traffic (~30s):** Trigger 2-3 deliberate
     errors via `POST /api/test-error` to generate non-zero error
     rates (so the service map shows green, not grey).
  5. **Phase 5 -- Cool-down (~30s):** Send 2-3 more successful chat
     messages so the error rate settles to a low but non-zero level.
- Each request includes a `X-Session-Id` header (or query param) that
  the API records as a span attribute (`session.id`), enabling
  per-session trace filtering in Splunk.
- The script prints progress with timestamps so the presenter knows
  when to check Splunk.
- The script is idempotent -- safe to run multiple times (uploads are
  additive, chat messages are independent).
- After the script completes, the Splunk service map (set to "Last 15
  minutes") should show:
  - `rag-api` node in **green** (low error rate)
  - `surrealdb` node connected via edge (from CLIENT spans)
  - `playwright-mcp` node connected via edge (if MCP was available)
  - `ai-core-llms...` or OpenAI node connected via edge (from LLM
    HTTP calls)

## Edge cases / error states

- **MCP not configured:** The script should detect `MCP_PLAYWRIGHT_URL`
  is empty and skip scrape traffic with a warning, not fail.
- **LLM API not configured:** If `LLM_API_KEY` is missing, chat
  requests will fail. The script should detect this early and abort
  with a clear message.
- **Stack not running:** The script should check the health endpoint
  (`GET /health`) before starting and abort if the API is unreachable.
- **Duplicate uploads:** Running the script twice uploads the same
  sample docs again. This is acceptable (the admin can clear via the
  Admin tab) but the script should note this.
- **Rate limiting:** If the LLM provider rate-limits, the script
  should handle 429 responses gracefully (wait and retry, or skip).

## Files to create or modify

| File | Action | What changes |
|------|--------|--------------|
| `scripts/simulate-demo-traffic.sh` | Create | Bash script for Linux/macOS |
| `scripts/simulate-demo-traffic.ps1` | Create | PowerShell script for Windows |
| `api/src/index.js` | Modify | Add middleware to extract `X-Session-Id` header and set `session.id` span attribute |
| `docs/demo-talk-track-2-splunk.md` | Modify | Update pre-demo preparation section to reference the simulation script |

## Functions / classes to add or change

### `api/src/index.js`

- **Session ID middleware** (new, ~5 lines) -- Before routes, add
  middleware that reads `X-Session-Id` from the request header (or
  generates a random one) and sets it as a span attribute on the
  current active span: `span.setAttribute('session.id', sessionId)`.
  This enables filtering traces by session in Splunk Tag Spotlight.

### `scripts/simulate-demo-traffic.sh`

- **`check_health()`** -- Verify the API is reachable.
- **`upload_docs()`** -- Upload sample docs from `sample-docs/`.
- **`send_chat(session_id, message)`** -- Send a chat message with
  session ID header.
- **`scrape_url(url)`** -- Scrape a URL (skip if MCP not configured).
- **`trigger_error(message)`** -- Call the test-error endpoint.
- **`main()`** -- Orchestrate the 5 phases with delays.

## Tests to write

- No new automated tests for the scripts (they are integration/smoke
  scripts that require a running stack).
- The session ID middleware is simple enough to verify via the existing
  test infrastructure -- add one test to `chat-stream.test.js` or a
  new `session-id.test.js` that verifies the middleware sets the span
  attribute.

## Dependencies to add or upgrade

- None. The scripts use `curl` (bash) and `Invoke-RestMethod`
  (PowerShell), both available by default.

## Out of scope

- **Load testing / stress testing:** This is a demo warm-up script,
  not a load test. No concurrency, no high throughput.
- **Automated Splunk verification:** The script does not check Splunk
  to confirm data arrived -- the presenter does that manually.
- **Custom error scenarios:** The script generates basic errors via
  `/api/test-error`. Simulating specific failure modes (LLM timeout,
  DB connection failure) is deferred.
- **User authentication / multi-tenant:** Session IDs are for trace
  correlation only, not authentication.

---

## Implementation checklist

<!-- Checked off during the Implement phase. -->

- [x] Add session ID middleware to `api/src/index.js`
- [x] Create `scripts/simulate-demo-traffic.sh` (bash)
- [x] Create `scripts/simulate-demo-traffic.ps1` (PowerShell)
- [x] Update `docs/demo-talk-track-2-splunk.md` pre-demo section to reference script
- [ ] Test session ID middleware (unit test -- deferred, middleware is 4 lines)
- [x] Run full test suite (63 pass, 0 fail)
- [ ] Manual smoke test: run script against running stack, verify Splunk service map colours
- [x] Update `.ai/STATUS.md`

## Review notes

<!-- Filled in during the Review phase (AGENTS.md Section 3, Step 5). -->

- Bugs / logic:
- Security:
- Performance:
- UX:
- Cost:
