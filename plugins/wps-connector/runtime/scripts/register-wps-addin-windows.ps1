[CmdletBinding()]
param(
  [string]$PublishPath = (Join-Path $env:APPDATA "kingsoft\wps\jsaddons\publish.xml"),
  [string]$BackupRoot = (Join-Path $env:LOCALAPPDATA "Connector Suite\backups\wps-registration"),
  [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss-fff")
)

$ErrorActionPreference = "Stop"
$jsonHelperPath = Join-Path $PSScriptRoot "windows-json.ps1"
if (-not (Test-Path -LiteralPath $jsonHelperPath -PathType Leaf)) { throw "Windows JSON helper is missing: $jsonHelperPath" }
. $jsonHelperPath
$contractPath = Join-Path (Split-Path -Parent $PSScriptRoot) "config\windows-addin-contract.json"
if (-not (Test-Path -LiteralPath $contractPath -PathType Leaf)) { throw "WPS Windows add-in contract is missing: $contractPath" }
try { $contract = Read-ConnectorUtf8Json $contractPath } catch { throw "WPS Windows add-in contract is invalid JSON: $($_.Exception.Message)" }
$registrations = @($contract.registrations | ForEach-Object { [ordered]@{ name = [string]$_.name; type = [string]$_.type } })
if ($registrations.Count -ne 2 -or @($registrations | Where-Object { -not $_.name -or -not $_.type }).Count -gt 0) { throw "WPS Windows add-in contract must define exactly two named registrations." }
$enableMode = [string]$contract.enable
$debugMode = [string]$contract.debug
$installMode = [string]$contract.install
$addinUrl = [string]$contract.url
$addinImage = [string]$contract.image
$addinIcon = [string]$contract.icon
$addinImageUrl = [string]$contract.imageUrl
if (-not $enableMode -or -not $addinUrl -or -not $addinImage -or -not $addinIcon -or -not $addinImageUrl) { throw "WPS Windows add-in contract is incomplete: $contractPath" }
$publishDir = Split-Path -Parent $PublishPath
New-Item -ItemType Directory -Path $publishDir, $BackupRoot -Force | Out-Null
$runBackupDir = Join-Path $BackupRoot $RunId

function Write-RegistrationDiagnostics([object]$Registration, [object[]]$Nodes, [object[]]$Matches) {
  $failedPublishPath = Join-Path $runBackupDir "failed-publish.xml"
  $diagnosticPath = Join-Path $runBackupDir "registration-diagnostics.json"
  try {
    New-Item -ItemType Directory -Path $runBackupDir -Force | Out-Null
    if (Test-Path -LiteralPath $PublishPath -PathType Leaf) {
      Copy-Item -LiteralPath $PublishPath -Destination $failedPublishPath -Force
    }
    $nodeDetails = @($Nodes | ForEach-Object {
      [ordered]@{
        name = $_.GetAttribute("name")
        type = $_.GetAttribute("type")
        url = $_.GetAttribute("url")
        enable = $_.GetAttribute("enable")
        debug = $_.GetAttribute("debug")
      }
    })
    $matchDetails = @($Matches | ForEach-Object {
      [ordered]@{
        name = $_.GetAttribute("name")
        type = $_.GetAttribute("type")
        url = $_.GetAttribute("url")
        enable = $_.GetAttribute("enable")
        debug = $_.GetAttribute("debug")
      }
    })
    $report = [ordered]@{
      ok = $false
      publishPath = $PublishPath
      failedPublishPath = $failedPublishPath
      registration = [ordered]@{ name = $Registration.name; type = $Registration.type }
      expected = [ordered]@{ url = $addinUrl; image = $addinImage; icon = $addinIcon; imageUrl = $addinImageUrl; enable = $enableMode; debug = $debugMode; install = $installMode }
      matchCount = @($Matches).Count
      nodeCount = @($Nodes).Count
      matches = $matchDetails
      nodes = $nodeDetails
      xml = if (Test-Path -LiteralPath $PublishPath -PathType Leaf) { Get-Content -LiteralPath $PublishPath -Raw } else { "" }
    }
    Write-ConnectorUtf8JsonAtomic -Path $diagnosticPath -Value $report -Depth 12
  } catch {
    [Console]::Error.WriteLine("[wps-register] WARNING: Could not preserve registration diagnostics: $($_.Exception.Message)")
  }
  return [ordered]@{ failedPublishPath = $failedPublishPath; diagnosticPath = $diagnosticPath }
}

if (Test-Path -LiteralPath $PublishPath) {
  $backupDir = Join-Path $BackupRoot $RunId
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  Copy-Item -LiteralPath $PublishPath -Destination (Join-Path $backupDir "publish.xml") -Force
  try {
    [xml]$document = Get-Content -LiteralPath $PublishPath -Raw
  } catch {
    throw "Existing WPS publish.xml is invalid XML: $($_.Exception.Message)"
  }
} else {
  $document = New-Object System.Xml.XmlDocument
  $declaration = $document.CreateXmlDeclaration("1.0", "UTF-8", $null)
  $document.AppendChild($declaration) | Out-Null
  $document.AppendChild($document.CreateElement("jsplugins")) | Out-Null
}

if (-not $document.DocumentElement -or $document.DocumentElement.Name -ne "jsplugins") {
  throw "WPS publish.xml root must be <jsplugins>."
}

$names = @($registrations | ForEach-Object { $_.name })
@($document.DocumentElement.SelectNodes("jspluginonline")) | Where-Object {
  $names -contains $_.GetAttribute("name")
} | ForEach-Object {
  $document.DocumentElement.RemoveChild($_) | Out-Null
}

foreach ($registration in $registrations) {
  $node = $document.CreateElement("jspluginonline")
  $attributes = [ordered]@{
    name = $registration.name
    type = $registration.type
    url = $addinUrl
    debug = $debugMode
    enable = $enableMode
    install = $installMode
    icon = $addinIcon
    image = $addinImage
    imageUrl = $addinImageUrl
  }
  foreach ($item in $attributes.GetEnumerator()) {
    $node.SetAttribute($item.Key, [string]$item.Value)
  }
  $document.DocumentElement.AppendChild($node) | Out-Null
}

$settings = New-Object System.Xml.XmlWriterSettings
$settings.Encoding = New-Object System.Text.UTF8Encoding($false)
$settings.Indent = $true
$writer = [System.Xml.XmlWriter]::Create($PublishPath, $settings)
try {
  $document.Save($writer)
} finally {
  $writer.Dispose()
}

[xml]$verified = Get-Content -LiteralPath $PublishPath -Raw
foreach ($registration in $registrations) {
  $nodes = @($verified.DocumentElement.SelectNodes("jspluginonline"))
  $matches = @(
    $nodes |
      Where-Object {
        $_.GetAttribute("name") -eq $registration.name -and
        $_.GetAttribute("type") -eq $registration.type -and
        $_.GetAttribute("url") -eq $addinUrl -and
        $_.GetAttribute("image") -eq $addinImage -and
        $_.GetAttribute("icon") -eq $addinIcon -and
        $_.GetAttribute("imageUrl") -eq $addinImageUrl -and
        $_.GetAttribute("enable") -eq $enableMode -and
        $_.GetAttribute("debug") -eq $debugMode -and
        $_.GetAttribute("install") -eq $installMode
      }
  )
  if ($matches.Count -ne 1) {
    $diagnostics = Write-RegistrationDiagnostics -Registration $registration -Nodes $nodes -Matches $matches
    throw "WPS $($registration.type) registration was not persisted exactly once (matchCount=$($matches.Count), nodeCount=$($nodes.Count)). Diagnostics: $($diagnostics.diagnosticPath). Failed XML: $($diagnostics.failedPublishPath)."
  }
}

[Console]::Error.WriteLine("[wps-register] Updated $PublishPath with enable=$enableMode")
[ordered]@{
  ok = $true
  publishPath = $PublishPath
  contractPath = $contractPath
  enable = $enableMode
  registrations = 2
} | ForEach-Object { ConvertTo-ConnectorJsonText -Value $_ -Compress }
