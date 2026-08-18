# 014 -- Implement web scrape endpoint using Playwright MCP

Status: backlog
Priority: medium
Assignee: @tom
Epic: 004
Theme: rag-agent, mcp-services
Tags:
Blocked by: 007, 013
Blocked:

## Description

Create a `POST /api/scrape` endpoint that accepts a URL, uses the
Playwright MCP service to fetch and render the page, extracts the text
content, chunks it, generates embeddings, and stores everything in
SurrealDB.

## Acceptance criteria

- [ ] `POST /api/scrape` accepts `{ url: "..." }`
- [ ] Playwright MCP service fetches and renders the page
- [ ] Text content extracted from the rendered HTML
- [ ] Content chunked into manageable pieces
- [ ] Embeddings generated for each chunk via the configured embedding API
- [ ] Document and chunks stored in SurrealDB
- [ ] Returns document ID and chunk count on success

## Notes

The Playwright MCP service runs as a separate Docker container.
Chunking strategy: start simple (fixed-size with overlap), refine later.
