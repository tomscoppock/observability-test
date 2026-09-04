# Plan: 030 -- Streaming chat with markdown rendering

Status: **in-review** <!-- planning | in-progress | in-review | done -->
Created: 2026-09-04
Owner: @tom

## Problem / goal

The chat UI currently waits for the entire LLM response before displaying
anything (5-10+ seconds of blank screen after "Thinking..."), then renders
the reply as escaped plain text. LLM responses naturally contain markdown
(headings, lists, bold, code blocks, bullet points) which is unreadable
when escaped.

Two improvements in one task:

1. **Stream tokens via SSE** so the user sees text appear word-by-word as
   the LLM generates it, giving immediate feedback.
2. **Render markdown as HTML** so the LLM's formatted output (lists,
   headings, code blocks, bold/italic) displays properly.

## Expected behaviour

- When the user sends a chat message, tokens appear in the assistant
  bubble incrementally as they arrive from the LLM.
- The "Thinking..." indicator is replaced by the first token, not held
  until the full response is ready.
- Once streaming completes, source citations are appended below the
  response (same format as today).
- The assistant's reply is rendered as formatted HTML from markdown
  (headings, lists, bold, italic, inline code, code blocks, links).
- User messages remain plain text (no markdown rendering).
- If the LLM API does not support streaming or an error occurs mid-stream,
  the UI falls back gracefully -- shows whatever was received plus an
  error message.
- OTel spans still capture the full request lifecycle, token counts, and
  model metadata (token counts are only available in the final SSE chunk
  with `usage` data or from the `[DONE]` sentinel).
- The non-streaming JSON endpoint (`POST /api/chat`) continues to work
  for backward compatibility (e.g. API consumers, tests). The frontend
  switches to the streaming variant.

## Edge cases / error states

- **LLM API returns non-streaming response:** The `stream: true` flag is
  ignored by some providers. Detect this (response is JSON, not
  `text/event-stream`) and fall back to the existing non-streaming path.
- **Mid-stream error:** If the LLM connection drops mid-stream, flush
  whatever content was received and append an error notice.
- **Empty response:** If the LLM returns zero tokens, show a "No response
  received" message.
- **Markdown XSS:** The `marked` library must have `sanitize` behaviour
  (it strips raw HTML by default in recent versions). Additionally, use
  DOMPurify or marked's built-in sanitiser to prevent injection.
- **Nginx buffering:** Nginx buffers proxy responses by default, which
  breaks SSE. The `/api/chat/stream` location needs
  `proxy_buffering off` and SSE-specific headers.
- **Browser reconnection:** `EventSource` auto-reconnects on disconnect.
  Since this is a one-shot request/response (not a persistent event
  stream), use `fetch()` with `ReadableStream` instead of `EventSource`
  to avoid unwanted reconnection.

## Files to create or modify

| File | Action | What changes |
|------|--------|--------------|
| `api/src/llm.js` | Modify | Add `chatCompletionStream()` that returns an async iterator of token chunks |
| `api/src/routes/chat.js` | Modify | Add `POST /api/chat/stream` SSE endpoint alongside existing JSON endpoint |
| `nginx/html/app.js` | Modify | Replace `fetch().json()` with streaming `fetch()` + `ReadableStream` reader; render markdown with `marked` |
| `nginx/html/index.html` | Modify | Add `<script>` tag for `marked` library (CDN) |
| `nginx/html/style.css` | Modify | Add styles for rendered markdown inside `.message.assistant` (headings, lists, code blocks, links, tables) |
| `nginx/nginx.conf` | Modify | Add `/api/chat/stream` location with `proxy_buffering off` and SSE headers |
| `api/src/__tests__/chat-stream.test.js` | Create | Test SSE endpoint: validates event format, token streaming, source citations, error handling |

## Functions / classes to add or change

### `api/src/llm.js`

- **`chatCompletionStream(messages)`** (new) -- Sends `stream: true` to
  the LLM API. Returns `{ stream: ReadableStream, spanContext }` where
  `stream` is a Node.js `ReadableStream` of `data: {...}` SSE lines from
  the LLM. The caller is responsible for iterating and forwarding chunks.
  Token usage is extracted from the final chunk (OpenAI sends
  `usage` in the last chunk when `stream_options: { include_usage: true }`).
  The OTel span is started but not ended -- the caller ends it after
  consuming the stream so the span covers the full streaming duration.

