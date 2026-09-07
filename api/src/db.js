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
const { trace, SpanKind } = require('@opentelemetry/api');
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

/** Parsed from the connection URL during connect(). */
let _serverAddress = 'surrealdb';
let _serverPort = 8000;

/**
 * Returns span options for a CLIENT-kind DB span with common attributes.
 * Splunk APM uses SpanKind.CLIENT + server.address to draw service map edges.
 * db.system + db.namespace are standard OTel semconv for database spans.
 */
function _dbSpanOpts(queryText) {
  const attrs = {
    'db.system': 'surrealdb',
    'db.namespace': process.env.SURREAL_NS || 'observability',
    'server.address': _serverAddress,
    'server.port': _serverPort,
    'peer.service': 'surrealdb',
  };
  if (queryText) {
    attrs['db.query.text'] = queryText;
  }
  return {
    kind: SpanKind.CLIENT,
    attributes: attrs,
  };
}

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

  return tracer.startActiveSpan('db.connect', _dbSpanOpts(), async (span) => {
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

      // Parse host/port for service map edge detection
      try {
        const parsed = new URL(rawUrl);
        _serverAddress = parsed.hostname || 'surrealdb';
        _serverPort = parseInt(parsed.port, 10) || 8000;
      } catch (_e) {
        // keep defaults
      }

      span.setAttributes({
        'db.connection_string': url,
        'db.namespace': ns,
        'db.name': db,
        'server.address': _serverAddress,
        'server.port': _serverPort,
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
  return tracer.startActiveSpan('db.applySchema', _dbSpanOpts(), async (span) => {
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
  const sql = 'CREATE documents SET title=$title, filename=$filename, ...';
  return tracer.startActiveSpan('db.insertDocument', _dbSpanOpts(sql), async (span) => {
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
  return tracer.startActiveSpan('db.insertChunks', _dbSpanOpts('CREATE chunks SET document=$doc_id, text=$text, ...'), async (span) => {
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
  const sql = 'SELECT *, vector::similarity::cosine(embedding, $query_vec) AS score FROM chunks WHERE embedding <|K,EF|> $query_vec ORDER BY score DESC';
  return tracer.startActiveSpan('db.vectorSearch', _dbSpanOpts(sql), async (span) => {
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
 * Extract the raw record identifier from various ID formats.
 *
 * Handles:
 *  - SurrealDB RecordId objects (have an `id` property)
 *  - Strings like "documents:abc123" (strips the table prefix)
 *  - Plain strings like "abc123" (returned as-is)
 *
 * @param {string|object} id  The record ID in any supported format.
 * @returns {string} The raw identifier portion (e.g. "abc123").
 */
function _extractRid(id) {
  if (id && typeof id === 'object' && id.id !== undefined) {
    return String(id.id);
  }
  const str = String(id);
  const colonIdx = str.indexOf(':');
  return colonIdx >= 0 ? str.slice(colonIdx + 1) : str;
}

/**
 * Fetch a document by its record ID.
 *
 * @param {string|object} id  SurrealDB record ID.
 * @returns {Promise<object|null>}
 */
async function getDocumentById(id) {
  return tracer.startActiveSpan('db.getDocumentById', _dbSpanOpts('SELECT * FROM type::record("documents", $rid)'), async (span) => {
    try {
      const rid = _extractRid(id);
      span.setAttribute('db.document.rid', rid);
      const result = await _withRetry(async (session) => {
        const [rows] = await session.query(
          'SELECT * FROM type::record("documents", $rid)',
          { rid }
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
  return tracer.startActiveSpan('db.hasDocuments', _dbSpanOpts('SELECT count() AS total FROM documents GROUP ALL'), async (span) => {
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

/**
 * List all documents, newest first.
 *
 * @returns {Promise<object[]>}
 */
async function listDocuments() {
  return tracer.startActiveSpan('db.listDocuments', _dbSpanOpts('SELECT * FROM documents ORDER BY created_at DESC'), async (span) => {
    try {
      const results = await _withRetry(async (session) => {
        const [rows] = await session.query(
          'SELECT * FROM documents ORDER BY created_at DESC'
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
 * Get aggregate stats: document count and chunk count.
 *
 * @returns {Promise<{ documentCount: number, chunkCount: number }>}
 */
async function getStats() {
  return tracer.startActiveSpan('db.getStats', _dbSpanOpts('SELECT count() AS total FROM documents|chunks GROUP ALL'), async (span) => {
    try {
      const stats = await _withRetry(async (session) => {
        const [docRows] = await session.query(
          'SELECT count() AS total FROM documents GROUP ALL'
        );
        const [chunkRows] = await session.query(
          'SELECT count() AS total FROM chunks GROUP ALL'
        );
        return {
          documentCount: docRows?.[0]?.total ?? 0,
          chunkCount: chunkRows?.[0]?.total ?? 0,
        };
      });
      span.setAttributes({
        'db.document_count': stats.documentCount,
        'db.chunk_count': stats.chunkCount,
      });
      span.setStatus({ code: 1 });
      return stats;
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
 * Delete a document and all its related chunks.
 *
 * @param {string|object} id  SurrealDB record ID (e.g. "documents:abc123").
 * @returns {Promise<void>}
 */
async function deleteDocument(id) {
  return tracer.startActiveSpan('db.deleteDocument', _dbSpanOpts('DELETE chunks WHERE document=$rid; DELETE documents:$rid'), async (span) => {
    try {
      const rid = _extractRid(id);
      span.setAttribute('db.document.id', rid);
      await _withRetry(async (session) => {
        // Delete chunks that reference this document
        await session.query(
          'DELETE chunks WHERE document = type::record("documents", $rid)',
          { rid }
        );
        // Delete the document itself
        await session.query(
          'DELETE type::record("documents", $rid)',
          { rid }
        );
      });
      span.setStatus({ code: 1 });
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
 * Delete all documents and chunks (truncate both tables).
 *
 * @returns {Promise<void>}
 */
async function deleteAllData() {
  return tracer.startActiveSpan('db.deleteAllData', _dbSpanOpts('DELETE chunks; DELETE documents'), async (span) => {
    try {
      await _withRetry(async (session) => {
        await session.query('DELETE chunks');
        await session.query('DELETE documents');
      });
      logger.info('All documents and chunks deleted');
      span.setStatus({ code: 1 });
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
 * Export all documents and chunks as a JSON-serialisable object.
 *
 * @returns {Promise<{ documents: object[], chunks: object[] }>}
 */
async function exportAll() {
  return tracer.startActiveSpan('db.exportAll', _dbSpanOpts('SELECT * FROM documents; SELECT * FROM chunks'), async (span) => {
    try {
      const data = await _withRetry(async (session) => {
        const [docs] = await session.query(
          'SELECT * FROM documents ORDER BY created_at ASC'
        );
        const [chks] = await session.query(
          'SELECT * FROM chunks ORDER BY document ASC, chunk_index ASC'
        );
        return { documents: docs, chunks: chks };
      });
      span.setAttributes({
        'db.export.document_count': data.documents.length,
        'db.export.chunk_count': data.chunks.length,
      });
      span.setStatus({ code: 1 });
      return data;
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
 * Import documents and chunks from a previously exported JSON object.
 * Clears all existing data first (full replace).
 *
 * @param {{ documents: object[], chunks: object[] }} data
 * @returns {Promise<{ documentCount: number, chunkCount: number }>}
 */
async function importAll(data) {
  return tracer.startActiveSpan('db.importAll', _dbSpanOpts('DELETE + CREATE documents/chunks (bulk import)'), async (span) => {
    try {
      const docs = data.documents || [];
      const chks = data.chunks || [];
      span.setAttributes({
        'db.import.document_count': docs.length,
        'db.import.chunk_count': chks.length,
      });

      await _withRetry(async (session) => {
        // Clear existing data
        await session.query('DELETE chunks');
        await session.query('DELETE documents');

        // Insert documents
        for (const doc of docs) {
          await session.query(
            `CREATE type::record("documents", $rid) SET
               title = $title,
               filename = $filename,
               source_type = $source_type,
               content_length = $content_length,
               chunk_count = $chunk_count,
               created_at = $created_at`,
            {
              rid: typeof doc.id === 'object' ? doc.id.id : String(doc.id).replace('documents:', ''),
              title: doc.title,
              filename: doc.filename,
              source_type: doc.source_type || 'upload',
              content_length: doc.content_length || 0,
              chunk_count: doc.chunk_count || 0,
              created_at: doc.created_at || new Date().toISOString(),
            }
          );
        }

        // Insert chunks
        for (const chunk of chks) {
          await session.query(
            `CREATE type::record("chunks", $rid) SET
               document = $document,
               text = $text,
               embedding = $embedding,
               chunk_index = $chunk_index,
               created_at = $created_at`,
            {
              rid: typeof chunk.id === 'object' ? chunk.id.id : String(chunk.id).replace('chunks:', ''),
              document: chunk.document,
              text: chunk.text,
              embedding: chunk.embedding,
              chunk_index: chunk.chunk_index || 0,
              created_at: chunk.created_at || new Date().toISOString(),
            }
          );
        }
      });

      logger.info('Database imported', {
        documentCount: docs.length,
        chunkCount: chks.length,
      });
      span.setStatus({ code: 1 });
      return { documentCount: docs.length, chunkCount: chks.length };
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
  listDocuments,
  getStats,
  deleteDocument,
  deleteAllData,
  exportAll,
  importAll,
  _reset,
};
