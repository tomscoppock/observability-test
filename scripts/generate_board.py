#!/usr/bin/env python3
"""Generate a static kanban board (board.html) from the .ai/ project tracker.

Zero dependencies beyond the Python 3 standard library -- no pip install, no
npm, no network access. Run from anywhere inside the repo:

    python3 scripts/generate_board.py [--out board.html]

Parsing and validation live in board_core.py (shared with validate_board.py and
test_board.py) so there is a single source of truth. This script owns only the
HTML rendering. It is a snapshot, not a live view -- re-run after task changes.

Each card's title links to its source .md file on GitHub, if a base URL is
configured. Set BOARD_BASE_URL in a repo-root .env (see .env.example) or as a
real environment variable -- it should be the "blob" URL for this repo's
branch, e.g. https://github.com/ORG/REPO/blob/main. Nothing is linked if unset.

Cards also surface optional traceability fields when present (fully backward
compatible -- a card without them renders as before): Repo / Plan (repository +
plan-ID links), Evidence / Completion evidence (source links), Stage
(assessment / implementation / runtime-validation-pending) and Blocked by
(dependency chips). See board_core.py for the field reference.
"""

import argparse
import datetime
import json
import os
import sys
from pathlib import Path

import board_core as core


HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Project Board</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 1.5rem; background: #f4f5f7; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  .theme-banners { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 1.1rem; }
  .theme-banner { padding: 0.45rem 0.9rem; border-radius: 8px; cursor: pointer; border: 2px solid transparent; min-width: 150px; box-shadow: 0 1px 2px rgba(0,0,0,0.12); }
  .theme-banner:hover { filter: brightness(0.95); }
  .theme-banner.active { border-color: #333; }
  .theme-banner:focus-visible { outline: 3px solid #1a56db; outline-offset: 2px; }
  .theme-banner-name { font-weight: 700; font-size: 0.85rem; }
  .theme-banner-counts { font-size: 0.7rem; color: #333; margin-top: 0.15rem; }
  .filters { display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
  .filters select { padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid #ccc; }
  .filters .clear-theme { font-size: 0.75rem; cursor: pointer; color: #555; text-decoration: underline; background: none; border: none; padding: 0; }
  .board { display: flex; gap: 1rem; align-items: flex-start; }
  .col { background: #ebecf0; border-radius: 8px; padding: 0.75rem; flex: 1; min-width: 260px; }
  .col h2 { font-size: 0.95rem; margin: 0 0 0.5rem; display: flex; justify-content: space-between; }
  .card { background: #fff; border-radius: 6px; padding: 0.6rem 0.7rem; margin-bottom: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
  .card.blocked { border-left: 4px solid #d64545; }
  .card .id { font-size: 0.7rem; color: #777; }
  .card .title { font-weight: 600; margin: 0.15rem 0 0.35rem; }
  .card .title a { color: inherit; text-decoration: none; }
  .card .title a:hover { text-decoration: underline; }
  .card .meta { display: flex; flex-wrap: wrap; gap: 0.3rem; font-size: 0.7rem; }
  .pill { background: #eee; border-radius: 10px; padding: 0.1rem 0.5rem; }
  .pill.assignee { background: #d3e5ff; }
  .pill.priority-critical { background: #d64545; color: #fff; font-weight: 700; }
  .pill.priority-high { background: #ffd6d6; }
  .pill.priority-medium { background: #fff3cd; }
  .pill.priority-low { background: #e6e6e6; }
  .pill.repo { background: #dfeee0; }
  .blocked-reason { color: #a33; font-size: 0.72rem; margin-top: 0.3rem; }
  .deps { font-size: 0.7rem; margin-top: 0.25rem; display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
  .deps .dep-chip { background: #f0d9d9; border-radius: 8px; padding: 0.05rem 0.4rem; }
  .stage-badge { display: inline-block; font-size: 0.68rem; margin-top: 0.3rem; padding: 0.1rem 0.5rem; border-radius: 4px; font-weight: 600; }
  .stage-assessment { background: #e3d3ff; color: #3a2b57; }
  .stage-implementation { background: #cfe8cf; color: #1f4d23; }
  .stage-runtime { background: #ffe1c2; color: #6b3d10; }
  .stage-other { background: #e6e6e6; color: #333; }
  .evidence { list-style: none; margin: 0.3rem 0 0; padding: 0; font-size: 0.7rem; }
  .evidence li { margin: 0.1rem 0; }
  .evidence .ev-label { color: #555; font-weight: 600; }
  .evidence a { color: #1a56db; }
  .empty { color: #888; font-size: 0.85rem; padding: 0.5rem; }
  .hidden { display: none !important; }
  .legend { display: flex; flex-wrap: wrap; gap: 0.35rem 1.1rem; align-items: center; margin-bottom: 1rem; font-size: 0.72rem; color: #444; }
  .legend .legend-item { display: flex; align-items: center; gap: 0.35rem; }
  .legend .swatch { display: inline-block; width: 0.85rem; height: 0.85rem; border-radius: 3px; background: #eee; }
  .legend .swatch.blocked-swatch { width: 0.3rem; height: 0.85rem; border-radius: 0; background: #d64545; }
  .legend .swatch.assignee { background: #d3e5ff; }
  .legend .swatch.theme-multi { background: linear-gradient(90deg, #d8f5d0 50%, #ffe1c2 50%); }
  .legend .swatch.priority-critical { background: #d64545; }
  .legend .swatch.priority-high { background: #ffd6d6; }
  .legend .swatch.priority-medium { background: #fff3cd; }
  .legend .swatch.priority-low { background: #e6e6e6; }
  details.legend-toggle { margin-bottom: 1rem; }
  details.legend-toggle summary { cursor: pointer; font-size: 0.8rem; color: #555; }
  a:focus-visible, button:focus-visible, select:focus-visible { outline: 3px solid #1a56db; outline-offset: 2px; }
</style>
</head>
<body>
<h1>Project Board <small id="generated"></small></h1>
<details class="legend-toggle" open>
  <summary>Key</summary>
  <div class="legend">
    <span class="legend-item"><span class="swatch blocked-swatch"></span> Red left border = blocked (reason shown on the card)</span>
    <span class="legend-item"><span class="swatch assignee"></span> Blue pill = assignee</span>
    <span class="legend-item"><span class="swatch theme-multi"></span> Colored pill/banner = theme -- each theme has its own color, matched between the banners below and the pills on its cards</span>
    <span class="legend-item"><span class="swatch priority-critical"></span> Priority: critical</span>
    <span class="legend-item"><span class="swatch priority-high"></span> Priority: high</span>
    <span class="legend-item"><span class="swatch priority-medium"></span> Priority: medium</span>
    <span class="legend-item"><span class="swatch priority-low"></span> Priority: low</span>
    <span class="legend-item">Stage badge = assessment / implementation / runtime-validation-pending</span>
    <span class="legend-item">Underlined title = click to open the task's .md file on GitHub (needs BOARD_BASE_URL configured -- see .env.example)</span>
  </div>
</details>
<div class="theme-banners" id="theme-banners" role="group" aria-label="Filter by theme"></div>
<div class="filters">
  <label>Assignee <select id="assignee-filter" aria-label="Filter by assignee"><option value="">All</option></select></label>
  <button type="button" class="clear-theme" id="clear-theme">Clear theme filter</button>
</div>
<div class="board" id="board"></div>
<script>
const DATA = __DATA_JSON__;
const GENERATED = "__GENERATED__";
document.getElementById("generated").textContent = "(generated " + GENERATED + ")";

const columnDefs = __COLUMN_ORDER_JSON__;

// Deterministic color per theme (stable as long as the theme set doesn't
// change) -- cycles through this palette in sorted-theme order.
const THEME_PALETTE = [
  "#d8f5d0", "#ffe1c2", "#e3d3ff", "#ffd3e8", "#c2f0e6",
  "#fff3b0", "#e6e2d3", "#cfe8cf", "#f3d9ff", "#d9e8ff",
];
const themeColor = {};
DATA.themes.forEach((t, i) => { themeColor[t] = THEME_PALETTE[i % THEME_PALETTE.length]; });

const STAGE_CLASS = {
  "assessment": "stage-assessment",
  "assessment-complete": "stage-assessment",
  "implementation": "stage-implementation",
  "implementation-complete": "stage-implementation",
  "runtime-validation-pending": "stage-runtime",
  "runtime-pending": "stage-runtime",
};
const STAGE_LABEL = {
  "assessment": "assessment complete",
  "assessment-complete": "assessment complete",
  "implementation": "implementation complete",
  "implementation-complete": "implementation complete",
  "runtime-validation-pending": "runtime validation pending",
  "runtime-pending": "runtime validation pending",
};

let activeTheme = "";

function pill(text, cls, bg) {
  const span = document.createElement("span");
  span.className = "pill " + cls;
  span.textContent = text;
  if (bg) span.style.background = bg;
  return span;
}

// A link if it looks like a URL, otherwise a plain code-styled span. Keeps
// repo-relative paths (e.g. .ai/backlog/252-...md) readable without a base URL.
function evidenceNode(ref) {
  const isUrl = /^https?:\\/\\//i.test(ref);
  if (isUrl) {
    const a = document.createElement("a");
    a.href = ref;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = ref;
    return a;
  }
  const code = document.createElement("span");
  code.textContent = ref;
  return code;
}

function renderCard(card) {
  const div = document.createElement("div");
  div.className = "card" + (card.blocked ? " blocked" : "");
  div.dataset.assignee = card.assignee;
  div.dataset.themes = JSON.stringify(card.theme);

  const idLine = document.createElement("div");
  idLine.className = "id";
  idLine.textContent = card.id + (card.epic ? " - epic " + card.epic : "");
  div.appendChild(idLine);

  const title = document.createElement("div");
  title.className = "title";
  if (card.url) {
    const link = document.createElement("a");
    link.href = card.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = card.title;
    title.appendChild(link);
  } else {
    title.textContent = card.title;
  }
  div.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "meta";
  if (card.assignee) meta.appendChild(pill(card.assignee, "assignee"));
  if (card.priority) meta.appendChild(pill(card.priority, "priority-" + card.priority));
  (card.theme || []).forEach(t => meta.appendChild(pill(t, "theme", themeColor[t])));
  if (card.repo) {
    const planSuffix = (card.plan && card.plan.length) ? (" #" + card.plan.join(", #")) : "";
    meta.appendChild(pill(card.repo + planSuffix, "repo"));
  }
  div.appendChild(meta);

  if (card.stage) {
    const badge = document.createElement("span");
    badge.className = "stage-badge " + (STAGE_CLASS[card.stage] || "stage-other");
    badge.textContent = STAGE_LABEL[card.stage] || card.stage;
    div.appendChild(badge);
  }

  if (card.blocked && card.blocked_reason) {
    const b = document.createElement("div");
    b.className = "blocked-reason";
    b.setAttribute("role", "note");
    b.textContent = "Blocked: " + card.blocked_reason;
    div.appendChild(b);
  }

  if (card.blocked_by && card.blocked_by.length) {
    const deps = document.createElement("div");
    deps.className = "deps";
    const label = document.createElement("span");
    label.textContent = "Depends on:";
    deps.appendChild(label);
    card.blocked_by.forEach(d => {
      const chip = document.createElement("span");
      chip.className = "dep-chip";
      chip.textContent = "#" + d;
      deps.appendChild(chip);
    });
    div.appendChild(deps);
  }

  const evidence = (card.completion_evidence && card.completion_evidence.length)
    ? { label: "Completion evidence", items: card.completion_evidence }
    : (card.evidence && card.evidence.length)
      ? { label: "Evidence", items: card.evidence }
      : null;
  if (evidence) {
    const ul = document.createElement("ul");
    ul.className = "evidence";
    ul.setAttribute("aria-label", evidence.label);
    const head = document.createElement("li");
    const hl = document.createElement("span");
    hl.className = "ev-label";
    hl.textContent = evidence.label + ":";
    head.appendChild(hl);
    ul.appendChild(head);
    evidence.items.forEach(ref => {
      const li = document.createElement("li");
      li.appendChild(evidenceNode(ref));
      ul.appendChild(li);
    });
    div.appendChild(ul);
  }

  return div;
}

function computeThemeCounts() {
  const counts = {};
  DATA.themes.forEach(t => { counts[t] = { backlog: 0, "in-progress": 0, done: 0 }; });
  Object.keys(DATA.columns).forEach(status => {
    (DATA.columns[status] || []).forEach(card => {
      (card.theme || []).forEach(t => {
        if (counts[t]) counts[t][status] = (counts[t][status] || 0) + 1;
      });
    });
  });
  return counts;
}

function renderThemeBanners() {
  const counts = computeThemeCounts();
  const bar = document.getElementById("theme-banners");
  bar.innerHTML = "";
  DATA.themes.forEach(t => {
    const c = counts[t] || { backlog: 0, "in-progress": 0, done: 0 };
    const banner = document.createElement("button");
    banner.type = "button";
    banner.className = "theme-banner" + (activeTheme === t ? " active" : "");
    banner.style.background = themeColor[t];
    banner.setAttribute("aria-pressed", activeTheme === t ? "true" : "false");

    const name = document.createElement("div");
    name.className = "theme-banner-name";
    name.textContent = t;
    banner.appendChild(name);

    const counts_el = document.createElement("div");
    counts_el.className = "theme-banner-counts";
    counts_el.textContent = "Backlog " + c.backlog + " \\u00b7 In Progress " + c["in-progress"] + " \\u00b7 Done " + c.done;
    banner.appendChild(counts_el);

    banner.addEventListener("click", () => {
      activeTheme = (activeTheme === t) ? "" : t;
      renderThemeBanners();
      applyFilters();
    });

    bar.appendChild(banner);
  });
}

function render() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  columnDefs.forEach(([key, label]) => {
    const col = document.createElement("div");
    col.className = "col";
    col.setAttribute("role", "region");
    col.setAttribute("aria-label", label);
    const cards = DATA.columns[key] || [];
    const h2 = document.createElement("h2");
    h2.textContent = label + " (" + cards.length + ")";
    col.appendChild(h2);
    if (cards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Nothing here.";
      col.appendChild(empty);
    }
    cards.forEach(c => col.appendChild(renderCard(c)));
    board.appendChild(col);
  });
  applyFilters();
}

function applyFilters() {
  const a = document.getElementById("assignee-filter").value;
  document.querySelectorAll(".card").forEach(el => {
    const themes = JSON.parse(el.dataset.themes || "[]");
    const showA = !a || el.dataset.assignee === a;
    const showT = !activeTheme || themes.includes(activeTheme);
    el.classList.toggle("hidden", !(showA && showT));
  });
}

function fillOptions(id, values) {
  const sel = document.getElementById(id);
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", applyFilters);
}

document.getElementById("clear-theme").addEventListener("click", () => {
  activeTheme = "";
  renderThemeBanners();
  applyFilters();
});

fillOptions("assignee-filter", DATA.assignees);
renderThemeBanners();
render();
</script>
</body>
</html>
"""


def render_html(data, generated):
    """Substitute board data into the template. Pure function -- no file or
    environment access -- so tests can render a fixture directly."""
    return (
        HTML_TEMPLATE.replace("__DATA_JSON__", json.dumps(data))
        .replace("__COLUMN_ORDER_JSON__", json.dumps(core.COLUMN_ORDER))
        .replace("__GENERATED__", generated)
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="board.html", help="output HTML path (default: board.html at repo root)")
    args = parser.parse_args()

    repo_root = core.find_repo_root(Path(__file__).parent)
    ai_dir = repo_root / ".ai"

    dotenv_values = core.load_dotenv(repo_root)
    # A real environment variable always wins over the .env file.
    base_url = os.environ.get("BOARD_BASE_URL") or dotenv_values.get("BOARD_BASE_URL", "")
    if not base_url:
        print("No BOARD_BASE_URL set (.env or env var) -- task titles will not be linked. See .env.example.")

    tasks = core.load_tasks(ai_dir)
    epics = core.load_epics(ai_dir)

    for task_id, status, folder in core.find_status_folder_mismatches(tasks):
        print(
            "WARNING: %s has Status: %s but lives in %s/ -- it will render "
            "under '%s' on the board, not '%s'. Fix the Status: field or "
            "move the file so they match."
            % (task_id, status, folder, status, folder)
        )

    data = core.build_board_data(tasks, epics, base_url)

    out_path = (repo_root / args.out) if not Path(args.out).is_absolute() else Path(args.out)
    rendered = render_html(data, datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))
    out_path.write_text(rendered, encoding="utf-8")
    print("Wrote %s (%d tasks, %d epics)" % (out_path, len(tasks), len(epics)))


if __name__ == "__main__":
    sys.exit(main())
