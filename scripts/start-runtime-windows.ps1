[CmdletBinding()]
param(
  [ValidateSet("bridge", "addin")]
  [string]$Mode,
  [string]$RuntimeDir = (Split-Path -Parent $PSScriptRoot),
  [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"
if (-not $NodePath) {
  $NodePath = (Get-Command node.exe -ErrorAction Stop).Source
}
$logsDir = Join-Path $env:LOCALAPPDATA "Connector Suite\logs"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
$env:WPS_CONNECTOR_RUNTIME_ROOT = $RuntimeDir
$env:CONNECTOR_PLATFORM_URL = "http://127.0.0.1:40315"
Set-Location -LiteralPath $RuntimeDir

if ($Mode -eq "bridge") {
  $env:WPS_CONNECTOR_HOST = "127.0.0.1"
  $env:WPS_CONNECTOR_PORT = "40215"
  $entry = Join-Path $RuntimeDir "apps\bridge\server.js"
  $log = Join-Path $logsDir "wps-bridge.log"
} else {
  $env:WPS_CONNECTOR_ADDIN_HOST = "127.0.0.1"
  $env:WPS_CONNECTOR_ADDIN_PORT = "3891"
  $env:WPS_CONNECTOR_ADDIN_ROOT = Join-Path $RuntimeDir "apps\wps-addin"
  $entry = Join-Path $RuntimeDir "apps\wps-addin\server.js"
  $log = Join-Path $logsDir "wps-addin.log"
}

& $NodePath $entry *>> $log
exit $LASTEXITCODE
