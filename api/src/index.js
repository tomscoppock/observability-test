'use strict';

const express = require('express');
const cors = require('cors');
const { trace } = require('@opentelemetry/api');
const logger = require('./logger');
const uploadRouter = require('./routes/upload');
const chatRouter = require('./routes/chat');
const scrapeRouter = require('./routes/scrape');

const tracer = trace.getTracer('rag-api.test', '0.1.0');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Health check -- used by Docker healthcheck and Nginx upstream probes. */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// File upload (multipart/form-data) -- chunking, embedding, storage
app.use(uploadRouter);

// RAG chat -- embed query, vector search, LLM completion
app.use(chatRouter);

// Web scrape -- fetch page via Playwright MCP, chunk, embed, store
app.use(scrapeRouter);

/**
 * Test error endpoint -- generates a deliberate exception wrapped in an
 * OTel span so you can verify errors appear in Splunk APM.
 * Only available in non-production environments.
 */
app.post('/api/test-error', (req, res) => {
  return tracer.startActiveSpan('test.error', (span) => {
    const message = (req.body && req.body.message) || 'Deliberate test error';
    const err = new Error(message);

    span.setAttributes({
      'test.error': true,
      'test.message': message,
    });
    span.setStatus({ code: 2, message: err.message });
    span.recordException(err);
    span.end();

    logger.error('Test error triggered', { error: err.message, stack: err.stack });

    return res.status(500).json({ error: message, otel: 'Error span recorded' });
  });
});

// ---------------------------------------------------------------------------
// Error-handling middleware (must be registered AFTER all routes)
// ---------------------------------------------------------------------------

/**
 * Catch JSON parse errors from body-parser and other unhandled errors.
 * Returns a JSON response instead of Express's default HTML stack trace.
 */
// eslint-disable-next-line no-unused-vars -- Express requires 4 args for error middleware
app.use((err, req, res, _next) => {
  // body-parser SyntaxError on malformed JSON
  if (err.type === 'entity.parse.failed' && err.status === 400) {
    logger.warn('Invalid JSON in request body', {
      method: req.method,
      path: req.originalUrl,
    });
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  // Multer file size limit
  if (err.code === 'LIMIT_FILE_SIZE') {
    logger.warn('File too large', { method: req.method, path: req.originalUrl });
    return res.status(413).json({ error: 'File too large. Maximum size is 5 MB.' });
  }

  // All other unhandled errors
  logger.error('Unhandled error', {
    method: req.method,
    path: req.originalUrl,
    message: err.message,
  });

  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({
    error: 'Internal server error',
    ...(isDev && { detail: err.message }),
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Listening on port', { port: PORT });
});
