'use strict';

/**
 * SurrealDB client module (SDK v2).
 *
 * Provides a singleton WebSocket connection to SurrealDB with lazy
 * initialisation.  On first connect the schema from db/schema.surql is
 * applied (idempotent IF NOT EXISTS statements).
 *
 * SDK v2 API:
 *   - Surreal is a named export (not default)
 *   - connect() requires ws:// (WebSocket), not http://
 *   - CRUD goes through a session: surreal.newSession()
 *   - session.query() is the most reliable method (returns [[rows]])
 *
 * All public functions are wrapped in OTel spans so every DB operation
 * appears in Splunk APM traces.
 */

const fs = require('node:fs');
const path = require('node:path');
const { trace } = require('@opentelemetry/api');
const logger = require('./logger');

const tracer = trace.getTracer('rag-api.db', '0.1.0');

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

/** @type {object | null} Surreal instance */
let _surreal = null;
/** @type {object | null} SurrealSession (has query/create/select) */
let _session = null;
let _ready = false;

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Force-reset the singleton so the next connect() creates a fresh session.
 * Called automatically when a query fails with an auth/connection error.
 */
function _invalidate() {
  logger.warn('Invalidating stale SurrealDB session');
  _surreal = null;
  _session = null;
  _ready = false;
}

/**
 * Returns true if the error looks like a stale/expired session that a
 * reconnect would fix (e.g. after machine sleep).
 */
function _isRetryableError(err) {
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('not allowed') ||
    msg.includes('not authenticated') ||
    msg.includes('anonymous') ||
    msg.includes('permission') ||
    msg.includes('connection') ||
    msg.includes('closed') ||
    msg.includes('socket')
  );
}

/**
 * Connect to SurrealDB (singleton).  On first call the schema is applied.
 * Subsequent calls return the cached session.  If the session is stale
 * (e.g. after machine sleep), it is automatically re-established.
 *
 * @returns {Promise<object>} The SurrealDB session with query/create/select.
 */
