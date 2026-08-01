[CmdletBinding()]
param(
  [string]$RuntimeDir = (Join-Path $env:LOCALAPPDATA "WPS Connector\runtime"),
  [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"
if (-not $NodePath) {
  $NodePath = (Get-Command node.exe -ErrorAction Stop).Source
}
$startScript = Join-Path $RuntimeDir "scripts\start-runtime-windows.ps1"
if (-not (Test-Path -LiteralPath $startScript)) {
  throw "WPS start script is missing: $startScript"
}
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Install-ConnectorTask([string]$TaskName, [string]$Mode) {
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Mode {1} -RuntimeDir "{2}" -NodePath "{3}"' -f $startScript, $Mode, $RuntimeDir, $NodePath
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RuntimeDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  [Console]::Error.WriteLine("[wps-task] Registered and started: $TaskName")
}

Install-ConnectorTask -TaskName "WPS Connector Bridge" -Mode "bridge"
Install-ConnectorTask -TaskName "WPS Connector Addin" -Mode "addin"
