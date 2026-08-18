# Golden Rules

- Reuse before rewrite -- search the codebase before writing new code.
- Small, focused files -- no file should be doing everything.
- No duplicate logic -- extract shared modules.
- Minimal diff footprint -- smallest change that solves the stated problem;
  no drive-by refactors, no speculative abstractions.
- Tests are not optional -- write one for every new feature or changed
  behaviour, and run the full suite before finishing.
- Latest stable dependencies -- flag any with known vulnerabilities.
- ASCII only in scripts and config files.
- Never hardcode secrets -- use `.env` or the platform secret manager.
- State uncertainty explicitly -- never fabricate figures, names, or API
  behaviour.

Project-specific overrides (spelling convention, house style, extra
folders) live in `.ai/CONVENTIONS.md`.
