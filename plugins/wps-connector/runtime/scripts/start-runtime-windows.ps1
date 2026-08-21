[CmdletBinding()]
param(
  [ValidateSet("bridge", "addin")]
  [string]$Mode,
  [string]$RuntimeDir = (Split-Path -Parent $PSScriptRoot),
  [string]$NodePath = "",
  [string]$RunId = "",
  [int]$ReadyTimeoutSeconds = 30,
  [string]$StartupReportPath = ""
)

$ErrorActionPreference = "Stop"
$jsonHelperPath = Join-Path $PSScriptRoot "windows-json.ps1"
if (-not (Test-Path -LiteralPath $jsonHelperPath -PathType Leaf)) { throw "Windows JSON helper is missing: $jsonHelperPath" }
. $jsonHelperPath
$logsDir = Join-Path $env:LOCALAPPDATA "Connector Suite\logs"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
$logPath = if ($Mode -eq "bridge") { Join-Path $logsDir "wps-bridge.log" } else { Join-Path $logsDir "wps-addin.log" }
$effectiveRunId = if ($RunId) { $RunId } else { "adhoc-$([guid]::NewGuid().ToString('N'))" }
if (-not $StartupReportPath) {
  $StartupReportPath = Join-Path $logsDir ("wps-{0}-startup-{1}.json" -f $Mode, $effectiveRunId)
}
$latestStartupReportPath = Join-Path $logsDir ("wps-{0}-startup.json" -f $Mode)

function Write-Log([string]$Message) {
  Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f (Get-Date -Format o), $Message) -Encoding UTF8
}

function Write-Utf8Json([string]$Path, [object]$Value) {
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $temporary = "$Path.tmp-$PID"
  $json = ConvertTo-ConnectorJsonText -Value $Value
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($temporary, "$json`r`n", $encoding)
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Quote-ProcessArgument([string]$Value) {
  if ($null -eq $Value -or $Value -notmatch '[\s"]') { return [string]$Value }
  $escaped = $Value -replace '(\\*)"', '$1$1\"'
  $escaped = $escaped -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

function Get-ArrayText([object]$Items) {
  return @($Items | ForEach-Object { [string]$_ })
}

function Write-StartupReport([System.Collections.IDictionary]$Report) {
  $Report.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  try {
    Write-Utf8Json -Path $StartupReportPath -Value $Report
    Write-Utf8Json -Path $latestStartupReportPath -Value $Report
  } catch {
    Write-Log ("Could not write startup report: " + $_.Exception.ToString())
  }
}

function Get-HealthTarget {
  if ($Mode -eq "bridge") {
    return [ordered]@{ url = "http://127.0.0.1:40215/api/health"; expectedName = "wps-connector" }
  }
  return [ordered]@{ url = "http://127.0.0.1:3891/health"; expectedName = "wps-connector-addin" }
}

function Invoke-HealthProbe([string]$Url, [string]$ExpectedName) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 -ErrorAction Stop
    $body = ConvertFrom-Json -InputObject ([string]$response.Content)
    $nameOk = (-not $ExpectedName) -or ([string]$body.name -eq $ExpectedName)
    $platformOk = $true
    $platformError = ""
    if ($Mode -eq "bridge") {
      $platformOk = ($body.connectorPlatform.ok -eq $true)
      if (-not $platformOk) { $platformError = [string]$body.connectorPlatform.lastError }
    }
    return [ordered]@{
      ok = ([int]$response.StatusCode -eq 200 -and $body.ok -eq $true -and $nameOk -and $platformOk)
      statusCode = [int]$response.StatusCode
      body = $body
      nameOk = $nameOk
      platformOk = $platformOk
      platformError = $platformError
      error = if ($body.ok -ne $true) { "Health body did not contain ok:true." } elseif (-not $nameOk) { "Unexpected service name: $($body.name)" } elseif (-not $platformOk) { "Connector Platform registration is not ready: $platformError" } else { "" }
    }
  } catch {
    return [ordered]@{ ok = $false; statusCode = $null; body = $null; nameOk = $false; platformOk = $false; platformError = ""; error = $_.Exception.Message }
  }
}

