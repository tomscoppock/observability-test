'use strict';

/**
 * Structured logger wrapping the OpenTelemetry Logs API.
 *
 * Emits log records via OTLP (through the SDK configured in
 * instrumentation.js) AND writes to stdout so `docker compose logs`
 * remains useful.
 *
 * Trace context (trace ID, span ID) is automatically attached by the
 * SDK when a log is emitted inside an active span.
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('Server started', { port: 3000 });
 */

const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const { context, trace } = require('@opentelemetry/api');

// Severity text labels matching OTel spec.
const LEVELS = {
  DEBUG: { text: 'DEBUG', number: SeverityNumber.DEBUG },
  INFO:  { text: 'INFO',  number: SeverityNumber.INFO },
  WARN:  { text: 'WARN',  number: SeverityNumber.WARN },
  ERROR: { text: 'ERROR', number: SeverityNumber.ERROR },
};

/** @type {import('@opentelemetry/api-logs').Logger | null} */
let _logger = null;

/**
 * Get (or create) the OTel Logger instance.  Lazy so the module can be
 * imported before the SDK is fully initialised -- the proxy logger will
 * forward to the real provider once it is set.
 */
function getOtelLogger() {
  if (!_logger) {
    _logger = logs.getLogger('rag-api', '0.1.0');
  }
  return _logger;
}

/**
 * Format a log line for stdout.
 * ISO timestamp, level, message, then JSON attributes if any.
 */
function formatStdout(level, message, attributes) {
  const ts = new Date().toISOString();
  const prefix = `${ts}  ${level.text.padEnd(5)}`;
  if (attributes && Object.keys(attributes).length > 0) {
    return `${prefix} ${message} ${JSON.stringify(attributes)}`;
  }
  return `${prefix} ${message}`;
}

/**
 * Internal emit -- creates an OTel LogRecord and writes to stdout.
 *
 * @param {{ text: string, number: number }} level
 * @param {string} message
 * @param {Record<string, unknown>} [attributes]
 */
function emit(level, message, attributes) {
  // --- stdout (always, for docker compose logs / local dev) ---
  process.stdout.write(formatStdout(level, message, attributes) + '\n');

  // --- OTel log record ---
  const logger = getOtelLogger();

  /** @type {import('@opentelemetry/api-logs').LogRecord} */
  const record = {
    severityText: level.text,
    severityNumber: level.number,
    body: message,
  };

  if (attributes && Object.keys(attributes).length > 0) {
    record.attributes = attributes;
  }

  // Attach active span context so the SDK can inject trace_id / span_id.
  const activeContext = context.active();
  const span = trace.getSpan(activeContext);
  if (span) {
    record.context = activeContext;
  }

  logger.emit(record);
}

/** Log at DEBUG level. */
function debug(message, attributes) {
  emit(LEVELS.DEBUG, message, attributes);
}

/** Log at INFO level. */
function info(message, attributes) {
  emit(LEVELS.INFO, message, attributes);
}

/** Log at WARN level. */
function warn(message, attributes) {
  emit(LEVELS.WARN, message, attributes);
}

/** Log at ERROR level. */
function error(message, attributes) {
  emit(LEVELS.ERROR, message, attributes);
}

module.exports = { debug, info, warn, error };
