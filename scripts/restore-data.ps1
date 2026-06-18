param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [switch]$ValidateOnly,
  [switch]$Restart,
  [int]$Port = 37820
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$ServerDir = Join-Path $Root "server"
$DataDir = Join-Path $ServerDir "data"
$BackupFullPath = (Resolve-Path $BackupPath).Path
$TempDir = Join-Path $env:TEMP "project-graph-web-restore-$([guid]::NewGuid().ToString('N'))"

function Assert-PathInside([string]$Parent, [string]$Child) {
  $ParentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $ChildFull = [IO.Path]::GetFullPath($Child)
  if (-not $ChildFull.StartsWith($ParentFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside expected directory: $ChildFull"
  }
}

Assert-PathInside $Root $DataDir
Assert-PathInside $Root $ServerDir

try {
  New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
  Expand-Archive -LiteralPath $BackupFullPath -DestinationPath $TempDir -Force

  $RestoredDataDir = Join-Path $TempDir "data"
  $RestoredProjectsJson = Join-Path $RestoredDataDir "projects.json"
  if (-not (Test-Path $RestoredDataDir)) {
    throw "Backup is missing data directory."
  }
  if (-not (Test-Path $RestoredProjectsJson)) {
    throw "Backup is missing data\projects.json."
  }
  Get-Content -Raw $RestoredProjectsJson | ConvertFrom-Json | Out-Null

  if ($ValidateOnly) {
    Write-Host "Backup is valid: $BackupFullPath"
    return
  }

  if (Test-Path $DataDir) {
    & (Join-Path $ScriptDir "backup-data.ps1") -Keep 10 | Out-Null
  }

  & (Join-Path $ScriptDir "stop-web.ps1") | Out-Null

  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
  Get-ChildItem -LiteralPath $DataDir -Force -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force

  Get-ChildItem -LiteralPath $RestoredDataDir -Force |
    Copy-Item -Destination $DataDir -Recurse -Force
  Set-Content -LiteralPath (Join-Path $DataDir "locks.json") -Value "{}" -Encoding UTF8

  Write-Host "Data restored from: $BackupFullPath"
  Write-Host "Data directory: $DataDir"
} finally {
  if (Test-Path $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($Restart) {
  & (Join-Path $ScriptDir "start-web.ps1") -SkipBuild -Port $Port
}
