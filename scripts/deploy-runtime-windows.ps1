[CmdletBinding()]
param(
  [string]$SourceDir = (Split-Path -Parent $PSScriptRoot),
  [string]$RuntimeDir = (Join-Path $env:LOCALAPPDATA "WPS Connector\runtime"),
  [string]$BackupRoot = (Join-Path $env:LOCALAPPDATA "Connector Suite\backups\wps-runtime"),
  [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss")
)

$ErrorActionPreference = "Stop"
$SourceDir = [System.IO.Path]::GetFullPath($SourceDir)
$RuntimeDir = [System.IO.Path]::GetFullPath($RuntimeDir)
$BackupRoot = [System.IO.Path]::GetFullPath($BackupRoot)
$runtimeParent = Split-Path -Parent $RuntimeDir
$stageDir = Join-Path $runtimeParent (".runtime-stage-{0}-{1}" -f $RunId, $PID)
$oldRuntime = $null

function Write-Diagnostic([string]$Message) {
  [Console]::Error.WriteLine("[wps-runtime] $Message")
}

function Copy-SourceTree([string]$From, [string]$To) {
  $excluded = @(".git", "node_modules", ".DS_Store", "test_logs")
  New-Item -ItemType Directory -Path $To -Force | Out-Null
  Get-ChildItem -LiteralPath $From -Force | Where-Object {
    $excluded -notcontains $_.Name
  } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $To -Recurse -Force
  }
}

try {
  New-Item -ItemType Directory -Path $runtimeParent, $BackupRoot -Force | Out-Null
  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
  Copy-SourceTree -From $SourceDir -To $stageDir

  foreach ($relative in @(
    "project-bindings.local.json",
    "codex-catalog.snapshot.json",
    "et-wpp-table-syncs.local.json"
  )) {
    $current = Join-Path $RuntimeDir $relative
    if (Test-Path -LiteralPath $current) {
      Copy-Item -LiteralPath $current -Destination (Join-Path $stageDir $relative) -Force
    }
  }

  Write-Diagnostic "Installing production dependencies in writable staging runtime"
  $npmArguments = @("install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", $stageDir)
  & npm.cmd @npmArguments 1>&2
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
  }

  if (Test-Path -LiteralPath $RuntimeDir) {
    $backupDir = Join-Path $BackupRoot $RunId
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $oldRuntime = Join-Path $backupDir "runtime"
    Write-Diagnostic "Backing up current runtime to $oldRuntime"
    Move-Item -LiteralPath $RuntimeDir -Destination $oldRuntime
  }

  try {
    Move-Item -LiteralPath $stageDir -Destination $RuntimeDir
  } catch {
    if ($oldRuntime -and (Test-Path -LiteralPath $oldRuntime) -and -not (Test-Path -LiteralPath $RuntimeDir)) {
      Move-Item -LiteralPath $oldRuntime -Destination $RuntimeDir
      Write-Diagnostic "Previous runtime restored"
    }
    throw
  }

  Write-Diagnostic "Activated runtime: $RuntimeDir"
  if ($oldRuntime) {
    Write-Diagnostic "Rollback runtime: $oldRuntime"
  }
  [Console]::Out.WriteLine($RuntimeDir)
} finally {
  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
