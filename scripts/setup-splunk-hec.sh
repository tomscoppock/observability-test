#!/usr/bin/env bash
# setup-splunk-hec.sh -- Validate and activate the Splunk Cloud Platform
# HEC logs pipeline for the OTel Collector.
#
# Usage:
#   ./scripts/setup-splunk-hec.sh
#
# Prerequisites:
#   - SPLUNK_HEC_URL, SPLUNK_HEC_TOKEN, SPLUNK_HEC_INDEX,
#     SPLUNK_HEC_SOURCETYPE set in .env (see .env.example)
#   - A HEC token already created in Splunk Web (Settings > Add Data >
#     Monitor > HTTP Event Collector) -- this script does not create the
#     token, it only validates one and wires it up. See docs/splunk-setup.md
#   - curl installed
#   - docker compose installed and this repo's stack buildable
#
# What this script does:
#   1. Loads .env and checks the four HEC variables are set
#   2. Sends one test event straight to the HEC endpoint to confirm the
#      token/URL/index actually work, before touching Docker
#   3. Rebuilds and restarts the otel-collector service
#   4. Tails its logs briefly so you can see the logs pipeline exporting
#      cleanly (or spot an auth/endpoint error immediately)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Load .env if present. Sourcing with `set -a` DOES override variables
# already exported in this shell, so the current .env always wins. That
# is deliberate: this script is meant to be edited-and-rerun while
# troubleshooting, and a stale exported value silently shadowing your
# latest .env edit is the more confusing failure.
# ---------------------------------------------------------------------------
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

# ---------------------------------------------------------------------------
# Validate required variables
# ---------------------------------------------------------------------------
MISSING=0
for VAR_NAME in SPLUNK_HEC_URL SPLUNK_HEC_TOKEN SPLUNK_HEC_INDEX SPLUNK_HEC_SOURCETYPE; do
  if [ -z "${!VAR_NAME:-}" ]; then
    echo "ERROR: $VAR_NAME is not set. Set it in .env (see .env.example)." >&2
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is required but not installed." >&2
  exit 1
fi

# Plain string rather than an array: expanding an empty array under
# `set -u` aborts on bash 3.2 (still the default on macOS). Only ever
# holds "-k", so word-splitting is safe here.
CURL_TLS_OPTS=""
if [ "${SPLUNK_HEC_INSECURE_SKIP_VERIFY:-false}" = "true" ]; then
  CURL_TLS_OPTS="-k"
fi

echo "=== Splunk Cloud Platform HEC Setup ==="
echo "Endpoint: $SPLUNK_HEC_URL"
echo "Index:    $SPLUNK_HEC_INDEX"
if [ "${SPLUNK_HEC_INSECURE_SKIP_VERIFY:-false}" = "true" ]; then
  echo "TLS:      certificate verification DISABLED (SPLUNK_HEC_INSECURE_SKIP_VERIFY=true)"
fi
echo ""

# ---------------------------------------------------------------------------
# Step 1: Send a test event directly to HEC
# ---------------------------------------------------------------------------
echo "--- Step 1: Test HEC connectivity ---"

TEST_BODY=$(cat <<EOF
{"event": "otel-collector HEC connectivity test", "sourcetype": "$SPLUNK_HEC_SOURCETYPE", "index": "$SPLUNK_HEC_INDEX", "source": "setup-splunk-hec-script"}
EOF
)

# `set -e` would abort here on curl's non-zero exit (DNS failure, refused
# connection, TLS error), skipping the diagnostics below -- which is
# exactly the case they exist for. Capture the exit code instead.
set +e
# shellcheck disable=SC2086 # CURL_TLS_OPTS is a controlled "-k" or empty
HTTP_RESPONSE=$(curl -s -S -w "\n%{http_code}" \
  $CURL_TLS_OPTS \
  -H "Authorization: Splunk $SPLUNK_HEC_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$TEST_BODY" \
  "$SPLUNK_HEC_URL" 2>&1)
CURL_EXIT=$?
set -e

if [ "$CURL_EXIT" -ne 0 ]; then
  HTTP_CODE="000"
  HTTP_BODY="curl exited $CURL_EXIT: $HTTP_RESPONSE"
else
  HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -1)
  HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
fi

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: HEC test event failed with HTTP $HTTP_CODE" >&2
  echo "$HTTP_BODY" >&2
  echo "" >&2
  if [ "$HTTP_CODE" = "000" ]; then
    echo "HTTP 000 means curl never got a response -- a connection-level" >&2
    echo "failure (DNS, TLS, timeout, refused), not an HTTP error from Splunk." >&2
    echo "Re-run with 'curl -v' against \$SPLUNK_HEC_URL to see the raw error." >&2
    echo "" >&2
  fi
  echo "Debug guidance:" >&2
  echo "  HTTP 404 -- wrong host. Splunk Cloud HEC uses a dedicated ingest" >&2
  echo "              hostname, not your Splunk Web hostname:" >&2
  echo "                https://http-inputs-<stack>.splunkcloud.com/services/collector" >&2
  echo "  HTTP 400 -- malformed request, or SPLUNK_HEC_INDEX does not exist or is" >&2
  echo "              not in this token's allowed indexes list." >&2
  echo "  HTTP 401 -- invalid or revoked token. Check SPLUNK_HEC_TOKEN." >&2
  echo "  HTTP 403 -- token disabled, or HEC is disabled globally on this stack" >&2
  echo "              (Splunk Web: Settings > Data Inputs > HTTP Event Collector >" >&2
  echo "              Global Settings -- confirm 'All Tokens' is Enabled)." >&2
  echo "  000 / 'could not resolve host' --" >&2
  echo "              DNS lookup failed. Re-check the stack name in SPLUNK_HEC_URL" >&2
  echo "              character-for-character against your Splunk Cloud stack." >&2
  echo "  000 / 'connection refused' or timeout --" >&2
  echo "              Outbound network/firewall/proxy is blocking access to" >&2
  echo "              *.splunkcloud.com on port 443 from this machine." >&2
  echo "  SSL/TLS or certificate errors --" >&2
  echo "              Check the system clock is correct (cert validation fails on a" >&2
  echo "              wrong clock), and whether a corporate TLS-inspecting proxy is" >&2
  echo "              intercepting the connection." >&2
  exit 1
fi

echo "Test event accepted: $HTTP_BODY"
echo ""

# ---------------------------------------------------------------------------
# Step 2: Rebuild and restart the collector
# ---------------------------------------------------------------------------
echo "--- Step 2: Redeploy otel-collector ---"
(cd "$PROJECT_ROOT" && docker compose up -d --build otel-collector)
echo ""

# ---------------------------------------------------------------------------
# Step 3: Tail logs for a quick sanity check
# ---------------------------------------------------------------------------
echo "--- Step 3: Recent otel-collector logs ---"
(cd "$PROJECT_ROOT" && docker compose logs --tail=30 otel-collector)

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Generate a chat message through the app to produce log traffic."
echo "  2. In Splunk Cloud Platform Search, run: index=$SPLUNK_HEC_INDEX sourcetype=$SPLUNK_HEC_SOURCETYPE"
echo "  3. Set up Log Observer Connect (Splunk admin console, see docs/splunk-setup.md)"
echo "     to correlate these logs with traces in Observability Cloud."
