#!/usr/bin/env python3
"""Shared parsing and validation core for the .ai/ project tracker.

Zero dependencies beyond the Python 3 standard library. This module is the
single source of truth for how task/epic files are parsed and validated, so
that `generate_board.py` (kanban view), `validate_board.py` (safe, read-only
data checks) and `test_board.py` (tests) never duplicate that logic.

Task/epic files use "Key: value" header lines under the title (see
.ai/templates/*.md and .claude/skills/project-tracking/SKILL.md). All fields
are optional except Status/Priority/Assignee; unknown fields are preserved
verbatim, so adding a new field here never breaks an existing board.

New optional traceability fields (backward compatible -- a card without them
renders exactly as before):

- Repo         a repository slug, e.g. "TungstenKnowledgeDiscovery"
- Plan         one or more repository plan/backlog IDs (comma-separated)
- Evidence     one or more evidence links (semicolon-separated)
- Completion evidence   evidence links for a completed item (semicolon-separated)
- Stage        assessment | implementation | runtime-validation-pending
"""

import re
from pathlib import Path

FIELD_RE = re.compile(r"^([A-Za-z][A-Za-z /]*[A-Za-z]):\s*(.*)$")
TITLE_RE = re.compile(r"^#\s*(?:Epic:\s*)?(\S+)\s*--\s*(.+?)\s*$")

# Comma-separated list fields.
LIST_FIELDS = {"theme", "tags", "blocked by", "plan"}
# Link fields split on ';' so URLs/markdown links containing commas stay intact.
EVIDENCE_FIELDS = {"evidence", "completion evidence"}

COLUMN_ORDER = [("backlog", "Backlog"), ("in-progress", "In Progress"), ("done", "Done")]
PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

# Recommended values for the Stage field and their human labels. Any other
# value is still accepted (rendered as-is) -- this set only drives the badge
# text/colour and the validator's "unusual stage" hint.
STAGE_LABELS = {
    "assessment": "assessment complete",
    "assessment-complete": "assessment complete",
    "implementation": "implementation complete",
    "implementation-complete": "implementation complete",
    "runtime-validation-pending": "runtime validation pending",
    "runtime-pending": "runtime validation pending",
}


def find_repo_root(start: Path) -> Path:
    p = start.resolve()
    for candidate in [p, *p.parents]:
        if (candidate / ".ai").is_dir():
            return candidate
    raise SystemExit("Could not find a .ai/ directory above %s" % start)


