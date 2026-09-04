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

## Future endpoints (planned)

| Method | Path | Description |
|---|---|---|
| GET | /api/documents | List ingested documents |
| DELETE | /api/documents/:id | Delete a document |
