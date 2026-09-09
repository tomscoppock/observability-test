@AGENTS.md

Everything above this line is the canonical charter (workflow, `.ai/` data
model, golden rules, ponytail ladder, security guardrails) -- imported
directly so it never drifts out of sync. Everything below is Claude-Code
specific on top of it.

## Session start

1. Read `AGENTS.md` (full rules) and `.ai/STATUS.md` (current state).
2. Check `.ai/in-progress/` for active work before starting anything new.
3. Read `.ai/CONVENTIONS.md` for the team roster and any project-specific
   overrides.

## Task management -- use the skill

Creating, updating, assigning, or reviewing tasks/epics/themes, or
generating a kanban view, is handled by the `project-tracking` skill
(`.claude/skills/project-tracking/SKILL.md`). It loads automatically when the
conversation is about `.ai/` state; invoke it directly with `/project-tracking`
if it doesn't. Don't hand-rewrite `.ai/` files from first principles when the
skill already encodes the field conventions and numbering rules.

## Mapping AGENTS.md's engineering workflow onto Claude Code features

- **Clarify / Plan (AGENTS.md Section 1, Steps 1-2):** Use Plan Mode. Stay
  in it until scope, files, and tests are settled. The approved plan is
  written to `.ai/in-progress/NNN-*.md` from `.ai/templates/plan-template.md`.
- **Implement (Step 3):** Use `TodoWrite` to track the plan's checklist
  live -- it mirrors the checklist in the `.ai/in-progress/` file, it doesn't
  replace it. `.ai/` is the durable record; `TodoWrite` is the in-session
  view.
- **Validate (Step 4):** Run the project's real test/lint/typecheck commands
  -- never mark a todo complete on a red build.
- **Review (Step 5):** Use the `/code-review` skill if available, or perform
  the Section 1 review manually against every modified file.
- **Ship (Step 6):** Move the item to `.ai/done/`, update `.ai/STATUS.md`,
  remove the `(@handle)` claim marker, and refresh
  `memory-bank/activeContext.md` and `memory-bank/progress.md` so Zoo/Roo
  Code sees the same state.

Non-engineering tasks (research, vendor sign-ups) skip the Plan Mode /
TodoWrite ceremony -- just track status via the task file and update
`.ai/STATUS.md`. See `.ai/CONVENTIONS.md` for which task types get the
full workflow.

## Memory

Claude Code's own persistent memory (user/feedback/project/reference
records) is for cross-session *collaboration* context -- how this user
likes to work, standing project facts, pointers to external systems. It is
a complement to `.ai/`, not a replacement: `.ai/STATUS.md` is the
project's state of record that any tool or teammate can read; Claude's
memory is Claude's own notes about working with this user.

`memory-bank/` gives Zoo/Roo Code a native, incrementally-updated memory
format. When shipping work in Claude Code, also refresh
`memory-bank/activeContext.md` and `memory-bank/progress.md` so both tools
see the same state.

## Project-specific additions

### Architecture

Docker Compose stack with 4 core services:
- **Nginx** -- static chat UI + reverse proxy to API
- **Node.js API** (Express) -- RAG agent, OTel-instrumented
- **SurrealDB** -- document/embedding store
- **OTel Collector** (upstream contrib) -- telemetry pipeline

LLM backends (OpenAI, Gemma, Qwen) are swappable via `.env`.
Observability backends (Splunk, Azure Monitor, Grafana) are swappable via
the OTel Collector config.

### Build / run commands

```bash
# Start all services
docker compose up -d

# Start with rebuild
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down

# Run API locally (outside Docker, for development)
cd api && npm install && node --require ./src/instrumentation.js src/index.js

# Run tests
cd api && npm test

# Lint
cd api && npm run lint

# Generate kanban board
python3 scripts/generate_board.py

# Validate board data
python3 scripts/validate_board.py

# Verify demo talk tracks against the dashboards they describe
python3 scripts/check_talk_tracks.py

# Capture the Azure side of the backend comparison table
python3 scripts/compare_backends.py --offset 1h --markdown
```

### Key conventions

- All config in `.env` -- never hardcode endpoints, keys, or credentials
- OTel instrumentation loads FIRST via `--require ./src/instrumentation.js`
- OTel JS SDK 2.x (packages >= 2.0.0) -- Node.js >= 20.6.0
- Upstream OTel Collector Contrib image (not Splunk distribution)
- British English spelling

---
