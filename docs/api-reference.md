# API Reference

Base URL: `http://localhost/api` (via Nginx) or `http://localhost:3000` (direct).

## Endpoints

### GET /health

Health check endpoint used by Docker healthcheck and Nginx upstream probes.

**Response:**

```json
{
  "status": "ok"
}
```

**Status codes:**
- `200` -- Service is healthy

---

### POST /api/chat

Send a message and receive a response. Currently returns a stub response.
Will be replaced by RAG + LLM integration in Epic 004.

**Request:**

```json
{
  "message": "What is observability?"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | Yes | The user's message text |

**Response (stub):**

```json
{
  "reply": "[stub] You said: \"What is observability?\". LLM integration coming in Epic 004."
}
```

**Response (future, with LLM):**

```json
{
  "reply": "Observability is the ability to understand the internal state of a system..."
}
```

**Status codes:**
- `200` -- Success
- `400` -- Missing or invalid `message` field

**Error response:**

```json
{
  "error": "message is required and must be a string"
}
```

**Example with curl:**

```bash
curl -X POST http://localhost/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

**Example with PowerShell:**

```powershell
Invoke-RestMethod -Uri http://localhost/api/chat -Method POST -ContentType "application/json" -Body '{"message":"hello"}'
```

---

### POST /api/scrape

Scrape a web page via the Playwright MCP server, extract visible text,
chunk it, generate embeddings, and store everything in SurrealDB.

Requires the Playwright MCP server to be running and configured via
`MCP_PLAYWRIGHT_URL` (see [Configuration](configuration.md)).

**Request:**

```json
{
  "url": "https://example.com/some-page"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | HTTP or HTTPS URL to scrape |

**Response (success):**

```json
{
  "id": "document:abc123",
  "title": "Example Page Title",
  "url": "https://example.com/some-page",
  "chunkCount": 12,
  "contentLength": 8432
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | SurrealDB document ID |
| `title` | string | Page title (extracted from `<title>` tag) |
| `url` | string | The scraped URL |
| `chunkCount` | number | Number of text chunks stored |
| `contentLength` | number | Total text length in characters |

**Status codes:**
- `200` -- Success
- `400` -- Missing/invalid URL, unsupported protocol, or empty page content
- `503` -- Playwright MCP server not configured or unreachable, embedding
  service unavailable, or database unavailable
- `500` -- Unexpected error

**Error response:**

```json
{
  "error": "url is required and must be a string"
}
```

**Example with curl:**

```bash
curl -X POST http://localhost/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

**Example with PowerShell:**

```powershell
Invoke-RestMethod -Uri http://localhost/api/scrape -Method POST -ContentType "application/json" -Body '{"url":"https://example.com"}'
```

---

## Admin endpoints

All admin endpoints require the `x-admin-key` header set to the value of
the `ADMIN_PASSWORD` environment variable. If `ADMIN_PASSWORD` is not set,
all admin endpoints return `503`.

### GET /api/admin/stats

Get document and chunk counts.

**Headers:** `x-admin-key: <ADMIN_PASSWORD>`

**Response:**

```json
{
  "documentCount": 5,
  "chunkCount": 42
}
```

**Status codes:**
- `200` -- Success
- `401` -- Missing or invalid admin password
- `503` -- Admin not configured (`ADMIN_PASSWORD` not set)

---

### GET /api/admin/documents

List all documents in the knowledge base, newest first.

**Headers:** `x-admin-key: <ADMIN_PASSWORD>`

**Response:**

```json
{
  "documents": [
    {
      "id": "documents:abc123",
      "title": "Example Document",
      "filename": "example.txt",
      "source_type": "upload",
      "chunk_count": 5,
      "content_length": 2048,
      "created_at": "2026-09-04T12:00:00Z"
    }
  ]
}
```

**Status codes:**
- `200` -- Success
- `401` -- Missing or invalid admin password
- `503` -- Admin not configured

---

### DELETE /api/admin/documents

Delete ALL documents and chunks from the knowledge base.

**Headers:** `x-admin-key: <ADMIN_PASSWORD>`

**Response:**

```json
{
  "message": "All documents and chunks deleted"
}
```

**Status codes:**
- `200` -- Success
- `401` -- Missing or invalid admin password
- `503` -- Admin not configured

---

### DELETE /api/admin/documents/:id

Delete a single document and its chunks.

**Headers:** `x-admin-key: <ADMIN_PASSWORD>`

**Response:**

```json
{
  "message": "Document and its chunks deleted",
  "id": "abc123"
}
```

**Status codes:**
- `200` -- Success
- `404` -- Document not found
- `401` -- Missing or invalid admin password
- `503` -- Admin not configured

---

### GET /api/admin/export

Export all documents and chunks as a JSON file download.

**Headers:** `x-admin-key: <ADMIN_PASSWORD>`

**Response:** JSON file download with `Content-Disposition: attachment` header.

```json
{
  "documents": [ ... ],
  "chunks": [ ... ]
}
```

**Status codes:**
- `200` -- Success (file download)
- `401` -- Missing or invalid admin password
- `503` -- Admin not configured

---

### POST /api/admin/import

Import a previously exported JSON file. **Replaces all existing data.**

**Headers:** `x-admin-key: <ADMIN_PASSWORD>`

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | JSON export file (max 50 MB) |

**Response:**

```json
{
  "message": "Database imported successfully",
  "documentCount": 5,
  "chunkCount": 42
}
```

**Status codes:**
- `200` -- Success
- `400` -- No file provided, invalid JSON, or missing required arrays
- `401` -- Missing or invalid admin password
- `413` -- File too large (max 50 MB)
- `503` -- Admin not configured

**Example with curl:**

```bash
curl -X POST http://localhost/api/admin/import \
  -H "x-admin-key: your-password" \
  -F "file=@rag-export-2026-09-04.json"
```
