# Plan: 036 -- Logs correlation and verification

Status: **in-progress**
Created: 2026-09-07
Assignee: @tom
Epic: 025
Theme: otel-instrumentation, splunk-observability
Tags: enhancement

## Problem / goal

The app already emits structured OTel log records with trace context
attached (via `logger.js`). The logs pipeline originally exported to
Splunk Observability Cloud's native Log Observer at `/v2/log/otlp`
(task 021), but manual verification found that path dead: Splunk
deprecated native Log Observer, with migration required by end of
January 2024. Observability Cloud's own UI confirms this -- opening
**Logs Explorer** without a linked platform returns: *"ask your Splunk
administrator to set up Splunk Log Observer Connect."*

**2026-09-07 finding:** the current product, Log Observer Connect, does
not store logs in Observability Cloud -- it live-queries them from a
separate, licensed Splunk Enterprise/Cloud Platform instance. It is also
explicitly unavailable on Splunk Cloud Platform trial accounts. The user
provisioned a Splunk Cloud Platform trial specifically for this; since
Log Observer Connect won't work on it, this task now targets the
achievable piece (HEC ingestion into Splunk Cloud Platform, working
today) and documents Log Observer Connect's linking steps for whenever a
licensed instance is available, rather than claiming full correlation is
verified.

Revised goal: point the logs pipeline at Splunk Cloud Platform via HEC
(`splunk_hec/logs`), verify logs actually land there, and document both
the architecture and the Log Observer Connect linking steps accurately
so this doesn't reoccur. Dashboard log charts remain UI-only and
contingent on Log Observer Connect being linked.

## Expected behaviour

1. App logs land in Splunk Cloud Platform (searchable via
   `index=<SPLUNK_HEC_INDEX>`) with correct severity, message,
   attributes, and trace context (trace_id, span_id).
2. Once Log Observer Connect is linked to a licensed Splunk Cloud
   Platform/Enterprise instance, clicking a trace in Splunk APM shows
   correlated log records from the same trace.
3. The dashboard has at least one log-related chart (e.g. error log count
   or log volume over time) -- contingent on Log Observer Connect being
   linked; not achievable on a trial account.
4. Documentation explains the two-product architecture (Observability
   Cloud vs. Splunk Cloud Platform), the HEC setup, and the Log Observer
   Connect linking steps.

## Edge cases / error states

- Native Log Observer (direct OTLP ingest into Observability Cloud) is
  deprecated (Jan 2024) -- do not build against it; use HEC into a real
  Splunk Cloud Platform/Enterprise instance via Log Observer Connect
  instead.
