# 008 -- Create basic chat UI in Nginx

Status: backlog
Priority: medium
Assignee: @tom
Epic: 001
Theme: rag-agent
Tags:
Blocked by:
Blocked:

## Description

Create a simple, static chat UI served by Nginx that sends messages to the
Node.js API and displays responses. No framework -- plain HTML, CSS, and
vanilla JS. Nginx also reverse-proxies `/api/*` to the Node.js service.

## Acceptance criteria

- [ ] `nginx/` directory with `nginx.conf` and static HTML/CSS/JS
- [ ] Chat interface with message input, send button, and message history
- [ ] Messages sent to `POST /api/chat` and responses displayed
- [ ] Nginx reverse-proxies `/api/*` to the Node.js API container
- [ ] UI is accessible at `http://localhost` (port 80)

## Notes

Keep it minimal -- this is a test/learning project, not a production UI.
The chat endpoint (`POST /api/chat`) will be implemented in task 016.
Until then, the API can return a stub response.