### `api/src/routes/chat.js`

- **`POST /api/chat/stream`** (new route) -- Performs the same RAG
  pipeline (embed query, vector search, build context) as the existing
  `/api/chat`, then calls `chatCompletionStream()` instead of
  `chatCompletion()`. Writes SSE events to the response:
  - `event: token` / `data: {"content":"..."}` -- each token chunk
  - `event: sources` / `data: [...]` -- source citations (sent once after
    the last token)
  - `event: usage` / `data: {"promptTokens":N,"completionTokens":N}` --
    token counts (sent once)
  - `event: done` / `data: {}` -- signals end of stream
  - `event: error` / `data: {"error":"..."}` -- on failure

  Sets response headers: `Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `Connection: keep-alive`.

### `nginx/html/app.js`

- **`sendMessage()`** (modify) -- Switch from `fetch().json()` to
  streaming `fetch()` with `response.body.getReader()`. Parse SSE lines
  from the stream. On each `token` event, append content to the assistant
  bubble. On `sources` event, append citations. On `done`, finalise. On
  `error`, show error message.
- **`renderMarkdown(text)`** (new) -- Wrapper around `marked.parse()` that
  converts markdown to sanitised HTML.
- **`appendStreamingMessage()`** (new) -- Creates an empty assistant
  bubble and returns an updater function that appends content and
  re-renders the markdown on each chunk.

## Tests to write

### `api/src/__tests__/chat-stream.test.js` (new)

- **SSE format:** Verify response has `Content-Type: text/event-stream`
  and correct SSE event structure (`event:` + `data:` lines).
- **Token streaming:** Mock LLM to return chunked response; verify
  individual `token` events are emitted.
- **Sources event:** Verify source citations are sent as a single
  `sources` event after all tokens.
- **Usage event:** Verify token counts are sent.
- **Done event:** Verify stream ends with `done` event.
- **Error handling:** Verify `error` event on LLM failure.
- **No documents:** Verify appropriate message when no documents exist
  (same as non-streaming path).
- **Invalid input:** Verify 400 response for missing/invalid message.

## Dependencies to add or upgrade

- **`marked`** (frontend, CDN) -- Lightweight markdown-to-HTML parser.
  Load via `<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js">`.
  No npm install needed (static frontend served by nginx). ~40KB minified.
  MIT licence. Latest stable: 15.x.
- No new backend npm dependencies. Node.js `fetch()` (built-in since
  Node 18) supports streaming responses natively.

## Out of scope

- **Conversation history / multi-turn chat:** Each request is still
  independent (system prompt + user message). Multi-turn memory is a
  separate feature.
- **Streaming for non-chat endpoints:** Upload, scrape, admin endpoints
  remain JSON request/response.
- **Code syntax highlighting:** `marked` outputs `<code>` blocks but
  syntax highlighting (e.g. highlight.js) is deferred to a future task.
  Basic code block styling (monospace, background) is included.
- **Removing the non-streaming endpoint:** `POST /api/chat` stays for
  backward compatibility and simpler testing.

---

## Implementation checklist

<!-- Checked off during the Implement phase. -->

- [x] Add `chatCompletionStream()` to `api/src/llm.js`
- [x] Add `POST /api/chat/stream` SSE route to `api/src/routes/chat.js`
- [x] Add SSE proxy config to `nginx/nginx.conf` (`proxy_buffering off`)
- [x] Add `marked` CDN script tag to `nginx/html/index.html`
- [x] Update `sendMessage()` in `nginx/html/app.js` to use streaming fetch
- [x] Add `renderMarkdown()` and `createStreamingMessage()` to `nginx/html/app.js`
- [x] Add markdown typography styles to `nginx/html/style.css`
- [x] Add `CHAT_HISTORY_ROUNDS` env var to `.env.example`
- [x] Add conversation history support to `chat.js` and `app.js`
- [x] Create `api/src/__tests__/chat-stream.test.js`
- [x] Run full test suite (63 pass, 0 fail)
- [ ] Manual smoke test: send a chat message, verify streaming + markdown rendering
- [x] Update `.ai/STATUS.md`

## Review notes

<!-- Filled in during the Review phase (AGENTS.md Section 3, Step 5). -->

- Bugs / logic:
- Security:
- Performance:
- UX:
- Cost:
