# Plan: 013 + 015 + 016 -- RAG Pipeline (Schema, Upload, Chat)

Status: **in-review** <!-- planning | in-progress | in-review | done -->
Created: 2026-08-26
Owner: @tom

## Problem / goal

Build the core RAG pipeline for the observability-test project: SurrealDB
schema (013), text file upload with chunking and embedding (015), and
RAG chat with vector retrieval and LLM generation (016). The use case is
an **HR Policy Handbook chatbot** -- users drag text files into the chat
UI, the system chunks and embeds them, then answers questions about
company policies using retrieved context.

This is a test/learning application, so simple RAG is sufficient: naive
chunking (fixed-size with overlap), OpenAI-compatible embedding API, and
basic prompt template with retrieved context. The primary goal is to
produce rich, observable traces in Splunk showing every step (chunking,
embedding, retrieval, LLM generation) with timing and token counts.

### Use case: HR Policy Handbook Chat

**Persona:** An employee who wants quick answers about company policies.

**Flow:**
1. User drags 3-5 `.txt` files into the chat UI (e.g. `leave-policy.txt`,
   `remote-work-policy.txt`, `expenses-policy.txt`, `code-of-conduct.txt`,
   `data-protection-policy.txt`).
2. System uploads each file via `POST /api/upload`, which:
   - Extracts text content
   - Chunks into ~500-char segments with 50-char overlap
   - Generates embeddings via the configured embedding API
   - Stores document + chunks + embeddings in SurrealDB
3. User asks: "How many days of annual leave do I get?"
4. System embeds the query, retrieves top-5 relevant chunks from SurrealDB
   via vector similarity, constructs a prompt with the context, and sends
   to the LLM.
5. LLM responds with an answer citing the leave policy.

**Expected results in Splunk:**
- **APM trace** for each upload showing: HTTP span > chunk span > embed
  span (with `gen_ai.*` attributes for token count, model, dimensions)
  > SurrealDB insert span.
- **APM trace** for each chat showing: HTTP span > embed query span >
  SurrealDB vector search span > LLM completion span (with prompt/
  completion token counts) > response.
- **Log records** correlated with traces for each step.
- **Infrastructure metrics** from SurrealDB (transaction count, KV ops)
  showing the database work during upload and retrieval.

## Expected behaviour

### 013: SurrealDB Schema

- A schema file `db/schema.surql` defines:
  - `documents` table: id, title, source_type (upload/scrape), filename,
    content_length, chunk_count, created_at
  - `chunks` table: id, document (record link to documents), text,
    embedding (array of floats), chunk_index, created_at
  - MTREE vector index on `chunks.embedding` for cosine similarity search
- A `db/init.js` script connects to SurrealDB and applies the schema
- Schema is applied automatically on `docker compose up` via an init
  container or on first API request

### 015: File Upload Endpoint

- `POST /api/upload` accepts `multipart/form-data` with one or more files
- Supported types: `.txt`, `.md` (text files only -- user scoped down
  from the original HTML/PDF requirement)
- Processing pipeline per file:
  1. Extract text content (read as UTF-8)
  2. Chunk into segments (~500 chars, 50-char overlap)
  3. Generate embeddings for each chunk via `POST {EMBEDDING_API_BASE_URL}/embeddings`
  4. Store document record + chunk records in SurrealDB
- Returns `{ documents: [{ id, title, chunkCount }] }`
- Each step is wrapped in an OTel span for observability
- The chat UI gets a drag-and-drop zone for file uploads

### 016: RAG Chat Endpoint

- `POST /api/chat` (replaces the existing stub):
  1. Embed the user's query via the embedding API
  2. Vector similarity search in SurrealDB (`chunks` table, top-5)
  3. Construct prompt: system message + retrieved context + user query
  4. Send to LLM via `POST {LLM_API_BASE_URL}/chat/completions`
  5. Return `{ reply, sources: [{ documentId, title, chunkIndex, score }] }`
- Each step is wrapped in an OTel span
- LLM spans include `gen_ai.*` attributes (model, prompt_tokens,
  completion_tokens)
- If no documents are uploaded yet, returns a helpful message instead of
  an error

## Edge cases / error states

- **No documents uploaded:** Chat returns a message like "No documents
  have been uploaded yet. Please upload some files first."
- **Embedding API unavailable:** Upload and chat return 503 with a clear
  error message. Logged as ERROR.
- **LLM API unavailable:** Chat returns 503. The embedding + retrieval
  steps still complete (partial trace visible in Splunk).
- **Empty file uploaded:** Rejected with 400 "File is empty".
- **Unsupported file type:** Rejected with 400 "Unsupported file type.
  Accepted: .txt, .md".
- **Very large file:** `multer` file size limit (e.g. 5MB) prevents
  memory issues. Returns 413.
- **SurrealDB connection failure:** Returns 503 with logged error.
- **Duplicate upload:** Allowed -- each upload creates a new document
  record. De-duplication is out of scope.
- **Embedding dimension mismatch:** The schema's MTREE index dimension
  must match the embedding model's output. `text-embedding-3-small`
  produces 1536 dimensions by default.

## Files to create or modify

### New files

- `db/schema.surql` -- SurrealDB schema definition
- `api/src/db.js` -- SurrealDB client module (connect, apply schema, CRUD)
- `api/src/chunker.js` -- Text chunking utility
- `api/src/embeddings.js` -- Embedding API client
- `api/src/llm.js` -- LLM completions API client
- `api/src/routes/upload.js` -- Upload route handler
- `api/src/routes/chat.js` -- Chat route handler (replaces stub)
- `api/src/__tests__/chunker.test.js` -- Chunker unit tests
- `api/src/__tests__/db.test.js` -- DB client unit tests (mock SurrealDB)
- `sample-docs/leave-policy.txt` -- Sample HR policy
- `sample-docs/remote-work-policy.txt` -- Sample HR policy
- `sample-docs/expenses-policy.txt` -- Sample HR policy
- `sample-docs/code-of-conduct.txt` -- Sample HR policy
- `sample-docs/data-protection-policy.txt` -- Sample HR policy
- `docs/rag-testing-guide.md` -- How to test the RAG pipeline end-to-end

### Modified files

- `api/src/index.js` -- Mount upload route, replace chat stub with real handler
- `api/package.json` -- Add dependencies (surrealdb, multer)
- `nginx/nginx.conf` -- Increase client_max_body_size for file uploads
- `nginx/html/index.html` -- Add drag-and-drop upload zone
- `nginx/html/app.js` -- Add file upload handling + source citations
- `nginx/html/style.css` -- Style the upload zone and source citations
- `docker-compose.yml` -- Add healthcheck for SurrealDB (if needed)
- `.env.example` -- Document any new env vars
- `docs/splunk-setup.md` -- Add RAG observability dashboard section

## Functions / classes to add or change

### `api/src/db.js` (new)

- `connect()` -- Connect to SurrealDB using env vars, apply schema on
  first connection. Returns the Surreal client instance. Cached singleton.
- `applySchema()` -- Read and execute `db/schema.surql`.
- `insertDocument(doc)` -- Insert a document record, return its ID.
- `insertChunks(documentId, chunks)` -- Batch-insert chunk records with
  embeddings.
- `vectorSearch(queryEmbedding, topK)` -- Execute vector similarity search
  on the chunks table, return top-K results with scores.
- `getDocumentById(id)` -- Fetch a document by ID.

### `api/src/chunker.js` (new)

- `chunkText(text, chunkSize, overlap)` -- Split text into overlapping
  chunks. Returns `[{ text, chunkIndex }]`. Default: 500 chars, 50 overlap.

### `api/src/embeddings.js` (new)

- `embedTexts(texts)` -- Call the embedding API with a batch of texts.
  Returns `[Float32Array]`. Uses `EMBEDDING_API_BASE_URL`, `EMBEDDING_API_KEY`,
  `EMBEDDING_MODEL` from env. Wrapped in an OTel span with `gen_ai.*`
  attributes.

### `api/src/llm.js` (new)

- `chatCompletion(messages)` -- Call the LLM completions API. Returns
  `{ content, promptTokens, completionTokens }`. Uses `LLM_API_BASE_URL`,
  `LLM_API_KEY`, `LLM_MODEL` from env. Wrapped in an OTel span with
  `gen_ai.*` attributes.

### `api/src/routes/upload.js` (new)

- `router.post('/api/upload', multer, async (req, res) => { ... })` --
  Handle file upload: validate, chunk, embed, store. Each step in its own
  OTel span.

### `api/src/routes/chat.js` (new)

- `router.post('/api/chat', async (req, res) => { ... })` -- Handle chat:
  validate, embed query, vector search, construct prompt, LLM call, return
  response with sources. Each step in its own OTel span.

### `api/src/index.js` (modify)

- Remove the stub `app.post('/api/chat', ...)` handler.
- Mount `require('./routes/upload')` and `require('./routes/chat')`.
- Add `multer` middleware configuration.

### `nginx/html/app.js` (modify)

- Add drag-and-drop event listeners on the chat area.
- Add `uploadFiles(files)` function that POSTs to `/api/upload`.
- Display upload progress and results in the chat.
- Display source citations in assistant responses.

## Tests to write

### `api/src/__tests__/chunker.test.js`

- Chunks text into correct number of segments
- Respects chunk size and overlap parameters
- Handles text shorter than chunk size (single chunk)
- Handles empty string (returns empty array)
- Chunk indices are sequential starting from 0

### `api/src/__tests__/db.test.js`

- `insertDocument` creates a record and returns an ID
- `insertChunks` creates chunk records linked to a document
- `vectorSearch` returns results sorted by similarity score
- (Uses mock/stub SurrealDB client)

### Integration testing (manual, documented in `docs/rag-testing-guide.md`)

- Upload sample HR policy files via the UI
- Verify documents and chunks appear in SurrealDB
- Ask questions and verify relevant answers with source citations
- Check Splunk APM for end-to-end traces

## Dependencies to add or upgrade

