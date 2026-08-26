# RAG Pipeline Testing Guide

Step-by-step guide for testing the HR Policy Handbook RAG pipeline
end-to-end, including file upload, chat, and observability verification.

---

## Prerequisites

1. **Docker Compose stack running:**

   ```bash
   docker compose up -d --build
   ```

2. **API keys configured** in `.env`:
   - `EMBEDDING_API_KEY` -- for the embedding model (e.g. OpenAI)
   - `LLM_API_KEY` -- for the chat completion model (e.g. OpenAI)

3. **Splunk Observability Cloud** configured (optional, for trace
   verification):
   - `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` in `.env`

4. **Verify services are healthy:**

   ```
   curl.exe http://localhost/health
   ```

   Expected: `{"status":"ok"}`

---

## Test 1: Upload sample HR policy files

### Via the UI (recommended)

1. Open `http://localhost` in your browser.
2. Drag all 5 files from `sample-docs/` into the drop zone (or click
   "browse" to select them):
   - `leave-policy.txt`
   - `remote-work-policy.txt`
   - `expenses-policy.txt`
   - `code-of-conduct.txt`
   - `data-protection-policy.txt`
3. Watch the upload progress in the chat area.

**Expected result:**

```
5 of 5 file(s) uploaded successfully.
leave-policy.txt: 4 chunks indexed
remote-work-policy.txt: 5 chunks indexed
expenses-policy.txt: 5 chunks indexed
code-of-conduct.txt: 6 chunks indexed
data-protection-policy.txt: 6 chunks indexed
```

The exact chunk counts may vary slightly depending on text length.

### Via the API (PowerShell)

```powershell
$files = Get-ChildItem .\sample-docs\*.txt
$form = @{}
foreach ($f in $files) { $form[$f.Name] = Get-Item $f.FullName }
Invoke-RestMethod -Uri http://localhost/api/upload -Method POST -Form @{ files = (Get-ChildItem .\sample-docs\*.txt) }
```

### Via the API (curl on Linux/macOS)

```bash
curl -X POST http://localhost/api/upload \
  -F "files=@sample-docs/leave-policy.txt" \
  -F "files=@sample-docs/remote-work-policy.txt" \
  -F "files=@sample-docs/expenses-policy.txt" \
  -F "files=@sample-docs/code-of-conduct.txt" \
  -F "files=@sample-docs/data-protection-policy.txt"
```

---

## Test 2: Verify documents in SurrealDB

Query SurrealDB directly to confirm documents and chunks were stored:

```
curl.exe -s -X POST http://localhost:8000/sql -H "surreal-ns: observability" -H "surreal-db: rag" -H "Accept: application/json" -u "root:root" -d "SELECT id, title, filename, chunk_count FROM documents;"
```

Expected: 5 document records with titles matching the uploaded files.

```
curl.exe -s -X POST http://localhost:8000/sql -H "surreal-ns: observability" -H "surreal-db: rag" -H "Accept: application/json" -u "root:root" -d "SELECT count() AS total FROM chunks GROUP ALL;"
```

Expected: Total chunk count (approximately 26 chunks across all files).

---

## Test 3: Ask questions about HR policies

### Test questions and expected answers

Use the chat UI at `http://localhost` or the API directly.

| # | Question | Expected source | Expected answer (gist) |
|---|----------|----------------|----------------------|
| 1 | "How many days of annual leave do I get?" | leave-policy.txt | 25 days + bank holidays |
| 2 | "Can I work from home on Fridays?" | remote-work-policy.txt | Yes, Friday is a flexible day for remote work |
| 3 | "What's the limit for expense claims without a receipt?" | expenses-policy.txt | GBP 25 for incidental expenses |
| 4 | "What happens if I breach the code of conduct?" | code-of-conduct.txt | Disciplinary process, up to termination |
| 5 | "How long do we retain personal data?" | data-protection-policy.txt | 6 years after employment ends |

### Via the API (PowerShell)

```powershell
Invoke-RestMethod -Uri http://localhost/api/chat -Method POST -ContentType "application/json" -Body '{"message":"How many days of annual leave do I get?"}'
```

### Via the API (curl on Linux/macOS)

```bash
curl -X POST http://localhost/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"How many days of annual leave do I get?"}'
```

**Expected response structure:**

```json
{
  "reply": "According to the Annual Leave and Time Off Policy, all full-time employees are entitled to 25 days of paid annual leave per calendar year, in addition to public bank holidays...",
  "sources": [
    {
      "documentId": "documents:...",
      "title": "leave policy",
      "chunkIndex": 0,
      "score": 0.89
    }
  ]
}
```

### What to check

- The `reply` should answer the question using information from the
  correct policy document.
