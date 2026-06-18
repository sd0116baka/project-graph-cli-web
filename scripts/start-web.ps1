param(
  [int]$Port = 37820,
  [switch]$SkipBuild,
  [switch]$NoAuth,
  [string]$AuthUser = "pg",
  [string]$AuthPassword = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $Root

function Test-PortBusy([int]$Value) {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $Value -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

function Get-FreePort([int]$Start) {
  for ($Value = $Start; $Value -lt ($Start + 100); $Value++) {
    if (-not (Test-PortBusy $Value)) {
      return $Value
    }
  }
  throw "No free port found from $Start"
}

function Get-LanIp {
  $PhysicalAdapters = Get-NetAdapter |
    Where-Object { $_.Status -eq "Up" -and $_.HardwareInterface -eq $true } |
    Select-Object -ExpandProperty Name

  $Primary = Get-NetIPConfiguration |
    Where-Object {
      $_.IPv4DefaultGateway -and
      $_.IPv4Address -and
      $_.InterfaceAlias -in $PhysicalAdapters
    } |
    ForEach-Object {
      $_.IPv4Address |
        Where-Object { $_.IPAddress -notmatch "^(127|169\.254)\." } |
        Select-Object -First 1
    } |
    Select-Object -First 1

  if ($Primary) {
    return $Primary.IPAddress
  }

  $Fallback = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq "Up" } |
    ForEach-Object {
      $_.IPv4Address |
        Where-Object { $_.IPAddress -notmatch "^(127|169\.254)\." } |
        Select-Object -First 1
    } |
    Select-Object -First 1

  if ($Fallback) {
    return $Fallback.IPAddress
  }

  $Any = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch "^(127|169\.254)\." } |
    Select-Object -First 1

  if ($Any) {
    return $Any.IPAddress
  }

  return "127.0.0.1"
}

function New-RandomPassword {
  $Chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $Bytes = [byte[]]::new(16)
  $Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $Rng.GetBytes($Bytes)
  } finally {
    $Rng.Dispose()
  }
  return -join ($Bytes | ForEach-Object { $Chars[$_ % $Chars.Length] })
}

if (-not $SkipBuild) {
  pnpm run web:build
}

$DistDir = (Resolve-Path (Join-Path $Root "app\dist")).Path
$IndexHtml = Join-Path $DistDir "index.html"
if (-not (Test-Path $IndexHtml)) {
  throw "Missing app/dist/index.html. Run pnpm run web:build first."
}

$DataDir = Join-Path $Root "server\data"
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
$AuthPath = Join-Path $DataDir "auth.json"

if (-not $NoAuth) {
  if (-not $AuthPassword -and (Test-Path $AuthPath)) {
    $AuthConfig = Get-Content -Raw $AuthPath | ConvertFrom-Json
    $AuthUser = if ($AuthConfig.user) { [string]$AuthConfig.user } else { $AuthUser }
    $AuthPassword = if ($AuthConfig.password) { [string]$AuthConfig.password } else { "" }
  }

  if (-not $AuthPassword) {
    $AuthPassword = New-RandomPassword
    @{
      user = $AuthUser
      password = $AuthPassword
      createdAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $AuthPath -Encoding UTF8
  }
}

$SelectedPort = Get-FreePort $Port
$LanIp = Get-LanIp

$env:PG_WEB_HOST = "0.0.0.0"
$env:PG_WEB_PORT = [string]$SelectedPort
$env:PG_WEB_DATA_DIR = $DataDir
$env:PG_WEB_STATIC_DIR = $DistDir
$env:PG_WEB_ALLOWED_ORIGIN = "*"
if (-not $NoAuth) {
  $env:PG_WEB_AUTH_USER = $AuthUser
  $env:PG_WEB_AUTH_PASSWORD = $AuthPassword
} else {
  Remove-Item Env:\PG_WEB_AUTH_USER -ErrorAction SilentlyContinue
  Remove-Item Env:\PG_WEB_AUTH_PASSWORD -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Project Graph Web is starting..."
Write-Host "Local:  http://127.0.0.1:$SelectedPort"
Write-Host "LAN:    http://$LanIp`:$SelectedPort"
Write-Host "Data:   $DataDir"
if (-not $NoAuth) {
  Write-Host "User:   $AuthUser"
  Write-Host "Pass:   $AuthPassword"
} else {
  Write-Host "Auth:   disabled"
}
Write-Host ""
Write-Host "Keep this window open. Press Ctrl+C to stop."
Write-Host ""

node server/src/server.js
