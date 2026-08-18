# Epic: 001 -- Docker Compose RAG Agent Stack

Status: done
Created: 2026-08-18
Theme: rag-agent, infrastructure
Lead: @tom

## Goal

Stand up the full Docker Compose stack with all services communicating:
Nginx (chat UI), Node.js API (Express), SurrealDB (document/embedding
store), and OTel Collector (telemetry pipeline). This is the foundation
everything else builds on.

## Scope

Included:
- Docker Compose file with all service definitions
- Node.js API skeleton with Express, health endpoint, and basic routing
- Nginx config serving a simple chat UI
- SurrealDB container with persistent volume
- OTel Collector container with a minimal config (OTLP receiver, logging exporter)
- Inter-service networking

Excluded:
- Actual RAG logic (Epic 004)
- OTel exporter to Splunk (Epic 002)
- LLM integration (Epic 004/005)

## Child items

- [x] 006 -- Create Docker Compose with Nginx, Node.js API, SurrealDB, OTel Collector (@tom)
- [x] 007 -- Create Node.js API skeleton with Express and health endpoint (@tom)
- [x] 008 -- Create basic chat UI in Nginx (@tom)

## Notes

All configuration (ports, credentials, endpoints) must come from `.env`.
The OTel Collector starts with a debug/logging exporter so we can verify
telemetry flows before wiring up Splunk in Epic 002.
