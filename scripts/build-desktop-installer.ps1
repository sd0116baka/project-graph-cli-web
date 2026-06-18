param(
  [switch]$SkipPortableBuild,
  [switch]$WithDefaultFeatures
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$AppDir = Join-Path $Root "app"
$PortableStage = Join-Path $Root "dist\portable\project-graph-cli-web"
$InstallerConfig = Join-Path $Root "app\src-tauri\tauri.cli-web.conf.json"

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

Set-Location $Root

if ($SkipPortableBuild) {
  & (Join-Path $ScriptDir "package-portable.ps1") -SkipBuild
} else {
  & (Join-Path $ScriptDir "package-portable.ps1")
}

if (-not (Test-Path -LiteralPath (Join-Path $PortableStage "scripts\start-web.ps1"))) {
  throw "Portable backend runtime was not staged at $PortableStage."
}
if (-not (Test-Path -LiteralPath $InstallerConfig)) {
  throw "Missing Tauri CLI/Web installer config: $InstallerConfig"
}

Push-Location $AppDir
try {
  $BuildArgs = @(
    "exec",
    "tauri",
    "build",
    "--config",
    "src-tauri\tauri.cli-web.conf.json",
    "--bundles",
    "nsis",
    "--no-sign"
  )
  if (-not $WithDefaultFeatures) {
    $BuildArgs += @("--", "--no-default-features")
  }
  Invoke-NativeCommand -FilePath "pnpm" -Arguments $BuildArgs
} finally {
  Pop-Location
}
