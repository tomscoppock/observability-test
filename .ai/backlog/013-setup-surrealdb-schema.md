# 013 -- Set up SurrealDB schema for documents and embeddings

Status: backlog
Priority: medium
Assignee: @tom
Epic: 004
Theme: database
Tags:
Blocked by: 006
Blocked:

## Description

Design and create the SurrealDB schema for storing documents, document
chunks, and their vector embeddings. Include tables for documents
(metadata, source URL/filename, raw content) and chunks (text, embedding
vector, parent document reference).

## Acceptance criteria

- [ ] Schema definition file (e.g. `db/schema.surql`)
- [ ] `documents` table with fields: id, title, source_type, source_url, raw_content, created_at
- [ ] `chunks` table with fields: id, document_id, text, embedding (vector), chunk_index
- [ ] Relationship between chunks and parent document
- [ ] Schema can be applied to a fresh SurrealDB instance
- [ ] Basic CRUD operations verified via the Node.js SDK

## Notes

SurrealDB supports vector fields and vector search natively -- check the
latest docs for the correct syntax for vector indexing.
The Node.js SDK is `surrealdb` on npm.
