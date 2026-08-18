---
name: project-tracking
description: >
  Use when the user wants to create, update, assign, reprioritize, or review
  tasks, epics, or themes in the .ai/ project tracker, ask "what's on my
  plate" / "what's Srishti working on" / "status update on TotalAI", or
  generate a kanban board view. NOT for general coding help unrelated to the
  tracker itself.
user-invocable: true
---

# Project Tracking

Full mechanics for the `.ai/` theme/epic/task tracker defined in
`AGENTS.md` Sections 1-2. Read `.ai/CONVENTIONS.md` for the team roster and
theme registry before doing anything below.

## Field reference

Every task file (`.ai/backlog|in-progress|done/NNN-name.md`) uses these
key: value lines under the title, plus free-text sections. Only `Status`,
`Priority`, and `Assignee` are required; the rest are added when they carry
real information.

| Field | Required | Meaning |
|---|---|---|
| `Status` | Yes | `backlog` \| `in-progress` \| `done` -- must match the folder it lives in. |
| `Priority` | Yes | `critical` \| `high` \| `medium` \| `low`. `critical` sorts to the top and renders as a red pill. |
| `Assignee` | Yes | `@handle` from the roster in `.ai/CONVENTIONS.md`. Exactly one owner. |
| `Epic` | No | `NNN` of the parent epic, or `none`. |
| `Theme` | No | One or more tags from `.ai/THEMES.md`, comma-separated. Inherited from the parent epic if omitted. |
| `Tags` | No | Free-form lowercase labels beyond Theme, for finer filtering. |
| `Blocked by` | No | Comma-separated task IDs. Task is not actionable until all referenced IDs are in `.ai/done/`. Rendered as "Depends on" chips. |
| `Blocked` | No | Free-text reason when the blocker isn't another task -- a missing decision, credential, or external dependency (e.g. `Blocked: waiting on Nicolas's Forge telemetry pull`). Any non-empty value marks the task blocked regardless of `Status`. |
| `Repo` | No | Repository slug this card's real work lives in, e.g. `TungstenKnowledgeDiscovery`. Board-to-repository traceability -- renders as a green repo pill. |
| `Plan` | No | One or more repository plan/backlog IDs (comma-separated), e.g. `252, 285`. Appended to the repo pill as `#252, #285`. |
| `Evidence` | No | One or more evidence links (**semicolon**-separated, so URLs/markdown with commas survive). URLs render as links; repo-relative paths render as code. |
| `Completion evidence` | No | Same as `Evidence`, for a completed item. Takes precedence over `Evidence` in the card's evidence list. |
| `Stage` | No | `assessment` \| `implementation` \| `runtime-validation-pending` -- the honest distinction between "assessment done", "implementation done" and "runtime validation still pending". Renders as a coloured badge. |

Validate the data before regenerating the board (safe, read-only):

```bash
python3 scripts/validate_board.py           # duplicate IDs, status/folder,
                                             # unknown assignee/epic, dangling
                                             # Blocked by, numbering; +warnings
python3 scripts/validate_board.py --report  # board-to-repository sync summary
python3 scripts/test_board.py               # the board tooling's own tests
```

Epic files (`.ai/epics/NNN-name.md`) add:

| Field | Meaning |
|---|---|
| `Theme` | One or more tags this epic belongs to. |
| `Lead` | `@handle` -- accountable for the epic's outcome; not necessarily the assignee of every child task. |

## Claiming a task (small-team convention)

This team pushes directly to one shared branch rather than running a
collision-free git-native claim broker (that's for fleets of autonomous
agents; three people don't need it). The convention instead:

1. Append `(@handle)` to the task's title line (`# 014 -- Provision GPU host (@phani)`).
2. Move the file from `backlog/` to `in-progress/`, set `Status: in-progress`.
3. Commit and push immediately -- so the claim is visible before anyone else
   picks up the same item.
4. This framework tracks work, it doesn't cap it (see `AGENTS.md`
   Section 2) -- move as many items to `in-progress/` as reflect what's
   actually being worked.

## Creating a task

1. Check `.ai/STATUS.md` for the next free number.
2. Copy `.ai/templates/backlog-item-template.md` to
   `.ai/backlog/NNN-short-name.md`.
3. Fill in `Status: backlog`, `Priority`, `Assignee`, `Epic` (if any),
   `Theme` (if not inherited from the epic), and a concrete `Acceptance
   criteria` list -- a task without a testable "done" is a task that never
   gets marked done correctly.
4. If this task belongs to a new theme, add it to `.ai/THEMES.md` first.
5. Update `.ai/STATUS.md`'s next-free-number counter.

## Creating an epic

1. Copy `.ai/templates/epic-template.md` to `.ai/epics/NNN-short-name.md`.
2. Set `Theme` and `Lead`.
3. As child tasks are created, add them to the epic's `Child items`
   checklist -- this is the only place the epic <-> task relationship is
   tracked in both directions (the task's `Epic:` field points up; the
   epic's `Child items` list points down. Keep both in sync).

## Answering status questions

"What's Srishti working on" / "give me an update on TotalAI" / "what's
blocked" are all a grep across `.ai/{backlog,in-progress,done}/*.md` and
`.ai/epics/*.md` for the relevant `Assignee:`, `Epic:`, `Theme:`, or
`Blocked` field -- read the matching files and summarise in prose. Don't
guess from file names; read the field lines.

## Generating the kanban board

Run `python3 scripts/generate_board.py` from the repo root. It parses every
file under `.ai/` and writes a self-contained `board.html` (no CDN, no
external dependencies, opens directly in a browser) with Backlog / In
Progress / Done columns and client-side filters for assignee and theme.
Regenerate on demand -- it's a snapshot, not a live view. Re-run it after any
batch of task changes, or when asked for "the board" / "a kanban view".

Each card's title links to its source `.md` file on GitHub if a
`BOARD_BASE_URL` is configured -- copy `.env.example` to `.env` and fill in
the repo's GitHub "blob" URL (e.g.
`https://github.com/ORG/REPO/blob/main`), or set `BOARD_BASE_URL` as a real
environment variable (which takes precedence over `.env`). No dependency is
needed -- the script has its own minimal `.env` reader. Unset is fine too:
titles just render as plain text.

If Python isn't available in the environment, read the task/epic files
directly and produce the same summary as prose or a markdown table instead
of failing the request.

## Non-engineering tasks

Tasks tagged with a `Tags: non-code` (or whose Theme is registered as
non-engineering in `.ai/THEMES.md`) skip the Plan Mode / TodoWrite /
validate-suite ceremony in `AGENTS.md` Section 3 -- track them with just
`Status` transitions and a plain-text `Notes` update. Don't force a marketing
copy review through a test-suite gate.
