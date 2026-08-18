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
Invoke-RestMethod -Uri http://localhost/api/chat `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"message":"hello"}'
```

---

## Future endpoints (planned)

These will be added in later epics:

| Method | Path | Epic | Description |
|---|---|---|---|
| POST | /api/ingest/scrape | 004 | Scrape a URL and store content |
| POST | /api/ingest/upload | 004 | Upload a file (HTML, TXT, MD, PDF) |
| GET | /api/documents | 004 | List ingested documents |
| DELETE | /api/documents/:id | 004 | Delete a document |
