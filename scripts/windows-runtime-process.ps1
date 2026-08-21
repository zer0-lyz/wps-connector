# Shared Windows runtime process lifecycle helpers for WPS Connector.
# Match only Connector-owned node/PowerShell processes by exact runtime path.
# Never terminate WPS/ET host processes merely because their names match.

function Get-ConnectorRuntimeProcessSnapshot {
  param([Parameter(Mandatory = $true)] [string]$RuntimePath)
  if ([string]::IsNullOrWhiteSpace($RuntimePath)) { return @() }
  $normalized = ([System.IO.Path]::GetFullPath($RuntimePath)).TrimEnd('\').ToLowerInvariant()
  return @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.ProcessId -ne $PID -and $_.Name -match '^(?i:node|nodejs|powershell|pwsh)(?:\.exe)?$' -and
    -not [string]::IsNullOrWhiteSpace([string]$_.CommandLine) -and
    ([string]$_.CommandLine).Replace('/', '\').ToLowerInvariant().Contains($normalized)
  })
}

function Move-ConnectorRuntimeWithRetry {
  param([Parameter(Mandatory = $true)] [string]$From, [Parameter(Mandatory = $true)] [string]$To, [Parameter(Mandatory = $true)] [string]$Label, [int]$Attempts = 6, [int]$DelayMilliseconds = 500)
  $lastError = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try { Move-Item -LiteralPath $From -Destination $To -Force -ErrorAction Stop; return $true }
    catch {
      $lastError = $_.Exception
      [Console]::Error.WriteLine("[connector-process] $Label move attempt $attempt/$Attempts failed: $($_.Exception.Message)")
      if ($attempt -lt $Attempts) { Start-Sleep -Milliseconds ($DelayMilliseconds * $attempt) }
    }
  }
  throw "Could not move runtime '$From' to '$To' after $Attempts attempts. Root cause: $($lastError.Message)"
}

function Remove-ConnectorRuntimeWithRetry {
  param([Parameter(Mandatory = $true)] [string]$Path, [Parameter(Mandatory = $true)] [string]$Label, [int]$Attempts = 6, [int]$DelayMilliseconds = 500)
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  $lastError = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try { Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop; if (-not (Test-Path -LiteralPath $Path)) { return $true } }
    catch {
      $lastError = $_.Exception
      [Console]::Error.WriteLine("[connector-process] $Label removal attempt $attempt/$Attempts failed: $($_.Exception.Message)")
    }
    if ($attempt -lt $Attempts) { Start-Sleep -Milliseconds ($DelayMilliseconds * $attempt) }
  }
  throw "Could not remove runtime '$Path' after $Attempts attempts. Root cause: $($lastError.Message)"
}

function Stop-ConnectorRuntimeProcesses {
  param([Parameter(Mandatory = $true)] [string]$RuntimePath, [string]$Label = "Connector runtime", [int]$MaxAttempts = 6, [int]$DelayMilliseconds = 400)
  $processes = New-Object System.Collections.ArrayList
  $errors = New-Object System.Collections.ArrayList
  $matchedInitially = $false
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $matches = @(Get-ConnectorRuntimeProcessSnapshot -RuntimePath $RuntimePath)
    if ($matches.Count -gt 0) { $matchedInitially = $true }
    if ($matches.Count -eq 0) { return [ordered]@{ runtime = $RuntimePath; label = $Label; matched = if ($matchedInitially) { @($processes).Count } else { 0 }; attempts = $attempt; status = if ($matchedInitially) { "stopped" } else { "already_stopped" }; processes = @($processes); remaining = @(); errors = @($errors) } }
    foreach ($candidate in $matches) {
      $current = @(Get-ConnectorRuntimeProcessSnapshot -RuntimePath $RuntimePath | Where-Object { [int]$_.ProcessId -eq [int]$candidate.ProcessId })
      if ($current.Count -eq 0) { $null = $processes.Add([ordered]@{ pid = [int]$candidate.ProcessId; name = [string]$candidate.Name; status = "already_exited"; error = "" }); continue }
      $entry = [ordered]@{ pid = [int]$candidate.ProcessId; name = [string]$candidate.Name; commandLine = [string]$candidate.CommandLine; status = "pending"; error = "" }
      try { Stop-Process -Id $entry.pid -Force -ErrorAction Stop; $entry.status = "stop_requested" }
      catch {
        $entry.error = $_.Exception.Message
        $afterStop = @(Get-ConnectorRuntimeProcessSnapshot -RuntimePath $RuntimePath | Where-Object { [int]$_.ProcessId -eq $entry.pid })
        if ($afterStop.Count -eq 0) { $entry.status = "already_exited" }
        else {
          $taskkillOutput = @(& taskkill.exe /PID $entry.pid /T /F 2>&1)
          $taskkillCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
          $afterTaskkill = @(Get-ConnectorRuntimeProcessSnapshot -RuntimePath $RuntimePath | Where-Object { [int]$_.ProcessId -eq $entry.pid })
          if ($afterTaskkill.Count -eq 0) { $entry.status = "already_exited_or_taskkill" } else { $entry.error = "$($entry.error); taskkill exit code $taskkillCode; output: $($taskkillOutput -join ' ')" }
        }
      }
      $null = $processes.Add($entry)
    }
    Start-Sleep -Milliseconds ($DelayMilliseconds * $attempt)
  }
  $remaining = @(Get-ConnectorRuntimeProcessSnapshot -RuntimePath $RuntimePath)
  if ($remaining.Count -eq 0) { return [ordered]@{ runtime = $RuntimePath; label = $Label; matched = @($processes).Count; attempts = $MaxAttempts; status = "stopped"; processes = @($processes); remaining = @(); errors = @($errors) } }
  foreach ($item in $remaining) { $null = $errors.Add("PID $($item.ProcessId) '$($item.Name)' still matches runtime '$RuntimePath'.") }
  return [ordered]@{ runtime = $RuntimePath; label = $Label; matched = @($processes).Count; attempts = $MaxAttempts; status = "failed"; processes = @($processes); remaining = @($remaining | ForEach-Object { [ordered]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; commandLine = [string]$_.CommandLine } }); errors = @($errors) }
}

function Invoke-ConnectorNpmDiagnostics {
  param([Parameter(Mandatory = $true)] [string[]]$Arguments)
  $output = @(& npm.cmd @Arguments 2>&1)
  $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
  foreach ($line in $output) { [Console]::Error.WriteLine("[connector-npm] $([string]$line)") }
  return $exitCode
}
