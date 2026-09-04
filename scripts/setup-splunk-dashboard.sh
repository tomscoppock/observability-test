#!/usr/bin/env bash
# setup-splunk-dashboard.sh -- Create the RAG Agent demo dashboards in
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
#
# Dashboard structure (from splunk/dashboard.json):
#   dashboardGroup -> dashboards[] -> charts[]
# Each dashboard appears as a tab in the Splunk UI.

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
  elif [ "$method" = "DELETE" ]; then
    args+=(-X DELETE)
  fi

  local response
  response=$(curl "${args[@]}" "$url")

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" -ge 400 ]]; then
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
DASH_COUNT=$(jq '.dashboards | length' "$DASHBOARD_JSON")

echo "=== Splunk Dashboard Setup ==="
echo "Realm:           $SPLUNK_REALM"
echo "Dashboard group: $GROUP_NAME"
echo "Dashboards:      $DASH_COUNT"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Find or create dashboard group
# ---------------------------------------------------------------------------
echo "--- Step 1: Dashboard group ---"

GROUP_ID=""
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
# Step 2: Clean up old single "Demo Dashboard" if it exists
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 2: Clean up old dashboards ---"

DASH_LIST=$(api_call GET "/v2/dashboard?limit=100&groupId=$GROUP_ID")

# Delete old single "Demo Dashboard" if it exists
OLD_DASH_ID=$(echo "$DASH_LIST" | jq -r '.results[]? | select(.name == "Demo Dashboard") | .id' | head -1)
if [ -n "$OLD_DASH_ID" ]; then
  echo "Deleting old 'Demo Dashboard': $OLD_DASH_ID"
  api_call DELETE "/v2/dashboard/$OLD_DASH_ID" >/dev/null 2>&1 || echo "  (could not delete -- may be the default dashboard)"
fi

# Delete the empty auto-created default dashboard (same name as the group)
DEFAULT_DASH_ID=$(echo "$DASH_LIST" | jq -r --arg name "$GROUP_NAME" \
  '.results[]? | select(.name == $name) | .id' | head -1)
if [ -n "$DEFAULT_DASH_ID" ]; then
  echo "Deleting empty default dashboard: $DEFAULT_DASH_ID"
  api_call DELETE "/v2/dashboard/$DEFAULT_DASH_ID" >/dev/null 2>&1 || echo "  (could not delete -- Splunk may protect the default)"
fi

# ---------------------------------------------------------------------------
# Step 3: Create or update each dashboard and its charts
# ---------------------------------------------------------------------------

# Helper: determine chart width based on type
chart_width() {
  local chart_type="$1"
  case "$chart_type" in
    SingleValue) echo 3 ;;
    *)           echo 6 ;;
  esac
}

