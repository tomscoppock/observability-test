# Operating Workflow

1. Clarify before planning -- resolve ambiguity by asking, not guessing.
2. Write a plan into `.ai/in-progress/` from `.ai/templates/plan-template.md`
   before touching code. Wait for approval on anything architectural.
3. Implement the smallest diff that satisfies the plan.
4. Validate -- run the full test suite, linter, and type checker. Do not
   proceed on a red build.
5. Review every modified file for bugs, security, performance, UX, cost.
6. Ship -- update docs, move the plan file to `.ai/done/`, update
   `.ai/STATUS.md`, and refresh `memory-bank/activeContext.md` and
   `memory-bank/progress.md`.

Use the `ai-planner`, `ai-implementer`, and `ai-reviewer` custom modes
(see `.roomodes`) to keep planning, implementation, and review as
distinct passes rather than one blended pass.

## Deterministic Workflow Phases

| Phase     | Gate to pass                              | Artifact                          |
|-----------|-------------------------------------------|-----------------------------------|
| Plan      | User approves scope, files, tests         | `.ai/in-progress/NNN-*.md`        |
| Implement | Loops until all plan tasks checked off    | Code diff + updated plan checklist|
| Validate  | Full test suite + lint + typecheck pass   | CI/local run output               |
| Review    | Golden Rules review clean                 | Review notes in plan file         |
| Ship      | Docs updated, item moved to `.ai/done/`  | Updated `.ai/STATUS.md`           |