def parse_item(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    item = {
        "file": str(path),
        "id": path.stem,
        "title": path.stem,
        "assignee_claim": None,
        "fields": {},
    }

    if lines:
        m = TITLE_RE.match(lines[0])
        if m:
            item["id"] = m.group(1)
            title = m.group(2)
            claim = re.search(r"\(@([A-Za-z0-9_.\-]+)\)\s*$", title)
            if claim:
                item["assignee_claim"] = claim.group(1)
                title = title[: claim.start()].strip()
            item["title"] = title

    for line in lines[1:]:
        if line.strip() == "" or line.startswith("#"):
            if line.startswith("#"):
                break
            continue
        m = FIELD_RE.match(line.strip())
        if not m:
            break
        key = m.group(1).strip().lower()
        value = m.group(2).strip()
        if key in EVIDENCE_FIELDS:
            item["fields"][key] = [
                v.strip() for v in value.split(";") if v.strip() and not v.strip().startswith("<")
            ]
        elif key in LIST_FIELDS:
            item["fields"][key] = [
                v.strip() for v in value.split(",") if v.strip() and not v.strip().startswith("<")
            ]
        else:
            item["fields"][key] = "" if value.startswith("<") else value

    return item


def load_tasks(ai_dir: Path):
    tasks = []
    for folder, status_fallback in (
        ("backlog", "backlog"),
        ("in-progress", "in-progress"),
        ("done", "done"),
    ):
        d = ai_dir / folder
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.md")):
            item = parse_item(f)
            item["fields"].setdefault("status", status_fallback)
            item["folder"] = folder
            item["relpath"] = ".ai/%s/%s" % (folder, f.name)
            tasks.append(item)
    return tasks


def load_epics(ai_dir: Path):
    epics = {}
    d = ai_dir / "epics"
    if d.is_dir():
        for f in sorted(d.glob("*.md")):
            item = parse_item(f)
            item["relpath"] = ".ai/epics/%s" % f.name
            epics[item["id"]] = item
    return epics


def load_dotenv(repo_root: Path) -> dict:
    """Minimal, dependency-free .env reader -- KEY=VALUE per line, '#'
    comments, no interpolation. Real environment variables win (checked by the
    caller)."""
    env_path = repo_root / ".env"
    values = {}
    if not env_path.is_file():
        return values
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def build_board_data(tasks, epics, base_url=""):
    columns = {key: [] for key, _ in COLUMN_ORDER}
    assignees = set()
    themes = set()
    base_url = base_url.rstrip("/")

    for t in tasks:
        f = t["fields"]
        status = f.get("status", t["folder"])
        assignee = f.get("assignee") or t["assignee_claim"] or "unassigned"
        theme = f.get("theme") or []
        epic_id = f.get("epic")
        if (not theme) and epic_id and epic_id in epics:
            theme = epics[epic_id]["fields"].get("theme", [])
        blocked_by = f.get("blocked by") or []
        blocked_reason = f.get("blocked", "")
        if not blocked_reason and blocked_by:
            blocked_reason = "waiting on " + ", ".join(blocked_by)
        blocked = bool(blocked_reason)

        assignees.add(assignee)
        for th in theme:
            themes.add(th)

        card = {
            "id": t["id"],
            "title": t["title"],
            "assignee": assignee,
            "priority": f.get("priority", ""),
            "epic": epic_id or "",
            "epic_title": epics.get(epic_id, {}).get("title", "") if epic_id else "",
            "theme": theme,
            "blocked": blocked,
            "blocked_reason": blocked_reason,
            "blocked_by": blocked_by,
            "repo": f.get("repo", ""),
            "plan": f.get("plan") or [],
            "evidence": f.get("evidence") or [],
            "completion_evidence": f.get("completion evidence") or [],
            "stage": f.get("stage", ""),
            "url": (base_url + "/" + t["relpath"]) if base_url else "",
        }
        columns.setdefault(status, []).append(card)

    for key in columns:
        columns[key].sort(key=lambda c: PRIORITY_ORDER.get(c["priority"], 9))

    return {
        "columns": columns,
        "assignees": sorted(assignees),
        "themes": sorted(themes),
    }


# --------------------------------------------------------------------------
# Validation helpers (read-only -- never mutate files). Each returns a list of
# plain-data findings so callers can format them however they like.
# --------------------------------------------------------------------------

def parse_roster(conventions_path: Path):
    """Extract the set of valid assignee handles from CONVENTIONS.md's team
    roster table (any `@handle` token), plus the literal 'unassigned'. Returns
    an empty set if the file is missing, which callers treat as "skip the
    assignee check" rather than "everything is invalid"."""
    handles = set()
    if not conventions_path.is_file():
        return handles
    for h in re.findall(r"`?@([A-Za-z0-9_.\-]+)`?", conventions_path.read_text(encoding="utf-8")):
        handles.add(h)
    handles.add("unassigned")
    return handles


def card_assignee(t):
    return t["fields"].get("assignee") or t["assignee_claim"] or "unassigned"


def find_duplicate_ids(tasks, epics):
    seen = {}
    for t in list(tasks) + list(epics.values()):
        seen.setdefault(t["id"], []).append(t.get("relpath", t["file"]))
    return {tid: files for tid, files in seen.items() if len(files) > 1}


def find_status_folder_mismatches(tasks):
    out = []
    for t in tasks:
        status = t["fields"].get("status", t["folder"])
        if status != t["folder"]:
            out.append((t["id"], status, t["folder"]))
    return out


def find_unknown_assignees(tasks, roster):
    if not roster:
        return []
    out = []
    for t in tasks:
        a = card_assignee(t)
        handle = a[1:] if a.startswith("@") else a
        if handle not in roster:
            out.append((t["id"], a))
    return out


def find_unknown_epics(tasks, epics):
    out = []
    for t in tasks:
        epic_id = t["fields"].get("epic")
        if epic_id and epic_id.lower() != "none" and epic_id not in epics:
            out.append((t["id"], epic_id))
    return out


def find_dangling_blocked_by(tasks, epics):
    ids = {t["id"] for t in tasks} | set(epics)
    out = []
    for t in tasks:
        for dep in t["fields"].get("blocked by", []):
            if dep not in ids:
                out.append((t["id"], dep))
    return out


_LINK_HINT = re.compile(r"https?://|PR\s*#\d+|\.md\b|docs/|\.ai/|#\d{2,}", re.IGNORECASE)


def find_missing_evidence(tasks):
    """Done cards with no evidence signal at all: no Evidence/Completion
    evidence field AND nothing link-like in the body. Warning-level -- a done
    card should point at something."""
    out = []
    for t in tasks:
        status = t["fields"].get("status", t["folder"])
        if status != "done":
            continue
        if t["fields"].get("evidence") or t["fields"].get("completion evidence"):
            continue
        body = Path(t["file"]).read_text(encoding="utf-8")
        if not _LINK_HINT.search(body):
            out.append(t["id"])
    return out


def find_stale_in_progress(tasks, today, max_age_days=30):
    """In-progress cards whose `Started` date is older than max_age_days and
    which are not blocked -- candidates for a status check. `today` is a
    datetime.date; `Started` is parsed leniently (YYYY-MM or YYYY-MM-DD)."""
    import datetime

    out = []
    for t in tasks:
        status = t["fields"].get("status", t["folder"])
        if status != "in-progress":
            continue
        if t["fields"].get("blocked"):
            continue
        started = t["fields"].get("started", "")
        d = _parse_lenient_date(started)
        if d is None:
            continue
        if (today - d).days > max_age_days:
            out.append((t["id"], started, (today - d).days))
    return out


def _parse_lenient_date(s):
    import datetime

    s = (s or "").strip()
    for fmt in ("%Y-%m-%d", "%Y-%m"):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def check_numbering(tasks, epics, status_next_free):
    """Confirm STATUS.md's declared next-free number is strictly greater than
    the highest NATIVE numeric ID in use. Returns (ok, highest, declared) -- ok
    is False if the declared next-free would collide with or trail an existing
    native number.

    Mirror cards -- a board card that carries a `Repo` field and represents
    another repository's plan under that plan's own number (e.g. board card 252
    mirroring KD plan 252) -- are excluded: they are numbered by the foreign
    repo's sequence, not this board's, so they must not drag this board's
    next-free number forward. Duplicate-ID detection still applies to them."""
    nums = []
    for t in list(tasks) + list(epics.values()):
        if t["fields"].get("repo"):
            continue  # mirror card, numbered by the foreign repo
        m = re.match(r"^(\d+)$", t["id"])
        if m:
            nums.append(int(m.group(1)))
    highest = max(nums) if nums else 0
    if status_next_free is None:
        return (None, highest, None)
    return (status_next_free > highest, highest, status_next_free)


def read_status_next_free(ai_dir: Path):
    status_path = ai_dir / "STATUS.md"
    if not status_path.is_file():
        return None
    m = re.search(r"[Nn]ext free[^*\n]*\*\*(\d+)\*\*", status_path.read_text(encoding="utf-8"))
    return int(m.group(1)) if m else None
