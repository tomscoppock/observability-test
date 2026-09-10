'use strict';

/**
 * Embedding API client.
 *
 * Calls an OpenAI-compatible or Azure OpenAI embeddings endpoint to
 * generate vector representations of text.  Each call is wrapped in an
 * OTel span following the gen_ai semantic conventions
 * (https://github.com/open-telemetry/semantic-conventions-genai).
 *
 * Span name: `embeddings {model}` (per gen_ai semconv)
 * Span kind: CLIENT
 * Attributes: gen_ai.operation.name, gen_ai.provider.name,
 *   gen_ai.request.model, gen_ai.response.model,
 *   gen_ai.usage.input_tokens, server.address, server.port
 *
 * Token usage is also recorded as OTel histogram metrics:
 *   gen_ai.client.token.usage (input_tokens)
 *
 * Configuration (env vars):
 *   EMBEDDING_API_BASE_URL  -- e.g. https://api.openai.com/v1
 *                              or https://{resource}.openai.azure.com/openai/deployments/{deployment}
 *   EMBEDDING_API_KEY       -- API key (Bearer token or Azure api-key)
 *   EMBEDDING_MODEL         -- e.g. text-embedding-3-small
 *   EMBEDDING_DIMENSIONS    -- output dimensions (e.g. 1536, 3072); omit to use model default
 *   AZURE_API_VERSION       -- Azure OpenAI API version (default: 2024-10-21)
 */

const { trace, SpanKind, metrics } = require('@opentelemetry/api');
const logger = require('./logger');
const { buildUrl, buildHeaders } = require('./api-client');
const { recordOperationDuration, errorType, TOKEN_BUCKETS } = require('./genai-metrics');

const tracer = trace.getTracer('rag-api.embeddings', '0.1.0');
const meter = metrics.getMeter('rag-api.embeddings', '0.1.0');

// gen_ai.client.token.usage histogram -- records input token counts
// for embedding operations per the gen_ai semconv metrics spec.
const tokenUsageHistogram = meter.createHistogram('gen_ai.client.token.usage', {
  description: 'Measures number of input and output tokens used',
  unit: '{token}',
  // Conventional boundaries -- see the note in llm.js and genai-metrics.js.
  advice: { explicitBucketBoundaries: TOKEN_BUCKETS },
});

// Counter companion -- simpler metric type that works reliably with
// data() in SignalFlow and any backend. Records the same token values.
const tokenCounter = meter.createCounter('gen_ai.client.token.count', {
  description: 'Total number of tokens consumed (counter)',
  unit: '{token}',
});

/**
 * Generate embeddings for an array of texts.
 *
 * @param {string[]} texts  Array of text strings to embed.
 * @returns {Promise<number[][]>}  Array of embedding vectors.
 */
async function embedTexts(texts) {
  const baseUrl = process.env.EMBEDDING_API_BASE_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.EMBEDDING_API_KEY || '';
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const provider = process.env.LLM_PROVIDER || 'openai';
  const dimensions = process.env.EMBEDDING_DIMENSIONS
    ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
    : undefined;
  const parsedUrl = new URL(baseUrl);
  const startMs = Date.now();

  // Span name per gen_ai semconv: "{operation} {model}"
  const spanName = `embeddings ${model}`;

  return tracer.startActiveSpan(spanName, { kind: SpanKind.CLIENT }, async (span) => {
    span.setAttributes({
      'gen_ai.operation.name': 'embeddings',
      'gen_ai.system': provider,
      'gen_ai.provider.name': provider,
      'gen_ai.request.model': model,
      'gen_ai.request.input_count': texts.length,
      'server.address': parsedUrl.hostname,
      'server.port': parseInt(parsedUrl.port, 10) || (parsedUrl.protocol === 'https:' ? 443 : 80),
    });

    try {
      const url = buildUrl(baseUrl, 'embeddings');
      const headers = buildHeaders(baseUrl, apiKey);
      const requestBody = { model, input: texts };
      if (dimensions) requestBody.dimensions = dimensions;
      const body = JSON.stringify(requestBody);

      logger.debug('Calling embedding API', {
        url,
        model,
        inputCount: texts.length,
        totalChars: texts.reduce((sum, t) => sum + t.length, 0),
      });

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Embedding API returned ${res.status}: ${errBody}`);
      }

      const data = await res.json();

      // Extract embeddings in order
      const embeddings = data.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);

      // Record token usage if available
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      if (data.usage) {
        span.setAttributes({
          'gen_ai.usage.input_tokens': inputTokens,
          'gen_ai.usage.total_tokens': data.usage.total_tokens,
          // OpenAI-style aliases for Splunk MetricSet compatibility
          'gen_ai.usage.prompt_tokens': inputTokens,
        });
      }

      // Response attributes per gen_ai semconv
      span.setAttribute('gen_ai.response.model', data.model || model);
      span.setAttribute('gen_ai.response.dimensions', embeddings[0]?.length ?? 0);
      span.setStatus({ code: 1 });

      // Record token usage as OTel metrics
      if (inputTokens > 0) {
        const metricAttrs = {
          'gen_ai.operation.name': 'embeddings',
          'gen_ai.provider.name': provider,
          'gen_ai.request.model': model,
          'gen_ai.response.model': data.model || model,
          'gen_ai.token.type': 'input',
        };
        tokenUsageHistogram.record(inputTokens, metricAttrs);
        tokenCounter.add(inputTokens, metricAttrs);
      }

      logger.info('Embeddings generated', {
        model: data.model || model,
        inputCount: texts.length,
        dimensions: embeddings[0]?.length ?? 0,
        promptTokens: inputTokens,
      });

      recordOperationDuration({
        startMs,
        operationName: 'embeddings',
        provider,
        requestModel: model,
        responseModel: data.model || model,
        serverAddress: parsedUrl.hostname,
        serverPort: parseInt(parsedUrl.port, 10)
          || (parsedUrl.protocol === 'https:' ? 443 : 80),
      });

      return embeddings;
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.setAttribute('error.type', err.name || 'Error');
      span.recordException(err);
      logger.error('Embedding API call failed', { error: err.message });
      recordOperationDuration({
        startMs,
        operationName: 'embeddings',
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

module.exports = { embedTexts };