for d in $(seq 0 $((DASH_COUNT - 1))); do
  DASH_NAME=$(jq -r ".dashboards[$d].name" "$DASHBOARD_JSON")
  DASH_DESC=$(jq -r ".dashboards[$d].description" "$DASHBOARD_JSON")
  CHART_COUNT=$(jq ".dashboards[$d].charts | length" "$DASHBOARD_JSON")

  echo ""
  echo "--- Dashboard $((d + 1))/$DASH_COUNT: $DASH_NAME ($CHART_COUNT charts) ---"

  # Find or create this dashboard
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

  # Build a map of chart names already on this dashboard
  CURRENT_DASH=$(api_call GET "/v2/dashboard/$DASH_ID")
  declare -A DASH_CHART_MAP=()
  DASH_CHART_IDS_RAW=$(echo "$CURRENT_DASH" | jq -r '.charts[]?.chartId // empty')
  for dcid in $DASH_CHART_IDS_RAW; do
    CHART_DETAIL=$(api_call GET "/v2/chart/$dcid" 2>/dev/null || true)
    if [ -n "$CHART_DETAIL" ]; then
      CNAME=$(echo "$CHART_DETAIL" | jq -r '.name // empty')
      if [ -n "$CNAME" ]; then
        DASH_CHART_MAP["$CNAME"]="$dcid"
      fi
    fi
  done

  # Create or update charts
  CHART_IDS=()
  for i in $(seq 0 $((CHART_COUNT - 1))); do
    CHART_NAME=$(jq -r ".dashboards[$d].charts[$i].name" "$DASHBOARD_JSON")
    CHART_DESC=$(jq -r ".dashboards[$d].charts[$i].description" "$DASHBOARD_JSON")
    CHART_TYPE=$(jq -r ".dashboards[$d].charts[$i].chartType" "$DASHBOARD_JSON")
    PROGRAM_TEXT=$(jq -r ".dashboards[$d].charts[$i].programText" "$DASHBOARD_JSON")

    # Map chart types to Splunk API options.type values
    PLOT_TYPE="TimeSeriesChart"
    DEFAULT_PLOT_TYPE=""
    case "$CHART_TYPE" in
      Line)        PLOT_TYPE="TimeSeriesChart" ;;
      Area)        PLOT_TYPE="TimeSeriesChart"; DEFAULT_PLOT_TYPE="AreaChart" ;;
      List)        PLOT_TYPE="List" ;;
      SingleValue) PLOT_TYPE="SingleValue" ;;
    esac

    if [ -n "$DEFAULT_PLOT_TYPE" ]; then
      CHART_BODY=$(jq -n \
        --arg name "$CHART_NAME" \
        --arg desc "$CHART_DESC" \
        --arg programText "$PROGRAM_TEXT" \
        --arg plotType "$PLOT_TYPE" \
        --arg defaultPlotType "$DEFAULT_PLOT_TYPE" \
        '{
          "name": $name,
          "description": $desc,
          "programText": $programText,
          "options": {
            "type": $plotType,
            "defaultPlotType": $defaultPlotType
          }
        }')
    else
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
    fi

    EXISTING_CHART_ID="${DASH_CHART_MAP[$CHART_NAME]:-}"
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

    sleep 0.2
  done

  # Attach charts to dashboard with smart layout
  echo "  Attaching charts to dashboard ..."

  EXISTING_CHART_IDS_ON_DASH=$(echo "$CURRENT_DASH" | jq -r '.charts[]?.chartId // empty')
  CHARTS_ARRAY=$(echo "$CURRENT_DASH" | jq '[.charts[]? | {chartId, row, column, height, width}]')
  if [ "$CHARTS_ARRAY" = "null" ] || [ -z "$CHARTS_ARRAY" ]; then
    CHARTS_ARRAY="[]"
  fi

  # For a clean layout, rebuild chart positions from scratch
  CHARTS_ARRAY="[]"
  ROW=0
  COL=0

  for idx in "${!CHART_IDS[@]}"; do
    cid="${CHART_IDS[$idx]}"
    # Determine width from chart type
    CT=$(jq -r ".dashboards[$d].charts[$idx].chartType" "$DASHBOARD_JSON")
    W=$(chart_width "$CT")

    # Wrap to next row if this chart won't fit
    if [ $((COL + W)) -gt 12 ]; then
      COL=0
      ROW=$((ROW + 1))
    fi

    CHARTS_ARRAY=$(echo "$CHARTS_ARRAY" | jq \
      --arg chartId "$cid" \
      --argjson row "$ROW" \
      --argjson col "$COL" \
      --argjson height 1 \
      --argjson width "$W" \
      '. + [{"chartId": $chartId, "row": $row, "column": $col, "height": $height, "width": $width}]')

    COL=$((COL + W))
    if [ "$COL" -ge 12 ]; then
      COL=0
      ROW=$((ROW + 1))
    fi
  done

  TOTAL=$(echo "$CHARTS_ARRAY" | jq 'length')

  DASH_UPDATE=$(jq -n \
    --arg name "$DASH_NAME" \
    --arg desc "$DASH_DESC" \
    --arg groupId "$GROUP_ID" \
    --argjson charts "$CHARTS_ARRAY" \
    '{"name": $name, "description": $desc, "groupId": $groupId, "charts": $charts}')

  api_call PUT "/v2/dashboard/$DASH_ID" "$DASH_UPDATE" >/dev/null
  echo "  Dashboard '$DASH_NAME' has $TOTAL charts."
done

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "=== Setup complete ==="
echo ""
echo "Dashboard group URL:"
echo "  https://app.${SPLUNK_REALM}.signalfx.com/#/dashboard-group/$GROUP_ID"
echo ""
echo "Dashboard group: $GROUP_ID"
echo "Dashboards:      $DASH_COUNT"
