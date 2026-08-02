# Scales the Qwixx container app down to 0 replicas to stop billing for
# compute while nobody's playing.
#
# Usage:
#   $env:QWIXX_RESOURCE_GROUP = "my-rg"
#   $env:QWIXX_APP_NAME = "qwixx"        # optional, defaults to "qwixx"
#   ./scripts/qwixx-off.ps1
#
# Safe to run any time between turns — state only persists to SQLite after
# a turn fully resolves, so as long as you're not mid-turn nothing is lost.

$ErrorActionPreference = "Stop"

$resourceGroup = $env:QWIXX_RESOURCE_GROUP
if (-not $resourceGroup) {
    Write-Error "Set `$env:QWIXX_RESOURCE_GROUP to your Azure resource group name first."
}
$appName = if ($env:QWIXX_APP_NAME) { $env:QWIXX_APP_NAME } else { "qwixx" }

Write-Host "Scaling '$appName' down to 0 replicas in resource group '$resourceGroup'..."
az containerapp update --name $appName --resource-group $resourceGroup --min-replicas 0

Write-Host "Done. Compute billing stops once the replica shuts down."
