#!/usr/bin/env python3
"""Capture BOTH sides of the backend comparison table, Splunk and Azure.

Fills the measured-numbers table in docs/splunk-vs-azure-monitor.md.

Usage:
    python3 scripts/compare_backends.py
    python3 scripts/compare_backends.py --offset 2h
    python3 scripts/compare_backends.py --markdown
    python3 scripts/compare_backends.py --azure-only

Prerequisites:
    - Azure CLI authenticated (az login), with the application-insights
      extension installed
    - SPLUNK_ACCESS_TOKEN and SPLUNK_REALM in .env, the same credentials the
      dashboard REST scripts use. The token needs the API scope.
    - The stack running in DUAL mode, so both backends received the SAME
      telemetry from the SAME traffic run:
          OTEL_COLLECTOR_CONFIG=./otel-collector-config.dual.yaml \\
            docker compose up -d --force-recreate otel-collector
    - One traffic run, e.g. ./scripts/simulate-demo-traffic.sh --duration 10

Splunk is reached over plain HTTP: POST /v2/signalflow/execute on
stream.<realm>.signalfx.com returns Server-Sent Events, and terminates on its
own given immediate=true with a bounded start/stop. No websocket client is
needed.

One script rather than a bash/PowerShell pair, deliberately. The repo's
convention is paired shell scripts for operational tasks, but this is
reporting logic of the same kind as generate_board.py, and duplicating a
non-trivial two-backend query loop is exactly the drift this project keeps
getting bitten by. Python is already required by the board tooling.

Every row still names the Splunk chart and tab, so any number can be checked
against the dashboard a human is looking at.
"""

import argparse
import io
import json
import os
import shutil
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUERY_SET = os.path.join(REPO_ROOT, 'azure', 'comparison-queries.json')

# Resolved once at startup. On Windows the Azure CLI is a .CMD shim and
# subprocess cannot exec it by bare name -- ['az', ...] fails with WinError 2
# while the full path from shutil.which() works. Resolving once is portable:
# on Linux which() returns /usr/bin/az, which execs fine.
AZ_BIN = shutil.which('az')


def load_env():
    """Read .env without clobbering anything already in the environment.

    An existing value wins, so a single setting can be overridden for one
    run without editing the file. Mirrors the other setup scripts.
    """
    path = os.path.join(REPO_ROOT, '.env')
    if not os.path.exists(path):
        return
    with io.open(path, encoding='utf-8', errors='replace') as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
                value = value[1:-1]
            if key and not os.environ.get(key):
                os.environ[key] = value


def offset_to_ms(offset):
    """Parse an az-CLI style offset such as 90m, 2h or 1d into milliseconds.

    The same window is applied to both backends, so the two numbers in a
    table row always describe the same slice of time.
    """
    units = {'m': 60, 'h': 3600, 'd': 86400}
    text = offset.strip().lower()
    if len(text) > 1 and text[-1] in units and text[:-1].isdigit():
        return int(text[:-1]) * units[text[-1]] * 1000
    if text.isdigit():                      # a bare number means hours
        return int(text) * 3600 * 1000
    raise ValueError('unsupported --offset value: %r' % offset)


# ---------------------------------------------------------------------------
# Azure
# ---------------------------------------------------------------------------

def run_az(args):
    """Run an az command, returning (exit_code, stdout).

    stderr is captured rather than inherited, so the az CLI's periodic
    upgrade notices cannot corrupt the table output.
    """
    if AZ_BIN is None:
        return 1, 'az not found on PATH'
    try:
        proc = subprocess.run(
            [AZ_BIN] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
        )
    except OSError as exc:
        return 1, 'could not execute az: %s' % exc
    return proc.returncode, proc.stdout.strip()


def resolve_app_id(resource_group, app_name):
    code, out = run_az([
        'monitor', 'app-insights', 'component', 'show',
        '--resource-group', resource_group, '--app', app_name,
        '--query', 'appId', '-o', 'tsv',
    ])
    if code != 0 or not out:
        return None
    return out


