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
 * never arrives. See docs/implementation-playbook.md trap 34. The semantic
 * conventions expect exactly this: "When recorded on spans, it MAY be
 * recorded as a JSON string if structured format is not supported", and
 * OpenTelemetry JS does not yet support complex attribute values.
 *
 * WHY THE SHAPE IS NOT NEGOTIABLE: the conventions say instrumentations
 * MUST follow the published JSON schema, and Splunk's AI Interactions view
 * calls JSON.parse on these attributes and reads the parsed structure. A
 * bare answer string is not JSON, so parsing throws on the first character
 * and Splunk's React error boundary blanks the whole trace page with
 * "error occurred rendering the page". The schema is an ARRAY of messages,
 * each { role, parts }, each part { type: 'text', content }:
 *
 *   [{ "role": "assistant",
 *      "parts": [{ "type": "text", "content": "According to ..." }] }]
 *
 * `finish_reason` exists on the output message in the schema but is marked
 * deprecated there, in favour of the separate `gen_ai.response.finish_reasons`
 * attribute, so it is not set here.
 */

/** The OpenTelemetry-standard variable name, honoured verbatim. */
const CAPTURE_ENV_VAR = 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT';

const ATTR_INPUT_MESSAGES = 'gen_ai.input.messages';
const ATTR_OUTPUT_MESSAGES = 'gen_ai.output.messages';
const ATTR_TRUNCATED = 'gen_ai.capture.truncated';

/**
 * Upper bound on captured text per attribute, in characters.
 *
 * This budgets the text CONTENT, not the serialised document, so the JSON
 * envelope is never counted and never clipped.
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

/** Roles the conventions enumerate. Anything else passes through as-is. */
const ROLES = new Set(['system', 'user', 'assistant', 'tool']);

/**
 * Coerce one part's content to the string the schema requires.
 * Returns null when it cannot be represented, so the part is dropped
 * rather than emitted in a shape that fails validation.
 */
function partContent(value) {
  if (typeof value === 'string') return value;
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/**
 * Turn one message into schema shape.
 *
 * Accepts what this codebase actually passes -- the OpenAI wire format,
 * `{ role, content }` -- and passes through anything already carrying
 * `parts`, so a future caller that builds messages properly is not
 * rewritten into a worse shape.
 */
function toSchemaMessage(message, defaultRole) {
  if (!message || typeof message !== 'object') return null;

  const role = ROLES.has(message.role) ? message.role : (message.role || defaultRole);
  if (typeof role !== 'string') return null;

  if (Array.isArray(message.parts)) return { role, parts: message.parts };

  // OpenAI multimodal content is an array of {type, text} blocks.
  if (Array.isArray(message.content)) {
    const parts = [];
    for (const block of message.content) {
      const content = partContent(block && block.type === 'text' ? block.text : block);
      if (content !== null) parts.push({ type: 'text', content });
    }
    return parts.length > 0 ? { role, parts } : null;
  }

  const content = partContent(message.content);
  if (content === null) return null;
  return { role, parts: [{ type: 'text', content }] };
}

/**
 * Normalise a caller's value into the array of messages the schema wants.
 *
 * Returns null when there is nothing representable, which is how a
 * circular or otherwise unserialisable value ends up contributing no
 * attribute at all rather than a broken one.
 */
function toMessages(value, defaultRole) {
  if (typeof value === 'string') {
    return [{ role: defaultRole, parts: [{ type: 'text', content: value }] }];
  }
  const list = Array.isArray(value) ? value : [value];
  const messages = [];
  for (const message of list) {
    const shaped = toSchemaMessage(message, defaultRole);
    if (shaped) messages.push(shaped);
  }
  return messages.length > 0 ? messages : null;
}

/**
 * Clip text content to a total budget, IN PLACE ACROSS THE STRUCTURE.
 *
 * The conventions call for truncating "individual message contents,
 * preserving JSON structure". Slicing the serialised JSON string instead --
 * which is what this module used to do -- produces a truncated document
 * that no longer parses, reintroducing the exact rendering failure this
 * shape is meant to avoid.
 *
 * Budget is spent in message order, so the earliest content survives intact
 * and later content is clipped or emptied.
 */
function clipMessages(messages, budget) {
  let remaining = budget;
  let truncated = false;

  for (const message of messages) {
    if (!Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (typeof part.content !== 'string') continue;
      if (part.content.length <= remaining) {
        remaining -= part.content.length;
        continue;
      }
      part.content = part.content.slice(0, Math.max(remaining, 0));
      remaining = 0;
      truncated = true;
    }
  }
  return truncated;
}

/** Shape, clip, and serialise one side of the exchange. */
function serialise(value, defaultRole) {
  const messages = toMessages(value, defaultRole);
  if (messages === null) return { text: null, truncated: false };

  const truncated = clipMessages(messages, MAX_CONTENT_CHARS);
  try {
    return { text: JSON.stringify(messages), truncated };
  } catch {
    return { text: null, truncated: false };
  }
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
    const { text, truncated: clipped } = serialise(messages, 'user');
    if (text !== null) {
      attrs[ATTR_INPUT_MESSAGES] = text;
      truncated = truncated || clipped;
    }
  }

  if (output !== undefined && output !== null) {
    const { text, truncated: clipped } = serialise(output, 'assistant');
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
