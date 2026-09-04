'use strict';

/**
 * Web scrape route.
 *
 * POST /api/scrape -- accepts { url: string }, uses the Playwright MCP
 * server to fetch and render the page, extracts visible text, chunks it,
 * generates embeddings, and stores everything in SurrealDB.
 *
 * Reuses the existing chunker, embeddings, and db modules from the
 * file upload pipeline.  Every step is wrapped in an OTel span.
 */

const { Router } = require('express');
const { trace } = require('@opentelemetry/api');
const { scrapeUrl } = require('../mcp-client');
const { chunkText } = require('../chunker');
const { embedTexts } = require('../embeddings');
const db = require('../db');
const logger = require('../logger');

const router = Router();
const tracer = trace.getTracer('rag-api.scrape', '0.1.0');

// Maximum text length from scraped pages (100 KB)
const MAX_SCRAPE_TEXT_LENGTH = 100000;

router.post('/api/scrape', async (req, res) => {
  return tracer.startActiveSpan('scrape.pipeline', async (span) => {
    try {
      const { url } = req.body;

      if (!url || typeof url !== 'string') {
        span.setStatus({ code: 2, message: 'Invalid input' });
        span.end();
        logger.warn('Invalid scrape request', { reason: 'missing or non-string url' });
        return res.status(400).json({ error: 'url is required and must be a string' });
      }

      // Basic URL validation
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        span.setStatus({ code: 2, message: 'Invalid URL' });
        span.end();
        return res.status(400).json({ error: 'Invalid URL format' });
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        span.setStatus({ code: 2, message: 'Unsupported protocol' });
        span.end();
        return res.status(400).json({ error: 'Only http and https URLs are supported' });
      }

      span.setAttribute('scrape.url', url);
      logger.info('Scrape request received', { url });

      // Step 1: Scrape the page via Playwright MCP
      const { text, title } = await scrapeUrl(url, {
        maxLength: MAX_SCRAPE_TEXT_LENGTH,
      });

      if (!text || text.trim().length === 0) {
        span.setAttribute('scrape.empty_content', true);
        span.setStatus({ code: 2, message: 'No text content' });
        span.end();
        return res.status(400).json({
          error: 'The page has no visible text content',
        });
      }

      span.setAttribute('scrape.text_length', text.length);

      // Step 2: Chunk the text
      const chunks = await tracer.startActiveSpan('scrape.chunk', async (chunkSpan) => {
        chunkSpan.setAttributes({
          'scrape.url': url,
          'scrape.content_length': text.length,
        });
        const result = chunkText(text);
        chunkSpan.setAttribute('scrape.chunk_count', result.length);
        chunkSpan.setStatus({ code: 1 });
        chunkSpan.end();
        return result;
      });

      logger.info('Page text chunked', {
        url,
        contentLength: text.length,
        chunkCount: chunks.length,
      });

      // Step 3: Embed
      const chunkTexts = chunks.map((c) => c.text);
      const embeddings = await embedTexts(chunkTexts);

      // Step 4: Store in SurrealDB
      const doc = await db.insertDocument({
        title,
        filename: url,
        source_type: 'scrape',
        content_length: text.length,
        chunk_count: chunks.length,
      });

      const chunksWithEmbeddings = chunks.map((c, i) => ({
        text: c.text,
        embedding: embeddings[i],
        chunkIndex: c.chunkIndex,
      }));

      await db.insertChunks(doc.id, chunksWithEmbeddings);

      logger.info('Scraped document stored', {
        documentId: String(doc.id),
        title,
        url,
        chunkCount: chunks.length,
      });

      span.setAttributes({
        'scrape.document_id': String(doc.id),
        'scrape.chunk_count': chunks.length,
      });
      span.setStatus({ code: 1 });
      span.end();

      return res.json({
        id: String(doc.id),
        title,
        url,
        chunkCount: chunks.length,
        contentLength: text.length,
      });
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();

      logger.error('Scrape failed', { error: err.message, stack: err.stack });

      const msg = err.message || '';
      if (msg.includes('MCP_PLAYWRIGHT_URL')) {
        return res.status(503).json({ error: 'Playwright MCP service not configured: ' + msg });
      }
      if (msg.includes('MCP') || msg.includes('connect') || msg.includes('ECONNREFUSED')) {
        return res.status(503).json({ error: 'Playwright MCP service unavailable: ' + msg });
      }
      if (msg.includes('Embedding API')) {
        return res.status(503).json({ error: 'Embedding service unavailable: ' + msg });
      }
      if (
        msg.includes('SurrealDB') || msg.includes('connection') ||
        msg.includes('not allowed') || msg.includes('permission') ||
        msg.includes('Anonymous') || msg.includes('not authenticated')
      ) {
        return res.status(503).json({ error: 'Database service unavailable: ' + msg });
      }
      return res.status(500).json({ error: 'Scrape failed: ' + msg });
    }
  });
});

module.exports = router;
