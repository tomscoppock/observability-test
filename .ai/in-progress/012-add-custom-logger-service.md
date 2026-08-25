# Plan: 012 -- Add custom logger service wrapping OTel logs API

Status: **in-review** <!-- planning | in-progress | in-review | done -->
Created: 2026-08-25
Owner: @tom

## Problem / goal

The application currently uses `console.log` for all output. These
messages are not exported via OTLP, have no structured attributes, and
cannot be correlated with traces in Splunk Log Observer. Task 012 creates
a logger service that wraps the OTel Logs API so every application log
record is:

1. Exported to the OTel Collector (and on to Splunk) via the existing
   OTLP logs pipeline configured in `instrumentation.js`.
2. Enriched with trace context (trace ID, span ID) for log-to-trace
   correlation.
3. Structured with severity level, timestamp, and arbitrary attributes.
4. Still printed to stdout for local development visibility.

## Expected behaviour

- A new module `api/src/logger.js` exports functions: `info()`, `warn()`,
  `error()`, `debug()`.
- Each function accepts `(message, attributes?)` where attributes is an
  optional object of key-value pairs.
- Log records include:
  - `severityText` and `severityNumber` matching the level
  - `body` set to the message string
  - `attributes` merged from the caller-supplied object
  - Trace context (trace ID, span ID) automatically injected by the SDK
    when called inside an active span
  - `service.name` and `deployment.environment` from the resource
- All existing `console.log` calls in `api/src/index.js` are replaced
  with the new logger.
- Logs appear in the OTel Collector debug output with correct severity
  and trace correlation.
- Logs continue to print to stdout (dual output) so `docker compose logs`
  remains useful.

## Edge cases / error states

- **No active span:** Logger must not throw if called outside a span
  context. Trace ID and span ID will be empty/zero -- this is expected
  for startup messages.
- **SDK not initialised:** The logger is imported after `instrumentation.js`
  runs (via `--require`), so the `LoggerProvider` is always available.
  But if someone imports logger in a test without the SDK, it should
  fall back gracefully (noop or console-only).
- **Circular dependency:** `logger.js` must not import from
  `instrumentation.js` -- it uses `@opentelemetry/api` (the stable API
  package) to get the logger provider, not the SDK internals.
- **Large attribute values:** No special handling needed -- the OTel SDK
  truncates oversized attributes per spec defaults.

## Files to create or modify

- **Create** `api/src/logger.js` -- the logger service module
- **Modify** `api/src/index.js` -- replace `console.log` with logger calls
- **Create** `api/src/__tests__/logger.test.js` -- unit tests for the logger

## Functions / classes to add or change

### `api/src/logger.js` (new)

- `getOtelLogger()` -- internal helper; calls `logs.getLogger('rag-api')`
  from `@opentelemetry/api` to get a Logger instance. Cached on first call.
- `emit(severityText, severityNumber, message, attributes)` -- internal;
  creates a LogRecord with body, severity, attributes, and emits it via
  the OTel Logger. Also writes to `process.stdout` for local visibility.
- `info(message, attributes?)` -- public; calls `emit` with INFO/9.
- `warn(message, attributes?)` -- public; calls `emit` with WARN/13.
- `error(message, attributes?)` -- public; calls `emit` with ERROR/17.
- `debug(message, attributes?)` -- public; calls `emit` with DEBUG/5.

### `api/src/index.js` (modify)

- Replace `console.log('[api] Listening on port ${PORT}')` with
  `logger.info('Listening on port', { port: PORT })`.
- Replace the `console.log` in the stub chat response path (if any) with
  `logger.debug`.

## Tests to write

### `api/src/__tests__/logger.test.js`

- **Test 1:** `info()` emits a log record with severityText='INFO' and
  severityNumber=9.
- **Test 2:** `error()` emits with severityText='ERROR' and
  severityNumber=17.
- **Test 3:** Custom attributes are included in the emitted log record.
- **Test 4:** Calling logger functions without an active span does not
  throw.
- **Test 5:** Message appears in stdout (capture process.stdout.write).

Testing approach: Use a mock/spy on the OTel Logger's `emit` method.
The `@opentelemetry/api` package supports `logs.setGlobalLoggerProvider()`
which can be set to a test provider with an in-memory exporter.

## Dependencies to add or upgrade

- `@opentelemetry/api-logs` -- ^0.200.0 (the logs API surface; needed
  for `SeverityNumber` enum and `Logger` type). Check if this is already
  re-exported from `@opentelemetry/api` in SDK 2.x -- if so, no new
  dependency needed.
- No new runtime dependencies expected -- the logs API is part of the
  existing `@opentelemetry/api` package in SDK 2.x.
- **Dev dependency:** Add a test runner. Options:
  - `node:test` (built-in, zero install, Node 22 has it stable) -- preferred
  - `jest` (heavier, but more familiar) -- fallback if node:test is insufficient

## Out of scope

- Log level filtering (e.g. suppress DEBUG in production) -- can be added
  later via an env var like `LOG_LEVEL`.
- Structured exception logging with stack traces -- will be added when
  error handling middleware is built.
- Replacing `console.log` calls inside `instrumentation.js` itself --
  those run before the SDK is ready and must stay as console output.
- Pino/Winston integration -- this is a thin OTel-native wrapper, not a
  full logging framework. If a framework is needed later, it can be
  bridged via the OTel logs bridge API.

---

## Implementation checklist

<!-- Checked off during the Implement phase. -->

- [x] Verify `@opentelemetry/api` exports logs API (no new dep needed)
- [x] Create `api/src/logger.js` with info/warn/error/debug functions
- [x] Add stdout dual-output in each log call
- [x] Replace `console.log` calls in `api/src/index.js` with logger
- [x] Add test runner config (node:test)
- [x] Create `api/src/__tests__/logger.test.js` with 5 test cases
- [x] Run tests locally -- all pass
- [x] Rebuild Docker image and verify logs appear in OTel Collector output
- [x] Verify trace correlation (log records have trace_id when inside a span)
- [x] Update `api/package.json` test script
- [x] Move 011 to done/ (housekeeping -- was already complete)
- [x] Update `.ai/STATUS.md`

## Review notes

<!-- Filled in during the Review phase (AGENTS.md Section 3, Step 5). -->

- Bugs / logic:
- Security:
- Performance:
- UX:
- Cost:
