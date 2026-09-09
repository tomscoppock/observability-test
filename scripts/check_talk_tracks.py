#!/usr/bin/env python3
"""Verify demo talk tracks against the dashboards they describe.

Usage:
    python3 scripts/check_talk_tracks.py
    python3 scripts/check_talk_tracks.py --strict   # non-zero exit on warnings

Catches the drift class that left docs/demo-talk-track.md claiming 5 charts
on its "LLM and AI" tab while splunk/dashboard.json held 10, with five
charts missing from its reference table entirely. A presenter following a
stale talk track discovers that live, in front of an audience.

Checks, per talk track:
  1. Every [CHART] marker names a chart that actually exists.       (error)
  2. Every reference-table entry names a chart that exists.         (error)
  3. Each per-tab chart count in the reference table headings
     matches the real number of charts on that tab.                (error)
  4. Charts that exist but appear in no reference table.            (error)
  5. Charts never mentioned by a [CHART] marker.                   (warning)

Read-only. Worth running before any demo, and after any dashboard edit.
"""

import argparse
import io
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CHART_MARKER = re.compile(r'\*\*\[CHART\]\*\*\s*`([^`]+)`')
# Reference-table headings: "### Service Overview (8 charts)" or
# "### LLM and AI (9 items, covering 10 Splunk charts)"
TAB_HEADING = re.compile(r'^###\s+(.+?)\s+\((\d+)\s+(?:charts|items)')
# Table rows in either style: "| 1 | Chart name | ... |" (Splunk track)
# or "| `Chart name` | ... |" (Azure track).
ROW_NUMBERED = re.compile(r'^\|\s*\d+\s*\|\s*([^|]+?)\s*\|')
ROW_BACKTICKED = re.compile(r'^\|\s*`([^`]+)`\s*\|')


def splunk_tabs():
    """Return ({tab: [chart names]}, path) for the Splunk dashboard."""
    path = os.path.join(REPO_ROOT, 'splunk', 'dashboard.json')
    with io.open(path, encoding='utf-8') as handle:
        data = json.load(handle)
    tabs = {}
    for dashboard in data.get('dashboards', []):
        tabs[dashboard['name']] = [c['name'] for c in dashboard.get('charts', [])]
    return tabs, path


def azure_tabs():
    """Return ({tab label: [item titles]}, path) for the Azure workbook."""
    path = os.path.join(REPO_ROOT, 'azure', 'workbook.json')
    with io.open(path, encoding='utf-8') as handle:
        data = json.load(handle)

    # Map group name -> tab label via the links item, so the reported tab
    # names match what a presenter actually sees.
    labels = {}
    for item in data.get('items', []):
        if item.get('type') == 11:
            for link in item.get('content', {}).get('links', []):
                labels['group-%s' % link['subTarget']] = link['linkLabel']

    tabs = {}
    for group in [i for i in data.get('items', []) if i.get('type') == 12]:
        label = labels.get(group.get('name'), group.get('name'))
        titles = []
        for item in group.get('content', {}).get('items', []):
            if item.get('type') == 3:
                title = item.get('content', {}).get('title')
                if title:
                    titles.append(title)
        tabs[label] = titles
    return tabs, path


def check(track_path, tabs, source_path):
    """Return (errors, warnings) for one talk track."""
    if not os.path.exists(track_path):
        return ['talk track not found: %s' % track_path], []

    with io.open(track_path, encoding='utf-8') as handle:
        text = handle.read()

    track = os.path.relpath(track_path, REPO_ROOT)
    source = os.path.relpath(source_path, REPO_ROOT)
    known = {name for names in tabs.values() for name in names}

    errors = []
    warnings = []
    marker_names = set(CHART_MARKER.findall(text))
    table_names = set()

    for name in sorted(marker_names):
        if name not in known:
            errors.append('%s: [CHART] names "%s", absent from %s'
                          % (track, name, source))

    # Walk the reference tables, tracking which tab heading we are under so
    # the stated per-tab count can be compared against reality.
    current_tab = None
    counted = 0
    claimed = None
    for line in text.split('\n') + ['### __end__ (0 charts)']:
        heading = TAB_HEADING.match(line)
        if heading:
            if current_tab is not None and claimed is not None:
                actual = len(tabs.get(current_tab, []))
                if current_tab not in tabs:
                    errors.append('%s: reference table has a tab "%s" that is '
                                  'not in %s' % (track, current_tab, source))
                elif claimed != actual:
                    errors.append('%s: "%s" heading claims %d, but %s holds %d'
                                  % (track, current_tab, claimed, source, actual))
                elif counted != actual:
                    errors.append('%s: "%s" heading claims %d and the table '
                                  'lists %d rows' % (track, current_tab, claimed, counted))
            current_tab = heading.group(1)
            claimed = int(heading.group(2))
            counted = 0
            continue

        match = ROW_BACKTICKED.match(line) or ROW_NUMBERED.match(line)
        if match:
            name = match.group(1).strip()
            if name in ('Chart name', 'Item name', 'Metric'):
                continue
            table_names.add(name)
            counted += 1
            if name not in known:
                errors.append('%s: reference table lists "%s", absent from %s'
                              % (track, name, source))

    for name in sorted(known - table_names):
        errors.append('%s: "%s" exists in %s but is in no reference table'
                      % (track, name, source))

    for name in sorted(known - marker_names):
        warnings.append('%s: no [CHART] marker for "%s"' % (track, name))

    return errors, warnings


def main():
    parser = argparse.ArgumentParser(
        description='Verify demo talk tracks against their dashboards.')
    parser.add_argument('--strict', action='store_true',
                        help='exit non-zero on warnings as well as errors')
    args = parser.parse_args()

    s_tabs, s_path = splunk_tabs()
    a_tabs, a_path = azure_tabs()

    print('Splunk dashboard : %d charts across %d tabs (%s)'
          % (sum(len(v) for v in s_tabs.values()), len(s_tabs),
             os.path.relpath(s_path, REPO_ROOT)))
    print('Azure workbook   : %d items across %d tabs (%s)'
          % (sum(len(v) for v in a_tabs.values()), len(a_tabs),
             os.path.relpath(a_path, REPO_ROOT)))
    print('')

    all_errors = []
    all_warnings = []
    for track, tabs, source in (
        (os.path.join(REPO_ROOT, 'docs', 'demo-talk-track.md'), s_tabs, s_path),
        (os.path.join(REPO_ROOT, 'docs', 'demo-talk-track-azure.md'), a_tabs, a_path),
    ):
        errors, warnings = check(track, tabs, source)
        all_errors.extend(errors)
        all_warnings.extend(warnings)

    if all_errors:
        print('ERRORS (%d):' % len(all_errors))
        for item in all_errors:
            print('  x %s' % item)
        print('')
    if all_warnings:
        print('WARNINGS (%d):' % len(all_warnings))
        for item in all_warnings:
            print('  ! %s' % item)
        print('')
    if not all_errors and not all_warnings:
        print('All talk track chart references match their dashboards.')

    if all_errors:
        return 1
    if all_warnings and args.strict:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
