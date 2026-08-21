function Read-ConnectorUtf8Text([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "UTF-8 input path is empty." }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "UTF-8 input file is missing: $Path" }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $offset = 0
  if ($bytes.Length -ge 3 -and [int]$bytes[0] -eq 239 -and [int]$bytes[1] -eq 187 -and [int]$bytes[2] -eq 191) {
    $offset = 3
  }
  $encoding = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList @($false, $true)
  return $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
}

function Read-ConnectorUtf8Json([string]$Path) {
  $raw = Read-ConnectorUtf8Text $Path
  if ([string]::IsNullOrWhiteSpace($raw)) { throw "UTF-8 JSON file is empty: $Path" }
  try {
    return ConvertFrom-Json -InputObject $raw
  } catch {
    throw "Invalid UTF-8 JSON in '$Path': $($_.Exception.Message)"
  }
}

function Write-ConnectorUtf8NoBom([string]$Path, [string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "UTF-8 output path is empty." }
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $encoding = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList @($false)
  [System.IO.File]::WriteAllBytes($Path, $encoding.GetBytes([string]$Text))
}

function ConvertTo-ConnectorPlainValue {
  param(
    [AllowNull()] [object]$Value,
    [int]$Depth = 0,
    [int]$MaxDepth = 24
  )
  if ($null -eq $Value) { return $null }
  if ($Depth -ge $MaxDepth) { return "[MaxDepthExceeded]" }
  if ($Value -is [string] -or $Value -is [char] -or $Value -is [bool] -or
      $Value -is [byte] -or $Value -is [sbyte] -or $Value -is [int16] -or
      $Value -is [uint16] -or $Value -is [int32] -or $Value -is [uint32] -or
      $Value -is [int64] -or $Value -is [uint64] -or $Value -is [single] -or
      $Value -is [double] -or $Value -is [decimal]) { return $Value }
  if ($Value -is [datetime] -or $Value -is [datetimeoffset] -or $Value -is [guid] -or $Value -is [uri]) { return [string]$Value }
  if ($Value -is [System.Management.Automation.ErrorRecord]) {
    return [ordered]@{ type = "ErrorRecord"; message = [string]$Value.Exception.Message; fullyQualifiedErrorId = [string]$Value.FullyQualifiedErrorId; category = [string]$Value.CategoryInfo; targetObject = [string]$Value.TargetObject; scriptStackTrace = [string]$Value.ScriptStackTrace }
  }
  if ($Value -is [System.Exception]) {
    return [ordered]@{ type = [string]$Value.GetType().FullName; message = [string]$Value.Message; hResult = [int]$Value.HResult; stackTrace = [string]$Value.StackTrace; innerException = ConvertTo-ConnectorPlainValue -Value $Value.InnerException -Depth ($Depth + 1) -MaxDepth $MaxDepth }
  }
  if ($Value -is [System.Management.Automation.PSPropertyInfo]) { return [string]$Value.Name }
  if ($Value -is [System.Collections.IDictionary]) {
    $plainDictionary = [ordered]@{}
    foreach ($key in @($Value.Keys)) { $plainDictionary[[string]$key] = ConvertTo-ConnectorPlainValue -Value $Value[$key] -Depth ($Depth + 1) -MaxDepth $MaxDepth }
    return $plainDictionary
  }
  if ($Value -is [System.Collections.IEnumerable]) {
    $plainArray = @()
    foreach ($item in $Value) { $plainArray += ,(ConvertTo-ConnectorPlainValue -Value $item -Depth ($Depth + 1) -MaxDepth $MaxDepth) }
    return ,$plainArray
  }
  $plainObject = [ordered]@{}
  foreach ($property in @($Value.PSObject.Properties)) {
    if ($property.MemberType -notin @("NoteProperty", "Property", "AliasProperty", "ScriptProperty")) { continue }
    try { $plainObject[[string]$property.Name] = ConvertTo-ConnectorPlainValue -Value $property.Value -Depth ($Depth + 1) -MaxDepth $MaxDepth }
    catch { $plainObject[[string]$property.Name] = [string]$property.Name }
  }
  if ($plainObject.Count -gt 0) { return $plainObject }
  return [string]$Value
}

function ConvertTo-ConnectorJsonText {
  param([AllowNull()] [object]$Value, [switch]$Compress)
  $plain = ConvertTo-ConnectorPlainValue -Value $Value
  if ($Compress) { return ($plain | ConvertTo-Json -Depth 30 -Compress) }
  return ($plain | ConvertTo-Json -Depth 30)
}

function Write-ConnectorUtf8JsonAtomic([string]$Path, [object]$Value, [int]$Depth = 20) {
  $json = ConvertTo-ConnectorJsonText -Value $Value
  $null = ConvertFrom-Json -InputObject $json
  $temporary = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  try {
    Write-ConnectorUtf8NoBom -Path $temporary -Text ("$json`r`n")
    $null = Read-ConnectorUtf8Json $temporary
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Move-Item -LiteralPath $temporary -Destination $Path -Force
    $null = Read-ConnectorUtf8Json $Path
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  }
}
