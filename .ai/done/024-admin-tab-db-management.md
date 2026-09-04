# Plan: 024 -- Admin tab with database management UI

Status: **done** <!-- planning | in-progress | in-review | done -->
Created: 2026-09-04
Owner: @tom

## Problem / goal

The RAG knowledge base has no management interface. Users cannot see what
documents are stored, how many chunks exist, or clean up stale entries.
During development, re-embedding is expensive -- there is no way to
back up and restore the database without re-running the embedding API.

Backlog item 023 (import/export only) is absorbed into this broader task.

## Expected behaviour

A new **Admin** tab in the chat UI (toggled via a tab bar alongside the
existing Chat view) that provides:

1. **Password gate** -- the Admin tab requires an `ADMIN_PASSWORD` (set
   in `.env`). The frontend prompts for the password on first access;
   all `/api/admin/*` endpoints validate it via an `x-admin-key` header.
   If `ADMIN_PASSWORD` is not set, admin endpoints return 503.
2. **Stats panel** -- shows document count, chunk count, and total
   embedding dimensions at a glance.
3. **Document list** -- table of all documents with title, source type,
   chunk count, and created date. Each row has a **Delete** button.
4. **Delete all** -- button to wipe all documents and chunks.
5. **Export** -- downloads a JSON file containing all documents and their
   chunks (including embeddings) as a `.json` file (not zip -- JSON is
   simpler and the user can gzip externally if needed).
6. **Import** -- file picker that accepts a previously exported `.json`
   file and restores documents + chunks. Clears existing data first
   (full replace, not merge).

All operations are instrumented with OTel spans following existing patterns.

## Edge cases / error states

- `ADMIN_PASSWORD` not set in `.env`: admin endpoints return 503
  "Admin not configured"; the Admin tab shows a disabled state.
- Wrong password: return 401 with "Invalid admin password".
- Password stored in browser `sessionStorage` (cleared on tab close) --
  never persisted to `localStorage`.
