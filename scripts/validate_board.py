#!/usr/bin/env python3
"""Safe, read-only validation of the .ai/ project-tracker data.

Never writes or moves a file -- it only reads .ai/ and reports. Use it in a
pre-commit hook, in CI, or by hand before regenerating the board:

    python3 scripts/validate_board.py            # errors + warnings, human output
    python3 scripts/validate_board.py --strict   # warnings also fail the run
    python3 scripts/validate_board.py --report    # repository-sync summary
    python3 scripts/validate_board.py --json      # machine-readable findings

Exit codes: 0 = clean (no errors; warnings allowed unless --strict), 1 = at
least one error (or, with --strict, at least one warning), 2 = bad invocation.

Checks (shared logic lives in board_core.py):

  ERRORS (block a clean board)
    - duplicate IDs across backlog/in-progress/done/epics
    - Status field not matching the folder the file lives in
    - unknown assignee (not in the CONVENTIONS.md roster)
    - unknown epic (Epic: points at a non-existent epic)
    - dangling "Blocked by" (references a task ID that does not exist)
    - numbering regression (STATUS next-free number <= highest existing ID)

  WARNINGS (worth a look, do not block by default)
    - done card with no evidence signal at all (no link/PR/report reference)
    - stale in-progress card (Started > 30 days ago and not blocked)
"""

import argparse
import datetime
import json
import sys
from pathlib import Path

import board_core as core


def collect(ai_dir: Path):
    tasks = core.load_tasks(ai_dir)
    epics = core.load_epics(ai_dir)
    roster = core.parse_roster(ai_dir / "CONVENTIONS.md")

    errors = []
    warnings = []

    dupes = core.find_duplicate_ids(tasks, epics)
    for tid, files in sorted(dupes.items()):
        errors.append("duplicate ID %s used by: %s" % (tid, ", ".join(files)))

    for tid, status, folder in core.find_status_folder_mismatches(tasks):
        errors.append(
            "%s has Status: %s but lives in %s/ (renders in the wrong column)"
            % (tid, status, folder)
        )

    for tid, who in core.find_unknown_assignees(tasks, roster):
        errors.append("%s has assignee %s not in the CONVENTIONS.md roster" % (tid, who))

    for tid, epic_id in core.find_unknown_epics(tasks, epics):
        errors.append("%s references Epic %s which has no epic file" % (tid, epic_id))

    for tid, dep in core.find_dangling_blocked_by(tasks, epics):
        errors.append("%s is 'Blocked by: %s' but %s does not exist" % (tid, dep, dep))

    next_free = core.read_status_next_free(ai_dir)
    ok, highest, declared = core.check_numbering(tasks, epics, next_free)
    if ok is False:
        errors.append(
            "STATUS.md next-free number %s is not greater than the highest "
            "existing ID %s (numbers are never reused)" % (declared, highest)
        )

    for tid in core.find_missing_evidence(tasks):
        warnings.append("done card %s has no evidence link/PR/report reference" % tid)

    today = datetime.date.today()
    for tid, started, age in core.find_stale_in_progress(tasks, today):
        warnings.append(
            "in-progress card %s has been Started since %s (%d days) and is not blocked"
            % (tid, started, age)
        )

    return tasks, epics, errors, warnings


def repository_sync_report(tasks):
    """Summarise every card that carries repository traceability (Repo / Plan /
    Evidence / Completion evidence) -- the board-to-repository map."""
    rows = []
    for t in tasks:
        f = t["fields"]
        repo = f.get("repo", "")
        plan = f.get("plan") or []
        ev = (f.get("evidence") or []) + (f.get("completion evidence") or [])
        if repo or plan or ev:
            rows.append({
                "id": t["id"],
                "status": f.get("status", t["folder"]),
                "repo": repo,
                "plan": plan,
                "evidence_count": len(ev),
            })
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--strict", action="store_true", help="treat warnings as failures")
    parser.add_argument("--report", action="store_true", help="print the repository-sync report and exit")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    repo_root = core.find_repo_root(Path(__file__).parent)
    ai_dir = repo_root / ".ai"

    tasks, epics, errors, warnings = collect(ai_dir)

    if args.report:
        rows = repository_sync_report(tasks)
        if args.json:
            print(json.dumps(rows, indent=2))
        else:
            print("Repository-sync report (%d cards with repo traceability):" % len(rows))
            for r in rows:
                plan = (" plan #" + ", #".join(r["plan"])) if r["plan"] else ""
                print("  %s [%s] %s%s -- %d evidence link(s)"
                      % (r["id"], r["status"], r["repo"] or "(no repo)", plan, r["evidence_count"]))
        return 0

    if args.json:
        print(json.dumps({"errors": errors, "warnings": warnings,
                          "tasks": len(tasks), "epics": len(epics)}, indent=2))
    else:
        print("Validated %d tasks, %d epics." % (len(tasks), len(epics)))
        if errors:
            print("\nERRORS (%d):" % len(errors))
            for e in errors:
                print("  x %s" % e)
        if warnings:
            print("\nWARNINGS (%d):" % len(warnings))
            for w in warnings:
                print("  ! %s" % w)
        if not errors and not warnings:
            print("Clean -- no errors or warnings.")
        elif not errors:
            print("\nNo errors. %d warning(s)." % len(warnings))

    if errors:
        return 1
    if args.strict and warnings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
