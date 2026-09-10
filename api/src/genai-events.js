'use strict';

/**
 * GenAI operation-details events, as log records.
 *
 * WHY THIS EXISTS: Splunk's AI agent screens are fed by LOG RECORDS, not
 * by spans and not by metrics. Reading the source of Splunk's own
 * `opentelemetry-util-genai-emitters-splunk` package, the `splunk` emitter
 * named in their documented
 * `OTEL_INSTRUMENTATION_GENAI_EMITTERS=span_metric_event,splunk` does one
 * thing: it calls `event_logger.emit(...)` with a record whose
 * `event.name` is `gen_ai.client.inference.operation.details`. Spans and
 * metrics are emitted by the other emitters in that list.
 *
 * That explains an otherwise baffling result: this stack had correct
 * `gen_ai.*` spans, correct `gen_ai.client.operation.duration` and token
 * metrics, a registered agent, and running evaluations, and the AI
 * overview and AI agents pages were still completely empty. The signal
 * those pages read was never being sent.
 *
 * TWO ROUTING TRAPS, both of which produce silence rather than an error:
 *
 * 1. These records must reach Observability Cloud, not Splunk Cloud
 *    Platform. This project's logs pipeline exported only to
 *    `splunk_hec`, which is a different product. The AI subsystem never
 *    saw them.
 * 2. The same emitter only runs when content capture is on, because the
 *    record body IS the prompt and response. So the AI screens are
 *    unreachable without accepting that content leaves the application.
 *    That is a data protection decision, not a configuration one.
 *
 * Emission is therefore gated on the event-capture modes only
 * (`SPAN_AND_EVENT`, `EVENT_ONLY`), never on `SPAN_ONLY`.
 */

const { logs } = require('@opentelemetry/api-logs');
const { context } = require('@opentelemetry/api');
const { CAPTURE_ENV_VAR } = require('./genai-content');

/** The event name Splunk's emitter uses for LLM, agent and workflow alike. */
const EVENT_NAME = 'gen_ai.client.inference.operation.details';

/** Capture modes that ask for content as EVENTS. */
const EVENT_CAPTURE_VALUES = new Set(['span_and_event', 'event_only']);

const logger = logs.getLogger('rag-api.genai', '0.1.0');

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} whether GenAI content events should be emitted
 */
function isEventCaptureEnabled(env) {
  const raw = (env || process.env)[CAPTURE_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return EVENT_CAPTURE_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Convert messages to the body format the emitter uses: each message is
 * `{ role, parts: [{ type: 'text', content }] }`, the same shape as the
 * span attributes but as structured data rather than a JSON string,
 * because a log record body is not limited to primitives.
 */
function toBodyMessages(messages) {
  if (!Array.isArray(messages)) return undefined;
  const out = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const parts = Array.isArray(message.parts)
      ? message.parts
      : [{ type: 'text', content: String(message.content == null ? '' : message.content) }];
    out.push({ role: message.role || 'user', parts });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Emit one operation-details event, correlated to the active span.
 *
 * Splits system messages into `gen_ai.system_instructions`, matching the
 * reference implementation, which treats them separately from the
 * conversation.
 *
 * @param {{
 *   messages?: Array<object>, output?: string, operationName?: string,
 *   provider?: string, requestModel?: string, responseModel?: string,
 *   responseId?: string, inputTokens?: number, outputTokens?: number,
 *   agentName?: string, framework?: string, env?: NodeJS.ProcessEnv,
 * }} opts
 * @returns {boolean} whether an event was emitted
 */
function emitOperationDetails(opts = {}) {
  if (!isEventCaptureEnabled(opts.env)) return false;

  const attributes = { 'event.name': EVENT_NAME };
  if (opts.framework) attributes['gen_ai.framework'] = opts.framework;
  if (opts.provider) attributes['gen_ai.provider.name'] = opts.provider;
  if (opts.operationName) attributes['gen_ai.operation.name'] = opts.operationName;
  if (opts.requestModel) attributes['gen_ai.request.model'] = opts.requestModel;
  if (opts.responseModel) attributes['gen_ai.response.model'] = opts.responseModel;
  if (opts.responseId) attributes['gen_ai.response.id'] = opts.responseId;
  if (typeof opts.inputTokens === 'number') {
    attributes['gen_ai.usage.input_tokens'] = opts.inputTokens;
  }
  if (typeof opts.outputTokens === 'number') {
    attributes['gen_ai.usage.output_tokens'] = opts.outputTokens;
  }
  if (opts.agentName) attributes['gen_ai.agent.name'] = opts.agentName;

  const all = Array.isArray(opts.messages) ? opts.messages : [];
  const systemInstructions = [];
  const conversation = [];
  for (const message of all) {
    if (message && message.role === 'system') {
      systemInstructions.push({
        type: 'text',
        content: String(message.content == null ? '' : message.content),
      });
    } else {
      conversation.push(message);
    }
  }

  const body = { 'gen_ai.system_instructions': systemInstructions };
  const input = toBodyMessages(conversation);
  if (input) body['gen_ai.input.messages'] = input;
  if (opts.output != null) {
    body['gen_ai.output.messages'] = [
      { role: 'assistant', parts: [{ type: 'text', content: String(opts.output) }] },
    ];
  }

  // Nothing but an empty instructions array means there is no content to
  // report, and an empty event is worse than none.
  if (!body['gen_ai.input.messages'] && !body['gen_ai.output.messages']) return false;

  try {
    logger.emit({
      // BOTH are needed. The reference implementation sets the record's
      // EventName field via `event_name=` AND carries `event.name` as an
      // attribute; they are separate places in the OTLP payload and a
      // consumer may key on either.
      eventName: EVENT_NAME,
      body,
      attributes,
      // The reference implementation leaves severity unset, which means
      // UNSPECIFIED(0). Any collector filtering on a severity floor -- and
      // this project's `filter/logs` does exactly that -- silently drops
      // the record. INFO keeps it, and the filter is also guarded now.
      severityNumber: 9,
      severityText: 'INFO',
      context: context.active(),
    });
    return true;
  } catch {
    // Telemetry must never break the request path.
    return false;
  }
}

module.exports = {
  emitOperationDetails,
  isEventCaptureEnabled,
  toBodyMessages,
  EVENT_NAME,
  EVENT_CAPTURE_VALUES,
};
