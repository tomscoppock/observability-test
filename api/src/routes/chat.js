'use strict';

/**
 * RAG chat route.
 *
 * POST /api/chat -- accepts { message: string }, embeds the query,
 * retrieves relevant chunks via vector search, constructs a prompt
 * with context, and calls the LLM.  Returns the answer with source
 * citations.  Every step is wrapped in an OTel span.
 */

const { Router } = require('express');
const { trace } = require('@opentelemetry/api');
const { embedTexts } = require('../embeddings');
const { chatCompletion } = require('../llm');
const db = require('../db');
const logger = require('../logger');

const router = Router();
const tracer = trace.getTracer('rag-api.chat', '0.1.0');

const TOP_K = 5;

const SYSTEM_PROMPT = `You are an HR Policy Assistant. Answer questions about company policies using ONLY the context provided below. If the context does not contain enough information to answer the question, say so clearly. Always cite which policy document your answer comes from.

Context:
{context}`;

router.post('/api/chat', async (req, res) => {
  return tracer.startActiveSpan('chat.pipeline', async (span) => {
    try {
      const { message } = req.body;

      if (!message || typeof message !== 'string') {
        span.setStatus({ code: 2, message: 'Invalid input' });
        span.end();
        logger.warn('Invalid chat request', { reason: 'missing or non-string message' });
        return res.status(400).json({ error: 'message is required and must be a string' });
      }

      span.setAttribute('chat.query_length', message.length);
      logger.info('Chat request received', { messageLength: message.length });

      // Check if any documents have been uploaded
      const docsExist = await db.hasDocuments();
      if (!docsExist) {
        span.setAttribute('chat.no_documents', true);
        span.setStatus({ code: 1 });
        span.end();
        return res.json({
          reply: 'No documents have been uploaded yet. Please upload some HR policy files first by dragging them into the chat area.',
          sources: [],
        });
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
          // Fetch document metadata for the citation
          const doc = await db.getDocumentById(chunk.document);
          sourceMap.set(docId, doc);
        }
        const doc = sourceMap.get(docId);
        const docTitle = doc?.title || 'Unknown';
        contextParts.push(`[Source: ${docTitle}]\n${chunk.text}`);
      }

      const context = contextParts.join('\n\n---\n\n');

      // Step 3: LLM completion
      const systemMessage = SYSTEM_PROMPT.replace('{context}', context);
      const messages = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: message },
      ];

      const completion = await chatCompletion(messages);

      // Build source citations
      const sources = chunks.map((chunk) => {
        const doc = sourceMap.get(String(chunk.document));
        return {
          documentId: String(chunk.document),
          title: doc?.title || 'Unknown',
          chunkIndex: chunk.chunk_index,
          score: chunk.score,
        };
      });

      span.setAttributes({
        'chat.prompt_tokens': completion.promptTokens,
        'chat.completion_tokens': completion.completionTokens,
        'chat.source_count': sources.length,
      });
      span.setStatus({ code: 1 });
      span.end();

      return res.json({
        reply: completion.content,
        sources,
      });
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();

      logger.error('Chat failed', { error: err.message });

      if (err.message.includes('Embedding API')) {
        return res.status(503).json({ error: 'Embedding service unavailable' });
      }
      if (err.message.includes('LLM API')) {
        return res.status(503).json({ error: 'LLM service unavailable' });
      }
      if (err.message.includes('SurrealDB') || err.message.includes('connection')) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      return res.status(500).json({ error: 'Chat failed' });
    }
  });
});

module.exports = router;
