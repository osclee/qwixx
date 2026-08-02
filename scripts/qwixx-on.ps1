# Scales the Qwixx container app up to 1 replica so you can play.
#
# Usage:
#   $env:QWIXX_RESOURCE_GROUP = "my-rg"
#   $env:QWIXX_APP_NAME = "qwixx"        # optional, defaults to "qwixx"
#   ./scripts/qwixx-on.ps1
#
# Cold start after this takes a handful of seconds (image pull + boot) —
# run it a minute or two before you actually want to play.

$ErrorActionPreference = "Stop"

$resourceGroup = $env:QWIXX_RESOURCE_GROUP
if (-not $resourceGroup) {
    Write-Error "Set `$env:QWIXX_RESOURCE_GROUP to your Azure resource group name first."
}
$appName = if ($env:QWIXX_APP_NAME) { $env:QWIXX_APP_NAME } else { "qwixx" }

Write-Host "Scaling '$appName' up to 1 replica in resource group '$resourceGroup'..."
az containerapp update --name $appName --resource-group $resourceGroup --min-replicas 1

Write-Host "Done. Give it a few seconds to finish starting before connecting."
