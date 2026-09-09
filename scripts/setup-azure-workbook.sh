#!/usr/bin/env bash
# setup-azure-workbook.sh -- Deploy the RAG Agent observability workbook and
# drift-detection alert rules to Azure Monitor.
#
# Usage:
#   ./scripts/setup-azure-workbook.sh
#   ./scripts/setup-azure-workbook.sh --no-alerts   # workbook only
#
# Prerequisites:
#   - Azure CLI installed and authenticated (run: az login)
#   - ./scripts/setup-azure-monitor.sh already run, so the resource
#     group and Application Insights resource exist
#
# The script is idempotent. The workbook resource name is derived
# deterministically from the resource group id, so re-running UPDATES
# the existing workbook rather than creating a duplicate.
#
# Deploys:
#   azure/workbook.bicep  -> one workbook, five tabs, 29 parity items
#                            plus 3 log items
#   azure/alerts.bicep    -> three scheduled query rules (drift detection)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AZURE_DIR="$PROJECT_ROOT/azure"

DEPLOY_ALERTS=true
for arg in "$@"; do
  case "$arg" in
    --no-alerts) DEPLOY_ALERTS=false ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $arg" >&2
      echo "Usage: $0 [--no-alerts]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Load .env without clobbering anything already exported in this shell.
# ---------------------------------------------------------------------------
if [ -f "$PROJECT_ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [ -z "$key" ] && continue
    val="${val#"${val%%[![:space:]]*}"}"
    case "$val" in
      \"*\") val="${val%\"}"; val="${val#\"}" ;;
      \'*\') val="${val%\'}"; val="${val#\'}" ;;
    esac
    if [ -z "$(eval "printf '%s' \"\${$key:-}\"")" ]; then
      export "$key=$val"
    fi
  done < "$PROJECT_ROOT/.env"
fi

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-observability-test}"
APP_INSIGHTS_NAME="${AZURE_APP_INSIGHTS_NAME:-appi-rag-agent}"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if ! command -v az &>/dev/null; then
  echo "ERROR: the Azure CLI (az) is required but was not found." >&2
  echo "Install it: https://learn.microsoft.com/cli/azure/install-azure-cli" >&2
  exit 1
fi

if ! az account show &>/dev/null; then
  echo "ERROR: not logged in to Azure." >&2
  echo "Run: az login" >&2
  exit 1
fi

if [ -n "${AZURE_SUBSCRIPTION_ID:-}" ]; then
  az account set --subscription "$AZURE_SUBSCRIPTION_ID"
fi

for f in "$AZURE_DIR/workbook.bicep" "$AZURE_DIR/workbook.json"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: required file not found: $f" >&2
    exit 1
  fi
done

if [ "$(az group exists --name "$RESOURCE_GROUP")" != "true" ]; then
  echo "ERROR: resource group '$RESOURCE_GROUP' does not exist." >&2
  echo "Run ./scripts/setup-azure-monitor.sh first." >&2
  exit 1
fi

# List-and-count rather than `show`, which errors when absent.
APPI_COUNT="$(az resource list \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "microsoft.insights/components" \
  --query "[?name=='$APP_INSIGHTS_NAME'] | length(@)" -o tsv 2>/dev/null || echo 0)"

if [ "$APPI_COUNT" != "1" ]; then
  echo "ERROR: Application Insights resource '$APP_INSIGHTS_NAME' not found" >&2
  echo "in resource group '$RESOURCE_GROUP'." >&2
  echo "Run ./scripts/setup-azure-monitor.sh first." >&2
  exit 1
fi

echo "Resource group : $RESOURCE_GROUP"
echo "App Insights   : $APP_INSIGHTS_NAME"
echo ""

# ---------------------------------------------------------------------------
# 1. Workbook
# ---------------------------------------------------------------------------
echo "[1/2] Deploying workbook..."
WORKBOOK_ID="$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "rag-agent-workbook" \
  --template-file "$AZURE_DIR/workbook.bicep" \
  --parameters "appInsightsName=$APP_INSIGHTS_NAME" \
  --query "properties.outputs.workbookResourceId.value" \
  -o tsv)"

echo "      Workbook deployed."

# ---------------------------------------------------------------------------
# 2. Alert rules
# ---------------------------------------------------------------------------
if [ "$DEPLOY_ALERTS" = true ]; then
  echo "[2/2] Deploying drift-detection alert rules..."
  az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --name "rag-agent-alerts" \
    --template-file "$AZURE_DIR/alerts.bicep" \
    --parameters "appInsightsName=$APP_INSIGHTS_NAME" \
    --output none
  echo "      Three rules deployed (severity 2, no action groups)."
else
  echo "[2/2] Skipped alert rules (--no-alerts)."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "Done."
echo ""
echo "Open the workbook:"
echo "  https://portal.azure.com/#@/resource${WORKBOOK_ID}"
echo ""
echo "Before trusting any panel, generate traffic and confirm each signal"
echo "actually arrived:"
echo ""
echo "  ./scripts/simulate-demo-traffic.sh --duration 10"
echo ""
echo "Then run these in the App Insights Logs blade -- all five must"
echo "return rows:"
echo "  requests      | summarize count() by cloud_RoleName"
echo "  dependencies  | summarize count() by name"
echo "  customMetrics | summarize count() by name"
echo "  traces        | summarize count() by severityLevel"
echo "  exceptions    | summarize count()"
echo ""
echo "An empty panel is the failure mode that matters here. The drift"
echo "rules need roughly an hour of traffic before their baselines mean"
echo "anything."
