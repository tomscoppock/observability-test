# Archon Integration

[Archon](https://github.com/coleam00/Archon) is an open-source workflow
engine for AI coding agents: you encode your development process as a
deterministic YAML workflow (phases, validation gates, artifacts), and the
AI supplies intelligence inside each phase rather than owning the process
structure itself. It also ships an MCP server for shared knowledge and
task management across agents.

This folder is a starting point, not a drop-in guarantee:

- `workflows/default.yaml` encodes the same phase table as
  `AGENTS.md` Section 5 (Plan -> Implement -> Validate -> Review -> Ship),
  written in illustrative Archon-style YAML.
- `commands/update-status.md` is a small command template for keeping
  `.ai/STATUS.md` in sync from within an Archon-run workflow.

**Before running this for real:** Archon's workflow schema evolves between
releases. Diff `workflows/default.yaml` against the example workflows
shipped in your installed Archon version (`.archon/workflows/defaults/` in
a real Archon checkout, or the `archon-example-workflow` folder in the
Archon repo) and adjust node names/keys to match. Treat this file as the
*shape* of the process to encode, not as tested-working YAML.

## If you are not running the Archon engine

You do not need Archon installed to use the rest of this framework. The
`.ai/` tracking system and the phase table in `AGENTS.md` Section 5 work
standalone with Claude Code and Zoo/Roo Code alone. Add Archon later if you
want the process itself to become executable and enforced rather than
just documented.
