# 016 -- Implement RAG chat endpoint with swappable LLM backend

Status: backlog
Priority: high
Assignee: @tom
Epic: 004
Theme: rag-agent, llm-integration
Tags:
Blocked by: 013
Blocked:

## Description

Create a `POST /api/chat` endpoint that takes a user message, generates an
embedding for the query, retrieves the most relevant document chunks from
SurrealDB via vector similarity search, constructs a prompt with the
retrieved context, and sends it to the configured LLM backend (OpenAI-
compatible API). The LLM provider, endpoint, API key, and model are all
configurable via `.env`.

## Acceptance criteria

- [ ] `POST /api/chat` accepts `{ message: "..." }`
- [ ] Query embedding generated via the configured embedding API
- [ ] Top-k relevant chunks retrieved from SurrealDB by vector similarity
- [ ] Prompt constructed with system message, retrieved context, and user query
- [ ] LLM response generated via OpenAI-compatible completions API
- [ ] Response returned to the client with the answer and source references
- [ ] Works with OpenAI, Gemma (via Ollama/vLLM), and Qwen by changing `.env`

## Notes

All LLM calls use the OpenAI-compatible pattern:
`POST {LLM_API_BASE_URL}/chat/completions` with the standard request body.
This means switching providers is just changing env vars.

Start with a simple prompt template; refine with system prompts and
few-shot examples later.