- Log Observer Connect is not available on Splunk Cloud Platform trial
  accounts -- confirmed against Splunk's help docs. HEC ingestion still
  works on a trial (searchable in that platform's own Splunk Web), but
  Observability Cloud cannot link to it until it's licensed.
- High log volume (especially DEBUG level) could hit Splunk ingest limits
  -- the `filter/logs` processor (added, see below) already drops DEBUG
  logs before export.
- The `otlp_http/splunk_logs` exporter (task 021) is now known dead for
  the reason above, not just a 404 to fix -- replaced with
  `splunk_hec/logs` targeting Splunk Cloud Platform directly.
- Splunk Cloud Platform's Admin Config Service (ACS) could in principle
  script HEC token creation, but ACS does not support single-instance
  deployments (most trial/small stacks) -- token creation stays a manual
  UI step; do not add speculative ACS automation.

## Files to create or modify

| File | Change |
|---|---|
| `otel-collector-config.yaml` | Replace dead `otlp_http/splunk_logs` exporter with `splunk_hec/logs` targeting Splunk Cloud Platform; `filter/logs` processor retained |
| `.env.example` | Add `SPLUNK_HEC_URL`, `SPLUNK_HEC_TOKEN`, `SPLUNK_HEC_INDEX`, `SPLUNK_HEC_SOURCETYPE` (user-applied -- file is permission-blocked for the agent) |
| `docker-compose.yml` | Pass the four new `SPLUNK_HEC_*` vars through to `otel-collector` |
| `scripts/setup-splunk-hec.sh` / `.ps1` (new) | Validate HEC vars, test-post one event, redeploy collector, tail logs |
| `docs/splunk-setup.md` | Rewrite Log Observer section as Log Observer Connect; new architecture diagram; HEC token generation and platform-linking steps |
| `docs/opentelemetry.md` | Update exporter/env-var reference for `splunk_hec/logs` |
| `docs/configuration.md` | Update Splunk env var tables (Observability Cloud vs. Cloud Platform HEC) |

## Functions / classes to add or change

None -- the logging infrastructure (`logger.js`, `instrumentation.js` log
exporter, collector logs pipeline) is already in place. This task is about
fixing the export destination, verification, and documentation.

## Tests to write

- Manual: run `scripts/setup-splunk-hec.ps1`/`.sh`, confirm the test
  event and collector redeploy succeed.
- Manual: send a chat request, check Splunk Cloud Platform Search for a
  log record with matching trace_id.
- Manual (deferred until a licensed Splunk Cloud Platform/Enterprise
  instance is available): in Splunk APM, open a trace and verify
  "Related Content > Logs" shows correlated log records via Log Observer
  Connect.
- Existing test suite: run to confirm no regressions (logger.test.js) --
  no application code changed, this is collector config/docs/tooling only.

## Dependencies to add or upgrade

None.

## Out of scope

- Changing the logger API or adding new log levels.
- Structured log parsing or field extraction in Splunk.
- Log-based alerting/detectors -- could be a follow-up task.
- Forwarding logs to non-Splunk backends (Grafana Loki, etc.) -- decided
  against in favor of staying within Splunk given the Cloud Platform
  trial the user provisioned.
- Scripting Splunk Cloud Platform's ACS API for HEC token creation --
  unsupported on single-instance/trial deployments; stays a manual step.
- Actually linking Log Observer Connect end-to-end -- requires a licensed
  (non-trial) Splunk Cloud Platform/Enterprise instance the user does not
  yet have; steps are documented for when one is available.

## Implementation checklist

- [x] Diagnose why "Logs Explorer" showed no data -- confirmed native Log
      Observer deprecated Jan 2024; Log Observer Connect requires a
      separate licensed Splunk platform instance
- [x] Confirm Log Observer Connect is unavailable on Cloud Platform trials
      (user's newly-created trial cannot be the target)
- [x] Replace `otlp_http/splunk_logs` with `splunk_hec/logs` in
      `otel-collector-config.yaml`, targeting Splunk Cloud Platform
- [x] Add `SPLUNK_HEC_*` env passthrough to `docker-compose.yml`
- [x] Add `scripts/setup-splunk-hec.sh` + `.ps1` (validate + test event +
      redeploy + tail logs; no speculative ACS token automation)
- [x] Rewrite `docs/splunk-setup.md` Log Observer section as Log Observer
      Connect, with architecture diagram, HEC setup, and platform-linking
      steps
- [x] Update `docs/opentelemetry.md` and `docs/configuration.md` exporter
      and env var references
- [ ] User adds `SPLUNK_HEC_*` values to `.env` (agent is permission-
      blocked from this file)
- [x] User generated a HEC token in Splunk Web
- [x] Diagnosed `SPLUNK_HEC_URL` DNS failure: documented
      `http-inputs-<stack>.splunkcloud.com` hostname is not provisioned in
      DNS on this trial (confirmed via direct lookup -- NXDOMAIN, not a
      client-side error)
- [x] Found working alternative: HEC is live on the main stack hostname,
      port 8088, but presents Splunk's default self-signed
      `SplunkServerDefaultCert` -- added `SPLUNK_HEC_INSECURE_SKIP_VERIFY`
      env var (default `false`) to `otel-collector-config.yaml`,
      `docker-compose.yml`, and both setup scripts to handle this
- [x] Proved the DNS failure is a Splunk-side provisioning gap, not our
      misconfiguration: the DigiCert wildcard cert served on port 443
      lists `http-inputs-<stack>`, `http-inputs-ack-<stack>`,
      `http-inputs-firehose-<stack>` and `akamai-inputs-<stack>` in its
      SANs, yet all four return NXDOMAIN. Splunk issued a certificate for
      hostnames it never created DNS records for. Our original
      `http-inputs-` configuration was correct.
      **Exit condition for the TLS workaround:** once Splunk Support
      creates the ingest DNS record, switch `SPLUNK_HEC_URL` to
      `https://http-inputs-<stack>.splunkcloud.com/services/collector`
      and set `SPLUNK_HEC_INSECURE_SKIP_VERIFY=false` -- that endpoint is
      covered by the publicly-trusted cert, so no bypass is needed.
- [ ] Raise the missing HEC ingest DNS records with Splunk Support, citing
      the cert-SAN-vs-NXDOMAIN evidence (see docs/splunk-setup.md)
- [x] User updates `.env`: `SPLUNK_HEC_URL=https://<stack>.splunkcloud.com:8088/services/collector`,
      `SPLUNK_HEC_INSECURE_SKIP_VERIFY=true`, then re-runs
      `setup-splunk-hec.ps1`/`.sh`
- [x] Diagnosed and fixed HTTP 400 on the test event: token's "Enable
      indexer acknowledgement" was checked, which requires an
      `X-Splunk-Request-Channel` header neither the test script nor the
      collector's `splunk_hec` exporter sends (`code: 28`, "Data channel
      is missing"). Unchecked it on the token -- not needed for this
      demo pipeline, which doesn't require delivery-confirmation polling.
- [x] `setup-splunk-hec.ps1` test event now succeeds:
      `{"text":"Success","code":0}` -- HEC ingestion into Splunk Cloud
      Platform is confirmed working end-to-end (script -> collector
      redeploy -> HEC accept)
- [x] Confirmed the HEC test event is searchable in Splunk Cloud Platform:
      `index=main sourcetype=otel` returns the "otel-collector HEC
      connectivity test" event with `host=prd-p-6bx70.splunkcloud.com:8088`
      -- HEC ingestion pipeline proven end-to-end
- [x] **Root cause of "no app logs anywhere" found and fixed:**
      `instrumentation.js` constructed
      `new BatchLogRecordProcessor(new OTLPLogExporter({...}))`, passing
      the exporter positionally. `@opentelemetry/sdk-logs` 0.221.0 expects
      an options object (`BatchLogRecordProcessorBase.js:101` reads
      `options.exporter`), so `this._exporter` was `undefined` and every
      export threw `TypeError: Cannot read properties of undefined
      (reading 'export')` internally. This was completely silent because
      the OTel `diag` logger is a no-op unless `OTEL_LOG_LEVEL` is set.
      Fixed to pass `{ exporter: ... }`. Note this bug was independent of
      the HEC migration -- app logs were never reaching the collector
      regardless of which backend it exported to, which invalidated 039's
      earlier "Log Observer already working" conclusion.
- [x] Added optional `OTEL_LOG_LEVEL` passthrough on the `api` service in
      `docker-compose.yml` (defaults empty) so OTel SDK export failures
      can be surfaced instead of failing silently -- this is what finally
      exposed the bug above
- [x] Verified real application logs now reach the collector with trace
      context: `Chat request received`, `Embeddings generated`,
      `LLM completion received`, `Connected to SurrealDB`, each carrying
      `Trace ID` and `Span ID`, no HEC export errors
- [x] Isolation test proving collector -> Splunk works independently:
      raw OTLP log record POSTed to `localhost:4318/v1/logs` appeared in
      Splunk Cloud Platform as `source=otel-collector sourcetype=otel`
- [ ] Verify the app's own log records are searchable in Splunk Cloud
      Platform Search (manual check -- user): `index=main sourcetype=otel`
      should now show `Chat request received` etc. alongside the earlier
      test events
- [x] Run test suite (no regressions) -- 63 pass, 0 fail
- [x] Realign docs on the HEC approach: `docs/architecture.md` (new
      Observability Cloud vs Cloud Platform signal-split diagram and
      table), `README.md` (architecture diagram), `docs/splunk-setup.md`,
      `docs/opentelemetry.md`, `docs/configuration.md`; corrected 039's
      stale Log Observer conclusion
- [x] Attempted Log Observer Connect setup wizard on the trial -- hit
      `/services/authorization/tokens` 303 error, traced to the Search
      Head API IP allow list (documented per-realm IPs added to
      splunk-setup.md); confirmed this is a distinct issue from the trial
      restriction and fixing it would not itself unblock Log Observer
      Connect on a trial
- [ ] (Deferred -- needs a licensed Splunk Cloud Platform/Enterprise
      instance) Link Log Observer Connect and verify trace-log
      correlation in APM

## Review notes

(To be filled during review.)
