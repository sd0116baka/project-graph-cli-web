param(
  [int]$Port = 37820,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $ScriptDir "stop-web.ps1") | Out-Host

$ArgsList = @("-File", (Join-Path $ScriptDir "start-web.ps1"), "-Port", [string]$Port)
if ($SkipBuild) {
  $ArgsList += "-SkipBuild"
}

& powershell -NoProfile -ExecutionPolicy Bypass @ArgsList
