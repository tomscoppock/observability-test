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

// Retry configuration for transient connection failures (e.g. server restart)
const MCP_CONNECT_RETRIES = parseInt(process.env.MCP_CONNECT_RETRIES, 10) || 3;
const MCP_CONNECT_RETRY_DELAY_MS = parseInt(process.env.MCP_CONNECT_RETRY_DELAY_MS, 10) || 1000;

/**
 * Patterns that indicate a transient connection error worth retrying.
 * These occur when the MCP server is restarting or temporarily unreachable.
 */
const RETRYABLE_PATTERNS = [
  'fetch failed',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'socket hang up',
];

/**
 * Check whether an error is a transient connection failure that should be retried.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryableConnectionError(err) {
  const msg = (err.message || '') + (err.cause ? ` ${err.cause.message || ''}` : '');
  return RETRYABLE_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Sleep for the given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a connected MCP client to the Playwright server.
 *
 * Retries transient connection failures (fetch failed, ECONNREFUSED, etc.)
 * with exponential backoff so that server restarts don't cause permanent
 * scrape failures. Configure via MCP_CONNECT_RETRIES (default 3) and
 * MCP_CONNECT_RETRY_DELAY_MS (default 1000).
 *
 * @returns {Promise<import('@modelcontextprotocol/sdk/client/index.js').Client>}
 */
async function createClient() {
  if (!MCP_PLAYWRIGHT_URL) {
    throw new Error('MCP_PLAYWRIGHT_URL is not configured');
  }

  // Warn about common misconfiguration: localhost doesn't work from inside Docker
  if (MCP_PLAYWRIGHT_URL.includes('localhost') || MCP_PLAYWRIGHT_URL.includes('127.0.0.1')) {
    logger.warn('MCP_PLAYWRIGHT_URL uses localhost -- this will not work from inside Docker. Use host.docker.internal instead.', {
      url: MCP_PLAYWRIGHT_URL,
    });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (MCP_PLAYWRIGHT_API_KEY) {
    headers['x-api-key'] = MCP_PLAYWRIGHT_API_KEY;
  }

  let lastError;

  for (let attempt = 0; attempt <= MCP_CONNECT_RETRIES; attempt++) {
    // Each attempt needs a fresh Client + Transport (they are single-use)
    const client = new Client({
      name: 'rag-api-mcp-client',
      version: '0.1.0',
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(MCP_PLAYWRIGHT_URL),
      { requestInit: { headers } },
    );

    try {
      await client.connect(transport);
      if (attempt > 0) {
        logger.info('MCP client connected after retry', {
          url: MCP_PLAYWRIGHT_URL,
          attempt: attempt + 1,
        });
      } else {
        logger.debug('MCP client connected', { url: MCP_PLAYWRIGHT_URL });
      }
      return client;
    } catch (err) {
      lastError = err;

      if (isRetryableConnectionError(err) && attempt < MCP_CONNECT_RETRIES) {
        const delayMs = MCP_CONNECT_RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn('MCP connection failed, retrying', {
          url: MCP_PLAYWRIGHT_URL,
          attempt: attempt + 1,
          maxRetries: MCP_CONNECT_RETRIES,
          nextRetryMs: delayMs,
          error: err.message,
        });
        await sleep(delayMs);
        continue;
      }

      // Non-retryable or exhausted retries -- throw with helpful message
      const msg = err.message || '';
      if (isRetryableConnectionError(err)) {
        const hint = MCP_PLAYWRIGHT_URL.includes('localhost')
          ? ' (hint: use host.docker.internal instead of localhost when running in Docker)'
          : '';
        throw new Error(
          `Cannot connect to Playwright MCP server at ${MCP_PLAYWRIGHT_URL} after ${attempt + 1} attempt(s)${hint}: ${msg}`,
        );
      }
      throw err;
    }
  }

  // Should not reach here, but just in case
  throw lastError;
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

  // MCP tool results have an isError flag when the tool execution fails
  if (result && result.isError) {
    const errText = result.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join(' ') || 'Unknown tool error';
    throw new Error(`MCP tool ${toolName} failed: ${errText}`);
  }

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
      // Note: Python MCP SDK (FastMCP) wraps tool args in { input: { ... } }
      const navResult = await callTool(client, 'browser_navigate', {
        input: { session_id: sessionId, url },
      });
      logger.debug('Navigation complete', { url, status: navResult.status });

      // Extract visible text content
      const textResult = await callTool(client, 'browser_get_text', {
        input: { session_id: sessionId, selector: 'body', max_length: maxLength },
      });

      // Get the page title via evaluate
      let title = url;
      try {
        const titleResult = await callTool(client, 'browser_evaluate', {
          input: { session_id: sessionId, function: 'document.title' },
        });
        if (typeof titleResult === 'string' && titleResult.length > 0) {
          title = titleResult;
        } else if (titleResult && titleResult.result) {
          title = String(titleResult.result);
        }
      } catch (evalErr) {
        // Title extraction is best-effort; fall back to URL
        logger.debug('Could not extract page title, using URL', { url, error: evalErr.message });
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
          await callTool(client, 'session_close', { input: { session_id: sessionId } });
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

module.exports = {
  createClient,
  callTool,
  scrapeUrl,
  // Exported for testing only
  _isRetryableConnectionError: isRetryableConnectionError,
};