- The `sources` array should list the relevant document(s) with
  similarity scores.
- The answer should cite which policy document it comes from.

---

## Test 4: Edge cases

### No documents uploaded (fresh database)

If you haven't uploaded any files yet:

```powershell
Invoke-RestMethod -Uri http://localhost/api/chat -Method POST -ContentType "application/json" -Body '{"message":"What is the leave policy?"}'
```

Expected: A message saying "No documents have been uploaded yet."

### Empty file

Create an empty file and try to upload it:

Expected: Error response `"File is empty"`.

### Unsupported file type

Try uploading a `.pdf` or `.jpg` file:

Expected: Error response `"Unsupported file type. Accepted: .txt, .md"`.

### Invalid chat request

```powershell
Invoke-RestMethod -Uri http://localhost/api/chat -Method POST -ContentType "application/json" -Body '{}'
```

Expected: `400` error `"message is required and must be a string"`.

---

## Test 5: Verify traces in Splunk APM

After running the upload and chat tests, check Splunk for observability
data.

### Upload trace

1. Navigate to **APM > Traces** in Splunk Observability Cloud.
2. Filter by `sf_service` = `rag-api` and time range covering your test.
3. Look for a trace with the root span `POST /api/upload`.
4. Click to expand the trace waterfall.

**Expected span hierarchy:**

```
POST /api/upload (HTTP span, auto-instrumented)
  |-- upload.pipeline (custom span)
       |-- upload.chunk (per file)
       |-- embeddings.embedTexts (embedding API call)
       |    |-- gen_ai.* attributes: model, input_count, dimensions, tokens
       |-- db.insertDocument (SurrealDB insert)
       |-- db.insertChunks (SurrealDB batch insert)
```

**Key attributes to verify:**

| Span | Attribute | Expected value |
|------|-----------|---------------|
| `embeddings.embedTexts` | `gen_ai.request.model` | `text-embedding-3-small` |
| `embeddings.embedTexts` | `gen_ai.response.dimensions` | `1536` |
| `embeddings.embedTexts` | `gen_ai.usage.prompt_tokens` | > 0 |
| `upload.chunk` | `upload.chunk_count` | 3-6 per file |
| `db.insertChunks` | `db.chunk_count` | matches chunk count |

### Chat trace

1. Look for a trace with the root span `POST /api/chat`.
2. Click to expand the trace waterfall.

**Expected span hierarchy:**

```
POST /api/chat (HTTP span, auto-instrumented)
  |-- chat.pipeline (custom span)
       |-- embeddings.embedTexts (query embedding)
       |-- db.vectorSearch (SurrealDB vector search)
       |    |-- db.vector.top_k = 5
       |    |-- db.results_count = 5
       |-- db.getDocumentById (fetch document metadata, 1-5 calls)
       |-- llm.chatCompletion (LLM API call)
            |-- gen_ai.request.model = gpt-4o-mini
            |-- gen_ai.usage.prompt_tokens > 0
            |-- gen_ai.usage.completion_tokens > 0
```

### SurrealDB traces

SurrealDB also emits its own traces. Look for `surrealdb` service traces
that correlate with the `rag-api` traces (same time window).

---

## Test 6: Verify SurrealDB metrics in Splunk IM

1. Navigate to **Metric Finder** in Splunk.
2. Search for `surrealdb.transaction`.
3. You should see transaction count and KV operation metrics increase
   during upload and chat operations.

---

## Troubleshooting

### "Embedding service unavailable" (503)

- Check that `EMBEDDING_API_KEY` is set in `.env`.
- Check that `EMBEDDING_API_BASE_URL` is reachable from the container.
- View API logs: `docker compose logs api`

### "LLM service unavailable" (503)

- Check that `LLM_API_KEY` is set in `.env`.
- Check that `LLM_API_BASE_URL` is reachable from the container.
- View API logs: `docker compose logs api`

### "Database service unavailable" (503)

- Check SurrealDB is running: `docker compose ps surrealdb`
- Check SurrealDB logs: `docker compose logs surrealdb`
- Verify connectivity: `curl.exe http://localhost:8000/health`

### No traces in Splunk

- Check OTel Collector logs: `docker compose logs otel-collector`
- Verify `SPLUNK_ACCESS_TOKEN` and `SPLUNK_REALM` in `.env`
- Wait 1-2 minutes for traces to appear (export batching)

### Chunks have wrong embedding dimensions

- Ensure `EMBEDDING_MODEL` matches the MTREE index dimension (1536 for
  `text-embedding-3-small`).
- If using a different model, update `db/schema.surql` MTREE DIMENSION
  to match.

---

*Last updated: 2026-08-26*
