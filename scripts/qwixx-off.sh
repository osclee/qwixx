#!/usr/bin/env bash
# Scales the Qwixx container app down to 0 replicas to stop billing for
# compute while nobody's playing.
#
# Usage:
#   export QWIXX_RESOURCE_GROUP=my-rg
#   export QWIXX_APP_NAME=qwixx   # optional, defaults to "qwixx"
#   ./scripts/qwixx-off.sh
#
# Safe to run any time between turns — state only persists to SQLite after
# a turn fully resolves, so as long as you're not mid-turn nothing is lost.

set -euo pipefail

if [ -z "${QWIXX_RESOURCE_GROUP:-}" ]; then
  echo "Set QWIXX_RESOURCE_GROUP to your Azure resource group name first." >&2
  exit 1
fi
APP_NAME="${QWIXX_APP_NAME:-qwixx}"

echo "Scaling '$APP_NAME' down to 0 replicas in resource group '$QWIXX_RESOURCE_GROUP'..."
az containerapp update --name "$APP_NAME" --resource-group "$QWIXX_RESOURCE_GROUP" --min-replicas 0

echo "Done. Compute billing stops once the replica shuts down."
