'use strict';

/**
 * Embedding API client.
 *
 * Calls an OpenAI-compatible embeddings endpoint to generate vector
 * representations of text.  Each call is wrapped in an OTel span with
 * gen_ai.* attributes for observability.
 *
 * Configuration (env vars):
 *   EMBEDDING_API_BASE_URL  -- e.g. https://api.openai.com/v1
 *   EMBEDDING_API_KEY       -- API key (Bearer token)
 *   EMBEDDING_MODEL         -- e.g. text-embedding-3-small
 */

const { trace } = require('@opentelemetry/api');
const logger = require('./logger');

const tracer = trace.getTracer('rag-api.embeddings', '0.1.0');

/**
 * Generate embeddings for an array of texts.
 *
 * @param {string[]} texts  Array of text strings to embed.
 * @returns {Promise<number[][]>}  Array of embedding vectors.
 */
async function embedTexts(texts) {
  return tracer.startActiveSpan('embeddings.embedTexts', async (span) => {
    const baseUrl = process.env.EMBEDDING_API_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = process.env.EMBEDDING_API_KEY || '';
    const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

    span.setAttributes({
      'gen_ai.system': 'openai',
      'gen_ai.request.model': model,
      'gen_ai.operation.name': 'embeddings',
      'gen_ai.request.input_count': texts.length,
    });

    try {
      const url = `${baseUrl}/embeddings`;
      const body = JSON.stringify({
        model,
        input: texts,
      });

      logger.debug('Calling embedding API', {
        url,
        model,
        inputCount: texts.length,
        totalChars: texts.reduce((sum, t) => sum + t.length, 0),
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
        },
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
      if (data.usage) {
        span.setAttributes({
          'gen_ai.usage.prompt_tokens': data.usage.prompt_tokens,
          'gen_ai.usage.total_tokens': data.usage.total_tokens,
        });
      }

      span.setAttribute('gen_ai.response.dimensions', embeddings[0]?.length ?? 0);
      span.setStatus({ code: 1 });

      logger.info('Embeddings generated', {
        model,
        inputCount: texts.length,
        dimensions: embeddings[0]?.length ?? 0,
        promptTokens: data.usage?.prompt_tokens,
      });

      return embeddings;
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      logger.error('Embedding API call failed', { error: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

module.exports = { embedTexts };