def activity_ages(app_id):
    """Minutes since the last LLM call and the last request.

    Without this, the output is quietly confusing. Application traffic
    arrives in bursts from the simulator while healthchecks run continuously,
    so once a burst has finished, every LLM and token row reports the SAME
    figure for a 30-minute window as for a 60-minute one, while the request
    count keeps climbing. That looks exactly like a caching bug and is not:
    both windows simply contain the whole burst.
    """
    kql = ("let lastChat = toscalar(dependencies "
           "| where tostring(customDimensions['gen_ai.operation.name']) == 'chat' "
           "| summarize max(timestamp)); "
           "let lastReq = toscalar(requests | summarize max(timestamp)); "
           "print c = round((now() - lastChat) / 1m, 1), "
           "r = round((now() - lastReq) / 1m, 1) "
           "| project strcat(tostring(c), ',', tostring(r))")
    code, out = run_az([
        'monitor', 'app-insights', 'query', '--app', app_id,
        '--analytics-query', kql, '--offset', '24h',
        '--query', 'tables[0].rows[0][0]', '-o', 'tsv',
    ])
    if code != 0 or not out or ',' not in out:
        return None, None
    chat, req = out.split(',', 1)
    try:
        return float(chat), float(req)
    except ValueError:
        return None, None


def freshness_note(app_id, window_ms):
    """One line explaining whether the window still bounds the traffic."""
    chat_age, req_age = activity_ages(app_id)
    if chat_age is None:
        return None
    window_min = window_ms / 60000.0
    note = ('Last LLM call %.0f min ago; last request %.0f min ago.'
            % (chat_age, req_age))
    if chat_age < window_min:
        note += (
            ' The whole LLM burst is inside this window, so widening it'
            ' will NOT change the token, LLM-latency or db rows. Only the'
            ' request count grows, because healthchecks are continuous.'
            ' That is correct, not a cached result.')
    else:
        note += (
            ' WARNING: the last LLM call predates this %.0f min window, so'
            ' the LLM and token rows will be empty. Widen --offset, or run'
            ' the traffic simulator again.' % window_min)
    return note


def query_azure(app_id, kql, start_iso, end_iso):
    """Return the single scalar an Azure comparison query yields.

    Uses an absolute --start-time/--end-time rather than a relative
    --offset. With --offset, every row's window is relative to the moment
    that row's az invocation runs, so across a dozen rows the two backends
    drift seconds apart and the counts stop being comparable.
    """
    code, out = run_az([
        'monitor', 'app-insights', 'query', '--app', app_id,
        '--analytics-query', kql,
        '--start-time', start_iso, '--end-time', end_iso,
        '--query', 'tables[0].rows[0][0]', '-o', 'tsv',
    ])
    if code != 0 or not out:
        return '(no data)'
    return out


# ---------------------------------------------------------------------------
# Splunk
# ---------------------------------------------------------------------------

def signalflow(program, realm, token, start_ms, stop_ms, resolution_ms=60000):
    """Execute a SignalFlow program over HTTP, returning {label: [values]}.

    The response is Server-Sent Events: blocks separated by a blank line,
    each carrying an "event:" type and a "data:" JSON payload. The two types
    that matter:

        metadata  maps a tsId to properties, including sf_streamLabel, which
                  is the publish(label=...) name
        data      {"data": [{"tsId": ..., "value": ...}], ...}

    Accept MUST be text/event-stream, or absent. Sending
    "Accept: application/json" returns a bare HTTP 406 with no explanation.
    """
    url = ('https://stream.%s.signalfx.com/v2/signalflow/execute'
           '?start=%d&stop=%d&immediate=true&resolution=%d'
           % (realm, start_ms, stop_ms, resolution_ms))
    request = urllib.request.Request(
        url,
        data=json.dumps({'programText': program}).encode('utf-8'),
        headers={'Content-Type': 'application/json',
                 'X-SF-Token': token,
                 'Accept': 'text/event-stream'},
        method='POST')

    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read().decode('utf-8', errors='replace')

    labels = {}
    series = {}
    for block in body.split('\n\n'):
        event = payload = None
        for line in block.split('\n'):
            if line.startswith('event: '):
                event = line[7:].strip()
            elif line.startswith('data: '):
                payload = line[6:]
        if not event or not payload:
            continue
        try:
            message = json.loads(payload)
        except ValueError:
            continue
        if event == 'metadata':
            props = message.get('properties', {})
            labels[message.get('tsId')] = props.get('sf_streamLabel')
        elif event == 'data':
            for point in message.get('data', []):
                label = labels.get(point.get('tsId'))
                series.setdefault(label, []).append(point.get('value'))
    return series


def collapse(series, how):
    """Reduce SignalFlow series to one number, per the row's rule.

    'median' exists because a percentile CANNOT be collapsed by averaging:
    the mean of per-interval P90s is not the window P90, which is the same
    error trap 22 records for standard deviation. Percentile rows therefore
    compare the median of per-interval percentiles on both sides, and the
    Azure KQL for those rows computes exactly that.

    'ratio' sums the numerator and denominator series before dividing, for
    the same reason: the mean of per-interval error rates is not the window
    error rate.
    """
    if how == 'ratio':
        errors = [v for v in series.get('errors', []) if v is not None]
        total = [v for v in series.get('total', []) if v is not None]
        if not total or sum(total) == 0:
            return 0.0
        return sum(errors) / float(sum(total))

    values = [v for v in series.get('v', []) if v is not None]
    if not values:
        return None
    if how == 'sum':
        return sum(values)
    if how == 'max':
        return max(values)
    if how == 'mean':
        return statistics.mean(values)
    if how == 'median':
        return statistics.median(values)
    raise ValueError('unknown splunkAggregate: %r' % how)


def format_number(value):
    if value is None:
        return '(no data)'
    if abs(value - round(value)) < 1e-9:
        return '%d' % round(value)
    return '%.1f' % value


def query_splunk(row, realm, token, start_ms, stop_ms):
    """Return the formatted Splunk value for one comparison row."""
    program = row.get('splunkflow')
    if not program:
        return '(not automated)'
    try:
        series = signalflow(program, realm, token, start_ms, stop_ms)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return '(auth failed)'
        return '(HTTP %d)' % exc.code
    except Exception:
        return '(query failed)'

    value = collapse(series, row.get('splunkAggregate', 'median'))
    if value is None:
        return '(no data)'

    # Units differ across Splunk's OWN metrics, not just across backends:
    # service.request is NANOSECONDS while traces.span.metrics.duration is
    # MILLISECONDS (that unit comes from the span_metrics connector
    # config). splunkScale normalises to the Azure unit. Verified by
    # agreement with Azure once scaled -- an unscaled table reads 1e6x high.
    scale = row.get('splunkScale')
    if scale:
        value = value * scale
    return format_number(value)


# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Capture both sides of the backend comparison table.')
    parser.add_argument('--offset', default='1h',
                        help='time window, az CLI format (default: 1h)')
    parser.add_argument('--markdown', action='store_true',
                        help='emit a paste-ready markdown table')
    parser.add_argument('--azure-only', action='store_true',
                        help='skip Splunk, e.g. when running Azure-only mode')
    args = parser.parse_args()

    if AZ_BIN is None:
        sys.exit('ERROR: the Azure CLI (az) is required but was not found.\n'
                 'Install it: https://learn.microsoft.com/cli/azure/install-azure-cli')
    if not os.path.exists(QUERY_SET):
        sys.exit('ERROR: query set not found at %s' % QUERY_SET)

    try:
        window_ms = offset_to_ms(args.offset)
    except ValueError as exc:
        sys.exit('ERROR: %s' % exc)

    # ONE window, computed once, used by both backends.
    #
    # Aligned down to a whole resolution bucket so the in-progress minute is
    # excluded. SignalFlow returns an inclusive endpoint -- 61 points for a
    # 60-minute window at 60s resolution -- and that extra partial bucket was
    # adding a minute of healthcheck traffic to every Splunk count, which
    # looked exactly like Azure dropping data. It was not: a controlled send
    # of 60 tagged requests returned 60 from both backends.
    resolution_ms = 60000
    stop_ms = (int(time.time() * 1000) // resolution_ms) * resolution_ms
    start_ms = stop_ms - window_ms

    def as_az_time(ms):
        return datetime.fromtimestamp(ms / 1000.0, timezone.utc).strftime(
            '%Y-%m-%d %H:%M:%S.%f +00:00')

    start_iso = as_az_time(start_ms)
    end_iso = as_az_time(stop_ms)

    load_env()
    resource_group = os.environ.get('AZURE_RESOURCE_GROUP', 'rg-observability-test')
    app_name = os.environ.get('AZURE_APP_INSIGHTS_NAME', 'appi-rag-agent')
    splunk_token = os.environ.get('SPLUNK_ACCESS_TOKEN', '')
    splunk_realm = os.environ.get('SPLUNK_REALM', '')

    code, _ = run_az(['account', 'show', '-o', 'none'])
    if code != 0:
        sys.exit('ERROR: not logged in to Azure. Run: az login')

    app_id = resolve_app_id(resource_group, app_name)
    if not app_id:
        sys.exit("ERROR: could not resolve Application Insights '%s' in resource "
                 "group '%s'.\nRun scripts/setup-azure-monitor.sh (or .ps1) first."
                 % (app_name, resource_group))

    do_splunk = not args.azure_only
    if do_splunk and not (splunk_token and splunk_realm):
        print('NOTE: SPLUNK_ACCESS_TOKEN or SPLUNK_REALM missing from .env --')
        print('      capturing the Azure side only.')
        print('')
        do_splunk = False

    with io.open(QUERY_SET, encoding='utf-8') as handle:
        rows = json.load(handle)['rows']

    if args.markdown:
        stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        print('<!-- Generated by scripts/compare_backends.py --offset %s on %s -->'
              % (args.offset, stamp))
        print('')
        note = freshness_note(app_id, window_ms)
        if note:
            print('<!-- %s -->' % note)
            print('')
        print('| Metric | Splunk | Azure | Explanation |')
        print('|---|---|---|---|')
    else:
        print('Backend comparison over the last %s' % args.offset)
        print('Window : %s to %s UTC (shared by both backends)'
              % (start_iso[:19], end_iso[:19]))
        print('Azure  : %s' % app_name)
        print('Splunk : %s' % (('realm ' + splunk_realm) if do_splunk else 'skipped'))
        print('')
        note = freshness_note(app_id, window_ms)
        if note:
            print(note)
            print('')
        print('%-28s %14s %14s' % ('Metric', 'Splunk', 'Azure'))
        print('%-28s %14s %14s' % ('-' * 28, '-' * 14, '-' * 14))

    for row in rows:
        azure = query_azure(app_id, row['kql'], start_iso, end_iso)
        splunk = (query_splunk(row, splunk_realm, splunk_token, start_ms, stop_ms)
                  if do_splunk else '(skipped)')
        if args.markdown:
            print('| %s | %s | %s | %s |'
                  % (row['metric'], splunk, azure, row['expectation']))
        else:
            print('%-28s %14s %14s' % (row['metric'][:28], splunk, azure))

    print('')
    if args.markdown:
        print('<!-- Paste over the measured-numbers table in')
        print('     docs/splunk-vs-azure-monitor.md. A number that differs')
        print('     without an explanation in the right-hand column is what')
        print('     that table exists to prevent. -->')
    else:
        print('Splunk values are normalised to the Azure unit where they differ:')
        print('service.request is NANOSECONDS, traces.span.metrics.duration is')
        print('milliseconds. Percentile rows compare the median of per-interval')
        print('percentiles on both sides, because a percentile cannot be')
        print('collapsed by averaging. Active sessions is deliberately NOT the')
        print('same statistic on both sides -- see section 6 of the comparison.')
        print('')
        print('Re-run with --markdown for a paste-ready table.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
