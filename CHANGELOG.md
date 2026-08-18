# Changelog

## 0.1.0 -- 2026-08-18

Initial project setup.

- Project tracking framework installed from `tlabs-project-tracking-main`
  with customisations for this project.
- `AGENTS.md` canonical charter (from framework, unchanged).
- `CLAUDE.md` adapter for Claude Code with project-specific build/test
  commands and architecture notes.
- `.roomodes` + `.roo/rules/` adapter for Zoo Code / Roo Code with three
  custom modes (`ai-planner`, `ai-implementer`, `ai-reviewer`).
- `.claude/skills/project-tracking/SKILL.md` for task management.
- `.ai/` tracking scaffold: `STATUS.md`, `CONVENTIONS.md` (solo @tom
  roster, British English, push-to-main), `THEMES.md` (12 observability-
  specific themes), templates.
- 5 epics: Docker Compose stack, OTel Collector to Splunk, Node.js OTel
  instrumentation, RAG document ingestion and chat, LLM observability.
- 13 backlog items (006-018) covering the full initial scope.
- `.env.example` with all configurable values (LLM, embedding, SurrealDB,
  OTel, Splunk, MCP).
- `.gitignore` with Node.js, Docker, SurrealDB, and secret patterns.
- `.rooignore` and `.claude/settings.json` for agent secret blocking.
- `scripts/` board generation and validation tools (from framework).
- Architecture plan in `plans/setup-plan.md`.
