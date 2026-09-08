#!/usr/bin/env bash
# simulate-demo-traffic.sh -- Generate realistic traffic for the RAG Agent
# stack so Splunk APM has data for the demo (service map colours, dashboard
# charts, distributed traces).
#
# Usage:
#   ./scripts/simulate-demo-traffic.sh [OPTIONS] [BASE_URL]
#
# Options:
#   --rounds N      Number of rounds (default: 2, each ~3-4 min)
#   --duration M    Run for M minutes instead, looping rounds until the
#                   time is up. Overrides --rounds. Default: unset.
#   --load LEVEL    light (default, current behaviour) or heavy.
#                   heavy shortens pauses ~4x and sends 3x the chat
#                   volume per round.
#   --no-errors     Skip deliberate error traffic (keeps service map green)
#   --errors        Include deliberate error traffic (default)
#
# BASE_URL defaults to http://localhost (nginx proxy).
# Requires: curl
#
# COST WARNING: every chat message is a real LLM API call. --load heavy
# triples chat volume and removes most of the pacing, so a long heavy run
# can be expensive. Start with a short --duration to gauge the rate.

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
ROUNDS=2
DURATION_MIN=""
LOAD="light"
INCLUDE_ERRORS=true
BASE_URL="http://localhost"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rounds)
      ROUNDS="$2"
      shift 2
      ;;
    --duration)
      DURATION_MIN="$2"
      shift 2
      ;;
    --load)
      LOAD="$2"
      shift 2
      ;;
    --no-errors)
      INCLUDE_ERRORS=false
      shift
      ;;
    --errors)
      INCLUDE_ERRORS=true
      shift
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      BASE_URL="$1"
      shift
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate and derive load settings
# ---------------------------------------------------------------------------
case "$LOAD" in
  light) DELAY_DIVISOR=1; CHAT_REPEAT=1 ;;
  heavy) DELAY_DIVISOR=4; CHAT_REPEAT=3 ;;
  *)
    echo "ERROR: --load must be 'light' or 'heavy' (got '$LOAD')" >&2
    exit 1
    ;;
esac

if [ -n "$DURATION_MIN" ]; then
  if ! [[ "$DURATION_MIN" =~ ^[0-9]+$ ]] || [ "$DURATION_MIN" -lt 1 ]; then
    echo "ERROR: --duration must be a positive whole number of minutes" >&2
    exit 1
  fi
fi

if ! [[ "$ROUNDS" =~ ^[0-9]+$ ]] || [ "$ROUNDS" -lt 1 ]; then
  echo "ERROR: --rounds must be a positive whole number" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SAMPLE_DIR="$SCRIPT_DIR/../sample-docs"

# Session IDs for simulated users
SESSION_A="demo-alice-$(date +%s)"
SESSION_B="demo-bob-$(date +%s)"
SESSION_C="demo-carol-$(date +%s)"

# Chat messages -- 20 varied questions aligned to sample docs
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
  "What equipment does the company provide for remote workers?"
  "How do I request parental leave?"
  "What is the policy on gifts and hospitality?"
  "How long must I retain expense receipts?"
  "What are the data breach notification procedures?"
  "Can I work remotely from another country?"
  "What is the disciplinary process for misconduct?"
  "How do I report a data protection concern?"
  "What types of leave are available besides annual leave?"
  "Summarise the key points across all company policies"
)

# Scrape URLs -- safe, public, reliable sites
SCRAPE_URLS=(
  "https://example.com"
  "https://httpbin.org/html"
  "https://www.w3.org/TR/WCAG21/"
)

