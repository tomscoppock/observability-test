'use strict';

/**
 * MCP client wrapper for the Playwright MCP server.
 *
 * Connects to a remote Playwright MCP server via Streamable HTTP transport,
 * provides helper methods for browser automation (navigate, extract text,
 * manage sessions), and handles connection lifecycle.
 *
 * W3C trace context (traceparent/tracestate) is propagated automatically
 * by the Node.js OTel auto-instrumentation -- the MCP SDK uses fetch()
 * internally, which is instrumented by @opentelemetry/instrumentation-http.
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { trace } = require('@opentelemetry/api');
const logger = require('./logger');

const tracer = trace.getTracer('rag-api.mcp-client', '0.1.0');

const MCP_PLAYWRIGHT_URL = process.env.MCP_PLAYWRIGHT_URL || '';
const MCP_PLAYWRIGHT_API_KEY = process.env.MCP_PLAYWRIGHT_API_KEY || '';

/**
 * Create a connected MCP client to the Playwright server.
 *
 * @returns {Promise<import('@modelcontextprotocol/sdk/client/index.js').Client>}
 */
async function createClient() {
  if (!MCP_PLAYWRIGHT_URL) {
    throw new Error('MCP_PLAYWRIGHT_URL is not configured');
  }

  const client = new Client({
    name: 'rag-api-mcp-client',
    version: '0.1.0',
  });

  const headers = { 'Content-Type': 'application/json' };
  if (MCP_PLAYWRIGHT_API_KEY) {
    headers['x-api-key'] = MCP_PLAYWRIGHT_API_KEY;
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_PLAYWRIGHT_URL),
    { requestInit: { headers } },
  );

  await client.connect(transport);
  logger.debug('MCP client connected', { url: MCP_PLAYWRIGHT_URL });
  return client;
}

/**
 * Call an MCP tool on the connected client.
 *
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {Promise<unknown>}
 */
async function callTool(client, toolName, args = {}) {
  const result = await client.callTool({ name: toolName, arguments: args });

  // MCP tool results have a content array; extract the first text content
  if (result && result.content && Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === 'text') {
        try {
          return JSON.parse(item.text);
        } catch {
          return item.text;
        }
      }
    }
  }
  return result;
}

/**
 * Scrape a URL using the Playwright MCP server.
 *
 * Creates a browser session, navigates to the URL, extracts visible text,
 * and closes the session. Returns the extracted text content.
 *
 * @param {string} url - The URL to scrape
 * @param {object} [options]
 * @param {number} [options.maxLength=100000] - Max text length to return
 * @returns {Promise<{ text: string, title: string }>}
 */
async function scrapeUrl(url, options = {}) {
  const maxLength = options.maxLength || 100000;

  return tracer.startActiveSpan('mcp.scrape', async (span) => {
    span.setAttributes({
      'mcp.server.url': MCP_PLAYWRIGHT_URL,
      'scrape.target_url': url,
    });

    let client;
    let sessionId;

    try {
      // Connect to MCP server
      client = await createClient();

      // Create a browser session
      const sessionResult = await callTool(client, 'session_create');
      sessionId = sessionResult.session_id;
      span.setAttribute('mcp.session_id', sessionId);
      logger.debug('Browser session created', { sessionId });

      // Navigate to the URL
      const navResult = await callTool(client, 'browser_navigate', {
        session_id: sessionId,
        url,
      });
      logger.debug('Navigation complete', { url, status: navResult.status });

      // Extract visible text content
      const textResult = await callTool(client, 'browser_get_text', {
        session_id: sessionId,
        selector: 'body',
        max_length: maxLength,
      });

      // Get the page title via evaluate
      let title = url;
      try {
        const titleResult = await callTool(client, 'browser_evaluate', {
          session_id: sessionId,
          function: 'document.title',
        });
        if (typeof titleResult === 'string' && titleResult.length > 0) {
          title = titleResult;
        } else if (titleResult && titleResult.result) {
          title = String(titleResult.result);
        }
      } catch {
        // Title extraction is best-effort; fall back to URL
        logger.debug('Could not extract page title, using URL', { url });
      }

      const text = typeof textResult === 'string'
        ? textResult
        : (textResult && textResult.text) || '';

      span.setAttributes({
        'scrape.text_length': text.length,
        'scrape.title': title,
      });
      span.setStatus({ code: 1 });
      span.end();

      return { text, title };
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      span.end();
      throw err;
    } finally {
      // Always close the session
      if (client && sessionId) {
        try {
          await callTool(client, 'session_close', { session_id: sessionId });
          logger.debug('Browser session closed', { sessionId });
        } catch (closeErr) {
          logger.warn('Failed to close browser session', {
            sessionId,
            error: closeErr.message,
          });
        }
      }
      // Close the MCP client connection
      if (client) {
        try {
          await client.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  });
}

module.exports = { createClient, callTool, scrapeUrl };
