# Epic: 004 -- RAG Document Ingestion and Chat

Status: done (2026-09-08, retroactive -- all child tasks were completed 2026-08-25 to 2026-09-04 but the epic file was never updated)
Created: 2026-08-18
Theme: rag-agent, database, mcp-services, llm-integration
Lead: @tom

## Goal

Build the RAG pipeline: web scraping and file upload for document
ingestion, SurrealDB storage with embeddings, and a chat endpoint that
retrieves relevant content and generates answers via a swappable LLM
backend (OpenAI-compatible API).

## Scope

Included:
- SurrealDB schema for documents, chunks, and embeddings
- Web scrape endpoint using Playwright MCP service
- File upload endpoint supporting HTML, TXT, MD, PDF
- Document chunking and embedding generation (configurable provider via `.env`)
- RAG chat endpoint: embed query, retrieve relevant chunks, generate answer
- LLM backend swappable between OpenAI, Gemma, Qwen via `.env`

Excluded:
- LLM-specific observability instrumentation (Epic 005)
- Advanced RAG techniques (re-ranking, hybrid search) -- future work

## Child items

- [x] 013 -- Set up SurrealDB schema for documents and embeddings (@tom)
- [x] 014 -- Implement web scrape endpoint using Playwright MCP (@tom)
- [x] 015 -- Implement file upload endpoint for HTML, TXT, MD, PDF (@tom)
- [x] 016 -- Implement RAG chat endpoint with swappable LLM backend (@tom)

## Notes

PDF parsing requires a Node.js library (e.g. `pdf-parse` or `pdfjs-dist`).

Embedding generation needs either a local embedding model or an API call
(OpenAI embeddings API, or a local model via Ollama). The provider and
model are configurable in `.env` (`EMBEDDING_API_BASE_URL`,
`EMBEDDING_MODEL`).

All LLM calls use the OpenAI-compatible completions API pattern, so
switching between providers is just changing `LLM_API_BASE_URL`,
`LLM_API_KEY`, and `LLM_MODEL` in `.env`.
