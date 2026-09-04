'use strict';

/**
 * RAG chat route.
 *
 * POST /api/chat        -- JSON request/response (original, kept for compat)
 * POST /api/chat/stream -- SSE streaming response (tokens arrive incrementally)
 *
 * Both endpoints accept { message: string }, embed the query, retrieve
 * relevant chunks via vector search, construct a prompt with context,
 * and call the LLM.  Every step is wrapped in an OTel span.
 */

const { Router } = require('express');
const { trace } = require('@opentelemetry/api');
const { embedTexts } = require('../embeddings');
const { chatCompletion, chatCompletionStream, recordStreamUsage } = require('../llm');
const db = require('../db');
const logger = require('../logger');

const router = Router();
const tracer = trace.getTracer('rag-api.chat', '0.1.0');

const TOP_K = 5;
const MAX_HISTORY_ROUNDS = parseInt(process.env.CHAT_HISTORY_ROUNDS, 10) || 0;

const SYSTEM_PROMPT = `You are an HR Policy Assistant. Answer questions about company policies using ONLY the context provided below. If the context does not contain enough information to answer the question, say so clearly. Always cite which policy document your answer comes from.

Context:
{context}`;

const NO_DOCS_REPLY = 'No documents have been uploaded yet. Please upload some HR policy files first by dragging them into the chat area.';

/**
 * Shared RAG pipeline: validate input, embed query, vector search, build
 * context and messages array.  Returns null and sends an HTTP response if
 * the request should short-circuit (invalid input, no documents).
 *
 * @returns {{ messages: object[], sources: object[], span: object } | null}
 */
async function ragPipeline(req, res, span) {
  const { message, history } = req.body;

  if (!message || typeof message !== 'string') {
    span.setStatus({ code: 2, message: 'Invalid input' });
    span.end();
    logger.warn('Invalid chat request', { reason: 'missing or non-string message' });
    res.status(400).json({ error: 'message is required and must be a string' });
    return null;
  }

  span.setAttribute('chat.query_length', message.length);
  logger.info('Chat request received', { messageLength: message.length });

  const docsExist = await db.hasDocuments();
  if (!docsExist) {
    span.setAttribute('chat.no_documents', true);
    return { noDocuments: true, message };
  }

  // Step 1: Embed the query
  const [queryEmbedding] = await embedTexts([message]);

  // Step 2: Vector search
  const chunks = await db.vectorSearch(queryEmbedding, TOP_K);
  span.setAttribute('chat.chunks_retrieved', chunks.length);

  // Build context from retrieved chunks
  const contextParts = [];
  const sourceMap = new Map();

  for (const chunk of chunks) {
    const docId = String(chunk.document);
    if (!sourceMap.has(docId)) {
      const doc = await db.getDocumentById(chunk.document);
      sourceMap.set(docId, doc);
    }
    const doc = sourceMap.get(docId);
    const docTitle = doc?.title || 'Unknown';
    contextParts.push(`[Source: ${docTitle}]\n${chunk.text}`);
  }

  const context = contextParts.join('\n\n---\n\n');
  const systemMessage = SYSTEM_PROMPT.replace('{context}', context);

  // Build messages array: system + conversation history + current user message
  const messages = [{ role: 'system', content: systemMessage }];

  // Insert conversation history (capped to MAX_HISTORY_ROUNDS pairs)
  if (MAX_HISTORY_ROUNDS > 0 && Array.isArray(history) && history.length > 0) {
    // Each "round" is a user+assistant pair (2 messages)
    const maxMessages = MAX_HISTORY_ROUNDS * 2;
    const trimmed = history.slice(-maxMessages);
    // Only allow user/assistant roles in history (sanitise)
    for (const entry of trimmed) {
      if (entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string') {
        messages.push({ role: entry.role, content: entry.content });
      }
    }
    span.setAttribute('chat.history_messages', trimmed.length);
  }

  messages.push({ role: 'user', content: message });

  const sources = chunks.map((chunk) => {
    const doc = sourceMap.get(String(chunk.document));
    return {
      documentId: String(chunk.document),
      title: doc?.title || 'Unknown',
      chunkIndex: chunk.chunk_index,
      score: chunk.score,
    };
  });

  return { messages, sources, message };
}

/**
 * Map an error to the appropriate HTTP status code.
 */
function chatErrorStatus(msg) {
  if (msg.includes('Embedding API')) return 503;
  if (msg.includes('LLM API')) return 503;
  if (
    msg.includes('SurrealDB') || msg.includes('connection') ||
    msg.includes('not allowed') || msg.includes('permission') ||
    msg.includes('Anonymous') || msg.includes('not authenticated')
  ) return 503;
  return 500;
}

// ---------------------------------------------------------------------------
// POST /api/chat -- JSON request/response (original)
// ---------------------------------------------------------------------------

