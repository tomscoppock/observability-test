#!/usr/bin/env bash
# setup-splunk-dashboard.sh -- Create the RAG Agent demo dashboard in
# Splunk Observability Cloud via the REST API.
#
# Usage:
#   ./scripts/setup-splunk-dashboard.sh
#
# Prerequisites:
#   - SPLUNK_ACCESS_TOKEN and SPLUNK_REALM set in .env (or exported)
#   - curl and jq installed
#
# The script is idempotent: it checks for existing resources before
# creating new ones. Re-running updates chart programs in place.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DASHBOARD_JSON="$PROJECT_ROOT/splunk/dashboard.json"

# ---------------------------------------------------------------------------
# Load .env if present (does not override already-exported vars)
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
if [ -z "${SPLUNK_ACCESS_TOKEN:-}" ]; then
  echo "ERROR: SPLUNK_ACCESS_TOKEN is not set." >&2
  echo "Set it in .env or export it before running this script." >&2
  exit 1
fi

if [ -z "${SPLUNK_REALM:-}" ]; then
  echo "ERROR: SPLUNK_REALM is not set." >&2
  echo "Set it in .env or export it before running this script." >&2
  exit 1
fi

if [ ! -f "$DASHBOARD_JSON" ]; then
  echo "ERROR: Dashboard definition not found at $DASHBOARD_JSON" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed." >&2
  echo "Install it: https://jqlang.github.io/jq/download/" >&2
  exit 1
fi

API_BASE="https://api.${SPLUNK_REALM}.signalfx.com"
AUTH_HEADER="X-SF-Token: ${SPLUNK_ACCESS_TOKEN}"

# ---------------------------------------------------------------------------
# Helper: make an API call with error handling
# ---------------------------------------------------------------------------
api_call() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"

  local url="${API_BASE}${endpoint}"
  local args=(-s -S -w "\n%{http_code}" -H "$AUTH_HEADER" -H "Content-Type: application/json")

  if [ "$method" = "GET" ]; then
    args+=(-X GET)
  elif [ "$method" = "POST" ]; then
    args+=(-X POST -d "$data")
  elif [ "$method" = "PUT" ]; then
    args+=(-X PUT -d "$data")
  fi

  local response
  response=$(curl "${args[@]}" "$url")

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -ge 400 ]; then
    echo "ERROR: API returned HTTP $http_code for $method $endpoint" >&2
    echo "$body" >&2
    return 1
  fi

  echo "$body"
}

# ---------------------------------------------------------------------------
# Read dashboard definition
# ---------------------------------------------------------------------------
GROUP_NAME=$(jq -r '.dashboardGroup.name' "$DASHBOARD_JSON")
GROUP_DESC=$(jq -r '.dashboardGroup.description' "$DASHBOARD_JSON")
DASH_NAME=$(jq -r '.dashboard.name' "$DASHBOARD_JSON")
DASH_DESC=$(jq -r '.dashboard.description' "$DASHBOARD_JSON")

echo "=== Splunk Dashboard Setup ==="
echo "Realm:           $SPLUNK_REALM"
echo "Dashboard group: $GROUP_NAME"
echo "Dashboard:       $DASH_NAME"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Find or create dashboard group
# ---------------------------------------------------------------------------
echo "--- Step 1: Dashboard group ---"

GROUP_ID=""
# Search for existing group by name
GROUPS_RESPONSE=$(api_call GET "/v2/dashboardgroup?limit=100")
GROUP_ID=$(echo "$GROUPS_RESPONSE" | jq -r --arg name "$GROUP_NAME" \
  '.results[]? | select(.name == $name) | .id' | head -1)

if [ -n "$GROUP_ID" ]; then
  echo "Found existing dashboard group: $GROUP_ID"
else
  echo "Creating dashboard group: $GROUP_NAME"
  GROUP_BODY=$(jq -n --arg name "$GROUP_NAME" --arg desc "$GROUP_DESC" \
    '{"name": $name, "description": $desc}')
  GROUP_RESPONSE=$(api_call POST "/v2/dashboardgroup" "$GROUP_BODY")
  GROUP_ID=$(echo "$GROUP_RESPONSE" | jq -r '.id')
  echo "Created dashboard group: $GROUP_ID"
fi

# ---------------------------------------------------------------------------
# Step 2: Find or create dashboard
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 2: Dashboard ---"

DASH_ID=""
# Search for existing dashboard in the group
DASH_LIST=$(api_call GET "/v2/dashboard?limit=100&groupId=$GROUP_ID")
DASH_ID=$(echo "$DASH_LIST" | jq -r --arg name "$DASH_NAME" \
  '.results[]? | select(.name == $name) | .id' | head -1)

if [ -n "$DASH_ID" ]; then
  echo "Found existing dashboard: $DASH_ID"
