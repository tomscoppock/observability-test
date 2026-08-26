'use strict';

const express = require('express');
const cors = require('cors');
const logger = require('./logger');

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

/**
 * Stub chat endpoint.
 * Accepts { message: string } and returns a placeholder response.
 * The real RAG implementation comes in task 016.
 */
app.post('/api/chat', (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    logger.warn('Invalid chat request', { reason: 'missing or non-string message' });
    return res.status(400).json({ error: 'message is required and must be a string' });
  }

  logger.info('Chat request received', { messageLength: message.length });

  // Stub response -- will be replaced by LLM call in Epic 004.
  res.json({
    reply: `[stub] You said: "${message}". LLM integration coming in Epic 004.`,
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
