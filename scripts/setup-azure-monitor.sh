#!/usr/bin/env bash
# setup-azure-monitor.sh -- Stand up the Azure Monitor resources this stack
# needs, then print the connection string to paste into .env.
#
# Usage:
#   ./scripts/setup-azure-monitor.sh
#
# Prerequisites:
#   - Azure CLI installed and authenticated (run: az login)
#   - Permission to create resource groups in the target subscription
#
# What this script creates (all idempotent -- safe to re-run):
#   1. Resource group, tagged with Purpose and "Responsible Owner"
#   2. Log Analytics workspace  (Application Insights is workspace-based
#      now, so this is a hard requirement, not an option)
#   3. Application Insights resource, linked to that workspace
#
# It does NOT deploy the workbook or alert rules -- that is
# scripts/setup-azure-workbook.sh, run after this one.
#
# Nothing needs creating by hand in the portal. The only manual step is
# copying the printed connection string into .env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Load .env without clobbering anything already exported in this shell.
# An exported value wins, so you can override a single setting for one run
# without editing the file.
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
    # Strip surrounding quotes, matching how docker compose reads .env.
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

# ---------------------------------------------------------------------------
# Defaults. Override any of these in .env.
# ---------------------------------------------------------------------------
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-observability-test}"
LOCATION="${AZURE_LOCATION:-uksouth}"
APP_INSIGHTS_NAME="${AZURE_APP_INSIGHTS_NAME:-appi-rag-agent}"
LOG_ANALYTICS_NAME="${AZURE_LOG_ANALYTICS_NAME:-law-rag-agent}"
TAG_PURPOSE="${AZURE_TAG_PURPOSE:-}"
TAG_RESPONSIBLE_OWNER="${AZURE_TAG_RESPONSIBLE_OWNER:-}"

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
  echo "Setting subscription to $AZURE_SUBSCRIPTION_ID"
  az account set --subscription "$AZURE_SUBSCRIPTION_ID"
fi

SUBSCRIPTION_NAME="$(az account show --query name -o tsv)"
SUBSCRIPTION_ID="$(az account show --query id -o tsv)"

# Both tags are required by policy. Fail early and loudly rather than
# creating an untagged resource group that then has to be fixed by hand.
MISSING_TAGS=""
[ -z "$TAG_PURPOSE" ] && MISSING_TAGS="AZURE_TAG_PURPOSE"
if [ -z "$TAG_RESPONSIBLE_OWNER" ]; then
  [ -n "$MISSING_TAGS" ] && MISSING_TAGS="$MISSING_TAGS, "
  MISSING_TAGS="${MISSING_TAGS}AZURE_TAG_RESPONSIBLE_OWNER"
fi
if [ -n "$MISSING_TAGS" ]; then
  echo "ERROR: required resource group tag value(s) not set: $MISSING_TAGS" >&2
  echo "Add them to .env, for example:" >&2
  echo "  AZURE_TAG_PURPOSE=Observability backend comparison spike" >&2
  echo "  AZURE_TAG_RESPONSIBLE_OWNER=tom.coppock@tungstenautomation.com" >&2
  exit 1
fi

# The application-insights commands live in an extension. Installing it
# is a no-op when already present.
if ! az extension show --name application-insights &>/dev/null; then
  echo "Installing the application-insights CLI extension..."
  az extension add --name application-insights --only-show-errors
fi

echo "Subscription : $SUBSCRIPTION_NAME ($SUBSCRIPTION_ID)"
echo "Location     : $LOCATION"
echo "Resource grp : $RESOURCE_GROUP"
echo ""

# ---------------------------------------------------------------------------
# 1. Resource group
# ---------------------------------------------------------------------------
# `az group create` is a PUT: it creates the group when absent and updates
# its tags when present. So there is no branch, and no need for
# `az group update --set tags."Responsible Owner"=...`, whose quoting of a
# tag key containing a space is fragile across shells.
#
# `az group exists` is used only to report which happened. It returns
# true/false on stdout with exit code 0, so it never writes to stderr.
if [ "$(az group exists --name "$RESOURCE_GROUP")" = "true" ]; then
  echo "[1/3] Resource group $RESOURCE_GROUP exists -- applying tags"