async function connect() {
  if (_session && _ready) return _session;

  return tracer.startActiveSpan('db.connect', async (span) => {
    try {
      // Dynamic import -- surrealdb is ESM-only in v2 (named export)
      const { Surreal } = await import('surrealdb');

      // Convert http:// to ws:// for WebSocket connection (SDK v2 requirement)
      const rawUrl = process.env.SURREAL_URL || 'http://surrealdb:8000';
      const url = rawUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
      const user = process.env.SURREAL_USER || 'root';
      const pass = process.env.SURREAL_PASS || 'root';
      const ns = process.env.SURREAL_NS || 'observability';
      const db = process.env.SURREAL_DB || 'rag';

      span.setAttributes({
        'db.system': 'surrealdb',
        'db.connection_string': url,
        'db.namespace': ns,
        'db.name': db,
      });

      _surreal = new Surreal();
      await _surreal.connect(url);

      // Create a session for CRUD operations
      _session = await _surreal.newSession();
      await _session.signin({ username: user, password: pass });
      await _session.use({ namespace: ns, database: db });

      logger.info('Connected to SurrealDB', { url, namespace: ns, database: db });

      await applySchema();
      _ready = true;

      span.setStatus({ code: 1 }); // OK
      return _session;
    } catch (err) {
      span.setStatus({ code: 2, message: err.message }); // ERROR
      span.recordException(err);
      logger.error('SurrealDB connection failed', { error: err.message });
      _surreal = null;
      _session = null;
      _ready = false;
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Apply the schema file to the database.  All statements use
 * IF NOT EXISTS so this is safe to run on every startup.
 */
async function applySchema() {
  return tracer.startActiveSpan('db.applySchema', async (span) => {
    try {
      // In Docker: /app/src -> /app/db/schema.surql (../db/schema.surql)
      // Locally:   api/src  -> db/schema.surql (../../db/schema.surql)
      let schemaPath = path.resolve(__dirname, '../db/schema.surql');
      if (!fs.existsSync(schemaPath)) {
        schemaPath = path.resolve(__dirname, '../../db/schema.surql');
      }
      let sql = fs.readFileSync(schemaPath, 'utf-8');

      // Replace the dimension placeholder with the configured value
      const dimensions = process.env.EMBEDDING_DIMENSIONS || '3072';
      sql = sql.replace(/__EMBEDDING_DIMENSIONS__/g, dimensions);
      span.setAttribute('db.embedding_dimensions', parseInt(dimensions, 10));

      await _session.query(sql);
      logger.info('SurrealDB schema applied', { embeddingDimensions: dimensions });
      span.setStatus({ code: 1 });
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      logger.error('Failed to apply SurrealDB schema', { error: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Retry wrapper -- reconnects on stale session errors
// ---------------------------------------------------------------------------

/**
 * Execute a function that uses the DB session.  If it fails with a
 * retryable error (auth/connection), invalidate the session and retry
 * once with a fresh connection.
 *
 * @param {function(session): Promise<T>} fn
 * @returns {Promise<T>}
 */
async function _withRetry(fn) {
  try {
    const session = await connect();
    return await fn(session);
  } catch (err) {
    if (_isRetryableError(err)) {
      logger.warn('Retrying after stale session', { error: err.message });
      _invalidate();
      const session = await connect();
      return await fn(session);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CRUD helpers -- all use session.query() for reliable serialization
// ---------------------------------------------------------------------------

/**
 * Insert a document record.
 *
 * @param {{ title: string, filename: string, source_type?: string, content_length: number, chunk_count: number }} doc
 * @returns {Promise<object>} The created record (with id).
 */
async function insertDocument(doc) {
  return tracer.startActiveSpan('db.insertDocument', async (span) => {
    try {
      const result = await _withRetry(async (session) => {
        const [rows] = await session.query(
          `CREATE documents SET
             title = $title,
             filename = $filename,
             source_type = $source_type,
             content_length = $content_length,
             chunk_count = $chunk_count,
             created_at = time::now()`,
          {
            title: doc.title,
            filename: doc.filename,
            source_type: doc.source_type || 'upload',
            content_length: doc.content_length,
            chunk_count: doc.chunk_count,
          }
        );
        return rows[0];
      });
      span.setAttribute('db.document.id', String(result.id));
      span.setStatus({ code: 1 });
      return result;
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Batch-insert chunk records linked to a document.
 *
 * @param {string|object} documentId  Record ID of the parent document.
 * @param {{ text: string, embedding: number[], chunkIndex: number }[]} chunks
 * @returns {Promise<object[]>} The created chunk records.
 */
async function insertChunks(documentId, chunks) {
  return tracer.startActiveSpan('db.insertChunks', async (span) => {
    try {
      span.setAttribute('db.chunk_count', chunks.length);

      const results = await _withRetry(async (session) => {
        const out = [];
        for (const chunk of chunks) {
          const [rows] = await session.query(
            `CREATE chunks SET
               document = $doc_id,
               text = $text,
               embedding = $embedding,
               chunk_index = $chunk_index,
               created_at = time::now()`,
            {
              doc_id: documentId,
              text: chunk.text,
              embedding: chunk.embedding,
              chunk_index: chunk.chunkIndex,
            }
          );
          out.push(rows[0]);
        }
        return out;
      });

      span.setStatus({ code: 1 });
      return results;
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Vector similarity search on the chunks table.
 *
 * Uses SurrealDB's vector search functions to find the top-K most
 * similar chunks to the query embedding.
 *
 * @param {number[]} queryEmbedding  The query vector.
 * @param {number} [topK=5]         Number of results to return.
 * @returns {Promise<object[]>}     Chunks with similarity scores.
 */
async function vectorSearch(queryEmbedding, topK = 5) {
  return tracer.startActiveSpan('db.vectorSearch', async (span) => {
    try {
      span.setAttributes({
        'db.vector.dimensions': queryEmbedding.length,
        'db.vector.top_k': topK,
      });

      // SurrealDB 3.x HNSW vector search.
      // Syntax: <|K, EF|> where EF is the search expansion factor
      // (higher = more accurate but slower; default 150 is a good balance).
      const ef = 150;
      const results = await _withRetry(async (session) => {
        const [rows] = await session.query(
          `SELECT *, vector::similarity::cosine(embedding, $query_vec) AS score
           FROM chunks
           WHERE embedding <|${topK},${ef}|> $query_vec
           ORDER BY score DESC`,
          { query_vec: queryEmbedding }
        );
        return rows;
      });

      span.setAttribute('db.results_count', results.length);
      span.setStatus({ code: 1 });
      return results;
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Fetch a document by its record ID.
 *
 * @param {string|object} id  SurrealDB record ID.
 * @returns {Promise<object|null>}
 */
async function getDocumentById(id) {
  return tracer.startActiveSpan('db.getDocumentById', async (span) => {
    try {
      const result = await _withRetry(async (session) => {
        const [rows] = await session.query(
          'SELECT * FROM $id',
          { id }
        );
        return rows[0] || null;
      });
      span.setStatus({ code: 1 });
      return result;
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Check if any documents exist in the database.
 *
 * @returns {Promise<boolean>}
 */
async function hasDocuments() {
  return tracer.startActiveSpan('db.hasDocuments', async (span) => {
    try {
      const total = await _withRetry(async (session) => {
        const [results] = await session.query(
          'SELECT count() AS total FROM documents GROUP ALL'
        );
        return results?.[0]?.total ?? 0;
      });
      span.setAttribute('db.document_count', total);
      span.setStatus({ code: 1 });
      return total > 0;
    } catch (err) {
      span.setStatus({ code: 2, message: err.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

// Expose for testing -- allows resetting the singleton
function _reset() {
  _surreal = null;
  _session = null;
  _ready = false;
}

module.exports = {
  connect,
  insertDocument,
  insertChunks,
  vectorSearch,
  getDocumentById,
  hasDocuments,
  _reset,
};
