[CmdletBinding()]
param(
  [string]$PublishPath = (Join-Path $env:APPDATA "kingsoft\wps\jsaddons\publish.xml"),
  [string]$BackupRoot = (Join-Path $env:LOCALAPPDATA "Connector Suite\backups\wps-registration"),
  [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss")
)

$ErrorActionPreference = "Stop"
$publishDir = Split-Path -Parent $PublishPath
New-Item -ItemType Directory -Path $publishDir, $BackupRoot -Force | Out-Null

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

$names = @("wps_connector_wps_binding_v7", "wps_connector_et_binding_v7")
@($document.DocumentElement.SelectNodes("jspluginonline")) | Where-Object {
  $names -contains $_.GetAttribute("name")
} | ForEach-Object {
  $document.DocumentElement.RemoveChild($_) | Out-Null
}

foreach ($registration in @(
  @{ name = "wps_connector_wps_binding_v7"; type = "wps" },
  @{ name = "wps_connector_et_binding_v7"; type = "et" }
)) {
  $node = $document.CreateElement("jspluginonline")
  foreach ($item in [ordered]@{
    name = $registration.name
    type = $registration.type
    url = "http://127.0.0.1:3891/"
    debug = ""
    enable = "enable"
    install = "null"
    icon = "http://127.0.0.1:3891/images/connector.svg"
    image = "http://127.0.0.1:3891/images/connector.svg"
    imageUrl = "http://127.0.0.1:3891/images/connector.svg"
  }.GetEnumerator()) {
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
foreach ($registration in @(
  @{ name = "wps_connector_wps_binding_v7"; type = "wps" },
  @{ name = "wps_connector_et_binding_v7"; type = "et" }
)) {
  $matches = @($verified.DocumentElement.SelectNodes("jspluginonline")) | Where-Object {
    $_.GetAttribute("name") -eq $registration.name -and
    $_.GetAttribute("type") -eq $registration.type -and
    $_.GetAttribute("url") -eq "http://127.0.0.1:3891/" -and
    $_.GetAttribute("enable") -eq "enable" -and
    $_.GetAttribute("debug") -eq ""
  }
  if ($matches.Count -ne 1) {
    throw "WPS $($registration.type) registration was not persisted exactly once."
  }
}

[Console]::Error.WriteLine("[wps-register] Updated $PublishPath")
[ordered]@{
  ok = $true
  publishPath = $PublishPath
  registrations = 2
} | ConvertTo-Json -Compress
