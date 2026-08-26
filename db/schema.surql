-- SurrealDB schema for the RAG pipeline.
-- Applied automatically by api/src/db.js on first connection.
--
-- Tables:
--   documents  -- uploaded files (metadata)
--   chunks     -- text segments with vector embeddings
--
-- Vector index:
--   idx_chunks_embedding  -- MTREE index on chunks.embedding for cosine similarity

-- Ensure the namespace and database exist
DEFINE NAMESPACE IF NOT EXISTS observability;
USE NS observability;
DEFINE DATABASE IF NOT EXISTS rag;
USE DB rag;

-- Documents table
DEFINE TABLE IF NOT EXISTS documents SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS title       ON documents TYPE string;
DEFINE FIELD IF NOT EXISTS filename    ON documents TYPE string;
DEFINE FIELD IF NOT EXISTS source_type ON documents TYPE string DEFAULT 'upload';
DEFINE FIELD IF NOT EXISTS content_length ON documents TYPE int;
DEFINE FIELD IF NOT EXISTS chunk_count ON documents TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS created_at  ON documents TYPE datetime DEFAULT time::now();

-- Chunks table
DEFINE TABLE IF NOT EXISTS chunks SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS document   ON chunks TYPE record<documents>;
DEFINE FIELD IF NOT EXISTS text       ON chunks TYPE string;
DEFINE FIELD IF NOT EXISTS embedding  ON chunks TYPE array<float>;
DEFINE FIELD IF NOT EXISTS chunk_index ON chunks TYPE int;
DEFINE FIELD IF NOT EXISTS created_at ON chunks TYPE datetime DEFAULT time::now();

-- HNSW vector index for cosine similarity search (SurrealDB 3.x).
-- The DIMENSION must match EMBEDDING_DIMENSIONS (env var).
-- Common values: 1536 (text-embedding-3-small), 3072 (text-embedding-3-large).
-- This file is a template: db.js replaces __EMBEDDING_DIMENSIONS__ at runtime.
DEFINE INDEX IF NOT EXISTS idx_chunks_embedding
  ON chunks
  FIELDS embedding
  HNSW DIMENSION __EMBEDDING_DIMENSIONS__
  DIST COSINE;
