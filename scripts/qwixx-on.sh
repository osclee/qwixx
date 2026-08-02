#!/usr/bin/env bash
# Scales the Qwixx container app up to 1 replica so you can play.
#
# Usage:
#   export QWIXX_RESOURCE_GROUP=my-rg
#   export QWIXX_APP_NAME=qwixx   # optional, defaults to "qwixx"
#   ./scripts/qwixx-on.sh
#
# Cold start after this takes a handful of seconds (image pull + boot) —
# run it a minute or two before you actually want to play.

set -euo pipefail

if [ -z "${QWIXX_RESOURCE_GROUP:-}" ]; then
  echo "Set QWIXX_RESOURCE_GROUP to your Azure resource group name first." >&2
  exit 1
fi
APP_NAME="${QWIXX_APP_NAME:-qwixx}"

echo "Scaling '$APP_NAME' up to 1 replica in resource group '$QWIXX_RESOURCE_GROUP'..."
az containerapp update --name "$APP_NAME" --resource-group "$QWIXX_RESOURCE_GROUP" --min-replicas 1

echo "Done. Give it a few seconds to finish starting before connecting."
