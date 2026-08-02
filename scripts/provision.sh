#!/usr/bin/env bash
# One-time provisioning of everything Qwixx needs on Azure: resource group,
# Container Registry, storage account + file share (for SQLite persistence),
# Container Apps environment, and the container app itself (pinned to 1
# replica, with the /data volume mount wired up from the start).
#
# Requires: az CLI installed and `az login` already run.
#
# Usage:
#   ./scripts/provision.sh
#
# Safe-ish to re-run: most `az ... create` calls no-op or fail clearly on an
# existing resource rather than silently duplicating it. The container app
# creation step is not idempotent though — if you re-run after the app
# already exists, delete it first or switch that step to `az containerapp
# update --yaml`.

set -euo pipefail

# Windows' default console codepage can't encode Unicode characters that
# `az acr build` streams back verbatim from tool output (e.g. Vite's ✓
# marks), which crashes the az CLI's log streamer mid-build. Force UTF-8.
export PYTHONIOENCODING="utf-8"
export PYTHONUTF8="1"

# ---- Edit these ----
LOCATION="eastus"                      # az account list-locations -o table
RESOURCE_GROUP="qwixx-rg"
FILE_SHARE_NAME="qwixx-data"
ENVIRONMENT_NAME="qwixx-env"
APP_NAME="qwixx"
IMAGE_NAME="qwixx:latest"
# ---------------------

# ACR and storage account names must be globally unique across all of
# Azure, so we generate them once with a random suffix and persist that
# choice to a local file — re-running this script (e.g. after fixing a bug
# partway through) must reuse the same names, not mint new resources every
# time. Delete this file if you actually want a fresh set of resources.
NAMES_FILE="$(dirname "$0")/.provision-names.env"
if [ -f "$NAMES_FILE" ]; then
  echo "== Reusing generated names from $NAMES_FILE =="
  source "$NAMES_FILE"
else
  ACR_NAME="qwixxacr$RANDOM"
  STORAGE_ACCOUNT="qwixxstorage$RANDOM"
  cat > "$NAMES_FILE" <<EOF
ACR_NAME="$ACR_NAME"
STORAGE_ACCOUNT="$STORAGE_ACCOUNT"
EOF
  echo "== Generated new names, saved to $NAMES_FILE =="
fi
echo "  ACR_NAME=$ACR_NAME"
echo "  STORAGE_ACCOUNT=$STORAGE_ACCOUNT"

echo "== Resource group =="
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --only-show-errors -o none

echo "== Container Registry (Basic SKU) =="
az acr create --resource-group "$RESOURCE_GROUP" --name "$ACR_NAME" --sku Basic --only-show-errors -o none

echo "== Build and push the image (compiles the Dockerfile remotely in ACR) =="
# Queue async and poll status rather than streaming logs: az CLI's log
# streamer crashes on Windows (colorama/win32 console encoding bug) the
# moment build output contains a non-cp1252 character, e.g. Vite's ✓ marks.
az acr build --registry "$ACR_NAME" --image "$IMAGE_NAME" . --no-wait --only-show-errors
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

echo "== Storage account for SQLite persistence =="
az storage account create \
  --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 --only-show-errors -o none

STORAGE_KEY=$(az storage account keys list --resource-group "$RESOURCE_GROUP" --account-name "$STORAGE_ACCOUNT" --query "[0].value" -o tsv)

echo "== Azure Files share =="
az storage share-rm create \
  --resource-group "$RESOURCE_GROUP" --storage-account "$STORAGE_ACCOUNT" \
  --name "$FILE_SHARE_NAME" --quota 5 --only-show-errors -o none

echo "== Container Apps environment (auto-creates a Log Analytics workspace) =="
az extension add --name containerapp --upgrade --only-show-errors -y 2>/dev/null || true
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait

az containerapp env create \
  --name "$ENVIRONMENT_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" \
  --only-show-errors -o none

echo "== Register the file share as a mountable volume on the environment =="
az containerapp env storage set \
  --name "$ENVIRONMENT_NAME" --resource-group "$RESOURCE_GROUP" \
  --storage-name qwixx-data --azure-file-account-name "$STORAGE_ACCOUNT" \
  --azure-file-account-key "$STORAGE_KEY" --azure-file-share-name "$FILE_SHARE_NAME" \
  --access-mode ReadWrite --only-show-errors -o none

echo "== Enabling ACR admin credentials (needed for the container app's registry auth) =="
az acr update --name "$ACR_NAME" --admin-enabled true --only-show-errors -o none

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

echo "== Creating the container app (flags only — no volume yet) =="
if az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --only-show-errors -o none 2>/dev/null; then
  echo "  App already exists, skipping create."
else
  az containerapp create \
    --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --environment "$ENVIRONMENT_NAME" \
    --image "$ACR_LOGIN_SERVER/$IMAGE_NAME" \
    --registry-server "$ACR_LOGIN_SERVER" --registry-username "$ACR_USERNAME" --registry-password "$ACR_PASSWORD" \
    --target-port 3000 --ingress external \
    --min-replicas 1 --max-replicas 1 \
    --env-vars QUIXX_DB_PATH=/data/qwixx.sqlite \
    --only-show-errors -o none
fi

echo "== Patching in the /data volume mount (fetch real current-state YAML, edit, apply) =="
APP_YAML="/tmp/qwixx-containerapp.yaml"
az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" -o yaml > "$APP_YAML"

python - "$APP_YAML" <<'PYEOF'
import sys
import yaml

path = sys.argv[1]
with open(path) as f:
    spec = yaml.safe_load(f)

template = spec["properties"]["template"]
template["volumes"] = [{"name": "qwixx-data", "storageType": "AzureFile", "storageName": "qwixx-data"}]
template["containers"][0]["volumeMounts"] = [{"volumeName": "qwixx-data", "mountPath": "/data"}]

with open(path, "w") as f:
    yaml.safe_dump(spec, f, default_flow_style=False)
PYEOF

az containerapp update --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --yaml "$APP_YAML" --only-show-errors -o none

APP_URL=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "=========================================="
echo "Resource group:     $RESOURCE_GROUP"
echo "ACR name:            $ACR_NAME"
echo "Storage account:     $STORAGE_ACCOUNT"
echo "Environment name:    $ENVIRONMENT_NAME"
echo "App name:            $APP_NAME"
echo "App URL:              https://$APP_URL"
echo "=========================================="
echo ""
echo "Save these for scripts/qwixx-on.sh / qwixx-on.ps1 (and the off variants):"
echo "  export QWIXX_RESOURCE_GROUP=$RESOURCE_GROUP"
echo "  export QWIXX_APP_NAME=$APP_NAME"
