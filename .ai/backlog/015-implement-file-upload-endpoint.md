# 015 -- Implement file upload endpoint for HTML, TXT, MD, PDF

Status: backlog
Priority: medium
Assignee: @tom
Epic: 004
Theme: rag-agent
Tags:
Blocked by: 007, 013
Blocked:

## Description

Create a `POST /api/upload` endpoint that accepts file uploads (HTML, TXT,
MD, PDF), extracts text content, chunks it, generates embeddings, and
stores everything in SurrealDB.

## Acceptance criteria

- [ ] `POST /api/upload` accepts multipart file upload
- [ ] Supports HTML, TXT, MD, and PDF file types
- [ ] Text extracted from each format (PDF via `pdf-parse` or `pdfjs-dist`)
- [ ] Content chunked and embeddings generated
- [ ] Document and chunks stored in SurrealDB
- [ ] Returns document ID and chunk count on success
- [ ] Rejects unsupported file types with a clear error

## Notes

PDF parsing adds a dependency -- `pdf-parse` is lightweight and
stdlib-friendly. `pdfjs-dist` is heavier but more robust.
HTML parsing can use a simple DOM parser like `cheerio` or `htmlparser2`.
Markdown is plain text -- no special parsing needed beyond stripping
frontmatter if present.