function Get-PortDiagnostics([int]$Port) {
  $owners = New-Object System.Collections.ArrayList
  $diagnosticError = ""
  try {
    foreach ($connection in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)) {
      $ownerPid = [int]$connection.OwningProcess
      $processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $ownerPid) -ErrorAction SilentlyContinue
      $null = $owners.Add([ordered]@{
        pid = $ownerPid
        name = if ($processInfo) { [string]$processInfo.Name } else { "" }
        commandLine = if ($processInfo) { [string]$processInfo.CommandLine } else { "" }
      })
    }
  } catch {
    $diagnosticError = $_.Exception.Message
  }
  return [ordered]@{ port = $Port; listening = (@($owners).Count -gt 0); owners = @($owners); error = $diagnosticError }
}

function Stop-OwnedNodeProcess([System.Diagnostics.Process]$Process) {
  if ($null -eq $Process -or $Process.HasExited) { return }
  Write-Log "Stopping owned Node process tree. PID=$($Process.Id)"
  try { & taskkill.exe /PID $Process.Id /T /F 2>&1 | ForEach-Object { Write-Log ("TASKKILL: " + [string]$_) } } catch { Write-Log ("taskkill failed: " + $_.Exception.Message) }
  try { $Process.WaitForExit(5000) | Out-Null } catch {}
  if (-not $Process.HasExited) {
    try { $Process.Kill() } catch { Write-Log ("Process kill failed: " + $_.Exception.Message) }
  }
}

function Wait-ProcessOutput([System.Diagnostics.Process]$Process) {
  try { $Process.WaitForExit() } catch {}
  try { $Process.WaitForExit() } catch {}
  Start-Sleep -Milliseconds 150
}