- `surrealdb` -- SurrealDB Node.js SDK (latest stable)
- `multer` -- Multipart form data handling for Express

No other new dependencies needed:
- Text file reading is built-in (`fs.readFileSync` / `Buffer.toString`)
- Embedding and LLM calls use `fetch` (built into Node 22)
- Markdown is plain text -- no parser needed for simple RAG

## Out of scope

- **PDF and HTML parsing** -- User scoped down to text files only (.txt, .md)
- **Web scraping** (task 014) -- Skipped per user request
- **Advanced RAG** -- No re-ranking, hybrid search, or query expansion
- **Streaming responses** -- Simple request/response for now
- **Authentication** -- No auth on upload or chat endpoints
- **De-duplication** -- Uploading the same file twice creates two documents
- **gen_ai semantic conventions** -- Basic `gen_ai.*` attributes on spans,
  but full gen_ai normalizer (task 017) and detailed instrumentation
  (task 018) are separate tasks
- **DB import/export** -- Separate backlog item (023)

---

## Sample HR Policy Files

Five `.txt` files in `sample-docs/` covering common HR topics. Each is
~500-1500 words to produce 2-6 chunks per document. Content is fictional
but realistic enough to test retrieval quality.

### Test questions and expected answers

| Question | Expected source | Expected answer (gist) |
|----------|----------------|----------------------|
| "How many days of annual leave do I get?" | leave-policy.txt | 25 days + bank holidays |
| "Can I work from home on Fridays?" | remote-work-policy.txt | Yes, hybrid policy allows 2 days remote |
| "What's the limit for expense claims without receipt?" | expenses-policy.txt | GBP 25 for incidental expenses |
| "What happens if I breach the code of conduct?" | code-of-conduct.txt | Disciplinary process, up to termination |
| "How long do we retain personal data?" | data-protection-policy.txt | 6 years after employment ends |

## Splunk Dashboard Documentation

Add a new section to `docs/splunk-setup.md` covering:

1. **RAG Upload Pipeline chart** -- Duration breakdown of upload traces
   (chunking time, embedding time, DB insert time)
2. **RAG Chat Pipeline chart** -- Duration breakdown of chat traces
   (query embedding, vector search, LLM generation)
3. **Embedding Token Usage chart** -- Track embedding API token consumption
4. **LLM Token Usage chart** -- Track prompt + completion tokens per chat
5. **RAG Error Rate detector** -- Alert on embedding/LLM API failures

---

## Implementation checklist

<!-- Checked off during the Implement phase. -->

### Phase 1: Schema and DB client (013)

- [x] Create `db/schema.surql` with documents and chunks tables + MTREE index
- [x] Create `api/src/db.js` with connect, applySchema, CRUD, vectorSearch
- [x] Add `surrealdb` dependency to `api/package.json`
- [x] Verify schema applies to SurrealDB on startup (via db.js applySchema on connect)
- [x] Write `api/src/__tests__/db.test.js`

### Phase 2: Chunking and Embedding (015 foundation)

- [x] Create `api/src/chunker.js` with chunkText function
- [x] Write `api/src/__tests__/chunker.test.js` (12 tests, all passing)
- [x] Create `api/src/embeddings.js` with embedTexts function + OTel spans
- [x] Create sample HR policy files in `sample-docs/` (5 files)

### Phase 3: Upload endpoint (015)

- [x] Add `multer` dependency to `api/package.json` (v2.2.0)
- [x] Create `api/src/routes/upload.js` with full pipeline
- [x] Update `api/src/index.js` to mount upload route
- [x] Update `nginx/nginx.conf` for file upload size (10 MB, 120s timeout)
- [x] Update chat UI: drag-and-drop zone in `nginx/html/index.html`
- [x] Update `nginx/html/app.js` with upload handling
- [x] Update `nginx/html/style.css` for upload zone styling
- [x] Test upload via UI with sample files (manual, documented in rag-testing-guide.md)

### Phase 4: RAG chat endpoint (016)

- [x] Create `api/src/llm.js` with chatCompletion function + OTel spans
- [x] Create `api/src/routes/chat.js` with full RAG pipeline
- [x] Update `api/src/index.js` to replace stub with real chat route
- [x] Update `nginx/html/app.js` to display source citations
- [x] Test chat with uploaded HR policy documents (manual, documented in rag-testing-guide.md)

### Phase 5: Documentation and validation

- [x] Create `docs/rag-testing-guide.md` with step-by-step test flow
- [x] Add RAG observability sections to `docs/splunk-setup.md` (sections 14-17)
- [x] Update `.env.example` if any new env vars added (none needed -- all vars already in docker-compose.yml)
- [x] Run all tests (unit: 21 tests, 5 suites, 0 failures)
- [x] Rebuild Docker image and verify end-to-end flow (upload + chat working, bbdd568)
- [ ] Verify traces appear in Splunk APM with correct span hierarchy (manual step after deploy)

## Review notes

<!-- Filled in during the Review phase (AGENTS.md Section 3, Step 5). -->

- Bugs / logic:
- Security:
- Performance:
- UX:
- Cost:
