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
 *   gen_ai.response.finish_reasons, gen_ai.usage.input_tokens,
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
const { buildUrl, buildHeaders } = require('./api-client');

const tracer = trace.getTracer('rag-api.llm', '0.1.0');
const meter = metrics.getMeter('rag-api.llm', '0.1.0');

// gen_ai.client.token.usage histogram -- records input and output token counts
// per the gen_ai semconv metrics spec.
const tokenUsageHistogram = meter.createHistogram('gen_ai.client.token.usage', {
  description: 'Measures number of input and output tokens used',
  unit: '{token}',
});

/**
 * Send a chat completion request to the LLM.
 *
 * @param {{ role: string, content: string }[]} messages  Chat messages array.
 * @returns {Promise<{ content: string, promptTokens: number, completionTokens: number }>}
 */
async function chatCompletion(messages) {
  const baseUrl = process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || '';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const provider = process.env.LLM_PROVIDER || 'openai';

  const temperature = 0.3;
  const parsedUrl = new URL(baseUrl);

  // Span name per gen_ai semconv: "{operation} {model}"
  const spanName = `chat ${model}`;

  return tracer.startActiveSpan(spanName, { kind: SpanKind.CLIENT }, async (span) => {
    span.setAttributes({
      'gen_ai.operation.name': 'chat',
      'gen_ai.system': provider,
      'gen_ai.provider.name': provider,
      'gen_ai.request.model': model,
      'gen_ai.request.temperature': temperature,
      'gen_ai.request.message_count': messages.length,
      'server.address': parsedUrl.hostname,
      'server.port': parseInt(parsedUrl.port, 10) || (parsedUrl.protocol === 'https:' ? 443 : 80),
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
      span.setAttributes({
        'gen_ai.response.model': data.model || model,
        'gen_ai.response.id': data.id || '',
        'gen_ai.usage.input_tokens': promptTokens,
        'gen_ai.usage.output_tokens': completionTokens,
      });

      // gen_ai.response.finish_reasons is an array per the spec
      const finishReasons = data.choices
        ? data.choices.map((c) => c.finish_reason || 'unknown')
        : ['unknown'];
      span.setAttribute('gen_ai.response.finish_reasons', finishReasons);

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
      tokenUsageHistogram.record(completionTokens, {
        ...metricAttrs,
        'gen_ai.token.type': 'output',
      });

      logger.info('LLM completion received', {
        model: data.model || model,
        promptTokens,
        completionTokens,
        finishReason: choice?.finish_reason,
        responseId: data.id,
      });

      return { content, promptTokens, completionTokens };
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.setAttribute('error.type', err.name || 'Error');
      span.recordException(err);
      logger.error('LLM API call failed', { error: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

module.exports = { chatCompletion };