try {
  if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node executable is missing: $NodePath" }
  $RuntimeDir = [System.IO.Path]::GetFullPath($RuntimeDir)
  $target = Get-HealthTarget
  $port = if ($Mode -eq "bridge") { 40215 } else { 3891 }
  $entry = $null
  $environment = @{}
  if ($Mode -eq "bridge") {
    $environment.WPS_CONNECTOR_HOST = "127.0.0.1"
    $environment.WPS_CONNECTOR_PORT = "40215"
    $entry = Join-Path $RuntimeDir "apps\bridge\server.js"
  } else {
    $environment.WPS_CONNECTOR_ADDIN_HOST = "127.0.0.1"
    $environment.WPS_CONNECTOR_ADDIN_PORT = "3891"
    $environment.WPS_CONNECTOR_ADDIN_ROOT = Join-Path $RuntimeDir "apps\wps-addin"
    $entry = Join-Path $RuntimeDir "apps\wps-addin\server.js"
  }
  if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "WPS $Mode entrypoint is missing: $entry" }
  $environment.WPS_CONNECTOR_RUNTIME_ROOT = $RuntimeDir
  $environment.CONNECTOR_PLATFORM_URL = "http://127.0.0.1:40315"
  $environment.CONNECTOR_PLATFORM_HEARTBEAT_MS = "5000"
  foreach ($key in $environment.Keys) { Set-Item -Path ("Env:{0}" -f $key) -Value ([string]$environment[$key]) }
  Set-Location -LiteralPath $RuntimeDir

  $commandLine = (Quote-ProcessArgument $NodePath) + " " + (Quote-ProcessArgument $entry)
  $startupFailureCode = if ($Mode -eq "bridge") { "WPS_BRIDGE_START_FAILED" } else { "WPS_ADDIN_START_FAILED" }
  $readinessFailureCode = if ($Mode -eq "bridge") { "WPS_BRIDGE_READINESS_TIMEOUT" } else { "WPS_ADDIN_READINESS_TIMEOUT" }
  $stdoutLines = New-Object System.Collections.ArrayList
  $stderrLines = New-Object System.Collections.ArrayList
  $targetReport = [ordered]@{
    runId = $effectiveRunId
    mode = $Mode
    status = "starting"
    ok = $false
    stage = "ProcessStart"
    runtimeDir = $RuntimeDir
    nodePath = $NodePath
    commandLine = $commandLine
    entry = $entry
    workingDirectory = $RuntimeDir
    processId = $null
    processStartTime = ""
    processEndTime = ""
    exitCode = $null
    stdout = @()
    stderr = @()
    readiness = [ordered]@{ stage = "Readiness"; url = $target.url; expectedName = $target.expectedName; timeoutSeconds = $ReadyTimeoutSeconds; attempts = 0; ok = $false; startedAt = (Get-Date).ToUniversalTime().ToString("o"); endedAt = ""; lastError = ""; last = $null; port = $null; logPath = $logPath; startupReportPath = $StartupReportPath }
    port = Get-PortDiagnostics -Port $port
    lastError = ""
    logPath = $logPath
    reportPath = $StartupReportPath
  }
  Write-Log "Starting WPS $Mode. NodePath=$NodePath RuntimeDir=$RuntimeDir Entry=$entry CommandLine=$commandLine RunId=$effectiveRunId"

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $process.StartInfo.FileName = $NodePath
  $process.StartInfo.Arguments = Quote-ProcessArgument $entry
  $process.StartInfo.WorkingDirectory = $RuntimeDir
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  $process.add_OutputDataReceived({ param($sender, $event); if ($event.Data) { $null = $stdoutLines.Add([string]$event.Data); Write-Log ("STDOUT: " + [string]$event.Data) } })
  $process.add_ErrorDataReceived({ param($sender, $event); if ($event.Data) { $null = $stderrLines.Add([string]$event.Data); Write-Log ("STDERR: " + [string]$event.Data) } })

  if (-not $process.Start()) { throw "Node process did not start." }
  $targetReport.processId = [int]$process.Id
  $targetReport.processStartTime = (Get-Date).ToUniversalTime().ToString("o")
  Write-Log "Node process started. PID=$($process.Id)"
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()
  Write-StartupReport $targetReport

  $deadline = (Get-Date).AddSeconds([Math]::Max(5, $ReadyTimeoutSeconds))
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      Wait-ProcessOutput $process
      $targetReport.exitCode = [int]$process.ExitCode
      $targetReport.stdout = Get-ArrayText $stdoutLines
      $targetReport.stderr = Get-ArrayText $stderrLines
      $targetReport.processEndTime = (Get-Date).ToUniversalTime().ToString("o")
      $targetReport.status = "failed"
      $targetReport.stage = "ProcessExitBeforeReadiness"
      $targetReport.port = Get-PortDiagnostics -Port $port
      $targetReport.lastError = "WPS $Mode Node process exited before readiness with code $($targetReport.exitCode)."
      Write-StartupReport $targetReport
      throw ("{0}: {1} ExitCode={2}; Stdout={3}; Stderr={4}; CommandLine={5}; StartupReport={6}" -f $startupFailureCode, $targetReport.lastError, $targetReport.exitCode, (($targetReport.stdout -join " | ").Trim()), (($targetReport.stderr -join " | ").Trim()), $commandLine, $StartupReportPath)
    }
    $probe = Invoke-HealthProbe -Url $target.url -ExpectedName $target.expectedName
    $targetReport.readiness.attempts = [int]$targetReport.readiness.attempts + 1
    $targetReport.readiness.last = $probe
    $targetReport.readiness.lastError = [string]$probe.error
    $targetReport.readiness.port = $targetReport.port
    if ($probe.ok) { $ready = $true; break }
    $targetReport.lastError = [string]$probe.error
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    $targetReport.stdout = Get-ArrayText $stdoutLines
    $targetReport.stderr = Get-ArrayText $stderrLines
    $targetReport.status = "failed"
    $targetReport.stage = "ReadinessTimeout"
    $targetReport.port = Get-PortDiagnostics -Port $port
    $targetReport.readiness.endedAt = (Get-Date).ToUniversalTime().ToString("o")
    $targetReport.readiness.lastError = [string]$targetReport.lastError
    $targetReport.readiness.port = $targetReport.port
    $targetReport.lastError = "WPS $Mode readiness timed out after $ReadyTimeoutSeconds seconds at $($target.url)."
    Stop-OwnedNodeProcess $process
    Wait-ProcessOutput $process
    $targetReport.exitCode = if ($process.HasExited) { [int]$process.ExitCode } else { $null }
    $targetReport.processEndTime = (Get-Date).ToUniversalTime().ToString("o")
    $targetReport.stdout = Get-ArrayText $stdoutLines
    $targetReport.stderr = Get-ArrayText $stderrLines
    Write-StartupReport $targetReport
    throw ("{0}: {1} LastError={2}; Stdout={3}; Stderr={4}; CommandLine={5}; StartupReport={6}" -f $readinessFailureCode, $targetReport.lastError, $targetReport.readiness.last.error, (($targetReport.stdout -join " | ").Trim()), (($targetReport.stderr -join " | ").Trim()), $commandLine, $StartupReportPath)
  }

  $targetReport.status = "ready"
  $targetReport.ok = $true
  $targetReport.stage = "Ready"
  $targetReport.readiness.ok = $true
  $targetReport.readiness.endedAt = (Get-Date).ToUniversalTime().ToString("o")
  $targetReport.readiness.lastError = ""
  $targetReport.stdout = Get-ArrayText $stdoutLines
  $targetReport.stderr = Get-ArrayText $stderrLines
  $targetReport.lastError = ""
  Write-StartupReport $targetReport
  Write-Log "WPS $Mode readiness passed. URL=$($target.url) PID=$($process.Id)"

  Wait-ProcessOutput $process
  $exitCode = [int]$process.ExitCode
  $targetReport.exitCode = $exitCode
  $targetReport.processEndTime = (Get-Date).ToUniversalTime().ToString("o")
  $targetReport.stdout = Get-ArrayText $stdoutLines
  $targetReport.stderr = Get-ArrayText $stderrLines
  if ($exitCode -ne 0) {
    $targetReport.status = "failed"
    $targetReport.ok = $false
    $targetReport.stage = "ProcessExitAfterReadiness"
    $targetReport.lastError = "WPS $Mode Node process exited after readiness with code $exitCode."
    Write-StartupReport $targetReport
    throw ("{0}: {1}; Stdout={2}; Stderr={3}; CommandLine={4}; StartupReport={5}" -f $startupFailureCode, $targetReport.lastError, (($targetReport.stdout -join " | ").Trim()), (($targetReport.stderr -join " | ").Trim()), $commandLine, $StartupReportPath)
  }
  $targetReport.status = "stopped"
  $targetReport.ok = $false
  $targetReport.stage = "ProcessExit"
  $targetReport.lastError = "WPS $Mode Node process exited with code 0 after readiness."
  Write-StartupReport $targetReport
  $global:LASTEXITCODE = $exitCode
  exit $exitCode
} catch {
  $message = $_.Exception.ToString()
  try {
    if ($process -and -not $process.HasExited) { Stop-OwnedNodeProcess $process }
    if ($targetReport) {
      $targetReport.status = "failed"
      $targetReport.ok = $false
      $targetReport.stage = if ($targetReport.stage -eq "ProcessStart") { "ProcessStartFailed" } else { [string]$targetReport.stage }
      $targetReport.lastError = $message
      if ($process -and $process.HasExited) { $targetReport.exitCode = [int]$process.ExitCode }
      $targetReport.processEndTime = (Get-Date).ToUniversalTime().ToString("o")
      $targetReport.stdout = Get-ArrayText $stdoutLines
      $targetReport.stderr = Get-ArrayText $stderrLines
      Write-StartupReport $targetReport
    } else {
      Write-StartupReport ([ordered]@{
        runId = $effectiveRunId
        mode = $Mode
        status = "failed"
        ok = $false
        stage = "ProcessStartFailed"
        runtimeDir = $RuntimeDir
        nodePath = $NodePath
        commandLine = ""
        entry = ""
        workingDirectory = $RuntimeDir
        processId = $null
        processStartTime = ""
        processEndTime = (Get-Date).ToUniversalTime().ToString("o")
        exitCode = $null
        stdout = @()
        stderr = @()
        readiness = [ordered]@{ stage = "Readiness"; url = ""; expectedName = ""; timeoutSeconds = $ReadyTimeoutSeconds; attempts = 0; ok = $false; startedAt = ""; endedAt = (Get-Date).ToUniversalTime().ToString("o"); lastError = $message; last = $null; port = $null; logPath = $logPath; startupReportPath = $StartupReportPath }
        port = [ordered]@{ port = $null; listening = $false; owners = @(); error = "" }
        lastError = $message
        logPath = $logPath
        reportPath = $StartupReportPath
      })
    }
    Write-Log ("WPS $Mode startup failed: " + $message)
  } catch {}
  [Console]::Error.WriteLine($message)
  exit 1
}
