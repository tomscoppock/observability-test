# 023 -- Add SurrealDB import/export for embeddings

Status: done (absorbed into 024)
Priority: medium
Assignee: @tom
Epic: 004
Theme: database
Tags:
Blocked by: 013
Blocked:

## Description

Add import and export functionality for the SurrealDB database so that
document and embedding data can be saved to a file and restored without
re-running the embedding API. This avoids repeated embedding costs during
development and testing.

## Acceptance criteria

- [ ] `POST /api/db/export` exports all documents and chunks (including
      embeddings) to a JSON file and returns it as a download
- [ ] `POST /api/db/import` accepts a previously exported JSON file and
      restores documents and chunks into SurrealDB
- [ ] Import clears existing data before restoring (or offers a merge option)
- [ ] The chat UI has an "Export DB" button and an "Import DB" file picker
- [ ] Round-trip test: export, clear DB, import, verify chat still works

## Notes

- SurrealDB has a built-in `surreal export` / `surreal import` CLI, but
  a REST API approach is more user-friendly for the chat UI.
- Alternative: use SurrealDB's native export format (SurrealQL) instead
  of JSON. Evaluate which is simpler.
- This is a dev/test convenience feature -- not production-grade backup.
- Deferred until after the core RAG pipeline (013, 015, 016) is complete.
