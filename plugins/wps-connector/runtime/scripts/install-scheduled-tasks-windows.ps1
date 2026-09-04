[CmdletBinding()]
param(
  [string]$RuntimeDir = (Join-Path $env:LOCALAPPDATA "WPS Connector\runtime"),
  [string]$NodePath = "",
  [string]$TaskPath = "\",
  [string]$ReportPath = "",
  [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss-fff"),
  [int]$ReadyTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
$jsonHelperPath = Join-Path $PSScriptRoot "windows-json.ps1"
if (-not (Test-Path -LiteralPath $jsonHelperPath -PathType Leaf)) { throw "Windows JSON helper is missing: $jsonHelperPath" }
. $jsonHelperPath
if (-not $NodePath) {
  $NodePath = (Get-Command node.exe -ErrorAction Stop).Source
}
$startScript = Join-Path $RuntimeDir "scripts\start-runtime-windows.ps1"
if (-not (Test-Path -LiteralPath $startScript)) {
  throw "WPS start script is missing: $startScript"
}
if (-not $ReportPath) {
  $ReportPath = Join-Path $env:LOCALAPPDATA "Connector Suite\backups\scheduled-tasks\wps.json"
}

function Get-ExecutionContext {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  $groups = @(& whoami.exe /groups 2>$null)
  $integrityLine = @($groups | Where-Object { $_ -match "Mandatory Label" } | Select-Object -First 1)
  [ordered]@{
    user = $identity.Name
    userSid = if ($identity.User) { $identity.User.Value } else { "" }
    isAdministrator = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
    integrityLevel = if ($integrityLine.Count -gt 0) { [string]$integrityLine[0] } else { "unknown" }
  }
}

function Save-TaskReport([object]$Report) {
  $parent = Split-Path -Parent $ReportPath
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Write-ConnectorUtf8JsonAtomic -Path $ReportPath -Value $Report -Depth 20
}

function Read-StartupReport([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try { return Read-ConnectorUtf8Json $Path } catch { return [ordered]@{ status = "invalid"; ok = $false; lastError = $_.Exception.Message; reportPath = $Path } }
}

function Get-PortDiagnostics([int]$Port) {
  $owners = @()
  $errorText = ""
  try {
    foreach ($connection in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)) {
      $ownerPid = [int]$connection.OwningProcess
      $processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $ownerPid) -ErrorAction SilentlyContinue
      $owners += [ordered]@{ pid = $ownerPid; name = if ($processInfo) { [string]$processInfo.Name } else { "" }; commandLine = if ($processInfo) { [string]$processInfo.CommandLine } else { "" } }
    }
  } catch { $errorText = [string]$_.Exception.Message }
  return [ordered]@{ port = $Port; listening = ($owners.Count -gt 0); owners = @($owners); error = $errorText }
}

function Wait-HttpHealth([string]$Url, [int]$TimeoutSeconds = 30, [string]$StartupReportPath = "") {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $attempts = 0
  $lastError = ""
  $port = if ($Url -like "*40215*") { 40215 } else { 3891 }
  $failureCode = if ($Url -like "*40215*") { "WPS_BRIDGE_START_FAILED" } else { "WPS_ADDIN_START_FAILED" }
  $telemetry = [ordered]@{
    ok = $false
    stage = "Readiness"
    url = $Url
    timeoutSeconds = $TimeoutSeconds
    attempts = 0
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    endedAt = ""
    lastError = ""
    code = $failureCode
    lastStatusCode = $null
    lastBody = $null
    startupReportPath = $StartupReportPath
    logPath = if ($Url -like "*40215*") { Join-Path $env:LOCALAPPDATA "Connector Suite\logs\wps-bridge.log" } else { Join-Path $env:LOCALAPPDATA "Connector Suite\logs\wps-addin.log" }
    portDiagnostics = Get-PortDiagnostics -Port $port
  }
  while ((Get-Date) -lt $deadline) {
    $attempts++
    $telemetry.attempts = $attempts
    if ($StartupReportPath) {
      $startup = Read-StartupReport $StartupReportPath
      if ($startup -and $startup.status -in @("failed", "invalid", "stopped")) {
        $telemetry.stage = "StartupReport"
        $telemetry.lastError = "${failureCode}: $([string]$startup.lastError)"
        $telemetry.lastBody = [ordered]@{ status = [string]$startup.status; exitCode = $startup.exitCode; stdout = @($startup.stdout); stderr = @($startup.stderr) }
        $telemetry.portDiagnostics = Get-PortDiagnostics -Port $port
        $telemetry.endedAt = (Get-Date).ToUniversalTime().ToString("o")
        return $telemetry
      }
    }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5 -ErrorAction Stop
      $body = ConvertFrom-Json -InputObject $response.Content
      $telemetry.lastStatusCode = [int]$response.StatusCode
      $telemetry.lastBody = $body
      $nameOk = if ($Url -like "*40215*") { [string]$body.name -eq "wps-connector" } else { [string]$body.name -eq "wps-connector-addin" }
      if ([int]$response.StatusCode -eq 200 -and $body.ok -eq $true -and $nameOk) {
        $telemetry.ok = $true
        $telemetry.statusCode = [int]$response.StatusCode
        $telemetry.body = $body
        $telemetry.endedAt = (Get-Date).ToUniversalTime().ToString("o")
        $telemetry.portDiagnostics = Get-PortDiagnostics -Port $port
        return $telemetry
      }
      $lastError = "HTTP $($response.StatusCode) did not return the expected WPS health response."
    } catch {
      $lastError = [string]$_.Exception.Message
    }
    $telemetry.lastError = $lastError
    $telemetry.portDiagnostics = Get-PortDiagnostics -Port $port
    Start-Sleep -Seconds 1
  }
  $telemetry.ok = $false
  $telemetry.stage = "ReadinessTimeout"
  $telemetry.lastError = "${failureCode}: $lastError"
  $telemetry.endedAt = (Get-Date).ToUniversalTime().ToString("o")
  $telemetry.portDiagnostics = Get-PortDiagnostics -Port $port
  return $telemetry
}

