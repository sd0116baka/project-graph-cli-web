param(
  [string]$OutputDir = "dist\portable",
  [string]$Version = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $Root

if (-not $SkipBuild) {
  pnpm nx build @graphif/project-graph-core
  pnpm nx build @graphif/project-graph-cli
  pnpm run web:build
}

if (-not $Version) {
  $Package = Get-Content -Raw (Join-Path $Root "package.json") | ConvertFrom-Json
  $Version = [string]$Package.version
}

$OutputDir = [IO.Path]::GetFullPath((Join-Path $Root $OutputDir))
$StageRoot = Join-Path $OutputDir "project-graph-cli-web"
$ZipPath = Join-Path $OutputDir "project-graph-cli-web-$Version-windows-preview.zip"

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

function Resolve-SymlinkTarget {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathText
  )
  if ([string]::IsNullOrWhiteSpace($PathText)) {
    throw "Cannot resolve an empty package path."
  }
  $Item = Get-Item -LiteralPath $PathText
  if ($Item.LinkType -and $Item.Target) {
    $Target = @($Item.Target)[0]
    return [IO.Path]::GetFullPath((Join-Path $Item.Parent.FullName $Target))
  }
  return $Item.FullName
}

function Copy-WorkspacePackage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PackageDir,
    [Parameter(Mandatory = $true)]
    [string]$Destination
  )
  Copy-File -Source (Join-Path $PackageDir "package.json") -Destination (Join-Path $Destination "package.json")
  Copy-Directory -Source (Join-Path $PackageDir "dist") -Destination (Join-Path $Destination "dist")
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
Assert-PathInside -Parent $OutputDir -Child $StageRoot
if (Test-Path -LiteralPath $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null

Copy-Directory -Source (Join-Path $Root "app\dist") -Destination (Join-Path $StageRoot "app\dist")
Copy-Directory -Source (Join-Path $Root "server\src") -Destination (Join-Path $StageRoot "server\src")
Copy-File -Source (Join-Path $Root "server\package.json") -Destination (Join-Path $StageRoot "server\package.json")
Copy-Directory -Source (Join-Path $Root "scripts") -Destination (Join-Path $StageRoot "scripts")

Copy-WorkspacePackage -PackageDir (Join-Path $Root "packages\project-graph-cli") -Destination (Join-Path $StageRoot "packages\project-graph-cli")
Copy-WorkspacePackage -PackageDir (Join-Path $Root "packages\project-graph-core") -Destination (Join-Path $StageRoot "node_modules\@graphif\project-graph-core")
Copy-WorkspacePackage -PackageDir (Join-Path $Root "packages\prg-codec") -Destination (Join-Path $StageRoot "node_modules\@graphif\prg-codec")

$MsgpackPath = Join-Path $Root "packages\prg-codec\node_modules\@msgpack\msgpack"
$ZipJsPath = Join-Path $Root "packages\prg-codec\node_modules\@zip.js\zip.js"
if ([string]::IsNullOrWhiteSpace($MsgpackPath) -or [string]::IsNullOrWhiteSpace($ZipJsPath)) {
  throw "Failed to resolve codec dependency paths."
}
$MsgpackSource = Resolve-SymlinkTarget -PathText $MsgpackPath
$ZipJsSource = Resolve-SymlinkTarget -PathText $ZipJsPath
Copy-Directory -Source $MsgpackSource -Destination (Join-Path $StageRoot "node_modules\@msgpack\msgpack")
Copy-Directory -Source $ZipJsSource -Destination (Join-Path $StageRoot "node_modules\@zip.js\zip.js")

foreach ($Doc in @("README.md", "README-cli.md", "README-web.md", "LICENSE")) {
  $Source = Join-Path $Root $Doc
  if (Test-Path -LiteralPath $Source) {
    Copy-File -Source $Source -Destination (Join-Path $StageRoot $Doc)
  }
}
Copy-Directory -Source (Join-Path $Root "docs") -Destination (Join-Path $StageRoot "docs")

Set-Content -LiteralPath (Join-Path $StageRoot "project-graph.cmd") -Encoding ASCII -Value '@echo off
setlocal
node "%~dp0packages\project-graph-cli\dist\index.mjs" %*'

Set-Content -LiteralPath (Join-Path $StageRoot "start-web.cmd") -Encoding ASCII -Value '@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-web.ps1" -SkipBuild %*'

foreach ($Name in @("stop-web", "status-web", "smoke-web", "smoke-lan-auth", "smoke-upgrade-rollback", "backup-data", "restore-data", "open-firewall", "install-startup", "uninstall-startup")) {
  $ScriptName = "$Name.ps1"
  Set-Content -LiteralPath (Join-Path $StageRoot "$Name.cmd") -Encoding ASCII -Value "@echo off
setlocal
cd /d ""%~dp0""
powershell -NoProfile -ExecutionPolicy Bypass -File ""%~dp0scripts\$ScriptName"" %*"
}

Set-Content -LiteralPath (Join-Path $StageRoot "README-PORTABLE.md") -Encoding UTF8 -Value @"
# Project Graph CLI + Web Portable Preview

Requirements:

- Windows
- Node.js 26 or newer on PATH

Quick start:

```powershell
.\start-web.cmd
.\project-graph.cmd target list --json
.\smoke-web.cmd
```

Release smokes:

```powershell
.\smoke-lan-auth.cmd
.\smoke-upgrade-rollback.cmd
```

The Web backend stores data in `server\data` by default. Use `-DataDir <path>` with `start-web.cmd`, `smoke-web.cmd`, backup, and restore scripts to keep data somewhere else.

This preview package contains the CLI, Web backend, built Web frontend, backend scripts, smoke tests, and backend-first documentation. It is not a final desktop installer; the desktop sidecar packaging decision is tracked in the roadmap.
"@

Compress-Archive -LiteralPath $StageRoot -DestinationPath $ZipPath -Force
Write-Host "Portable package: $ZipPath"
