[CmdletBinding()]
param(
  [string]$SourceDir = (Split-Path -Parent $PSScriptRoot),
  [string]$RuntimeDir = (Join-Path $env:LOCALAPPDATA "WPS Connector\runtime"),
  [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss")
)

$ErrorActionPreference = "Stop"
$runtime = & (Join-Path $PSScriptRoot "deploy-runtime-windows.ps1") -SourceDir $SourceDir -RuntimeDir $RuntimeDir -RunId $RunId
if ($LASTEXITCODE -ne 0 -or -not $runtime) {
  throw "WPS runtime deployment failed."
}

& (Join-Path $RuntimeDir "scripts\register-wps-addin-windows.ps1") -RunId $RunId | Out-Null
& (Join-Path $RuntimeDir "scripts\install-scheduled-tasks-windows.ps1") -RuntimeDir $RuntimeDir

[Console]::Out.WriteLine($RuntimeDir)
