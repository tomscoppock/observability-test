'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Mock setup -- must happen before requiring the module under test.
// ---------------------------------------------------------------------------

// We need to mock @modelcontextprotocol/sdk and @opentelemetry/api.
// Since Node.js test runner doesn't have built-in module mocking for CJS,
// we test the exported functions' behaviour by manipulating env vars and
// verifying error paths.  The happy-path integration is tested via the
// scrape route tests.

describe('mcp-client', () => {
  const originalUrl = process.env.MCP_PLAYWRIGHT_URL;
  const originalKey = process.env.MCP_PLAYWRIGHT_API_KEY;

  beforeEach(() => {
    // Clear env so each test starts clean
    delete process.env.MCP_PLAYWRIGHT_URL;
    delete process.env.MCP_PLAYWRIGHT_API_KEY;
  });

  afterEach(() => {
    // Restore original env
    if (originalUrl !== undefined) {
      process.env.MCP_PLAYWRIGHT_URL = originalUrl;
    } else {
      delete process.env.MCP_PLAYWRIGHT_URL;
    }
    if (originalKey !== undefined) {
      process.env.MCP_PLAYWRIGHT_API_KEY = originalKey;
    } else {
      delete process.env.MCP_PLAYWRIGHT_API_KEY;
    }
  });

  describe('module exports', () => {
    it('exports createClient, callTool, scrapeUrl, and _isRetryableConnectionError', () => {
      // The module reads env at require-time, so we need to set env first
      // for the require to not fail.  But the functions themselves check
      // at call-time, so we can still test them.
      const mcpClient = require('../mcp-client');
      assert.equal(typeof mcpClient.createClient, 'function');
      assert.equal(typeof mcpClient.callTool, 'function');
      assert.equal(typeof mcpClient.scrapeUrl, 'function');
      assert.equal(typeof mcpClient._isRetryableConnectionError, 'function');
    });
  });

  describe('_isRetryableConnectionError', () => {
    it('returns true for fetch failed errors', () => {
      const mcpClient = require('../mcp-client');
      const err = new Error('fetch failed');
      assert.equal(mcpClient._isRetryableConnectionError(err), true);
    });

    it('returns true for ECONNREFUSED errors', () => {
      const mcpClient = require('../mcp-client');
      const err = new Error('connect ECONNREFUSED 127.0.0.1:8100');
      assert.equal(mcpClient._isRetryableConnectionError(err), true);
    });

    it('returns true for ECONNRESET errors', () => {
      const mcpClient = require('../mcp-client');
      const err = new Error('read ECONNRESET');
      assert.equal(mcpClient._isRetryableConnectionError(err), true);
    });

    it('returns true for ETIMEDOUT errors', () => {
      const mcpClient = require('../mcp-client');
      const err = new Error('connect ETIMEDOUT');
      assert.equal(mcpClient._isRetryableConnectionError(err), true);
    });

    it('returns true for socket hang up errors', () => {
      const mcpClient = require('../mcp-client');
      const err = new Error('socket hang up');
      assert.equal(mcpClient._isRetryableConnectionError(err), true);
    });

    it('returns true for UND_ERR_CONNECT_TIMEOUT errors', () => {
      const mcpClient = require('../mcp-client');
      const err = new Error('UND_ERR_CONNECT_TIMEOUT');
      assert.equal(mcpClient._isRetryableConnectionError(err), true);
    });

    it('returns true when retryable pattern is in err.cause', () => {
      const mcpClient = require('../mcp-client');
      const err = new Error('request failed');
      err.cause = new Error('fetch failed');
      assert.equal(mcpClient._isRetryableConnectionError(err), true);
    });

    it('returns false for non-retryable errors', () => {
      const mcpClient = require('../mcp-client');
      const err = new Error('Invalid API key');
      assert.equal(mcpClient._isRetryableConnectionError(err), false);
    });

    it('returns false for 404 errors', () => {
      const mcpClient = require('../mcp-client');
      const err = new Error('HTTP 404 Not Found');
      assert.equal(mcpClient._isRetryableConnectionError(err), false);
    });
  });

  describe('createClient', () => {
    it('throws when MCP_PLAYWRIGHT_URL is not set', async () => {
      // Force a fresh require with empty env
      // Since the module caches the env value at require-time, and we
      // already required it above, the cached value may be empty string.
      const mcpClient = require('../mcp-client');

      await assert.rejects(
        () => mcpClient.createClient(),
        { message: 'MCP_PLAYWRIGHT_URL is not configured' },
      );
    });
  });

  describe('scrapeUrl', () => {
    it('throws when MCP_PLAYWRIGHT_URL is not set', async () => {
      const mcpClient = require('../mcp-client');

      await assert.rejects(
        () => mcpClient.scrapeUrl('https://example.com'),
        (err) => {
          // The error could come from createClient or from the span wrapper
          assert.ok(err.message.includes('MCP_PLAYWRIGHT_URL') ||
                    err.message.includes('not configured'),
                    `Unexpected error: ${err.message}`);
          return true;
        },
      );
    });
  });

  describe('callTool', () => {
    it('extracts text content from MCP tool result', async () => {
      const mcpClient = require('../mcp-client');

      // Create a mock client object
      const mockClient = {
        callTool: async () => ({
          content: [
            { type: 'text', text: '{"session_id": "abc123"}' },
          ],
        }),
      };

      const result = await mcpClient.callTool(mockClient, 'session_create');
      assert.deepEqual(result, { session_id: 'abc123' });
    });

    it('returns raw text when JSON parse fails', async () => {
      const mcpClient = require('../mcp-client');

      const mockClient = {
        callTool: async () => ({
          content: [
            { type: 'text', text: 'plain text result' },
          ],
        }),
      };

      const result = await mcpClient.callTool(mockClient, 'browser_get_text');
      assert.equal(result, 'plain text result');
    });

    it('throws when MCP tool returns isError', async () => {
      const mcpClient = require('../mcp-client');

      const mockClient = {
        callTool: async () => ({
          isError: true,
          content: [
            { type: 'text', text: 'Pydantic validation error: missing field' },
          ],
        }),
      };

      await assert.rejects(
        () => mcpClient.callTool(mockClient, 'browser_navigate'),
        (err) => {
          assert.ok(err.message.includes('MCP tool browser_navigate failed'));
          assert.ok(err.message.includes('Pydantic validation error'));
          return true;
        },
      );
    });

    it('returns full result when no text content found', async () => {
      const mcpClient = require('../mcp-client');

      const mockResult = { content: [{ type: 'image', data: 'base64...' }] };
      const mockClient = {
        callTool: async () => mockResult,
      };

      const result = await mcpClient.callTool(mockClient, 'browser_take_screenshot');
      assert.deepEqual(result, mockResult);
    });

    it('returns full result when content is not an array', async () => {
      const mcpClient = require('../mcp-client');

      const mockResult = { data: 'something' };
      const mockClient = {
        callTool: async () => mockResult,
      };

      const result = await mcpClient.callTool(mockClient, 'some_tool');
      assert.deepEqual(result, mockResult);
    });
  });
});
