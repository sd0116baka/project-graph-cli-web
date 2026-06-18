param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [switch]$ValidateOnly,
  [switch]$Restart,
  [int]$Port = 37820,
  [string]$DataDir = "",
  [string]$PreRestoreBackupDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$ServerDir = Join-Path $Root "server"
$DataDir = Resolve-WebDataDir -Root $Root -DataDir $DataDir
$BackupFullPath = (Resolve-Path $BackupPath).Path
$TempDir = Join-Path $env:TEMP "project-graph-web-restore-$([guid]::NewGuid().ToString('N'))"
$TargetPort = $Port
$Runtime = Read-WebRuntime -Root $Root
if (
  $Runtime `
    -and $Runtime.dataDir `
    -and ($Runtime.PSObject.Properties.Name -contains "port") `
    -and (Test-SameWebPath -Left ([string]$Runtime.dataDir) -Right $DataDir)
) {
  $TargetPort = [int]$Runtime.port
}

function Assert-PathInside([string]$Parent, [string]$Child) {
  $ParentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $ChildFull = [IO.Path]::GetFullPath($Child)
  if (-not $ChildFull.StartsWith($ParentFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside expected directory: $ChildFull"
  }
}

Assert-PathInside $Root $ServerDir
Assert-SafeWebDataDir -Root $Root -DataDir $DataDir

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
    $BackupArgs = @{
      Keep = 10
      DataDir = $DataDir
    }
    if ($PreRestoreBackupDir) {
      $BackupArgs.BackupDir = $PreRestoreBackupDir
    }
    & (Join-Path $ScriptDir "backup-data.ps1") @BackupArgs | Out-Null
  }

  & (Join-Path $ScriptDir "stop-web.ps1") -PortStart $TargetPort -PortEnd $TargetPort | Out-Null

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
  & (Join-Path $ScriptDir "start-web.ps1") -SkipBuild -Port $TargetPort -DataDir $DataDir
}
