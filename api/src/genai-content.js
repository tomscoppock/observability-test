'use strict';

/**
 * Optional capture of LLM prompt and response content as span attributes.
 *
 * OFF BY DEFAULT, and that default is the important part. Prompt and
 * response bodies routinely contain names, account numbers, customer data
 * and proprietary business logic. The OpenTelemetry GenAI conventions
 * deliberately keep them out of the default attribute set for exactly that
 * reason, and so do we.
 *
 * WHY THIS EXISTS AT ALL: Splunk's AI Agent Monitoring populates its AI
 * Interactions and AI trace data views from captured message content, and
 * its platform-side evaluations (hallucination, toxicity, bias, relevance)
 * score that content. Without capture those screens stay empty. So this is
 * the switch that makes a test system useful for evaluating those features
 * while leaving production safe.
 *
 * WHY WE IMPLEMENT IT BY HAND: `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`
 * is read by OpenTelemetry's GenAI *auto-instrumentation* libraries, which
 * exist for Python but not for this Node service -- our LLM spans are
 * instrumented manually in llm.js. Setting the variable alone therefore does
 * nothing here. We honour the standard variable name anyway, so the same
 * configuration works if this service is ever re-platformed onto a runtime
 * where auto-instrumentation does the job.
 *
 * WHY JSON STRINGS RATHER THAN STRUCTURED VALUES: array and object span
 * attributes are silently dropped by some exporters. The `azure_monitor`
 * exporter maps only strings, booleans and numbers, so a structured value
 * never arrives. See docs/implementation-playbook.md trap 34.
 */

/** The OpenTelemetry-standard variable name, honoured verbatim. */
const CAPTURE_ENV_VAR = 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT';

const ATTR_INPUT_MESSAGES = 'gen_ai.input.messages';
const ATTR_OUTPUT_MESSAGES = 'gen_ai.output.messages';
const ATTR_TRUNCATED = 'gen_ai.capture.truncated';

/**
 * Upper bound per attribute, in characters.
 *
 * Splunk warns that oversized values can cause problems when they exceed
 * platform limits, and an unbounded attribute is a denial-of-wallet risk on
 * any backend that bills by ingest. Content is truncated rather than
 * dropped: a clipped prompt is still diagnostically useful, unlike a
 * clipped identifier.
 */
const MAX_CONTENT_CHARS = 8192;

/**
 * Values that enable capture ON THE SPAN.
 *
 * `SPAN_ONLY` is the value Splunk's own setup guide specifies. `true` and
 * `1` are accepted because that is what most instrumentation libraries
 * historically took.
 *
 * `EVENT_ONLY` deliberately does NOT enable span capture: it asks for
 * content as separate log events, which this service does not emit, so
 * honouring it as a span attribute would put content somewhere the operator
 * did not ask for it.
 */
const SPAN_CAPTURE_VALUES = new Set(['span_only', 'true', '1', 'span_and_event']);

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} whether prompt/response content should go on the span
 */
function isContentCaptureEnabled(env) {
  const source = env || process.env;
  const raw = source[CAPTURE_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return SPAN_CAPTURE_VALUES.has(raw.trim().toLowerCase());
}

/** Serialise to JSON and clip, reporting whether clipping happened. */
function serialise(value) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return { text: null, truncated: false };
  }
  if (typeof text !== 'string') return { text: null, truncated: false };
  if (text.length <= MAX_CONTENT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_CONTENT_CHARS), truncated: true };
}

/**
 * Build the content attributes for one LLM call.
 *
 * Returns an empty object when capture is disabled, so callers can spread
 * the result unconditionally and the disabled path stays free of branching.
 *
 * @param {{ messages?: unknown, output?: unknown, env?: NodeJS.ProcessEnv }} args
 * @returns {Record<string, string|boolean>}
 */
function contentAttributes({ messages, output, env } = {}) {
  if (!isContentCaptureEnabled(env)) return {};

  const attrs = {};
  let truncated = false;

  if (messages !== undefined && messages !== null) {
    const { text, truncated: clipped } = serialise(messages);
    if (text !== null) {
      attrs[ATTR_INPUT_MESSAGES] = text;
      truncated = truncated || clipped;
    }
  }

  if (output !== undefined && output !== null) {
    const { text, truncated: clipped } = serialise(output);
    if (text !== null) {
      attrs[ATTR_OUTPUT_MESSAGES] = text;
      truncated = truncated || clipped;
    }
  }

  // Only stamp the flag when something was actually captured, so a disabled
  // or empty call adds no attributes at all.
  if (truncated && Object.keys(attrs).length > 0) {
    attrs[ATTR_TRUNCATED] = true;
  }
  return attrs;
}

module.exports = {
  contentAttributes,
  isContentCaptureEnabled,
  CAPTURE_ENV_VAR,
  ATTR_INPUT_MESSAGES,
  ATTR_OUTPUT_MESSAGES,
  ATTR_TRUNCATED,
  MAX_CONTENT_CHARS,
};
