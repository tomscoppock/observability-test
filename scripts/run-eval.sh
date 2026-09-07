#!/usr/bin/env bash
# run-eval.sh -- Run golden Q&A evaluation against the live RAG API.
#
# Sends each question from sample-docs/golden-qa.json to the chat API,
# checks that the response contains the expected source document and
# required key phrases, and prints a pass/fail summary.
#
# Usage:
#   ./scripts/run-eval.sh [BASE_URL]
#
# BASE_URL defaults to http://localhost (nginx proxy).
# Requires: curl, jq

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GOLDEN_QA="$PROJECT_ROOT/sample-docs/golden-qa.json"
BASE_URL="${1:-http://localhost}"

# Colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Validate prerequisites
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed." >&2
  exit 1
fi

if [ ! -f "$GOLDEN_QA" ]; then
  echo "ERROR: Golden Q&A dataset not found at $GOLDEN_QA" >&2
  exit 1
fi

# Check API health
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" 2>/dev/null || echo "000")
if [ "$STATUS" != "200" ]; then
  echo "ERROR: API is not reachable at ${BASE_URL} (HTTP $STATUS)." >&2
  echo "Start the stack with: docker compose up -d" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Run evaluation
# ---------------------------------------------------------------------------
ENTRY_COUNT=$(jq '.entries | length' "$GOLDEN_QA")
PASS=0
FAIL=0
ERRORS=0

echo -e "${CYAN}=== RAG Evaluation ===${NC}"
echo "Dataset:    $GOLDEN_QA"
echo "API:        $BASE_URL"
echo "Questions:  $ENTRY_COUNT"
echo ""

for i in $(seq 0 $((ENTRY_COUNT - 1))); do
  QUESTION=$(jq -r ".entries[$i].question" "$GOLDEN_QA")
  EXPECTED_SOURCE=$(jq -r ".entries[$i].expectedSource" "$GOLDEN_QA")
  DESCRIPTION=$(jq -r ".entries[$i].description" "$GOLDEN_QA")
  ENTRY_ID=$(jq -r ".entries[$i].id" "$GOLDEN_QA")

  # Read required phrases into array
  PHRASE_COUNT=$(jq ".entries[$i].requiredPhrases | length" "$GOLDEN_QA")

  echo -e "${CYAN}[$ENTRY_ID/$ENTRY_COUNT]${NC} $DESCRIPTION"
  echo "  Q: $QUESTION"

  # Call the chat API
  RESPONSE=$(curl -s -X POST "${BASE_URL}/api/chat" \
    -H "Content-Type: application/json" \
    -d "{\"message\": $(echo "$QUESTION" | jq -Rs .)}" 2>/dev/null || echo '{"error":"request failed"}')

  # Check for API errors
  API_ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  if [ -n "$API_ERROR" ]; then
    echo -e "  ${RED}ERROR${NC}: $API_ERROR"
    ERRORS=$((ERRORS + 1))
    echo ""
    continue
  fi

  REPLY=$(echo "$RESPONSE" | jq -r '.reply // ""')
  REPLY_LOWER=$(echo "$REPLY" | tr '[:upper:]' '[:lower:]')
  REPLY_LENGTH=${#REPLY}

  # Check source document
  SOURCE_MATCH=false
  SOURCES=$(echo "$RESPONSE" | jq -r '.sources[]?.title // empty')
  EXPECTED_LOWER=$(echo "$EXPECTED_SOURCE" | sed 's/\.txt$//' | tr '[:upper:]' '[:lower:]' | tr '-' ' ')
  for src in $SOURCES; do
    SRC_LOWER=$(echo "$src" | tr '[:upper:]' '[:lower:]')
    if echo "$SRC_LOWER" | grep -q "$EXPECTED_LOWER"; then
      SOURCE_MATCH=true
      break
    fi
  done

  # Also check if the reply mentions the expected source
  if [ "$SOURCE_MATCH" = false ]; then
    if echo "$REPLY_LOWER" | grep -qi "$EXPECTED_LOWER"; then
      SOURCE_MATCH=true
    fi
  fi

  # Check required phrases
  PHRASE_PASS=0
  PHRASE_FAIL_LIST=""
  for p in $(seq 0 $((PHRASE_COUNT - 1))); do
    PHRASE=$(jq -r ".entries[$i].requiredPhrases[$p]" "$GOLDEN_QA")
    PHRASE_LOWER=$(echo "$PHRASE" | tr '[:upper:]' '[:lower:]')
    if echo "$REPLY_LOWER" | grep -qi "$PHRASE_LOWER"; then
      PHRASE_PASS=$((PHRASE_PASS + 1))
    else
      if [ -n "$PHRASE_FAIL_LIST" ]; then
        PHRASE_FAIL_LIST="$PHRASE_FAIL_LIST, '$PHRASE'"
      else
        PHRASE_FAIL_LIST="'$PHRASE'"
      fi
    fi
  done

  # Determine pass/fail
  ALL_PASS=true
  if [ "$SOURCE_MATCH" = false ]; then
    ALL_PASS=false
    echo -e "  ${RED}FAIL${NC}: Expected source '$EXPECTED_SOURCE' not found in response"
  fi
  if [ -n "$PHRASE_FAIL_LIST" ]; then
    ALL_PASS=false
    echo -e "  ${RED}FAIL${NC}: Missing phrases: $PHRASE_FAIL_LIST"
  fi

  if [ "$ALL_PASS" = true ]; then
    echo -e "  ${GREEN}PASS${NC} (source: ok, phrases: $PHRASE_PASS/$PHRASE_COUNT, length: $REPLY_LENGTH chars)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${YELLOW}Phrases matched: $PHRASE_PASS/$PHRASE_COUNT, length: $REPLY_LENGTH chars${NC}"
    FAIL=$((FAIL + 1))
  fi
  echo ""
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
TOTAL=$((PASS + FAIL + ERRORS))
echo -e "${CYAN}=== Evaluation Summary ===${NC}"
echo -e "  Total:   $TOTAL"
echo -e "  ${GREEN}Pass:    $PASS${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}Fail:    $FAIL${NC}"
else
  echo -e "  Fail:    $FAIL"
fi
if [ "$ERRORS" -gt 0 ]; then
  echo -e "  ${RED}Errors:  $ERRORS${NC}"
else
  echo -e "  Errors:  $ERRORS"
fi
echo ""

SCORE=0
if [ "$TOTAL" -gt 0 ]; then
  SCORE=$(( (PASS * 100) / TOTAL ))
fi
echo -e "  Score:   ${SCORE}%"

if [ "$FAIL" -gt 0 ] || [ "$ERRORS" -gt 0 ]; then
  exit 1
fi
