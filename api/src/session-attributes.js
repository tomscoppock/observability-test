'use strict';

/**
 * Derives the `session.id` span attribute from an incoming request's headers.
 *
 * Kept as a standalone pure function for two reasons: `instrumentation.js`
 * starts the OTel SDK on require and so cannot be imported by tests, and this
 * logic is worth testing directly.
 *
 * TWO DELIBERATE DECISIONS, both learned by finding the dashboards wrong
 * rather than by reading anything -- see docs/implementation-playbook.md
 * traps 26 and 27:
 *
 *   1. This is applied to the HTTP SERVER span, via the http
 *      instrumentation's `startIncomingSpanHook`. It used to be set from
 *      Express middleware with `trace.getActiveSpan()`, which returns the
 *      middleware layer's own INTERNAL span, so the attribute landed on a
 *      child span and never reached the request. Any dashboard grouping a
 *      SERVER-span metric by session then silently returned nothing.
 *
 *   2. A session id is never invented. The previous version generated a
 *      random UUID when the header was absent, which made every health check
 *      look like a distinct user: live data showed 3 real sessions against
 *      307 single-request phantoms. Absent means absent, so the attribute is
 *      simply not set and distinct-counts stay honest.
 */

/** Node lower-cases incoming header names. */
const SESSION_ID_HEADER = 'x-session-id';

/** OpenTelemetry semantic convention attribute name. */
const ATTR_SESSION_ID = 'session.id';

/**
 * Upper bound on an accepted session id.
 *
 * Span attribute values are attacker-influenced input that ends up in the
 * telemetry backend and, for anything indexed as a metric dimension, in its
 * cardinality budget. An over-long value is not a legitimate session id, so
 * it is rejected rather than truncated -- truncating would silently merge
 * distinct sessions into one.
 */
const MAX_SESSION_ID_LENGTH = 200;

/**
 * @param {import('http').IncomingHttpHeaders | undefined} headers
 * @returns {Record<string, string>} attributes to add to the server span,
 *   empty when the client supplied no usable session id.
 */
function sessionAttributes(headers) {
  if (!headers) return {};

  // A repeated header arrives as an array; take the first value only.
  const raw = headers[SESSION_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return {};

  const sessionId = value.trim();
  if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) return {};

  return { [ATTR_SESSION_ID]: sessionId };
}

module.exports = {
  sessionAttributes,
  SESSION_ID_HEADER,
  ATTR_SESSION_ID,
  MAX_SESSION_ID_LENGTH,
};
