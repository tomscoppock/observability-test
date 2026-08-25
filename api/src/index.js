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
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Listening on port', { port: PORT });
});
