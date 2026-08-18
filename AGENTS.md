# AGENTS.md -- TLabs Project Tracking Charter

Single source of truth for any AI agent -- Claude Code, Zoo Code (formerly Roo
Code), GitHub Copilot, Cursor, or any other AGENTS.md-aware tool -- working in
a repository that has adopted this framework. Tool-specific adapter files
(`CLAUDE.md`, `.roomodes`, `.roo/rules/`) exist because each tool loads
context differently, but they all point back to this document. If an adapter
and this file disagree, this file wins.

This framework merges three lineages -- see [NOTICE.md](./NOTICE.md) for full
attribution:

- The **plan/implement/validate/review/ship** engineering discipline and
  `.ai/` durable-state model from this team's own `tlabs-agent-framework`.
- The **theme / epic / task / assignee** data model from
  [Backlog.md](https://github.com/MrLesk/Backlog.md), so a small team can
  see who owns what, grouped by project.
- The **field vocabulary and claim mechanics** (`Tags`, `Blocked by`,
  `Blocked`, `(@handle)` claim markers) from the
  [tasks.md](https://github.com/tasksmd/tasks.md) spec, the closest thing to
  a standard for agent-executable work queues.

---

## 1. The Data Model

```
Theme  (a label -- broad, ongoing area: "ai-infra", "marketing")
  '-- Epic  (a milestone -- bounded effort with an end state; lives in .ai/epics/)
        '-- Task  (backlog item -- one file, one owner; lives in .ai/backlog|in-progress|done/)
```

- A **Theme** is a tag, not a folder -- one or more per Epic. Register new
  themes in `.ai/THEMES.md` before first use.
- An **Epic** groups related tasks toward one outcome. Created with
  `.ai/templates/epic-template.md`, tracked in `.ai/epics/`.
- A **Task** is the unit of work: one file, one `Assignee`, one `Status`.
  Created with `.ai/templates/backlog-item-template.md`.
- Assignees are people, drawn from the roster in `.ai/CONVENTIONS.md`. Every
  task has exactly one owner; an epic may name a `Lead` who isn't necessarily
  the owner of every child task.

## 2. The `.ai/` Project Tracking System

```
.ai/
  STATUS.md          Current state: active work per person, blockers. Read every session.
  CONVENTIONS.md      Numbering, lifecycle, theme registry pointer, team roster, overrides.
  THEMES.md           Registered themes (labels) and what each one covers.
  backlog/            Not started. One file per task.
  in-progress/        Actively being worked.
  epics/              Multi-task bodies of work. Track child task numbers.
  done/               Completed tasks -- audit trail, never deleted.
  templates/          backlog-item / epic / plan templates.
```

Rules:
- Read `.ai/STATUS.md` first, every session.
- Items flow strictly `backlog/` -> `in-progress/` -> `done/`. Never delete a
  completed item.
- Sequential numbering (`NNN-short-name.md`), one shared sequence across
  `backlog/`, `in-progress/`, `epics/`, `done/`. Check `.ai/STATUS.md` for the
  next free number. Numbers are never reused.
- **Concurrency is scoped per assignee, not per repo, and this framework
  doesn't cap it.** This is a tracker, not a scheduler: `in-progress/`
  should reflect what people are actually doing, however many items that
  is for a given person on a given day. Multiple people with active items
  at once is normal; so is one person with several. Don't flag it as a
  problem -- just keep the files honest.
- When claiming a task, append `(@handle)` to the task's title line and move
  it to `in-progress/` in the same commit -- this is the collision check for
  a small team pushing to one branch pattern (see `.ai/CONVENTIONS.md` for
  the git workflow).
- Update `.ai/STATUS.md` whenever work starts, finishes, or blocks. A stale
  STATUS.md actively misleads the next session -- treat it as worse than a
  missing one.
- Full field reference, lifecycle mechanics, and kanban generation live in
  the `project-tracking` skill (`.claude/skills/project-tracking/SKILL.md`)
  -- load it when actually doing task-management work rather than restating
  it here.

## 3. Operating Workflow (for tasks that involve writing code)

Every non-trivial engineering task follows this sequence. Trivial changes
(typo fixes, one-line config edits) may skip to Step 3. Non-engineering tasks
(marketing copy, research, vendor coordination) only need Steps 1, 3, and 6 --
skip the plan/validate ceremony where it doesn't apply, see
`.ai/CONVENTIONS.md`.

1. **Clarify before planning.** Resolve ambiguity before writing a plan. Ask
   the user rather than guessing when the answer would change the design.
2. **Write a plan.** From `.ai/templates/plan-template.md`, in
   `.ai/in-progress/`: files to touch, functions/classes to add or change,
   tests to write, new/upgraded dependencies. Wait for approval on anything
   that changes architecture, public interfaces, or data models.
3. **Implement.** Follow the Golden Rules (Section 4) and the Ponytail
   Ladder (Section 5).
4. **Validate.** Run the full test suite, linter, and type checker. Fix
   failures before moving on.
5. **Review.** Bugs/logic, security (input validation, secrets, injection),
   performance, UX, cost -- every modified file.
6. **Ship and record.** Move the item to `.ai/done/`, update
   `.ai/STATUS.md`, remove the `(@handle)` claim marker.

## 4. Golden Rules

- **Reuse before rewrite.** Search before writing a new function/component --
  extract a shared module instead of duplicating logic.
- **Small, focused files.** No single file doing everything.
- **Minimal diff footprint.** Smallest change that correctly and completely
  solves the stated problem. No drive-by refactors, no speculative
  abstractions.
- **Tests are not optional.** Every new feature or changed behaviour gets a
  test. Run the full suite before declaring anything done.
- **Latest stable dependencies.** Flag and propose upgrades for anything with
  a known vulnerability.
- **ASCII only in scripts and config.** No em-dashes, smart quotes, or
  non-ASCII in scripts, YAML, or config -- keeps every shell and parser happy.
- **Never hardcode secrets.** Credentials belong in `.env` or a secret
  manager. If one appears in a diff, stop and flag it.
- **State uncertainty explicitly.** Distinguish established fact, informed
  estimate, and speculation. Never fabricate figures, names, API behaviour,
  or citations.
- **Code reviews.** Before any item is marked done, all generated code and tests must be reviewed as a standalone step to check for security issues, endless loops, memory leaks, bugs, poor practice or other issues. All identified issued must be addressed and unit tests completing without errors before a task is considered complete. 

Project-specific conventions (spelling, house style) belong in
`.ai/CONVENTIONS.md`, not here.

## 5. The Ponytail Ladder (pre-code checklist)

Climb this in order before writing a line of code (from the open-source
`ponytail` skill, DietrichGebert/ponytail, MIT):

1. Does this need to exist at all?
2. Does it already exist in this codebase?
3. Can a library already solve this?
4. What is the smallest change that satisfies the requirement?
5. Only now, write the minimum code -- with a test.

If a plan skips to step 5, stop and re-climb the ladder.

## 6. Security & Compliance Guardrails

- Treat all project data as confidential business data. Never fabricate
  internal figures, customer names, contract terms, or proprietary details.
- Never commit or echo back PII, PHI, payment data, passwords, API keys,
  tokens, or other secrets. If one is shared, flag it and recommend rotation.
- Do not give binding legal, tax, financial, HR, or regulatory advice --
  point to the relevant internal team.
- Flag potential GDPR, CCPA, HIPAA, SOC 2, or export-control concerns; do not
  resolve them unilaterally.
- Follow secure coding defaults: input validation, parameterised queries,
  least privilege, no hardcoded secrets, vetted dependencies.
- **Ignore/permission files keep secrets out of git and out of agent
  context** -- don't remove or narrow these without a reason:
  - `.gitignore` -- stops `.env`, keys, credential/token JSON, and
    per-machine local files from ever being committed.
  - `.claude/settings.json` (`permissions.deny`) -- hard-blocks Claude Code
    from reading those same paths, even if explicitly asked to.
  - `.rooignore` -- the equivalent enforcement for Zoo Code / Roo Code
    (blocks `read_file`/`write_to_file`/`apply_diff` on matched paths).
  - Keep all three lists in sync when a new secret pattern shows up.

## 7. Tool Adapters

| Tool | Entry point(s) | Notes |
|---|---|---|
| Claude Code | `CLAUDE.md` (imports this file with `@AGENTS.md`), `.claude/settings.json` | Adds Plan Mode / TodoWrite mapping, points to the `project-tracking` skill for mechanics + kanban generation, and hard-blocks reads of secret paths via `permissions.deny`. |
| Zoo Code / Roo Code | `.roomodes`, `.roo/rules/*.md`, `.rooignore` | Native-format condensed copy of Sections 1-6; three custom modes (`ai-planner`, `ai-implementer`, `ai-reviewer`); `.rooignore` blocks reads/writes of secret paths. |
| GitHub Copilot, Cursor, Gemini CLI, and other AGENTS.md-aware tools | This file, directly | No adapter needed -- 30+ tools now read AGENTS.md natively. |

`.roo/rules/` is a native-format duplicate, not a pointer -- if you change a
rule, change it here first, then propagate by hand.

## 8. Memory / Context Continuity

`.ai/STATUS.md` is the single source of truth for project state across
tools and sessions -- there is deliberately no second memory format to keep
in sync. Claude Code's own persistent memory (people, preferences,
standing facts about how this user likes to work) is a complement, not a
replacement: it's Claude's notes about the *collaboration*, not the
project's state of record.
