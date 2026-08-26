'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Set up a mock LoggerProvider BEFORE importing the app.
// ---------------------------------------------------------------------------

const { logs } = require('@opentelemetry/api-logs');

const emittedRecords = [];

const mockLogger = {
  emit(record) {
    emittedRecords.push(record);
  },
};

const mockProvider = {
  getLogger(_name, _version) {
    return mockLogger;
  },
};

logs.setGlobalLoggerProvider(mockProvider);

// Suppress stdout writes from the logger during tests.
const originalWrite = process.stdout.write;

// ---------------------------------------------------------------------------
// Import the Express app.
// We need to require index.js but prevent it from calling app.listen().
// The simplest approach: require express, build a test server manually.
// Instead, let's just test via a raw HTTP request to the running app.
// ---------------------------------------------------------------------------

// We'll create a minimal Express app that mirrors index.js's middleware stack
// to test the error handler in isolation.
const express = require('express');
const logger = require('../logger');

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.post('/api/chat', (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      logger.warn('Invalid chat request', { reason: 'missing or non-string message' });
      return res.status(400).json({ error: 'message is required and must be a string' });
    }
    res.json({ reply: `echo: ${message}` });
  });

  // Error-handling middleware (same as index.js)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed' && err.status === 400) {
      logger.warn('Invalid JSON in request body', {
        method: req.method,
        path: req.originalUrl,
      });
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }

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

  return app;
}

// ---------------------------------------------------------------------------
// Helper: make an HTTP request to the test server.
// ---------------------------------------------------------------------------
function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });

    req.on('error', reject);
    if (body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('error-handling middleware', () => {
  let server;

  beforeEach((_, done) => {
    emittedRecords.length = 0;
    process.stdout.write = () => true; // suppress logger stdout
    const app = createTestApp();
    server = app.listen(0, '127.0.0.1', done);
  });

  afterEach((_, done) => {
    process.stdout.write = originalWrite;
    server.close(done);
  });

  it('returns JSON 400 for malformed JSON body (not HTML stack trace)', async () => {
    const res = await request(server, 'POST', '/api/chat', '{bad json}');

    assert.equal(res.status, 400);

    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'Invalid JSON in request body');

    // Must NOT contain HTML
    assert.ok(!res.body.includes('<!DOCTYPE'), 'Response must not contain HTML');
    assert.ok(!res.body.includes('<pre>'), 'Response must not contain stack trace HTML');
  });

  it('logs a warning for malformed JSON', async () => {
    await request(server, 'POST', '/api/chat', '{bad json}');

    const warnRecord = emittedRecords.find(
      (r) => r.severityText === 'WARN' && r.body === 'Invalid JSON in request body'
    );
    assert.ok(warnRecord, 'Expected a WARN log record for invalid JSON');
    assert.equal(warnRecord.attributes.method, 'POST');
    assert.equal(warnRecord.attributes.path, '/api/chat');
  });

  it('returns JSON 400 for valid chat request with missing message', async () => {
    const res = await request(server, 'POST', '/api/chat', {});

    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'message is required and must be a string');
  });

  it('returns JSON 200 for valid chat request', async () => {
    const res = await request(server, 'POST', '/api/chat', { message: 'hello' });

    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.reply, 'echo: hello');
  });
});
