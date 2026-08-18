# Conventions

Project-specific overrides and the mechanics of the `.ai/` lifecycle. The
rules themselves (golden rules, workflow, security) live in `AGENTS.md` --
this file is about *how this specific project* runs that process. Field
definitions and day-to-day mechanics live in
`.claude/skills/project-tracking/SKILL.md`.

## Lifecycle

```
backlog/NNN-name.md  --(claimed, (@handle) added)-->  in-progress/NNN-name.md  --(shipped)-->  done/NNN-name.md
```

- **backlog/** -- not started. One file per item, from
  `templates/backlog-item-template.md`.
- **in-progress/** -- actively being worked, one file per active claim.
  No fixed per-assignee cap (see `AGENTS.md` Section 2) -- this tracks what
  people are actually doing, it doesn't police how much they take on.
- **epics/** -- groups of related tasks too large for one file, from
  `templates/epic-template.md`. Tracks child task numbers both ways: the
  epic lists its children, each child's `Epic:` field points back up.
- **done/** -- completed, moved here at Step 6. Never deleted -- the
  project's audit trail. If a shipped item is later reverted, add a new
  backlog item rather than editing history.

## Numbering

- Sequential, zero-padded to 3 digits: `001`, `002`, ...
- One shared sequence across `backlog/`, `in-progress/`, `epics/`, and
  `done/` -- check `.ai/STATUS.md` for the next free number.
- Never reused, even if an item is abandoned.

## Team roster

| Name | Handle | Notes |
|---|---|---|
| Tom Coppock | `@tom` | Sr. Director, AI Strategy & Research (UK). Solo owner of this project. |

Handles are the `Assignee:` values used on task files and the `(@handle)`
claim marker. Use `unassigned` (literal) for tasks not yet picked up --
don't guess an owner.

## Theme registry

See `.ai/THEMES.md` for the full list and description of each theme.
Register a theme there before using it on an epic or task.

## Which tasks get the full engineering workflow

By default, `AGENTS.md` Section 3's plan/implement/validate/review/ship
sequence applies to anything that touches code. Tasks tagged
`Tags: non-code` (e.g. research write-ups, vendor sign-ups) only need
Clarify (Step 1), Do the work (Step 3), and Ship (Step 6) -- skip the plan
file and validation-suite gate. Mark this explicitly on the task, don't
assume based on theme alone.

## Project-specific overrides

- **Spelling convention:** British English
- **Review cadence:** Self-review per task (solo project)
- **Git workflow:** Push directly to main
- **Extra `.ai/` folders:** none

## Technology conventions

- **Node.js:** >= 20.6.0 (required by OTel JS SDK 2.x)
- **OTel JS SDK:** 2.x (`@opentelemetry/sdk-node` >= 2.0.0)
- **OTel Collector:** upstream `otel/opentelemetry-collector-contrib` Docker
  image (not the Splunk distribution -- more portable for backend switching)
- **Docker Compose:** all services defined in `docker-compose.yml` at repo root
- **All config in `.env`:** LLM endpoints, API keys, collector endpoints,
  database credentials -- nothing hardcoded
- **OTel instrumentation must load first:** use
  `node --require ./src/instrumentation.js src/index.js` in Dockerfile CMD
