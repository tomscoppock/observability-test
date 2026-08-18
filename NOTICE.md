# Notice

This project uses the TLabs Project Tracking framework for its `.ai/`
project tracking system, agent adapters, and engineering workflow. The
framework merges practices (not code) from several sources:

- **[Backlog.md](https://github.com/MrLesk/Backlog.md)** (MrLesk, MIT) --
  the theme (label) / epic (milestone) / task / assignee data model, and
  the idea of a kanban view generated from plain markdown files.
- **[tasks.md](https://github.com/tasksmd/tasks.md)** (Fyodor Ivanischev,
  MIT) -- the field vocabulary (`Tags`, `Blocked by`, `Blocked`) and the
  `(@handle)` inline claim-marker convention for a shared task queue.
- **[AGENTS.md](https://agents.md/)** -- the open, cross-tool convention of
  a single canonical instructions file that every AI coding agent reads,
  with tool-specific adapters pointing back to it.
- **This team's own `tlabs-agent-framework`** -- the `.ai/` durable-state
  folder structure, the plan/implement/validate/review/ship workflow, the
  Golden Rules, and the deterministic-phase model.
- **Ponytail** (DietrichGebert/ponytail, MIT) -- the pre-code checklist in
  `AGENTS.md` Section 5.
- **Archon** (coleam00/Archon) -- the idea that process structure (phases,
  gates, artifacts) is fixed and team-owned, while the AI supplies
  intelligence within each phase.
