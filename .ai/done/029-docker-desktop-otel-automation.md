# Plan: 029 -- Docker Desktop OTel automation

Status: **in-progress** <!-- planning | in-progress | in-review | done -->
Created: 2026-09-04
Owner: @tom
Theme: llm-observability

## Problem / goal

The demo dashboard (Epic 025) shows application and database metrics but
not Docker container infrastructure metrics (CPU, memory, network I/O per
container). Docker Desktop 4.35+ can export these via OTLP, and our OTel
Collector already listens on `localhost:4318`, but enabling the export
requires manually editing Docker Desktop settings or navigating the UI.

We want:

1. A script that configures Docker Desktop to export OTLP telemetry to
   our collector -- so the user runs one command instead of following
   manual steps.
2. Container metric charts added to the demo dashboard so they appear
   alongside the application metrics.
3. The demo talk track updated to reference the new container charts.

## Expected behaviour

When this is done:

1. A setup script exists at `scripts/setup-docker-desktop-otel.ps1`
   (Windows) and `scripts/setup-docker-desktop-otel.sh` (macOS/Linux)
   that:
   - Locates the Docker Desktop `settings-store.json`
   - Enables OTLP export with endpoint `http://localhost:4318`
   - Backs up the original file before modifying
   - Prompts the user to restart Docker Desktop
   - Is idempotent (skips if already configured)

2. `splunk/dashboard.json` gains 3 new charts (charts 15-17):

   | # | Chart name | Type | Signal source |
   |---|---|---|---|
   | 15 | Container CPU Usage | Line | `container.cpu.usage` by `container.name` |
   | 16 | Container Memory Usage | Line | `container.memory.usage` by `container.name` |
   | 17 | Container Network I/O | Area | `container.network.io` by `container.name` |

3. `docs/demo-talk-track.md` is updated:
   - Section 1 (Infrastructure) references the new container charts
   - Chart name reference table updated with charts 15-17

4. `docs/docker-desktop-otel.md` is updated:
   - Add a section pointing to the automation script as an alternative
     to the manual steps

5. `docs/splunk-setup.md` section 22 (Automated dashboard setup) notes
   that the dashboard now includes 17 charts (was 14).

## Edge cases / error states

- Docker Desktop may not be installed (script should detect and error
  gracefully).
- `settings-store.json` may not exist yet (first-run scenario) -- script
  should create it with the minimal required structure.
- The file may already have OTLP enabled with a different endpoint --
  script should warn and offer to overwrite.
- On macOS the path is `~/Library/Group Containers/group.com.docker/settings-store.json`.
- On Windows the path is `%APPDATA%\Docker\settings-store.json`.
- On Linux (Docker Desktop for Linux) the path is `~/.docker/desktop/settings-store.json`.
- Docker Desktop must be restarted after the change -- the script cannot
  do this automatically (it would kill running containers).

## Files to create or modify

- `scripts/setup-docker-desktop-otel.ps1` -- new, Windows script
- `scripts/setup-docker-desktop-otel.sh` -- new, macOS/Linux script
- `splunk/dashboard.json` -- add 3 container metric charts
- `docs/demo-talk-track.md` -- update Section 1 and chart reference table
- `docs/docker-desktop-otel.md` -- add automation section
- `docs/splunk-setup.md` -- update chart count in section 22

## Functions / classes to add or change

- None (scripts and docs only)

## Tests to write

- None (infrastructure automation, tested by running the script)

## Dependencies to add or upgrade

- None (`jq` already required by dashboard script; PowerShell built-in
  `ConvertFrom-Json`/`ConvertTo-Json` for the PS script)

## Out of scope

- Automating Docker Desktop restart (too disruptive)
- Adding a Prometheus scraper for Docker Engine metrics (the OTLP path
  is simpler and already documented)
- Adding Docker build/compose trace charts (low value for the demo)
- CI/CD integration

---

## Implementation checklist

- [x] Create `scripts/setup-docker-desktop-otel.ps1` (Windows)
- [x] Create `scripts/setup-docker-desktop-otel.sh` (macOS/Linux)
- [x] Add 3 container metric charts to `splunk/dashboard.json`
- [x] Update `docs/demo-talk-track.md` Section 1 and chart reference
- [x] Update `docs/docker-desktop-otel.md` with automation section
- [x] Update `docs/splunk-setup.md` section 22 chart count
- [x] Test the PS script on Windows
- [x] Self-review for idempotency, error handling, and completeness

## Review notes

- Bugs / logic:
- Security: Script reads/writes Docker Desktop config -- no secrets
  involved, but the backup file should not be committed.
- Performance:
- UX: Script must clearly tell the user to restart Docker Desktop.
- Cost:
