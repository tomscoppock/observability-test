# 022 -- Add Express error-handling middleware

Status: **done**
Created: 2026-08-26
Assignee: @tom
Tags: otel-instrumentation, security
Epic: 003

## Description

Express currently returns raw HTML stack traces when `body-parser` encounters
malformed JSON (e.g. `{message:hello}` without quotes). This is both an
**information disclosure** risk (internal file paths leak to the client) and a
**UX issue** (HTML error page instead of JSON for an API).

Discovered during manual testing of task 012 (review finding S5). The issue is
pre-existing -- not introduced by 012.

## Acceptance criteria

- [ ] An Express error-handling middleware catches `SyntaxError` from
      `body-parser` and returns `{ "error": "Invalid JSON" }` with HTTP 400.
- [ ] Other unhandled errors return `{ "error": "Internal server error" }`
      with HTTP 500 (no stack trace in production).
- [ ] Error responses are logged via the OTel logger (`logger.warn` for 400,
      `logger.error` for 500).
- [ ] Stack traces are only included in the response body when
      `NODE_ENV !== 'production'` (development convenience).
- [ ] Unit test covers malformed JSON -> 400 JSON response.

## Notes

- Express error-handling middleware must be registered **after** all routes
  (4-argument signature: `(err, req, res, next)`).
- See: https://expressjs.com/en/guide/error-handling.html
- The `body-parser` SyntaxError has `err.type === 'entity.parse.failed'` and
  `err.status === 400` -- use these to distinguish from other errors.