else
  echo "[1/3] Creating resource group $RESOURCE_GROUP"
fi

# "Responsible Owner" contains a space, so the whole key=value pair is
# quoted as one argument.
if ! az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --tags "Purpose=$TAG_PURPOSE" "Responsible Owner=$TAG_RESPONSIBLE_OWNER" \
    --output none; then
  echo "ERROR: could not create or update resource group '$RESOURCE_GROUP'." >&2
  echo "Check you have permission to create resource groups in this" >&2
  echo "subscription, and that '$LOCATION' is a valid region." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Log Analytics workspace
# ---------------------------------------------------------------------------
# Existence is tested with a list-and-count query rather than `show`,
# because `show` errors when the resource is absent.
LAW_COUNT="$(az monitor log-analytics workspace list \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?name=='$LOG_ANALYTICS_NAME'] | length(@)" -o tsv 2>/dev/null || echo 0)"

if [ "$LAW_COUNT" = "1" ]; then
  echo "[2/3] Log Analytics workspace $LOG_ANALYTICS_NAME exists"
else
  echo "[2/3] Creating Log Analytics workspace $LOG_ANALYTICS_NAME"
  az monitor log-analytics workspace create \
    --resource-group "$RESOURCE_GROUP" \
    --workspace-name "$LOG_ANALYTICS_NAME" \
    --location "$LOCATION" \
    --output none
fi

WORKSPACE_ID="$(az monitor log-analytics workspace show \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOG_ANALYTICS_NAME" \
  --query id -o tsv)"

# ---------------------------------------------------------------------------
# 3. Application Insights
# ---------------------------------------------------------------------------
# `az resource list` does not error when nothing matches, unlike `show`.
APPI_COUNT="$(az resource list \
  --resource-group "$RESOURCE_GROUP" \
  --resource-type "microsoft.insights/components" \
  --query "[?name=='$APP_INSIGHTS_NAME'] | length(@)" -o tsv 2>/dev/null || echo 0)"

if [ "$APPI_COUNT" = "1" ]; then
  echo "[3/3] Application Insights $APP_INSIGHTS_NAME exists"
else
  echo "[3/3] Creating Application Insights $APP_INSIGHTS_NAME"
  az monitor app-insights component create \
    --resource-group "$RESOURCE_GROUP" \
    --app "$APP_INSIGHTS_NAME" \
    --location "$LOCATION" \
    --kind web \
    --application-type web \
    --workspace "$WORKSPACE_ID" \
    --output none
fi

CONNECTION_STRING="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" \
  --app "$APP_INSIGHTS_NAME" \
  --query connectionString -o tsv)"

APP_INSIGHTS_ID="$(az monitor app-insights component show \
  --resource-group "$RESOURCE_GROUP" \
  --app "$APP_INSIGHTS_NAME" \
  --query id -o tsv)"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "Azure Monitor resources are ready."
echo ""
echo "Add this to .env (it is a CREDENTIAL -- never commit it):"
echo ""
echo "APPLICATIONINSIGHTS_CONNECTION_STRING=$CONNECTION_STRING"
echo ""
echo "Then choose a backend and restart the collector:"
echo ""
echo "  # Azure Monitor only"
echo "  OTEL_COLLECTOR_CONFIG=./otel-collector-config.azure.yaml \\"
echo "    docker compose up -d --force-recreate otel-collector"
echo ""
echo "  # Splunk and Azure Monitor in parallel"
echo "  OTEL_COLLECTOR_CONFIG=./otel-collector-config.dual.yaml \\"
echo "    docker compose up -d --force-recreate otel-collector"
echo ""
echo "Then deploy the workbook and alert rules:"
echo "  ./scripts/setup-azure-workbook.sh"
echo ""
echo "Portal: https://portal.azure.com/#@/resource${APP_INSIGHTS_ID}/overview"
echo ""
echo "NOTE: this connection string cannot be rotated. If it leaks, the"
echo "remedy is a new Application Insights resource, which loses"
echo "continuity of the data already ingested."
