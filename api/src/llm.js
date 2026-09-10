'use strict';

/**
 * LLM completions API client.
 *
 * Calls an OpenAI-compatible or Azure OpenAI chat completions endpoint.
 * Each call is wrapped in an OTel span following the gen_ai semantic
 * conventions (https://github.com/open-telemetry/semantic-conventions-genai).
 *
 * Span name: `chat {model}` (per gen_ai semconv)
 * Span kind: CLIENT
 * Attributes: gen_ai.operation.name, gen_ai.provider.name,
 *   gen_ai.request.model, gen_ai.response.model, gen_ai.response.id,
 *   gen_ai.response.finish_reasons (array, per spec),
 *   gen_ai.response.finish_reason (scalar companion -- arrays are
 *     dropped by the azure_monitor exporter), gen_ai.usage.input_tokens,
 *   gen_ai.usage.output_tokens, server.address, server.port
 *
 * Token usage is also recorded as OTel histogram metrics:
 *   gen_ai.client.token.usage (input_tokens, output_tokens)
 *
 * Configuration (env vars):
 *   LLM_API_BASE_URL   -- e.g. https://api.openai.com/v1
 *                         or https://{resource}.openai.azure.com/openai/deployments/{deployment}
 *   LLM_API_KEY        -- API key (Bearer token or Azure api-key)
 *   LLM_MODEL          -- e.g. gpt-4o-mini
 *   AZURE_API_VERSION   -- Azure OpenAI API version (default: 2024-10-21)
 */

const { trace, SpanKind, metrics } = require('@opentelemetry/api');
const logger = require('./logger');
const { contentAttributes } = require('./genai-content');
const { recordOperationDuration, errorType, TOKEN_BUCKETS } = require('./genai-metrics');
const { emitOperationDetails } = require('./genai-events');
const { inheritedAttributes } = require('./genai-context');
const { buildUrl, buildHeaders } = require('./api-client');

const tracer = trace.getTracer('rag-api.llm', '0.1.0');
const meter = metrics.getMeter('rag-api.llm', '0.1.0');

// gen_ai.client.token.usage histogram -- records input and output token counts
// per the gen_ai semconv metrics spec.
const tokenUsageHistogram = meter.createHistogram('gen_ai.client.token.usage', {
  description: 'Measures number of input and output tokens used',
  unit: '{token}',
  // The conventions specify these boundaries. The OTel defaults are tuned
  // for millisecond latencies and bucket nearly every token count
  // together, which flattens the percentiles Splunk's AI overview charts.
  advice: { explicitBucketBoundaries: TOKEN_BUCKETS },
});

// Counter companion -- simpler metric type that works reliably with
// data() in SignalFlow and any backend. Records the same token values.
const tokenCounter = meter.createCounter('gen_ai.client.token.count', {
  description: 'Total number of tokens consumed (counter)',
  unit: '{token}',
});

// Response length histogram -- tracks character count of LLM responses.
// Sudden changes in response length distribution can signal model drift
// or prompt regression. Used by Splunk detectors for anomaly alerting.
const responseLengthHistogram = meter.createHistogram('gen_ai.client.response.length', {
  description: 'Character length of LLM responses',
  unit: '{character}',
});

/**
 * Send a chat completion request to the LLM.
 *
 * @param {{ role: string, content: string }[]} messages  Chat messages array.
 * @returns {Promise<{ content: string, promptTokens: number, completionTokens: number }>}
 */
