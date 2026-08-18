# 007 -- Create Node.js API skeleton with Express and health endpoint

Status: backlog
Priority: high
Assignee: @tom
Epic: 001
Theme: rag-agent
Tags:
Blocked by:
Blocked:

## Description

Create the Node.js API project structure with Express, a health check
endpoint (`GET /health`), and the basic folder layout for future routes.
Include a Dockerfile that uses `node --require ./src/instrumentation.js`
to ensure OTel loads before app code.

## Acceptance criteria

- [ ] `package.json` with Express and OTel SDK dependencies
- [ ] `src/index.js` with Express app and `GET /health` returning `{ status: "ok" }`
- [ ] `src/instrumentation.js` stub (console exporter initially)
- [ ] `Dockerfile` using `node --require ./src/instrumentation.js src/index.js`
- [ ] API responds on the configured port inside Docker

## Notes

OTel SDK 2.x packages: `@opentelemetry/api`, `@opentelemetry/sdk-node`,
`@opentelemetry/auto-instrumentations-node`,
`@opentelemetry/exporter-trace-otlp-http`,
`@opentelemetry/exporter-metrics-otlp-http`,
`@opentelemetry/exporter-logs-otlp-http`,
`@opentelemetry/resources`, `@opentelemetry/semantic-conventions`.

Minimum Node.js: ^18.19.0 || >=20.6.0 (use node:22-alpine in Dockerfile).
