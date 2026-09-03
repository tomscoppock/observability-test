'use strict';

/**
 * LLM completions API client.
 *
 * Calls an OpenAI-compatible or Azure OpenAI chat completions endpoint.
 * Each call is wrapped in an OTel span with gen_ai.* attributes for
 * observability.
 *
 * Configuration (env vars):
 *   LLM_API_BASE_URL   -- e.g. https://api.openai.com/v1
 *                         or https://{resource}.openai.azure.com/openai/deployments/{deployment}
 *   LLM_API_KEY        -- API key (Bearer token or Azure api-key)
 *   LLM_MODEL          -- e.g. gpt-4o-mini
 *   AZURE_API_VERSION   -- Azure OpenAI API version (default: 2024-10-21)
 */

const { trace } = require('@opentelemetry/api');
const logger = require('./logger');
const { buildUrl, buildHeaders } = require('./api-client');

const tracer = trace.getTracer('rag-api.llm', '0.1.0');

/**
 * Send a chat completion request to the LLM.
 *
 * @param {{ role: string, content: string }[]} messages  Chat messages array.
 * @returns {Promise<{ content: string, promptTokens: number, completionTokens: number }>}
 */
async function chatCompletion(messages) {
  return tracer.startActiveSpan('llm.chatCompletion', async (span) => {
    const baseUrl = process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = process.env.LLM_API_KEY || '';
    const model = process.env.LLM_MODEL || 'gpt-4o-mini';
    const provider = process.env.LLM_PROVIDER || 'openai';

    const temperature = 0.3;
    const parsedUrl = new URL(baseUrl);

    span.setAttributes({
      'gen_ai.system': provider,
      'gen_ai.request.model': model,
      'gen_ai.operation.name': 'chat',
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

      span.setAttributes({
        'gen_ai.response.model': data.model || model,
        'gen_ai.usage.input_tokens': promptTokens,
        'gen_ai.usage.output_tokens': completionTokens,
        'gen_ai.response.finish_reason': choice?.finish_reason || 'unknown',
      });
      span.setStatus({ code: 1 });

      logger.info('LLM completion received', {
        model: data.model || model,
        promptTokens,
        completionTokens,
        finishReason: choice?.finish_reason,
      });

      return { content, promptTokens, completionTokens };
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      logger.error('LLM API call failed', { error: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

module.exports = { chatCompletion };