else
  echo "Creating dashboard: $DASH_NAME"
  DASH_BODY=$(jq -n \
    --arg name "$DASH_NAME" \
    --arg desc "$DASH_DESC" \
    --arg groupId "$GROUP_ID" \
    '{"name": $name, "description": $desc, "groupId": $groupId, "charts": []}')
  DASH_RESPONSE=$(api_call POST "/v2/dashboard" "$DASH_BODY")
  DASH_ID=$(echo "$DASH_RESPONSE" | jq -r '.id')
  echo "Created dashboard: $DASH_ID"
fi

# ---------------------------------------------------------------------------
# Step 3: Create or update charts
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 3: Charts ---"

CHART_COUNT=$(jq '.charts | length' "$DASHBOARD_JSON")
CHART_IDS=()

for i in $(seq 0 $((CHART_COUNT - 1))); do
  CHART_NAME=$(jq -r ".charts[$i].name" "$DASHBOARD_JSON")
  CHART_DESC=$(jq -r ".charts[$i].description" "$DASHBOARD_JSON")
  CHART_TYPE=$(jq -r ".charts[$i].chartType" "$DASHBOARD_JSON")
  PROGRAM_TEXT=$(jq -r ".charts[$i].programText" "$DASHBOARD_JSON")

  # Map our chart types to Splunk API options.plotType values
  PLOT_TYPE="LineChart"
  case "$CHART_TYPE" in
    Line) PLOT_TYPE="LineChart" ;;
    Area) PLOT_TYPE="AreaChart" ;;
    List) PLOT_TYPE="List" ;;
    SingleValue) PLOT_TYPE="SingleValue" ;;
  esac

  # Check if chart already exists on this dashboard
  EXISTING_CHART_ID=""
  CHARTS_ON_DASH=$(api_call GET "/v2/chart?limit=200")
  EXISTING_CHART_ID=$(echo "$CHARTS_ON_DASH" | jq -r \
    --arg name "$CHART_NAME" \
    '.results[]? | select(.name == $name) | .id' | head -1)

  CHART_BODY=$(jq -n \
    --arg name "$CHART_NAME" \
    --arg desc "$CHART_DESC" \
    --arg programText "$PROGRAM_TEXT" \
    --arg plotType "$PLOT_TYPE" \
    '{
      "name": $name,
      "description": $desc,
      "programText": $programText,
      "options": {
        "type": $plotType
      }
    }')

  if [ -n "$EXISTING_CHART_ID" ]; then
    echo "  Updating chart [$((i + 1))/$CHART_COUNT]: $CHART_NAME ($EXISTING_CHART_ID)"
    api_call PUT "/v2/chart/$EXISTING_CHART_ID" "$CHART_BODY" >/dev/null
    CHART_IDS+=("$EXISTING_CHART_ID")
  else
    echo "  Creating chart [$((i + 1))/$CHART_COUNT]: $CHART_NAME"
    CHART_RESPONSE=$(api_call POST "/v2/chart" "$CHART_BODY")
    CHART_ID=$(echo "$CHART_RESPONSE" | jq -r '.id')
    CHART_IDS+=("$CHART_ID")
  fi

  # Brief pause to respect rate limits
  sleep 0.2
done

# ---------------------------------------------------------------------------
# Step 4: Attach charts to dashboard
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 4: Attach charts to dashboard ---"

# Build the charts array for the dashboard update
CHARTS_ARRAY="[]"
ROW=0
COL=0
for cid in "${CHART_IDS[@]}"; do
  CHARTS_ARRAY=$(echo "$CHARTS_ARRAY" | jq \
    --arg chartId "$cid" \
    --argjson row "$ROW" \
    --argjson col "$COL" \
    --argjson height 1 \
    --argjson width 6 \
    '. + [{"chartId": $chartId, "row": $row, "column": $col, "height": $height, "width": $width}]')
  COL=$((COL + 6))
  if [ "$COL" -ge 12 ]; then
    COL=0
    ROW=$((ROW + 1))
  fi
done

DASH_UPDATE=$(jq -n \
  --arg name "$DASH_NAME" \
  --arg desc "$DASH_DESC" \
  --arg groupId "$GROUP_ID" \
  --argjson charts "$CHARTS_ARRAY" \
  '{"name": $name, "description": $desc, "groupId": $groupId, "charts": $charts}')

api_call PUT "/v2/dashboard/$DASH_ID" "$DASH_UPDATE" >/dev/null
echo "Attached ${#CHART_IDS[@]} charts to dashboard."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "=== Setup complete ==="
echo ""
echo "Dashboard URL:"
echo "  https://app.${SPLUNK_REALM}.signalfx.com/#/dashboard/$DASH_ID"
echo ""
echo "Dashboard group: $GROUP_ID"
echo "Dashboard:       $DASH_ID"
echo "Charts:          ${#CHART_IDS[@]}"
