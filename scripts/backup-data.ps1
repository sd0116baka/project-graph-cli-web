param(
  [string]$BackupDir = "",
  [int]$Keep = 10,
  [string]$DataDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$DataDir = Resolve-WebDataDir -Root $Root -DataDir $DataDir

if (-not $BackupDir) {
  $BackupDir = Join-Path $Root "web-backups"
}

if (-not (Test-Path $DataDir)) {
  throw "Data directory does not exist: $DataDir"
}

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ZipPath = Join-Path $BackupDir "project-graph-web-data-$Timestamp.zip"
$TempDir = Join-Path $env:TEMP "project-graph-web-backup-$([guid]::NewGuid().ToString('N'))"
$TempDataDir = Join-Path $TempDir "data"

try {
  New-Item -ItemType Directory -Path $TempDataDir -Force | Out-Null

  foreach ($Name in @("projects", "backups", "projects.json", "auth.json")) {
    $Source = Join-Path $DataDir $Name
    if (Test-Path $Source) {
      Copy-Item -LiteralPath $Source -Destination $TempDataDir -Recurse -Force
    }
  }

  @{
    app = "project-graph-web"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    sourceDataDir = $DataDir
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $TempDir "manifest.json") -Encoding UTF8

  Compress-Archive -Path (Join-Path $TempDir "*") -DestinationPath $ZipPath -Force
} finally {
  if (Test-Path $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($Keep -gt 0) {
  Get-ChildItem -LiteralPath $BackupDir -Filter "project-graph-web-data-*.zip" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep |
    Remove-Item -Force
}

Write-Host "Backup created: $ZipPath"
Write-Host "Source data directory: $DataDir"
Write-Output $ZipPath
