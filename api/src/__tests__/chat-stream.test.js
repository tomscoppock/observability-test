'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');

// ---------------------------------------------------------------------------
// Mock OTel before any app imports
// ---------------------------------------------------------------------------

const { logs } = require('@opentelemetry/api-logs');

const mockOtelLogger = { emit() {} };
const mockLogProvider = { getLogger() { return mockOtelLogger; } };
logs.setGlobalLoggerProvider(mockLogProvider);

// Note: we do NOT suppress stdout in this test file because the Node.js
// test runner uses stdout for TAP output.  Suppressing it hides test results.

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

// Mock db module
const db = require('../db');
mock.method(db, 'hasDocuments', async () => true);
mock.method(db, 'vectorSearch', async () => [
  { document: 'doc:1', text: 'Policy text chunk 1', chunk_index: 0, score: 0.95 },
  { document: 'doc:1', text: 'Policy text chunk 2', chunk_index: 1, score: 0.90 },
]);
mock.method(db, 'getDocumentById', async () => ({
  id: 'doc:1',
  title: 'Test Policy',
  source_type: 'upload',
}));

// Mock embeddings module
const embeddings = require('../embeddings');
mock.method(embeddings, 'embedTexts', async () => [[0.1, 0.2, 0.3]]);

// Build a fake SSE stream that mimics OpenAI streaming response
function createFakeLLMStream(chunks, usage) {
  const lines = [];
  for (const chunk of chunks) {
    const data = {
      id: 'chatcmpl-test123',
      model: 'gpt-4o-mini',
      choices: [{ delta: { content: chunk }, index: 0, finish_reason: null }],
    };
    lines.push(`data: ${JSON.stringify(data)}\n\n`);
  }
  // Final chunk with finish_reason
  lines.push(`data: ${JSON.stringify({
    id: 'chatcmpl-test123',
    model: 'gpt-4o-mini',
    choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
    usage: usage || { prompt_tokens: 100, completion_tokens: 20 },
  })}\n\n`);
  lines.push('data: [DONE]\n\n');

  return Readable.from(lines.map((l) => Buffer.from(l)));
}

// Mock llm module
const llm = require('../llm');

const noopSpan = {
  setAttributes() {},
  setAttribute() {},
  setStatus() {},
  recordException() {},
  end() {},
};

mock.method(llm, 'chatCompletionStream', async () => ({
  stream: createFakeLLMStream(['Hello', ', ', 'world', '!'], { prompt_tokens: 50, completion_tokens: 4 }),
  span: Object.create(noopSpan),
  model: 'gpt-4o-mini',
  provider: 'openai',
}));

mock.method(llm, 'recordStreamUsage', () => {});

// Keep chatCompletion for the non-streaming endpoint
mock.method(llm, 'chatCompletion', async () => ({
  content: 'Hello, world!',
  promptTokens: 50,
  completionTokens: 4,
}));

// ---------------------------------------------------------------------------
// Import the chat router and build a test app
// ---------------------------------------------------------------------------

const express = require('express');

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mount the real chat router
  const chatRouter = require('../routes/chat');
  app.use(chatRouter);

  return app;
}

// ---------------------------------------------------------------------------
// Helper: make an HTTP request and collect the full response
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
// Helper: parse SSE events from raw response body
// ---------------------------------------------------------------------------

