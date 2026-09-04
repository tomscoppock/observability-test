#!/usr/bin/env bash
# simulate-demo-traffic.sh -- Generate realistic traffic for the RAG Agent
# stack so Splunk APM has data for the demo (service map colours, dashboard
# charts, distributed traces).
#
# Usage:
#   ./scripts/simulate-demo-traffic.sh [BASE_URL]
#
# BASE_URL defaults to http://localhost (nginx proxy).
# Requires: curl, jq (optional, for pretty output).

set -euo pipefail

BASE_URL="${1:-http://localhost}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SAMPLE_DIR="$SCRIPT_DIR/../sample-docs"

# Session IDs for simulated users
SESSION_A="demo-user-alice-$(date +%s)"
SESSION_B="demo-user-bob-$(date +%s)"
SESSION_C="demo-user-carol-$(date +%s)"

# Chat messages aligned to talk track sections
CHAT_MESSAGES=(
  "What is the company leave policy?"
  "How many days of annual leave do employees get?"
  "What is the remote work policy?"
  "Can I work from home on Fridays?"
  "What are the rules for claiming expenses?"
  "Is there a limit on meal expenses when travelling?"
  "What does the code of conduct say about conflicts of interest?"
  "How is personal data protected under the data protection policy?"
  "What happens if I breach the code of conduct?"
  "Can I carry over unused leave to the next year?"
)

# Scrape URLs (used if MCP is configured)
SCRAPE_URLS=(
  "https://example.com"
)

# Colours for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No colour

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()  { echo -e "${GREEN}  OK${NC} $*"; }
warn() { echo -e "${YELLOW}  WARN${NC} $*"; }
err() { echo -e "${RED}  ERROR${NC} $*"; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

check_health() {
  log "Checking API health at ${BASE_URL}/health ..."
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" 2>/dev/null || echo "000")
  if [ "$status" != "200" ]; then
    err "API is not reachable (HTTP $status). Is the stack running?"
    err "Start with: docker compose up -d"
    exit 1
  fi
  ok "API is healthy"
}

upload_file() {
  local filepath="$1"
  local session="$2"
  local filename
  filename=$(basename "$filepath")
  log "  Uploading $filename ..."
  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST "${BASE_URL}/api/upload" \
    -H "X-Session-Id: $session" \
    -F "files=@${filepath}" 2>/dev/null)
  local status
  status=$(echo "$response" | tail -1)
  if [ "$status" = "200" ] || [ "$status" = "201" ]; then
    ok "$filename uploaded (HTTP $status)"
  else
    warn "$filename upload returned HTTP $status"
  fi
}

send_chat() {
  local session="$1"
  local message="$2"
  log "  [$session] \"$message\""
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${BASE_URL}/api/chat" \
    -H "Content-Type: application/json" \
    -H "X-Session-Id: $session" \
    -d "{\"message\": \"$message\"}" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    ok "Chat response received"
  else
    warn "Chat returned HTTP $status"
  fi
}

scrape_url() {
  local url="$1"
  local session="$2"
  log "  Scraping $url ..."
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${BASE_URL}/api/scrape" \
    -H "Content-Type: application/json" \
    -H "X-Session-Id: $session" \
    -d "{\"url\": \"$url\"}" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    ok "Scrape completed"
  elif [ "$status" = "503" ]; then
    warn "MCP server not configured -- skipping scrape"
  else
    warn "Scrape returned HTTP $status"
  fi
}

trigger_error() {
  local message="$1"
  local session="$2"
  log "  Triggering error: $message"
  curl -s -o /dev/null \
    -X POST "${BASE_URL}/api/test-error" \
    -H "Content-Type: application/json" \
    -H "X-Session-Id: $session" \
    -d "{\"message\": \"$message\"}" 2>/dev/null || true
  ok "Error recorded"
}

random_delay() {
  local min="$1"
  local max="$2"
  local delay=$(( RANDOM % (max - min + 1) + min ))
  sleep "$delay"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo ""
echo "=============================================="
echo "  RAG Agent -- Demo Traffic Simulator"
echo "=============================================="
echo ""
log "Base URL: $BASE_URL"
log "Sessions: $SESSION_A, $SESSION_B, $SESSION_C"
echo ""

# Pre-flight check
check_health
echo ""

# Phase 1: Upload sample documents
log "Phase 1: Uploading sample documents ..."
for f in "$SAMPLE_DIR"/*.txt; do
  if [ -f "$f" ]; then
    upload_file "$f" "$SESSION_A"
    sleep 2
  fi
done
ok "Phase 1 complete -- documents uploaded"
echo ""

# Phase 2: Chat traffic (multiple sessions, varied delays)
log "Phase 2: Sending chat messages (this takes ~2 minutes) ..."
SESSIONS=("$SESSION_A" "$SESSION_B" "$SESSION_C")
for i in "${!CHAT_MESSAGES[@]}"; do
  # Rotate through sessions
  session_idx=$(( i % 3 ))
  session="${SESSIONS[$session_idx]}"
  send_chat "$session" "${CHAT_MESSAGES[$i]}"
  random_delay 5 12
done
ok "Phase 2 complete -- chat traffic generated"
echo ""

# Phase 3: Scrape traffic (skip if MCP not available)
log "Phase 3: Web scrape traffic ..."
for url in "${SCRAPE_URLS[@]}"; do
  scrape_url "$url" "$SESSION_B"
  sleep 3
done
ok "Phase 3 complete"
echo ""

# Phase 4: Error traffic (generates non-zero error rate for colour coding)
log "Phase 4: Generating error traffic (for service map colours) ..."
trigger_error "Simulated timeout for demo" "$SESSION_C"
sleep 2
trigger_error "Simulated validation failure" "$SESSION_A"
sleep 2
trigger_error "Simulated upstream error" "$SESSION_B"
ok "Phase 4 complete -- errors recorded"
echo ""

# Phase 5: Cool-down (more successful requests to settle error rate)
log "Phase 5: Cool-down -- sending successful requests ..."
send_chat "$SESSION_A" "Summarise the key points of the leave policy"
sleep 5
send_chat "$SESSION_B" "What are the main data protection principles?"
sleep 5
send_chat "$SESSION_C" "How do I submit an expense claim?"
ok "Phase 5 complete"
echo ""

echo "=============================================="
echo "  Simulation complete!"
echo "=============================================="
echo ""
log "Open Splunk Observability Cloud and set the time picker to"
log "'Last 15 minutes' to see the generated data."
log ""
log "Session IDs for trace filtering:"
log "  Alice: $SESSION_A"
log "  Bob:   $SESSION_B"
log "  Carol: $SESSION_C"
echo ""
