#!/usr/bin/env bash
# Rebuilds the Qwixx image from the current working tree and rolls a new
# revision on the existing container app. Use this after changing app code
# (packages/engine, packages/server, packages/client) — it does NOT
# provision any infrastructure; run provision.sh once first for that.
#
# Usage:
#   ./scripts/deploy.sh
#
# Requires: az CLI installed and `az login` already run, and
# scripts/.provision-names.env present (created by provision.sh).

set -euo pipefail

# Same Windows console-encoding workaround as provision.sh — az CLI's log
# streamer crashes on non-cp1252 characters (e.g. Vite's ✓ marks).
export PYTHONIOENCODING="utf-8"
export PYTHONUTF8="1"

RESOURCE_GROUP="${QWIXX_RESOURCE_GROUP:-qwixx-rg}"
APP_NAME="${QWIXX_APP_NAME:-qwixx}"

NAMES_FILE="$(dirname "$0")/.provision-names.env"
if [ ! -f "$NAMES_FILE" ]; then
  echo "Missing $NAMES_FILE — run scripts/provision.sh first to set up infrastructure." >&2
  exit 1
fi
source "$NAMES_FILE"

# Tag must be unique per deploy — `az containerapp update --image` only
# rolls a new revision when the image reference *string* changes; if two
# deploys reuse the same tag, Container Apps treats it as a no-op and keeps
# serving whatever was already running, even though the tag's digest in ACR
# changed underneath it. Prefer the git commit for traceability, but always
# append a timestamp so every deploy gets a distinct tag regardless of git
# state (uncommitted changes, or no commits at all).
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
TIMESTAMP=$(date +%Y%m%d%H%M%S)
IMAGE_TAG="qwixx:$GIT_SHA-$TIMESTAMP"

echo "== Building and pushing $IMAGE_TAG (compiles the Dockerfile remotely in ACR) =="
az acr build --registry "$ACR_NAME" --image "$IMAGE_TAG" . --no-wait --only-show-errors
sleep 5
BUILD_RUN_ID=$(az acr task list-runs --registry "$ACR_NAME" --top 1 --query "[0].runId" -o tsv)
echo "Queued ACR build run: $BUILD_RUN_ID"
while true; do
  BUILD_STATUS=$(az acr task list-runs --registry "$ACR_NAME" --top 20 --query "[?runId=='$BUILD_RUN_ID'].status | [0]" -o tsv)
  echo "  build status: $BUILD_STATUS"
  case "$BUILD_STATUS" in
    Succeeded) break ;;
    Failed|Canceled|Error|Timeout)
      echo "ACR build run $BUILD_RUN_ID ended with status $BUILD_STATUS. Logs:" >&2
      az acr task logs --registry "$ACR_NAME" --run-id "$BUILD_RUN_ID" --only-show-errors || true
      exit 1
      ;;
    *) sleep 10 ;;
  esac
done

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)

echo "== Rolling a new revision with the updated image =="
az containerapp update \
  --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --image "$ACR_LOGIN_SERVER/$IMAGE_TAG" \
  --only-show-errors -o none

APP_URL=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "Deployed $IMAGE_TAG to $APP_NAME."
echo "App URL: https://$APP_URL"
