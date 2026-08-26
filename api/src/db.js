'use strict';

/**
 * SurrealDB client module.
 *
 * Provides a singleton connection to SurrealDB with lazy initialisation.
 * On first connect the schema from db/schema.surql is applied (idempotent
 * IF NOT EXISTS statements).
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

/** @type {import('surrealdb').default | null} */
let _db = null;
let _ready = false;

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Connect to SurrealDB (singleton).  On first call the schema is applied.
 * Subsequent calls return the cached client.
 *
 * @returns {Promise<import('surrealdb').default>}
 */
async function connect() {
  if (_db && _ready) return _db;

  return tracer.startActiveSpan('db.connect', async (span) => {
    try {
      // Dynamic import -- surrealdb is ESM-only in v2
      const { default: Surreal } = await import('surrealdb');

      const url = process.env.SURREAL_URL || 'http://surrealdb:8000';
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

      _db = new Surreal();
      await _db.connect(url);
      await _db.signin({ username: user, password: pass });
      await _db.use({ namespace: ns, database: db });

      logger.info('Connected to SurrealDB', { url, namespace: ns, database: db });

      await applySchema(_db);
      _ready = true;

      span.setStatus({ code: 1 }); // OK
      return _db;
    } catch (err) {
      span.setStatus({ code: 2, message: err.message }); // ERROR
      span.recordException(err);
      logger.error('SurrealDB connection failed', { error: err.message });
      _db = null;
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
 *
 * @param {import('surrealdb').default} db
 */
async function applySchema(db) {
  return tracer.startActiveSpan('db.applySchema', async (span) => {
    try {
      const schemaPath = path.resolve(__dirname, '../../db/schema.surql');
      const sql = fs.readFileSync(schemaPath, 'utf-8');
      await db.query(sql);
      logger.info('SurrealDB schema applied');
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
// CRUD helpers
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
      const db = await connect();
      const [result] = await db.create('documents', doc);
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
      const db = await connect();
      span.setAttribute('db.chunk_count', chunks.length);

      const results = [];
      for (const chunk of chunks) {
        const [record] = await db.create('chunks', {
          document: documentId,
          text: chunk.text,
          embedding: chunk.embedding,
          chunk_index: chunk.chunkIndex,
        });
        results.push(record);
      }

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
 * @param {number[]} queryEmbedding  The query vector (1536 dimensions).
 * @param {number} [topK=5]         Number of results to return.
 * @returns {Promise<object[]>}     Chunks with similarity scores.
 */
async function vectorSearch(queryEmbedding, topK = 5) {
  return tracer.startActiveSpan('db.vectorSearch', async (span) => {
    try {
      const db = await connect();
      span.setAttributes({
        'db.vector.dimensions': queryEmbedding.length,
        'db.vector.top_k': topK,
      });

      // SurrealDB vector search using the MTREE index
      const [results] = await db.query(
        `SELECT *, vector::similarity::cosine(embedding, $query_vec) AS score
         FROM chunks
         WHERE embedding <|${topK}|> $query_vec
         ORDER BY score DESC`,
        { query_vec: queryEmbedding }
      );

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
      const db = await connect();
      const result = await db.select(id);
      span.setStatus({ code: 1 });
      return result || null;
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
      const db = await connect();
      const [results] = await db.query('SELECT count() AS total FROM documents GROUP ALL');
      const total = results?.[0]?.total ?? 0;
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
  _db = null;
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
