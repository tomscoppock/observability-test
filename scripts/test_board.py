#!/usr/bin/env python3
"""Tests for the .ai/ board tooling. Standard-library unittest only -- no pip,
no pytest. Run from anywhere:

    python3 scripts/test_board.py
    python3 -m unittest discover -s scripts -p 'test_board.py'

Covers parsing, board-data building (including new traceability fields and
critical-priority sorting), status-movement / duplicate / assignee / epic /
blocked-by / evidence / numbering validation, and HTML rendering of the new
fields.
"""

import datetime
import tempfile
import unittest
from pathlib import Path

import board_core as core
import generate_board


def write(p: Path, text: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def make_ai_tree(root: Path):
    """A small but representative .ai/ fixture."""
    ai = root / ".ai"
    write(ai / "CONVENTIONS.md", "| Name | Handle |\n| Phani | `@phani` |\n| Tom | `@tom` |\n")
    write(ai / "STATUS.md", "## Numbering\n\nNext free backlog/epic/task number: **200**\n")
    write(ai / "epics" / "100-sample-epic.md",
          "# Epic: 100 -- Sample epic\n\nStatus: in-progress\nTheme: knowledge-discovery\nLead: @tom\n")
    write(ai / "backlog" / "101-a-backlog-item.md",
          "# 101 -- A backlog item (@phani)\n\nStatus: backlog\nPriority: high\n"
          "Assignee: @phani\nEpic: 100\nTheme: knowledge-discovery\n"
          "Blocked by: 102\n\n## Description\n\nDo a thing.\n")
    write(ai / "backlog" / "102-critical-item.md",
          "# 102 -- Critical item\n\nStatus: backlog\nPriority: critical\n"
          "Assignee: @phani\nRepo: TungstenKnowledgeDiscovery\nPlan: 252, 285\n"
          "Stage: assessment\nEvidence: https://example.com/a; docs/analysis/x.md\n"
          "\n## Description\n\nSecurity gap.\n")
    write(ai / "in-progress" / "103-active-item.md",
          "# 103 -- Active item (@tom)\n\nStatus: in-progress\nPriority: medium\n"
          "Assignee: @tom\nStarted: 2026-07-01\n\n## Description\n\nWorking.\n")
    write(ai / "done" / "104-finished-item.md",
          "# 104 -- Finished item\n\nStatus: done\nPriority: low\nAssignee: @tom\n"
          "Completion evidence: https://example.com/pr/1\n\n## Notes\n\nDone.\n")
    return ai


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ai = make_ai_tree(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_title_and_claim(self):
        item = core.parse_item(self.ai / "backlog" / "101-a-backlog-item.md")
        self.assertEqual(item["id"], "101")
        self.assertEqual(item["title"], "A backlog item")
        self.assertEqual(item["assignee_claim"], "phani")

    def test_list_and_evidence_fields(self):
        item = core.parse_item(self.ai / "backlog" / "102-critical-item.md")
        self.assertEqual(item["fields"]["plan"], ["252", "285"])
        self.assertEqual(item["fields"]["repo"], "TungstenKnowledgeDiscovery")
        self.assertEqual(item["fields"]["stage"], "assessment")
        # evidence splits on ';' so the URL and path stay intact
        self.assertEqual(item["fields"]["evidence"],
                         ["https://example.com/a", "docs/analysis/x.md"])

    def test_epic_title(self):
        epics = core.load_epics(self.ai)
        self.assertIn("100", epics)
        self.assertEqual(epics["100"]["title"], "Sample epic")


class BoardDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ai = make_ai_tree(Path(self.tmp.name))
        self.tasks = core.load_tasks(self.ai)
        self.epics = core.load_epics(self.ai)
        self.data = core.build_board_data(self.tasks, self.epics, base_url="https://gh/blob/main")

    def tearDown(self):
        self.tmp.cleanup()

    def test_columns_bucketed_by_status(self):
        cols = self.data["columns"]
        self.assertEqual({c["id"] for c in cols["backlog"]}, {"101", "102"})
        self.assertEqual({c["id"] for c in cols["in-progress"]}, {"103"})
        self.assertEqual({c["id"] for c in cols["done"]}, {"104"})

    def test_critical_sorts_before_high(self):
        backlog = self.data["columns"]["backlog"]
        self.assertEqual(backlog[0]["id"], "102")  # critical
        self.assertEqual(backlog[1]["id"], "101")  # high

    def test_blocked_by_derives_reason(self):
        card = next(c for c in self.data["columns"]["backlog"] if c["id"] == "101")
        self.assertTrue(card["blocked"])
        self.assertEqual(card["blocked_by"], ["102"])
        self.assertIn("waiting on 102", card["blocked_reason"])

    def test_traceability_fields_carried(self):
        card = next(c for c in self.data["columns"]["backlog"] if c["id"] == "102")
        self.assertEqual(card["repo"], "TungstenKnowledgeDiscovery")
        self.assertEqual(card["plan"], ["252", "285"])
        self.assertEqual(card["stage"], "assessment")
        self.assertEqual(len(card["evidence"]), 2)

    def test_url_built(self):
        card = next(c for c in self.data["columns"]["done"] if c["id"] == "104")
        self.assertTrue(card["url"].endswith(".ai/done/104-finished-item.md"))


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ai = make_ai_tree(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def _load(self):
        return core.load_tasks(self.ai), core.load_epics(self.ai)

    def test_clean_fixture_has_no_hard_errors(self):
        tasks, epics = self._load()
        self.assertEqual(core.find_duplicate_ids(tasks, epics), {})
        self.assertEqual(core.find_status_folder_mismatches(tasks), [])
        roster = core.parse_roster(self.ai / "CONVENTIONS.md")
        self.assertEqual(core.find_unknown_assignees(tasks, roster), [])
        self.assertEqual(core.find_unknown_epics(tasks, epics), [])
        self.assertEqual(core.find_dangling_blocked_by(tasks, epics), [])

    def test_duplicate_id_detected(self):
        write(self.ai / "backlog" / "104-dupe.md",
              "# 104 -- Dupe\n\nStatus: backlog\nPriority: low\nAssignee: @tom\n")
        tasks, epics = self._load()
        dupes = core.find_duplicate_ids(tasks, epics)
        self.assertIn("104", dupes)

    def test_status_folder_mismatch_detected(self):
        # a file in backlog/ but Status: done -> movement/consistency bug
        write(self.ai / "backlog" / "105-misfiled.md",
              "# 105 -- Misfiled\n\nStatus: done\nPriority: low\nAssignee: @tom\n")
        tasks, _ = self._load()
        mism = core.find_status_folder_mismatches(tasks)
        self.assertIn(("105", "done", "backlog"), mism)

    def test_unknown_assignee_detected(self):
        write(self.ai / "backlog" / "106-ghost.md",
              "# 106 -- Ghost\n\nStatus: backlog\nPriority: low\nAssignee: @nobody\n")
        tasks, _ = self._load()
        roster = core.parse_roster(self.ai / "CONVENTIONS.md")
        self.assertIn(("106", "@nobody"), core.find_unknown_assignees(tasks, roster))

    def test_unknown_epic_detected(self):
        write(self.ai / "backlog" / "107-orphan.md",
              "# 107 -- Orphan\n\nStatus: backlog\nPriority: low\nAssignee: @tom\nEpic: 999\n")
        tasks, epics = self._load()
        self.assertIn(("107", "999"), core.find_unknown_epics(tasks, epics))

    def test_dangling_blocked_by_detected(self):
        write(self.ai / "backlog" / "108-waiting.md",
              "# 108 -- Waiting\n\nStatus: backlog\nPriority: low\nAssignee: @tom\nBlocked by: 900\n")
        tasks, epics = self._load()
        self.assertIn(("108", "900"), core.find_dangling_blocked_by(tasks, epics))

    def test_missing_evidence_warns_for_bare_done(self):
        write(self.ai / "done" / "109-bare.md",
              "# 109 -- Bare done\n\nStatus: done\nPriority: low\nAssignee: @tom\n\n## Notes\n\nNothing linked.\n")
        tasks, _ = self._load()
        self.assertIn("109", core.find_missing_evidence(tasks))
        # 104 has completion evidence -> not flagged
        self.assertNotIn("104", core.find_missing_evidence(tasks))

    def test_stale_in_progress_detected(self):
        tasks, _ = self._load()
        today = datetime.date(2026, 12, 1)  # 103 started 2026-07-01
        stale = core.find_stale_in_progress(tasks, today)
        self.assertTrue(any(row[0] == "103" for row in stale))

    def test_numbering_ok_and_regression(self):
        tasks, epics = self._load()
        ok, highest, declared = core.check_numbering(tasks, epics, 200)
        self.assertTrue(ok)
        self.assertEqual(highest, 104)
        bad, _, _ = core.check_numbering(tasks, epics, 100)
        self.assertFalse(bad)

    def test_mirror_card_excluded_from_numbering(self):
        # a mirror card carrying another repo's high number must NOT drag the
        # native next-free number forward
        write(self.ai / "backlog" / "252-mirror.md",
              "# 252 -- Mirror of KD plan 252\n\nStatus: backlog\nPriority: critical\n"
              "Assignee: @phani\nRepo: TungstenKnowledgeDiscovery\nPlan: 252\n")
        tasks, epics = self._load()
        ok, highest, declared = core.check_numbering(tasks, epics, 200)
        self.assertTrue(ok)            # 200 still valid despite the 252 mirror
        self.assertEqual(highest, 104)  # native highest unchanged
        # but the mirror is still a real card and duplicate detection covers it
        self.assertIn("252", {t["id"] for t in tasks})

    def test_read_status_next_free(self):
        self.assertEqual(core.read_status_next_free(self.ai), 200)


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ai = make_ai_tree(Path(self.tmp.name))
        tasks = core.load_tasks(self.ai)
        epics = core.load_epics(self.ai)
        self.data = core.build_board_data(tasks, epics, base_url="https://gh/blob/main")
        self.html = generate_board.render_html(self.data, "2026-08-04 00:00")

    def tearDown(self):
        self.tmp.cleanup()

    def test_html_is_self_contained(self):
        self.assertIn("<!doctype html>", self.html)
        self.assertNotIn("__DATA_JSON__", self.html)
        self.assertNotIn("http://cdn", self.html.lower())

    def test_new_field_support_present(self):
        # rendering hooks for the new fields exist in the emitted script
        for needle in ("stage-badge", "Depends on:", "Completion evidence",
                       "priority-critical", "aria-label"):
            self.assertIn(needle, self.html)

    def test_data_contains_traceability(self):
        self.assertIn("TungstenKnowledgeDiscovery", self.html)


if __name__ == "__main__":
    unittest.main(verbosity=2)