function parseSSEEvents(raw) {
  const events = [];
  const blocks = raw.split('\n\n');
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    let eventType = '';
    let eventData = '';

    const lines = trimmed.split('\n');
    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.slice(7);
      else if (line.startsWith('data: ')) eventData = line.slice(6);
    }

    if (eventType && eventData) {
      try {
        events.push({ event: eventType, data: JSON.parse(eventData) });
      } catch (_e) {
        events.push({ event: eventType, data: eventData });
      }
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/chat/stream (SSE)', () => {
  let server;

  beforeEach(async () => {
    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('returns Content-Type text/event-stream', async () => {
    const res = await request(server, 'POST', '/api/chat/stream', { message: 'hello' });
    assert.equal(res.status, 200);
    assert.ok(
      res.headers['content-type'].includes('text/event-stream'),
      'Expected text/event-stream content type, got: ' + res.headers['content-type']
    );
  });

  it('streams token events with content', async () => {
    const res = await request(server, 'POST', '/api/chat/stream', { message: 'hello' });
    const events = parseSSEEvents(res.body);

    const tokenEvents = events.filter((e) => e.event === 'token');
    assert.ok(tokenEvents.length > 0, 'Expected at least one token event');

    // Verify each token event has content
    for (const te of tokenEvents) {
      assert.ok(te.data.content !== undefined, 'Token event should have content');
    }
  });

  it('sends sources event after tokens', async () => {
    const res = await request(server, 'POST', '/api/chat/stream', { message: 'hello' });
    const events = parseSSEEvents(res.body);

    const sourcesEvents = events.filter((e) => e.event === 'sources');
    assert.equal(sourcesEvents.length, 1, 'Expected exactly one sources event');
    assert.ok(Array.isArray(sourcesEvents[0].data), 'Sources should be an array');
    assert.ok(sourcesEvents[0].data.length > 0, 'Sources should not be empty');
    assert.equal(sourcesEvents[0].data[0].title, 'Test Policy');
  });

  it('sends usage event with token counts', async () => {
    const res = await request(server, 'POST', '/api/chat/stream', { message: 'hello' });
    const events = parseSSEEvents(res.body);

    const usageEvents = events.filter((e) => e.event === 'usage');
    assert.equal(usageEvents.length, 1, 'Expected exactly one usage event');
    assert.equal(typeof usageEvents[0].data.promptTokens, 'number');
    assert.equal(typeof usageEvents[0].data.completionTokens, 'number');
  });

  it('sends done event at the end', async () => {
    const res = await request(server, 'POST', '/api/chat/stream', { message: 'hello' });
    const events = parseSSEEvents(res.body);

    const doneEvents = events.filter((e) => e.event === 'done');
    assert.equal(doneEvents.length, 1, 'Expected exactly one done event');
  });

  it('returns 400 for missing message', async () => {
    const res = await request(server, 'POST', '/api/chat/stream', {});
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'message is required and must be a string');
  });

  it('returns no-documents message when no docs exist', async () => {
    // Temporarily override hasDocuments to return false
    db.hasDocuments.mock.mockImplementation(async () => false);

    const res = await request(server, 'POST', '/api/chat/stream', { message: 'hello' });
    const events = parseSSEEvents(res.body);

    const tokenEvents = events.filter((e) => e.event === 'token');
    assert.ok(tokenEvents.length > 0, 'Expected at least one token event');
    assert.ok(
      tokenEvents[0].data.content.includes('No documents'),
      'Expected no-documents message'
    );

    // Restore
    db.hasDocuments.mock.mockImplementation(async () => true);
  });

  it('event order is: token(s), sources, usage, done', async () => {
    const res = await request(server, 'POST', '/api/chat/stream', { message: 'hello' });
    const events = parseSSEEvents(res.body);

    const types = events.map((e) => e.event);
    const sourcesIdx = types.indexOf('sources');
    const usageIdx = types.indexOf('usage');
    const doneIdx = types.indexOf('done');
    const lastTokenIdx = types.lastIndexOf('token');

    assert.ok(lastTokenIdx < sourcesIdx, 'All tokens should come before sources');
    assert.ok(sourcesIdx < usageIdx, 'Sources should come before usage');
    assert.ok(usageIdx < doneIdx, 'Usage should come before done');
  });
});

describe('POST /api/chat (non-streaming, backward compat)', () => {
  let server;

  beforeEach(async () => {
    const app = createTestApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('returns JSON response with reply and sources', async () => {
    const res = await request(server, 'POST', '/api/chat', { message: 'hello' });
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('application/json'));

    const parsed = JSON.parse(res.body);
    assert.equal(parsed.reply, 'Hello, world!');
    assert.ok(Array.isArray(parsed.sources));
  });
});
