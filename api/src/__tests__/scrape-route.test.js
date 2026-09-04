'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Mock setup -- suppress OTel log output during tests.
// ---------------------------------------------------------------------------

const { logs } = require('@opentelemetry/api-logs');

const mockLogger = {
  emit() {},
};

const mockProvider = {
  getLogger() {
    return mockLogger;
  },
};

logs.setGlobalLoggerProvider(mockProvider);

const originalWrite = process.stdout.write;

// ---------------------------------------------------------------------------
// Build a minimal Express app that includes the scrape route.
// We don't actually call the MCP server -- we test input validation only.
// ---------------------------------------------------------------------------

const express = require('express');

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mount the scrape route
  const scrapeRouter = require('../routes/scrape');
  app.use(scrapeRouter);

  // Error handler (mirrors index.js)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed' && err.status === 400) {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    res.status(err.status || 500).json({ error: 'Internal server error' });
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
        resolve({ status: res.statusCode, body: data });
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
// Tests -- input validation (no MCP server needed)
// ---------------------------------------------------------------------------

describe('POST /api/scrape -- input validation', () => {
  let server;

  beforeEach((_, done) => {
    process.stdout.write = () => true;
    const app = createTestApp();
    server = app.listen(0, '127.0.0.1', done);
  });

  afterEach((_, done) => {
    process.stdout.write = originalWrite;
    server.close(done);
  });

  it('returns 400 when url is missing', async () => {
    const res = await request(server, 'POST', '/api/scrape', {});
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.error.includes('url is required'));
  });

  it('returns 400 when url is not a string', async () => {
    const res = await request(server, 'POST', '/api/scrape', { url: 123 });
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.error.includes('url is required'));
  });

  it('returns 400 for invalid URL format', async () => {
    const res = await request(server, 'POST', '/api/scrape', { url: 'not-a-url' });
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.error.includes('Invalid URL'));
  });

  it('returns 400 for non-http protocol', async () => {
    const res = await request(server, 'POST', '/api/scrape', { url: 'ftp://example.com/file' });
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.error.includes('http and https'));
  });

  it('returns 400 for malformed JSON body', async () => {
    const res = await request(server, 'POST', '/api/scrape', '{bad json}');
    assert.equal(res.status, 400);
  });

  it('returns 503 when MCP server is not configured', async () => {
    // With a valid URL but no MCP server running, we expect a 503
    // because MCP_PLAYWRIGHT_URL is empty (not configured).
    const res = await request(server, 'POST', '/api/scrape', { url: 'https://example.com' });

    // Should be 503 (MCP not configured) or 500 (connection error)
    assert.ok(
      res.status === 503 || res.status === 500,
      `Expected 503 or 500, got ${res.status}`,
    );
    const parsed = JSON.parse(res.body);
    assert.ok(
      parsed.error.includes('MCP') || parsed.error.includes('configured') || parsed.error.includes('Scrape failed'),
      `Unexpected error: ${parsed.error}`,
    );
  });
});