$context = Get-ExecutionContext
$taskReport = [ordered]@{
  ok = $false
  runId = $RunId
  executionContext = $context
  tasks = @()
  runtimeDir = $RuntimeDir
  nodePath = $NodePath
  readyTimeoutSeconds = $ReadyTimeoutSeconds
  reportPath = $ReportPath
}

function Install-ConnectorTask([string]$TaskName, [string]$Mode) {
  $startupReportPath = Join-Path $env:LOCALAPPDATA ("Connector Suite\logs\wps-{0}-startup-{1}.json" -f $Mode, $RunId)
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Mode {1} -RuntimeDir "{2}" -NodePath "{3}" -RunId "{4}" -ReadyTimeoutSeconds {5} -StartupReportPath "{6}"' -f $startScript, $Mode, $RuntimeDir, $NodePath, $RunId, $ReadyTimeoutSeconds, $startupReportPath
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RuntimeDir
  $principal = New-ScheduledTaskPrincipal -UserId $context.user -LogonType Interactive -RunLevel Limited
  $entry = [ordered]@{
    name = $TaskName
    taskPath = $TaskPath
    mode = $Mode
    user = $context.user
    userSid = $context.userSid
    principal = $context.user
    logonType = "Interactive"
    runLevel = "Limited"
    action = [ordered]@{ execute = "powershell.exe"; arguments = $arguments; workingDirectory = $RuntimeDir }
    runtimeDir = $RuntimeDir
    nodePath = $NodePath
    startupReportPath = $startupReportPath
    startup = $null
    registration = [ordered]@{ status = "pending"; ok = $false; hresult = $null; error = "" }
    start = [ordered]@{ status = "pending"; ok = $false; hresult = $null; error = "" }
    state = "unknown"
    lastTaskResult = $null
    health = [ordered]@{ status = "pending"; ok = $false; url = ""; error = "" }
  }
  try {
    if (-not $context.isAdministrator) {
      throw "SCHEDULED_TASK_ELEVATION_REQUIRED: Register-ScheduledTask requires an elevated Windows PowerShell process. User=$($context.user), SID=$($context.userSid), Integrity=$($context.integrityLevel)."
    }
    Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $action -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew) -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $context.user) -Principal $principal -Force | Out-Null
    $entry.registration = [ordered]@{ status = "registered"; ok = $true; hresult = 0; error = "" }
    Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
    $healthUrl = if ($Mode -eq "bridge") { "http://127.0.0.1:40215/api/health" } else { "http://127.0.0.1:3891/health" }
    $entry.health = Wait-HttpHealth -Url $healthUrl -TimeoutSeconds $ReadyTimeoutSeconds -StartupReportPath $startupReportPath
    if ($entry.health.ok -ne $true) { throw "WPS readiness failed for ${healthUrl}: $($entry.health.lastError) (attempts=$($entry.health.attempts), timeout=$($entry.health.timeoutSeconds)s, report=$startupReportPath)" }
    $entry.startup = Read-StartupReport $startupReportPath
    if (-not $entry.startup -or [string]$entry.startup.status -ne "ready") { throw "WPS startup report did not remain ready after health success: $startupReportPath" }
    Start-Sleep -Seconds 2
    $entry.stability = Wait-HttpHealth -Url $healthUrl -TimeoutSeconds 3 -StartupReportPath $startupReportPath
    if ($entry.stability.ok -ne $true) { throw "WPS readiness was not stable after initial success for ${healthUrl}: $($entry.stability.lastError)" }
    $task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop
    $state = [string]$task.State
    $entry.state = $state
    $entry.lastTaskResult = $info.LastTaskResult
    if ($state -notin @("Running", "Ready")) {
      throw "Scheduled task state is '$state', expected Running or Ready."
    }
    if ([int64]$info.LastTaskResult -notin @(0, 267009)) { throw "Scheduled task last result is $($info.LastTaskResult), expected 0 or 267009. The process likely exited during startup." }
    $entry.start = [ordered]@{ status = "started"; ok = $true; hresult = 0; error = "" }
    $taskReport.tasks = @($taskReport.tasks) + @($entry)
  } catch {
    if (-not $entry.health.url) { $entry.health.url = if ($Mode -eq "bridge") { "http://127.0.0.1:40215/api/health" } else { "http://127.0.0.1:3891/health" } }
    $entry.health.status = "failed"
    $entry.health.ok = $false
    $entry.health.error = $_.Exception.Message
    $entry.startup = Read-StartupReport $entry.startupReportPath
    if ($entry.registration.ok -ne $true) {
      $entry.registration = [ordered]@{ status = "failed"; ok = $false; hresult = $_.Exception.HResult; error = $_.Exception.Message; fullyQualifiedErrorId = $_.FullyQualifiedErrorId }
    } else {
      $entry.start = [ordered]@{ status = "failed"; ok = $false; hresult = $_.Exception.HResult; error = $_.Exception.Message; fullyQualifiedErrorId = $_.FullyQualifiedErrorId }
    }
    $taskReport.tasks = @($taskReport.tasks) + @($entry)
    Save-TaskReport $taskReport
    throw "Scheduled task registration/start failed for '$TaskPath$TaskName': $($_.Exception.Message) (HRESULT=$($_.Exception.HResult)). Report: $ReportPath"
  }
}

try {
  Install-ConnectorTask -TaskName "WPS Connector Bridge" -Mode "bridge"
  Install-ConnectorTask -TaskName "WPS Connector Addin" -Mode "addin"
  $taskReport.ok = $true
  Save-TaskReport $taskReport
  [Console]::Out.WriteLine((ConvertTo-ConnectorJsonText -Value $taskReport -Compress))
} catch {
  Save-TaskReport $taskReport
  throw
}