- Export with empty database: return valid JSON with empty arrays.
- Import with malformed JSON: return 400 with clear error message.
- Import with mismatched embedding dimensions: warn but allow (the HNSW
  index will reject inserts if dimensions don't match -- surface that error).
- Delete while import is running: not guarded (dev tool, not production).
- Large exports (many chunks with high-dimensional embeddings): could be
  several MB. Stream the response with `res.write()` if needed, but for a
  dev tool a simple `res.json()` is acceptable initially.
- Concurrent admin operations: no locking needed for a single-user dev tool.

## Files to create or modify

### Backend (API)
- **`api/src/routes/admin.js`** (NEW) -- Express router with:
  - Admin auth middleware: validates `x-admin-key` header against
    `ADMIN_PASSWORD` env var. Returns 503 if not configured, 401 if wrong.
  - `GET /api/admin/stats` -- document count, chunk count
  - `GET /api/admin/documents` -- list all documents
  - `DELETE /api/admin/documents/:id` -- delete one document + its chunks
  - `DELETE /api/admin/documents` -- delete all documents + chunks
  - `GET /api/admin/export` -- export all data as JSON download
  - `POST /api/admin/import` -- import JSON file (multipart upload)
- **`api/src/db.js`** (MODIFY) -- add new query functions:
  - `listDocuments()` -- SELECT * FROM documents ORDER BY created_at DESC
  - `getStats()` -- count documents and chunks
  - `deleteDocument(id)` -- DELETE document + related chunks
  - `deleteAllData()` -- DELETE documents; DELETE chunks
  - `exportAll()` -- SELECT all documents and chunks
  - `importAll(data)` -- clear + bulk insert documents and chunks
- **`api/src/index.js`** (MODIFY) -- register adminRouter

### Config
- **`.env.example`** (MODIFY) -- add `ADMIN_PASSWORD` with documentation
- **`docker-compose.yml`** (MODIFY) -- pass `ADMIN_PASSWORD` env var to API

### Frontend (nginx/html)
- **`nginx/html/index.html`** (MODIFY) -- add tab bar (Chat | Admin),
  admin panel HTML
- **`nginx/html/app.js`** (MODIFY) -- add admin tab logic, API calls
- **`nginx/html/style.css`** (MODIFY) -- tab bar and admin panel styles

### Tests
- **`api/src/__tests__/admin-route.test.js`** (NEW) -- route tests
- **`api/src/__tests__/db.test.js`** (MODIFY) -- tests for new db functions

### Docs
- **`docs/api-reference.md`** (MODIFY) -- document admin endpoints

## Functions / classes to add or change

### `api/src/db.js` -- new exports
- `listDocuments()` -- returns all document records, newest first
- `getStats()` -- returns `{ documentCount, chunkCount }`
- `deleteDocument(id)` -- deletes a document and its chunks by document ID
- `deleteAllData()` -- truncates both tables
- `exportAll()` -- returns `{ documents: [...], chunks: [...] }`
- `importAll({ documents, chunks })` -- clears DB, inserts all records

### `api/src/routes/admin.js` -- new router
- `requireAdminAuth` middleware -- checks `x-admin-key` header against
  `ADMIN_PASSWORD` env var; returns 503 if not configured, 401 if wrong
- `GET /api/admin/stats` handler
- `GET /api/admin/documents` handler
- `DELETE /api/admin/documents/:id` handler
- `DELETE /api/admin/documents` handler (delete all)
- `GET /api/admin/export` handler (sets Content-Disposition for download)
- `POST /api/admin/import` handler (accepts multipart file upload)

### `nginx/html/app.js` -- new functions
- `switchTab(tabName)` -- toggles between Chat and Admin views
- `promptAdminPassword()` -- shows password prompt, stores in sessionStorage
- `adminFetch(url, options)` -- wrapper that adds `x-admin-key` header;
  on 401 clears stored password and re-prompts
- `loadAdminStats()` -- fetches and displays stats
- `loadDocumentList()` -- fetches and renders document table
- `deleteDocument(id)` -- calls DELETE endpoint, refreshes list
- `deleteAllDocuments()` -- calls DELETE all endpoint with confirmation
- `exportDatabase()` -- triggers download via GET /api/admin/export
- `importDatabase(file)` -- uploads file via POST /api/admin/import

## Tests to write

### `api/src/__tests__/admin-route.test.js`
- Returns 503 when ADMIN_PASSWORD is not set
- Returns 401 when x-admin-key header is missing
- Returns 401 when x-admin-key header is wrong
- GET /api/admin/stats returns 200 with documentCount and chunkCount
- GET /api/admin/documents returns 200 with array
- DELETE /api/admin/documents returns 200 (delete all)
- DELETE /api/admin/documents/:id returns 404 for non-existent ID
- GET /api/admin/export returns 200 with Content-Disposition header
- POST /api/admin/import returns 400 for missing file
- POST /api/admin/import returns 400 for invalid JSON

### `api/src/__tests__/db.test.js` (additions)
- listDocuments returns array
- getStats returns correct shape
- deleteDocument removes document and related chunks
- deleteAllData clears both tables
- exportAll returns documents and chunks arrays
- importAll clears and restores data

## Dependencies to add or upgrade

- None. Uses existing express, multer (already a dependency for upload),
  and surrealdb packages.

## Out of scope

- Full OAuth/JWT authentication (simple shared password is sufficient).
- Zip compression of exports (user can gzip externally).
- Merge-mode import (always full replace).
- Pagination of document list (dev tool with small datasets).
- Real-time stats updates (manual refresh).
- Production-grade backup (this is a dev convenience feature).

---

## Implementation checklist

<!-- Checked off during the Implement phase. -->

- [x] Add `listDocuments()`, `getStats()`, `deleteDocument()`,
      `deleteAllData()`, `exportAll()`, `importAll()` to `db.js`
- [x] Create `api/src/routes/admin.js` with auth middleware + 6 endpoints
- [x] Register `adminRouter` in `api/src/index.js`
- [x] Add `ADMIN_PASSWORD` to `.env.example` and `docker-compose.yml`
- [x] Add tab bar HTML to `index.html` (Chat | Admin)
- [x] Add admin panel HTML to `index.html` (stats, document table,
      export/import buttons, password prompt)
- [x] Add admin tab JS logic to `app.js` (including `adminFetch` with
      `x-admin-key` header and password prompt)
- [x] Add admin panel CSS to `style.css`
- [x] Write `admin-route.test.js` tests (including auth tests)
- [x] Add db function tests to `db.test.js`
- [x] Update `docs/api-reference.md` with admin endpoints
- [x] Run full test suite -- 54 tests pass
- [x] Rebuild Docker containers and verify end-to-end
- [x] Fix delete bug: `type::thing` renamed to `type::record` in SurrealDB 3.x;
      added `_extractRid()` helper for robust record ID handling
- [x] Full project code review
- [x] Commit and push

## Review notes

- Bugs / logic: Fixed `type::thing` -> `type::record` (SurrealDB 3.x rename).
  Added `_extractRid()` helper to handle RecordId objects, `"table:id"` strings,
  and plain strings uniformly. All error paths properly set span status, record
  exceptions, and end spans. No other bugs found.
- Security: Admin password comparison uses strict equality (acceptable for dev
  tool). No secrets in code. sessionStorage for admin key (not localStorage).
  XSS protection via `escapeHtml()`. File size limits enforced. CORS wide open
  but acceptable behind Nginx for a dev project.
- Performance: Sequential chunk inserts in importAll/insertChunks could be
  batched but acceptable for small datasets. No memory leaks -- MCP client
  properly closes sessions in finally blocks.
- UX: Double confirmation on delete all. Auto-refresh after mutations. Status
  messages auto-hide. Lock button clears session. Tab switching preserves state.
- Cost: No external API calls in admin operations. Export/import preserves
  embeddings, avoiding re-embedding costs.
