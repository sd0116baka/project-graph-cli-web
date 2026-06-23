param(
  [string]$OutputDir = "dist\desktop-portable",
  [string]$Version = "",
  [switch]$SkipPortableBuild,
  [switch]$SkipTauriBuild,
  [switch]$WithDefaultFeatures
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$AppDir = Join-Path $Root "app"
$TauriDir = Join-Path $AppDir "src-tauri"
$PortableStage = Join-Path $Root "dist\portable\project-graph-cli-web"
$PortableScript = Join-Path $ScriptDir "package-portable.ps1"
$TauriConfig = Join-Path $TauriDir "tauri.cli-web.conf.json"

$PathParts = @(
  [Environment]::GetEnvironmentVariable("Path", "Machine"),
  [Environment]::GetEnvironmentVariable("Path", "User"),
  (Join-Path $env:USERPROFILE ".cargo\bin"),
  $env:Path
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$env:Path = ($PathParts -join ";")

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath exited with code $LASTEXITCODE."
  }
}

function Assert-PathInside {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Parent,
    [Parameter(Mandatory = $true)]
    [string]$Child
  )
  $ParentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $ChildFull = [IO.Path]::GetFullPath($Child).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  if (-not $ChildFull.StartsWith($ParentFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside ${ParentFull}: $ChildFull"
  }
}

function Copy-Directory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Source,
    [Parameter(Mandatory = $true)]
    [string]$Destination
  )
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing required directory: $Source"
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Copy-File {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Source,
    [Parameter(Mandatory = $true)]
    [string]$Destination
  )
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing required file: $Source"
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Stop-ProcessesUsingPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $PathFull = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $CurrentPid = $PID
  $Processes = Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $CurrentPid -and (
        ($_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($PathFull, [StringComparison]::OrdinalIgnoreCase)) -or
        ($_.CommandLine -and $_.CommandLine.IndexOf($PathFull, [StringComparison]::OrdinalIgnoreCase) -ge 0)
      )
    }

  foreach ($ProcessInfo in $Processes) {
    $Process = Get-Process -Id $ProcessInfo.ProcessId -ErrorAction SilentlyContinue
    if (-not $Process) {
      continue
    }

    Write-Host "Stopping stale portable process PID $($Process.Id): $($Process.ProcessName)"
    if ($Process.MainWindowHandle -ne 0) {
      $null = $Process.CloseMainWindow()
      if ($Process.WaitForExit(5000)) {
        continue
      }
    }
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}

function Stop-StagedBackendRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $StopScript = Join-Path $Path "backend-runtime\scripts\stop-web.ps1"
  if (-not (Test-Path -LiteralPath $StopScript)) {
    return
  }

  Write-Host "Stopping stale portable backend runtime..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File $StopScript -PortStart 37820 -PortEnd 37920
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Stale portable backend stop script exited with code $LASTEXITCODE; continuing with process cleanup."
  }
}

function Get-DesktopExecutable {
  $ReleaseDir = Join-Path $TauriDir "target\release"
  $Candidates = @(
    (Join-Path $ReleaseDir "project-graph.exe"),
    (Join-Path $ReleaseDir "Project Graph.exe")
  )
  foreach ($Candidate in $Candidates) {
    if (Test-Path -LiteralPath $Candidate) {
      return (Resolve-Path -LiteralPath $Candidate).Path
    }
  }

  $Executable = Get-ChildItem -LiteralPath $ReleaseDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "*setup*.exe" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($Executable) {
    return $Executable.FullName
  }
  throw "Desktop executable was not found in $ReleaseDir. Run this script without -SkipTauriBuild first."
}

function Get-Sha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )
  $Stream = [IO.File]::OpenRead($Path)
  try {
    $Sha256 = [Security.Cryptography.SHA256]::Create()
    try {
      $HashBytes = $Sha256.ComputeHash($Stream)
      return (($HashBytes | ForEach-Object { $_.ToString("x2") }) -join "")
    } finally {
      $Sha256.Dispose()
    }
  } finally {
    $Stream.Dispose()
  }
}

Set-Location $Root

if (-not $Version) {
  $Package = Get-Content -Raw (Join-Path $Root "package.json") | ConvertFrom-Json
  $Version = [string]$Package.version
}

if ($SkipPortableBuild) {
  & $PortableScript -SkipBuild
} else {
  & $PortableScript
}

if (-not (Test-Path -LiteralPath (Join-Path $PortableStage "scripts\start-web.ps1"))) {
  throw "Portable backend runtime was not staged at $PortableStage."
}
if (-not (Test-Path -LiteralPath $TauriConfig)) {
  throw "Missing Tauri CLI/Web config: $TauriConfig"
}

if (-not $SkipTauriBuild) {
  Push-Location $AppDir
  try {
    $BuildArgs = @(
      "exec",
      "tauri",
      "build",
      "--config",
      "src-tauri\tauri.cli-web.conf.json",
      "--no-bundle"
    )
    if (-not $WithDefaultFeatures) {
      $BuildArgs += @("--", "--no-default-features")
    }
    Invoke-NativeCommand -FilePath "pnpm" -Arguments $BuildArgs
  } finally {
    Pop-Location
  }
}

$DesktopExe = Get-DesktopExecutable
$OutputDir = [IO.Path]::GetFullPath((Join-Path $Root $OutputDir))
$StageRoot = Join-Path $OutputDir "Project Graph"
$ZipPath = Join-Path $OutputDir "project-graph-desktop-portable-$Version-windows-preview.zip"
$ShaPath = "$ZipPath.sha256"

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
Assert-PathInside -Parent $OutputDir -Child $StageRoot
if (Test-Path -LiteralPath $StageRoot) {
  Stop-StagedBackendRuntime -Path $StageRoot
  Stop-ProcessesUsingPath -Path $StageRoot
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
if (Test-Path -LiteralPath $ShaPath) {
  Remove-Item -LiteralPath $ShaPath -Force
}

New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null
Copy-File -Source $DesktopExe -Destination (Join-Path $StageRoot "Project Graph.exe")
Copy-Directory -Source $PortableStage -Destination (Join-Path $StageRoot "backend-runtime")

Set-Content -LiteralPath (Join-Path $StageRoot "start-desktop.cmd") -Encoding ASCII -Value '@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0Project Graph.exe"'

Set-Content -LiteralPath (Join-Path $StageRoot "README-DESKTOP-PORTABLE.md") -Encoding UTF8 -Value @'
# Project Graph Desktop Portable Preview

Run `Project Graph.exe` or `start-desktop.cmd` from this directory.

The bundled backend runtime lives in `backend-runtime`. Desktop backend data is stored in the normal app data directory, not in this portable folder:

```text
%APPDATA%\liren.project-graph\backend-data
```

To update this preview, close Project Graph, replace this folder with a freshly packaged one, and start the executable again. Replacing this folder does not delete backend project data.

CLI/Web helpers remain available under `backend-runtime`, for example:

```powershell
.\backend-runtime\project-graph.cmd target list --json
.\backend-runtime\status-web.cmd
```
'@

Compress-Archive -LiteralPath $StageRoot -DestinationPath $ZipPath -Force
$Hash = Get-Sha256 -Path $ZipPath
Set-Content -LiteralPath $ShaPath -Encoding ASCII -Value "$Hash  $(Split-Path -Leaf $ZipPath)"

Write-Host "Desktop portable directory: $StageRoot"
Write-Host "Desktop portable package:   $ZipPath"
Write-Host "SHA256:                     $Hash"
