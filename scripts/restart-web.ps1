param(
  [int]$Port = 37820,
  [switch]$SkipBuild,
  [switch]$NoAuth,
  [string]$AuthUser = "",
  [string]$AuthPassword = "",
  [string]$DataDir = "",
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $ScriptDir "stop-web.ps1") | Out-Host

$ArgsList = @("-File", (Join-Path $ScriptDir "start-web.ps1"), "-Port", [string]$Port)
if ($SkipBuild) {
  $ArgsList += "-SkipBuild"
}
if ($NoAuth) {
  $ArgsList += "-NoAuth"
}
if ($AuthUser) {
  $ArgsList += @("-AuthUser", $AuthUser)
}
if ($AuthPassword) {
  $ArgsList += @("-AuthPassword", $AuthPassword)
}
if ($DataDir) {
  $ArgsList += @("-DataDir", $DataDir)
}
if ($LogPath) {
  $ArgsList += @("-LogPath", $LogPath)
}

& powershell -NoProfile -ExecutionPolicy Bypass @ArgsList