async function chatCompletion(messages, owner) {
  const baseUrl = process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || '';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const provider = process.env.LLM_PROVIDER || 'openai';

  const temperature = 0.3;
  const parsedUrl = new URL(baseUrl);

  // Span name per gen_ai semconv: "{operation} {model}"
  const spanName = `chat ${model}`;

  const startMs = Date.now();
  return tracer.startActiveSpan(spanName, { kind: SpanKind.CLIENT }, async (span) => {
    span.setAttributes({
      'gen_ai.operation.name': 'chat',
      'gen_ai.system': provider,
      'gen_ai.provider.name': provider,
      'gen_ai.request.model': model,
      'gen_ai.request.temperature': temperature,
      'gen_ai.request.message_count': messages.length,
      'gen_ai.request.input_count': messages.length,
      'server.address': parsedUrl.hostname,
      'server.port': parseInt(parsedUrl.port, 10) || (parsedUrl.protocol === 'https:' ? 443 : 80),
    ...inheritedAttributes(owner),
      // Which agent and workflow this call belongs to. Splunk aggregates
      // its agent screens on these, not on span nesting.
      ...inheritedAttributes(owner),
      // Prompt content, only when explicitly enabled. Off by default.
      ...contentAttributes({ messages }),
    });

    try {
      const url = buildUrl(baseUrl, 'chat/completions');
      const headers = buildHeaders(baseUrl, apiKey);
      const body = JSON.stringify({
        model,
        messages,
        temperature,
      });

      logger.debug('Calling LLM API', { url, model, messageCount: messages.length });

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`LLM API returned ${res.status}: ${errBody}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const content = choice?.message?.content || '';

      const promptTokens = data.usage?.prompt_tokens ?? 0;
      const completionTokens = data.usage?.completion_tokens ?? 0;

      // Response attributes per gen_ai semconv
      const responseLength = content.length;
      span.setAttributes({
        'gen_ai.response.model': data.model || model,
        'gen_ai.response.id': data.id || '',
        'gen_ai.usage.input_tokens': promptTokens,
        'gen_ai.usage.output_tokens': completionTokens,
        'gen_ai.usage.total_tokens': promptTokens + completionTokens,
        // OpenAI-style aliases for Splunk MetricSet compatibility
        'gen_ai.usage.prompt_tokens': promptTokens,
        'gen_ai.usage.completion_tokens': completionTokens,
        'gen_ai.response.length': responseLength,
      });

      // gen_ai.response.finish_reasons is an ARRAY per the spec, and the
      // spec-compliant array is kept. But array-valued span attributes do
      // not survive every backend: the azure_monitor exporter maps
      // attributes to customDimensions only when they are strings or
      // booleans, so an array is DROPPED SILENTLY. Measured: 254 chat spans
      // reached Application Insights, zero carrying finish_reasons, while
      // the collector's own debug output showed
      // `gen_ai.response.finish_reasons: Slice(["stop"])` arriving fine.
      //
      // So we also emit a scalar companion. Same belt-and-braces reasoning
      // as the gen_ai.usage.prompt_tokens aliases above: keep the standard
      // attribute, add the shape backends can actually store.
      const finishReasons = data.choices
        ? data.choices.map((c) => c.finish_reason || 'unknown')
        : ['unknown'];
      span.setAttribute('gen_ai.response.finish_reasons', finishReasons);
      span.setAttribute('gen_ai.response.finish_reason', finishReasons.join(','));

      // Response content, only when explicitly enabled. Off by default.
      span.setAttributes(contentAttributes({ output: content }));

      span.setStatus({ code: 1 });

      // Record token usage as OTel metrics
      const metricAttrs = {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': provider,
        'gen_ai.request.model': model,
        'gen_ai.response.model': data.model || model,
      };
      tokenUsageHistogram.record(promptTokens, {
        ...metricAttrs,
        'gen_ai.token.type': 'input',
      });
      tokenCounter.add(promptTokens, {
        ...metricAttrs,
        'gen_ai.token.type': 'input',
      });
      tokenUsageHistogram.record(completionTokens, {
        ...metricAttrs,
        'gen_ai.token.type': 'output',
      });
      tokenCounter.add(completionTokens, {
        ...metricAttrs,
        'gen_ai.token.type': 'output',
      });
      responseLengthHistogram.record(responseLength, metricAttrs);

      logger.info('LLM completion received', {
        model: data.model || model,
        promptTokens,
        completionTokens,
        finishReason: choice?.finish_reason,
        responseId: data.id,
      });

      // The event Splunk's AI screens actually read. No-op unless content
      // capture is set to an event mode. See genai-events.js.
      emitOperationDetails({
        messages,
        output: content,
        operationName: 'chat',
        provider,
        requestModel: model,
        responseModel: data.model || model,
        responseId: data.id,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        framework: 'in-house',
        agentName: owner && owner.agentName,
      });

      recordOperationDuration({
        startMs,
        operationName: 'chat',
        provider,
        requestModel: model,
        responseModel: data.model || model,
        serverAddress: parsedUrl.hostname,
        serverPort: parseInt(parsedUrl.port, 10)
          || (parsedUrl.protocol === 'https:' ? 443 : 80),
      });

      return { content, promptTokens, completionTokens };
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.setAttribute('error.type', err.name || 'Error');
      span.recordException(err);
      logger.error('LLM API call failed', { error: err.message });
      recordOperationDuration({
        startMs,
        operationName: 'chat',
        provider,
        requestModel: model,
        serverAddress: parsedUrl.hostname,
        errorType: errorType(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Send a streaming chat completion request to the LLM.
 *
 * Returns an object with:
 *   - stream: the raw Response body (ReadableStream) from the LLM
 *   - span: the active OTel span (caller must end it after consuming)
 *   - model: the requested model name
 *   - provider: the provider name
 *
 * The caller iterates SSE lines from the stream, forwarding token deltas
 * to the client.  Token usage is available in the final chunk when
 * `stream_options.include_usage` is set (OpenAI-compatible APIs).
 *
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<{ stream: ReadableStream, span: object, model: string, provider: string }>}
 */
async function chatCompletionStream(messages, owner) {
  const baseUrl = process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || '';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const provider = process.env.LLM_PROVIDER || 'openai';

  const temperature = 0.3;
  const parsedUrl = new URL(baseUrl);
  // Handed back to the caller so the duration metric can be recorded once
  // the stream is fully consumed, which is the real end of the operation.
  const startMs = Date.now();

  const spanName = `chat ${model}`;

  // Start span but do NOT end it -- the caller ends it after the stream is consumed.
  const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
  span.setAttributes({
    'gen_ai.operation.name': 'chat',
    'gen_ai.system': provider,
    'gen_ai.provider.name': provider,
    'gen_ai.request.model': model,
    'gen_ai.request.temperature': temperature,
    'gen_ai.request.message_count': messages.length,
    'gen_ai.request.input_count': messages.length,
    // Prompt content, only when explicitly enabled. Off by default.
    ...contentAttributes({ messages }),
    'gen_ai.request.stream': true,
    'server.address': parsedUrl.hostname,
    'server.port': parseInt(parsedUrl.port, 10) || (parsedUrl.protocol === 'https:' ? 443 : 80),
  });

  const url = buildUrl(baseUrl, 'chat/completions');
  const headers = buildHeaders(baseUrl, apiKey);
  const body = JSON.stringify({
    model,
    messages,
    temperature,
    stream: true,
    stream_options: { include_usage: true },
  });

  logger.debug('Calling LLM API (streaming)', { url, model, messageCount: messages.length });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    const errBody = await res.text();
    const err = new Error(`LLM API returned ${res.status}: ${errBody}`);
    span.setStatus({ code: 2, message: err.message });
    span.setAttribute('error.type', 'Error');
    span.recordException(err);
    span.end();
    throw err;
  }

  return { stream: res.body, span, model, provider, startMs, serverAddress: parsedUrl.hostname };
}

/**
 * Record token usage metrics and span attributes after streaming completes.
 *
 * @param {object} span - The OTel span from chatCompletionStream
 * @param {object} opts
 * @param {string} opts.model - Requested model
 * @param {string} opts.provider - Provider name
 * @param {string} [opts.responseModel] - Model from response
 * @param {string} [opts.responseId] - Response ID
 * @param {number} opts.promptTokens
 * @param {number} opts.completionTokens
 * @param {string} [opts.finishReason]
 * @param {number} [opts.responseLength] - Character length of the full response
 * @param {string} [opts.content] - Full response text. Recorded as a span
 *   attribute ONLY when content capture is explicitly enabled; see
 *   src/genai-content.js. Pass it unconditionally -- the capture module
 *   decides whether it is used.
 * @param {number} [opts.startMs] - Operation start, from
 *   chatCompletionStream. Supplied, the gen_ai.client.operation.duration
 *   histogram is recorded here, which is the correct point: the operation
 *   ends when the stream is drained, not when the headers arrive.
 * @param {string} [opts.serverAddress]
 */
function recordStreamUsage(span, opts) {
  const responseLength = opts.responseLength || 0;
  span.setAttributes({
    'gen_ai.response.model': opts.responseModel || opts.model,
    'gen_ai.response.id': opts.responseId || '',
    'gen_ai.usage.input_tokens': opts.promptTokens,
    'gen_ai.usage.output_tokens': opts.completionTokens,
    'gen_ai.usage.total_tokens': opts.promptTokens + opts.completionTokens,
    // OpenAI-style aliases for Splunk MetricSet compatibility
    'gen_ai.usage.prompt_tokens': opts.promptTokens,
    'gen_ai.usage.completion_tokens': opts.completionTokens,
    // Array per spec, plus a scalar companion because array attributes are
    // dropped by some exporters. See the long note on the non-streaming
    // path above.
    'gen_ai.response.finish_reasons': [opts.finishReason || 'stop'],
    'gen_ai.response.finish_reason': opts.finishReason || 'stop',
    'gen_ai.response.length': responseLength,
    // Response content, only when explicitly enabled. The prompt was
    // captured at span creation, where `messages` was in scope.
    ...contentAttributes({ output: opts.content }),
  });
  span.setStatus({ code: 1 });

  const metricAttrs = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': opts.provider,
    'gen_ai.request.model': opts.model,
    'gen_ai.response.model': opts.responseModel || opts.model,
  };
  tokenUsageHistogram.record(opts.promptTokens, {
    ...metricAttrs,
    'gen_ai.token.type': 'input',
  });
  tokenCounter.add(opts.promptTokens, {
    ...metricAttrs,
    'gen_ai.token.type': 'input',
  });
  tokenUsageHistogram.record(opts.completionTokens, {
    ...metricAttrs,
    'gen_ai.token.type': 'output',
  });
  tokenCounter.add(opts.completionTokens, {
    ...metricAttrs,
    'gen_ai.token.type': 'output',
  });
  responseLengthHistogram.record(responseLength, metricAttrs);

  emitOperationDetails({
    messages: opts.messages,
    output: opts.content,
    operationName: 'chat',
    provider: opts.provider,
    requestModel: opts.model,
    responseModel: opts.responseModel || opts.model,
    responseId: opts.responseId,
    inputTokens: opts.promptTokens,
    outputTokens: opts.completionTokens,
    framework: 'in-house',
    agentName: opts.agentName,
  });

  if (opts.startMs) {
    recordOperationDuration({
      startMs: opts.startMs,
      operationName: 'chat',
      provider: opts.provider,
      requestModel: opts.model,
      responseModel: opts.responseModel || opts.model,
      serverAddress: opts.serverAddress,
    });
  }

  logger.info('LLM streaming completion finished', {
    model: opts.responseModel || opts.model,
    promptTokens: opts.promptTokens,
    completionTokens: opts.completionTokens,
    finishReason: opts.finishReason,
    responseId: opts.responseId,
  });
}

module.exports = { chatCompletion, chatCompletionStream, recordStreamUsage };
