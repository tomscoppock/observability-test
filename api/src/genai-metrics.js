'use strict';

/**
 * GenAI operation metrics, per the OpenTelemetry GenAI metrics conventions.
 *
 * WHY THIS EXISTS: Splunk's "APM > AI overview" page is metric-driven, not
 * span-driven. Its Requests, Errors and "Performance by Latencies" panels
 * (latency per model, per provider, per operation) all read
 * `gen_ai.client.operation.duration`. This service emitted rich `gen_ai.*`
 * spans and token metrics but never emitted that histogram, so the page
 * stayed entirely zero while "AI trace data" was fully populated from the
 * same traffic. Splunk's own `splunk-otel-util-genai` library emits it,
 * which is the real content behind the "you need the Python library"
 * impression: the library is not required, the metrics it emits are.
 *
 * TWO DETAILS THAT ARE EASY TO GET WRONG:
 *
 * 1. The unit is SECONDS (`s`), not milliseconds. Recording milliseconds
 *    here produces latency panels wrong by a factor of 1000, and they will
 *    look plausible rather than broken.
 * 2. The conventions specify explicit bucket boundaries. The OTel default
 *    boundaries are tuned for millisecond HTTP latencies and put almost
 *    every LLM call in one bucket, destroying the percentiles the AI
 *    overview charts. `advice.explicitBucketBoundaries` is how you set
 *    them from the instrument rather than needing a View.
 */

const { metrics } = require('@opentelemetry/api');

const meter = metrics.getMeter('rag-api.genai', '0.1.0');

/** Per the GenAI metrics conventions, for `gen_ai.client.operation.duration`. */
const DURATION_BUCKETS = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28,
  2.56, 5.12, 10.24, 20.48, 40.96, 81.92,
];

/** Per the same conventions, for `gen_ai.client.token.usage`. */
const TOKEN_BUCKETS = [
  1, 4, 16, 64, 256, 1024, 4096, 16384,
  65536, 262144, 1048576, 4194304, 16777216, 67108864,
];

const operationDuration = meter.createHistogram('gen_ai.client.operation.duration', {
  description: 'GenAI operation duration',
  unit: 's',
  advice: { explicitBucketBoundaries: DURATION_BUCKETS },
});

/**
 * Agent-level duration, per Splunk's `splunk-otel-util-genai` instruments.
 * Feeds the agent-oriented AI screens, where `operation.duration` feeds
 * the LLM-oriented AI overview. Same unit and boundaries.
 */
const agentDuration = meter.createHistogram('gen_ai.agent.duration', {
  description: 'GenAI agent operation duration',
  unit: 's',
  advice: { explicitBucketBoundaries: DURATION_BUCKETS },
});

/** Workflow-level duration, the top of the agentic hierarchy. */
const workflowDuration = meter.createHistogram('gen_ai.workflow.duration', {
  description: 'GenAI workflow duration',
  unit: 's',
  advice: { explicitBucketBoundaries: DURATION_BUCKETS },
});

/**
 * Record one completed workflow.
 *
 * @param {{ startMs: number, workflowName: string, workflowType?: string,
 *           framework?: string, errorType?: string }} opts
 */
function recordWorkflowDuration(opts) {
  const attrs = { 'gen_ai.workflow.name': opts.workflowName };
  if (opts.workflowType) attrs['gen_ai.workflow.type'] = opts.workflowType;
  if (opts.framework) attrs['gen_ai.framework'] = opts.framework;
  if (opts.errorType) attrs['error.type'] = opts.errorType;

  workflowDuration.record(Math.max(Date.now() - opts.startMs, 0) / 1000, attrs);
}

/**
 * Record one completed agent invocation.
 *
 * Attributes match what the reference library records:
 * `gen_ai.operation.name` (always `invoke_agent`), `gen_ai.agent.name`,
 * and optionally `gen_ai.agent.type` and `gen_ai.framework`.
 *
 * @param {{ startMs: number, agentName: string, agentType?: string,
 *           framework?: string, errorType?: string }} opts
 */
function recordAgentDuration(opts) {
  const attrs = {
    'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.agent.name': opts.agentName,
  };
  if (opts.agentType) attrs['gen_ai.agent.type'] = opts.agentType;
  if (opts.framework) attrs['gen_ai.framework'] = opts.framework;
  if (opts.errorType) attrs['error.type'] = opts.errorType;

  agentDuration.record(Math.max(Date.now() - opts.startMs, 0) / 1000, attrs);
}

/**
 * Record one completed GenAI client operation.
 *
 * `error.type` is Conditionally Required and only when the operation
 * failed, so it is omitted rather than set to a placeholder on success.
 * Splunk's Errors panel counts on its presence meaning failure.
 *
 * @param {{
 *   startMs: number,
 *   operationName: string,
 *   provider?: string,
 *   requestModel?: string,
 *   responseModel?: string,
 *   serverAddress?: string,
 *   serverPort?: number,
 *   errorType?: string,
 * }} opts
 */
function recordOperationDuration(opts) {
  const attrs = { 'gen_ai.operation.name': opts.operationName };
  if (opts.provider) attrs['gen_ai.provider.name'] = opts.provider;
  if (opts.requestModel) attrs['gen_ai.request.model'] = opts.requestModel;
  if (opts.responseModel) attrs['gen_ai.response.model'] = opts.responseModel;
  if (opts.serverAddress) attrs['server.address'] = opts.serverAddress;
  if (opts.serverPort) attrs['server.port'] = opts.serverPort;
  if (opts.errorType) attrs['error.type'] = opts.errorType;

  // Milliseconds in, seconds out. See note 1 above.
  operationDuration.record(Math.max(Date.now() - opts.startMs, 0) / 1000, attrs);
}

/** Classify a thrown value for `error.type`, which is a class not a message. */
function errorType(err) {
  if (!err) return 'unknown';
  if (err.name && typeof err.name === 'string' && err.name !== 'Error') return err.name;
  if (err.code && typeof err.code === 'string') return err.code;
  return 'unknown';
}

module.exports = {
  recordOperationDuration,
  recordWorkflowDuration,
  recordAgentDuration,
  errorType,
  DURATION_BUCKETS,
  TOKEN_BUCKETS,
};