# Colours for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No colour

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()  { echo -e "${GREEN}  OK${NC} $*"; }
warn() { echo -e "${YELLOW}  WARN${NC} $*"; }
err() { echo -e "${RED}  ERROR${NC} $*"; }
phase() { echo -e "${CYAN}[$(date +%H:%M:%S)] === $* ===${NC}"; }

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
  local user
  user=$(echo "$session" | sed 's/demo-//' | sed 's/-.*//')
  log "  [$user] \"$message\""
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${BASE_URL}/api/chat" \
    -H "Content-Type: application/json" \
    -H "X-Session-Id: $session" \
    -d "{\"message\": \"$message\"}" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    ok "Response received"
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
    warn "MCP not configured -- skipping (set MCP_PLAYWRIGHT_URL in .env)"
    return 1
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

hit_health() {
  curl -s -o /dev/null "${BASE_URL}/health" 2>/dev/null || true
}

# Scaled sleep. Under --load heavy every pause is divided by DELAY_DIVISOR,
# with a 1s floor so we still yield between requests rather than spinning.
pause() {
  local seconds="$1"
  local scaled=$(( seconds / DELAY_DIVISOR ))
  [ "$scaled" -lt 1 ] && scaled=1
  sleep "$scaled"
}

random_delay() {
  local min="$1"
  local max="$2"
  local delay=$(( RANDOM % (max - min + 1) + min ))
  pause "$delay"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo ""
echo "=============================================="
echo "  RAG Agent -- Demo Traffic Simulator"
echo "=============================================="
echo ""
log "Base URL:  $BASE_URL"
if [ -n "$DURATION_MIN" ]; then
  log "Duration:  ${DURATION_MIN} min (rounds loop until elapsed)"
else
  log "Rounds:    $ROUNDS"
fi
log "Load:      $LOAD (pauses /${DELAY_DIVISOR}, chat x${CHAT_REPEAT})"
log "Errors:    $INCLUDE_ERRORS"
log "Sessions:  Alice=$SESSION_A"
log "           Bob=$SESSION_B"
log "           Carol=$SESSION_C"
echo ""

# Pre-flight check
check_health
echo ""

# Check MCP configuration
log "Checking MCP (Playwright) availability ..."
mcp_status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BASE_URL}/api/scrape" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' 2>/dev/null || echo "000")
MCP_AVAILABLE=true
if [ "$mcp_status" = "503" ]; then
  warn "MCP Playwright is NOT configured."
  warn "To see the Playwright node on the service map, set in .env:"
  warn "  MCP_PLAYWRIGHT_URL=http://host.docker.internal:8100/mcp"
  warn "  MCP_PLAYWRIGHT_API_KEY=<your-key>"
  warn "Scrape phases will be skipped."
  MCP_AVAILABLE=false
else
  ok "MCP appears configured (HTTP $mcp_status)"
fi
echo ""

SESSIONS=("$SESSION_A" "$SESSION_B" "$SESSION_C")

START_TS=$(date +%s)
DEADLINE_TS=0
if [ -n "$DURATION_MIN" ]; then
  DEADLINE_TS=$(( START_TS + DURATION_MIN * 60 ))
fi

round=0
while true; do
  round=$(( round + 1 ))
  echo ""
  echo "----------------------------------------------"
  if [ -n "$DURATION_MIN" ]; then
    remaining=$(( (DEADLINE_TS - $(date +%s) + 59) / 60 ))
    [ "$remaining" -lt 0 ] && remaining=0
    phase "Round $round (~${remaining} min remaining)"
  else
    phase "Round $round of $ROUNDS"
  fi
  echo "----------------------------------------------"
  echo ""

  # Phase 1: Upload sample documents (first round only)
  if [ "$round" -eq 1 ]; then
    phase "Phase 1: Uploading sample documents"
    for f in "$SAMPLE_DIR"/*.txt; do
      if [ -f "$f" ]; then
        upload_file "$f" "$SESSION_A"
        pause 1
      fi
    done
    ok "Phase 1 complete -- documents uploaded"
    echo ""
  fi

  # Phase 2: Chat traffic (multiple sessions, varied delays)
  # Under --load heavy the whole message set is replayed CHAT_REPEAT times.
  phase "Phase 2: Chat traffic ($(( ${#CHAT_MESSAGES[@]} * CHAT_REPEAT )) messages)"
  for pass in $(seq 1 "$CHAT_REPEAT"); do
    for i in "${!CHAT_MESSAGES[@]}"; do
      session_idx=$(( (i + pass) % 3 ))
      session="${SESSIONS[$session_idx]}"
      send_chat "$session" "${CHAT_MESSAGES[$i]}"
      # Sprinkle health checks to generate more nginx->api spans
      hit_health
      random_delay 3 8
    done
  done
  ok "Phase 2 complete -- chat traffic generated"
  echo ""

  # Phase 3: Scrape traffic (skip if MCP not available)
  phase "Phase 3: Web scrape traffic"
  if [ "$MCP_AVAILABLE" = "true" ]; then
    for url in "${SCRAPE_URLS[@]}"; do
      scrape_url "$url" "$SESSION_B" || true
      pause 3
    done
    ok "Phase 3 complete"
  else
    warn "Skipping -- MCP not configured"
  fi
  echo ""

  # Phase 4: Error traffic (optional -- controlled by --errors / --no-errors)
  phase "Phase 4: Error traffic"
  if [ "$INCLUDE_ERRORS" = "true" ]; then
    trigger_error "Simulated timeout for demo" "$SESSION_C"
    pause 1
    trigger_error "Simulated validation failure" "$SESSION_A"
    pause 1
    trigger_error "Simulated upstream error" "$SESSION_B"
    pause 1
    trigger_error "Simulated rate limit exceeded" "$SESSION_C"
    ok "Phase 4 complete -- errors recorded"
  else
    log "Skipping error traffic (--no-errors flag set)"
    log "Service map will show green nodes (0% error rate)"
  fi
  echo ""

  # Phase 5: Cool-down (more successful requests to settle error rate)
  phase "Phase 5: Cool-down -- successful requests"
  send_chat "$SESSION_A" "Summarise the key points of the leave policy"
  hit_health
  pause 3
  send_chat "$SESSION_B" "What are the main data protection principles?"
  hit_health
  pause 3
  send_chat "$SESSION_C" "How do I submit an expense claim?"
  hit_health
  pause 3
  send_chat "$SESSION_A" "What is the notice period for resignation?"
  hit_health
  pause 3
  send_chat "$SESSION_B" "Explain the whistleblowing procedure"
  ok "Phase 5 complete"
  echo ""

  # Termination: by deadline in duration mode, by count otherwise.
  if [ -n "$DURATION_MIN" ]; then
    if [ "$(date +%s)" -ge "$DEADLINE_TS" ]; then
      log "Duration reached after $round round(s)."
      break
    fi
  elif [ "$round" -ge "$ROUNDS" ]; then
    break
  fi

  log "Pausing before next round ..."
  pause 10
done

ELAPSED_MIN=$(( ( $(date +%s) - START_TS + 59 ) / 60 ))

echo ""
echo "=============================================="
echo "  Simulation complete!"
echo "=============================================="
echo ""
log "Rounds run:    $round"
log "Elapsed:       ~${ELAPSED_MIN} min"
log "Load level:    $LOAD"
log "Error traffic: $INCLUDE_ERRORS"
echo ""
log "Open Splunk Observability Cloud and set the time picker to"
log "'Last 15 minutes' to see the generated data."
echo ""
log "Session IDs for trace filtering in Splunk Tag Spotlight:"
log "  Alice: $SESSION_A"
log "  Bob:   $SESSION_B"
log "  Carol: $SESSION_C"
echo ""
if [ "$MCP_AVAILABLE" = "false" ]; then
  warn "Playwright MCP was not configured -- no scrape traffic was generated."
  warn "To include it, set MCP_PLAYWRIGHT_URL in .env and re-run."
  echo ""
fi
