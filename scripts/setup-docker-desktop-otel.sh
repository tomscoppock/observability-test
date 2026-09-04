#!/usr/bin/env bash
# setup-docker-desktop-otel.sh -- Configure Docker Desktop to export
# OpenTelemetry data to the project's OTel Collector.
#
# Usage:
#   ./scripts/setup-docker-desktop-otel.sh
#
# What it does:
#   1. Locates Docker Desktop's settings-store.json
#   2. Backs up the original file
#   3. Enables OTLP export with endpoint http://localhost:4318
#   4. Prompts you to restart Docker Desktop
#
# The script is idempotent -- it skips if already configured.
# Requires Docker Desktop 4.35+ for OTLP export support.
# Requires jq for JSON manipulation.

set -euo pipefail

OTEL_ENDPOINT="http://localhost:4318"
OTEL_PROTOCOL="http/protobuf"

# ---------------------------------------------------------------------------
# Locate settings-store.json
# ---------------------------------------------------------------------------
find_settings_file() {
  case "$(uname -s)" in
    Darwin)
      echo "$HOME/Library/Group Containers/group.com.docker/settings-store.json"
      ;;
    Linux)
      echo "$HOME/.docker/desktop/settings-store.json"
      ;;
    *)
      echo "ERROR: Unsupported OS: $(uname -s)" >&2
      echo "On Windows, use setup-docker-desktop-otel.ps1 instead." >&2
      exit 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "=== Docker Desktop OTel Setup ==="
echo ""

# Check Docker Desktop is installed
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is not installed or not in PATH." >&2
  echo "Install Docker Desktop from https://docs.docker.com/get-docker/" >&2
  exit 1
fi

DOCKER_VERSION=$(docker version --format '{{.Client.Version}}' 2>/dev/null || true)
if [ -z "$DOCKER_VERSION" ]; then
  echo "ERROR: Could not determine Docker version." >&2
  exit 1
fi
echo "Docker version: $DOCKER_VERSION"

# Check jq is available
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed." >&2
  echo "Install it: https://jqlang.github.io/jq/download/" >&2
  exit 1
fi

SETTINGS_FILE=$(find_settings_file)
SETTINGS_DIR=$(dirname "$SETTINGS_FILE")

echo "Settings file:  $SETTINGS_FILE"
echo ""

# ---------------------------------------------------------------------------
# Read or create settings
# ---------------------------------------------------------------------------
if [ -f "$SETTINGS_FILE" ]; then
  SETTINGS=$(cat "$SETTINGS_FILE")
else
  echo "Settings file does not exist yet -- will create it."
  mkdir -p "$SETTINGS_DIR"
  SETTINGS="{}"
fi

# ---------------------------------------------------------------------------
# Check if already configured
# ---------------------------------------------------------------------------
CURRENT_ENABLED=$(echo "$SETTINGS" | jq -r '.openTelemetry.enabled // false')
CURRENT_ENDPOINT=$(echo "$SETTINGS" | jq -r '.openTelemetry.endpoint // empty')

if [ "$CURRENT_ENABLED" = "true" ] && [ "$CURRENT_ENDPOINT" = "$OTEL_ENDPOINT" ]; then
  echo "Docker Desktop OTLP export is already configured correctly."
  echo "  enabled:  true"
  echo "  endpoint: $CURRENT_ENDPOINT"
  echo ""
  echo "No changes needed. If telemetry is not appearing, restart Docker Desktop."
  exit 0
fi

if [ "$CURRENT_ENABLED" = "true" ] && [ "$CURRENT_ENDPOINT" != "$OTEL_ENDPOINT" ]; then
  echo "WARNING: OTLP export is already enabled but pointing to a different endpoint:"
  echo "  Current:  $CURRENT_ENDPOINT"
  echo "  Expected: $OTEL_ENDPOINT"
  echo ""
  read -rp "Overwrite with the project endpoint? (y/N) " RESPONSE
  if [ "$RESPONSE" != "y" ] && [ "$RESPONSE" != "Y" ]; then
    echo "Aborted. No changes made."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
if [ -f "$SETTINGS_FILE" ]; then
  BACKUP_FILE="${SETTINGS_FILE}.bak"
  cp "$SETTINGS_FILE" "$BACKUP_FILE"
  echo "Backed up to: $BACKUP_FILE"
fi

# ---------------------------------------------------------------------------
# Update settings
# ---------------------------------------------------------------------------
UPDATED=$(echo "$SETTINGS" | jq \
  --arg endpoint "$OTEL_ENDPOINT" \
  --arg protocol "$OTEL_PROTOCOL" \
  '.openTelemetry = {
    "enabled": true,
    "endpoint": $endpoint,
    "protocol": $protocol
  }')

echo "$UPDATED" > "$SETTINGS_FILE"

echo ""
echo "Docker Desktop settings updated:"
echo "  openTelemetry.enabled:  true"
echo "  openTelemetry.endpoint: $OTEL_ENDPOINT"
echo "  openTelemetry.protocol: $OTEL_PROTOCOL"
echo ""
echo "=== ACTION REQUIRED ==="
echo ""
echo "Restart Docker Desktop for the changes to take effect."
echo "After restarting, verify with:"
echo ""
echo "  docker compose logs otel-collector | grep 'docker-desktop'"
echo ""
echo "You should see container metrics (container.cpu.usage, container.memory.usage)"
echo "flowing through the collector within a few minutes."