router.post('/api/chat', async (req, res) => {
  return tracer.startActiveSpan('chat.pipeline', async (span) => {
    try {
      const result = await ragPipeline(req, res, span);
      if (!result) return; // response already sent (validation error)

      if (result.noDocuments) {
        span.setStatus({ code: 1 });
        span.end();
        return res.json({ reply: NO_DOCS_REPLY, sources: [] });
      }

      const completion = await chatCompletion(result.messages);

      span.setAttributes({
        'chat.prompt_tokens': completion.promptTokens,
        'chat.completion_tokens': completion.completionTokens,
        'chat.source_count': result.sources.length,
      });
      span.setStatus({ code: 1 });
      span.end();

      return res.json({
        reply: completion.content,
        sources: result.sources,
      });
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();

      logger.error('Chat failed', { error: err.message, stack: err.stack });

      const msg = err.message || '';
      const status = chatErrorStatus(msg);
      const label = status === 503 ? msg.split(' ')[0] + ' service unavailable: ' : 'Chat failed: ';
      return res.status(status).json({ error: label + msg });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat/stream -- SSE streaming response
// ---------------------------------------------------------------------------

router.post('/api/chat/stream', async (req, res) => {
  return tracer.startActiveSpan('chat.pipeline.stream', async (pipelineSpan) => {
    // Validate input BEFORE setting SSE headers so we can still send
    // a normal JSON 400 response for bad requests.
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      pipelineSpan.setStatus({ code: 2, message: 'Invalid input' });
      pipelineSpan.end();
      logger.warn('Invalid chat request', { reason: 'missing or non-string message' });
      return res.status(400).json({ error: 'message is required and must be a string' });
    }

    // SSE headers -- from here on, the response is a stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx hint
    res.flushHeaders();

    /** Write one SSE event. */
    function sendEvent(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    let llmSpan = null;

    try {
      const result = await ragPipeline(req, res, pipelineSpan);
      if (!result) return; // response already sent (validation error -- should not happen here)

      if (result.noDocuments) {
        sendEvent('token', { content: NO_DOCS_REPLY });
        sendEvent('sources', []);
        sendEvent('done', {});
        pipelineSpan.setStatus({ code: 1 });
        pipelineSpan.end();
        return res.end();
      }

      // Start streaming LLM call
      const { stream, span: lSpan, model, provider } = await chatCompletionStream(result.messages);
      llmSpan = lSpan;

      pipelineSpan.setAttribute('chat.source_count', result.sources.length);

      // Parse SSE lines from the LLM response stream
      let fullContent = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let responseModel = model;
      let responseId = '';
      let finishReason = 'stop';

      const decoder = new TextDecoder();
      let buffer = '';

      for await (const chunk of stream) {
        buffer += decoder.decode(chunk, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const payload = trimmed.slice(6);
          if (payload === '[DONE]') continue;

          let parsed;
          try {
            parsed = JSON.parse(payload);
          } catch (_e) {
            continue; // skip malformed lines
          }

          // Extract token delta
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            sendEvent('token', { content: delta.content });
          }

          // Extract finish reason
          if (parsed.choices?.[0]?.finish_reason) {
            finishReason = parsed.choices[0].finish_reason;
          }

          // Extract usage (sent in the final chunk with include_usage)
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens || 0;
            completionTokens = parsed.usage.completion_tokens || 0;
          }

          // Extract response metadata
          if (parsed.model) responseModel = parsed.model;
          if (parsed.id) responseId = parsed.id;
        }
      }

      // Flush any remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ') && trimmed.slice(6) !== '[DONE]') {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              sendEvent('token', { content: delta.content });
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || 0;
              completionTokens = parsed.usage.completion_tokens || 0;
            }
          } catch (_e) {
            // ignore
          }
        }
      }

      // Send sources and usage
      sendEvent('sources', result.sources);
      sendEvent('usage', { promptTokens, completionTokens });
      sendEvent('done', {});

      // Record OTel metrics
      recordStreamUsage(llmSpan, {
        model,
        provider,
        responseModel,
        responseId,
        promptTokens,
        completionTokens,
        finishReason,
      });
      llmSpan.end();
      llmSpan = null;

      pipelineSpan.setAttributes({
        'chat.prompt_tokens': promptTokens,
        'chat.completion_tokens': completionTokens,
        'chat.source_count': result.sources.length,
        'chat.stream': true,
      });
      pipelineSpan.setStatus({ code: 1 });
      pipelineSpan.end();

      return res.end();
    } catch (err) {
      if (llmSpan) {
        llmSpan.setStatus({ code: 2, message: err.message });
        llmSpan.recordException(err);
        llmSpan.end();
      }
      pipelineSpan.setStatus({ code: 2, message: err.message });
      pipelineSpan.recordException(err);
      pipelineSpan.end();

      logger.error('Chat stream failed', { error: err.message, stack: err.stack });

      // If headers already sent, send error as SSE event
      if (res.headersSent) {
        sendEvent('error', { error: err.message });
        return res.end();
      }

      const msg = err.message || '';
      const status = chatErrorStatus(msg);
      return res.status(status).json({ error: 'Chat failed: ' + msg });
    }
  });
});

module.exports = router;
