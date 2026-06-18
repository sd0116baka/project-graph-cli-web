param(
  [int]$PortStart = 37820,
  [int]$PortEnd = 37920,
  [string]$DataDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$DataDir = Resolve-WebDataDir -Root $Root -DataDir $DataDir
$AuthPath = Join-Path $DataDir "auth.json"

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

function Test-ProjectGraphHealth([int]$Port) {
  try {
    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -Method Get -TimeoutSec 2
    return [bool]$Health.ok
  } catch {
    return $false
  }
}

$Ports = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -ge $PortStart -and $_.LocalPort -le $PortEnd } |
  Sort-Object LocalPort

$Running = foreach ($Connection in $Ports) {
  if (-not (Test-ProjectGraphHealth $Connection.LocalPort)) {
    continue
  }

  $Process = Get-CimInstance Win32_Process -Filter "ProcessId = $($Connection.OwningProcess)" -ErrorAction SilentlyContinue
  $AuthConfig = if (Test-Path $AuthPath) {
    Get-Content -Raw $AuthPath | ConvertFrom-Json
  } else {
    $null
  }
  [pscustomobject]@{
    Pid = $Connection.OwningProcess
    Port = $Connection.LocalPort
    LocalUrl = "http://127.0.0.1:$($Connection.LocalPort)"
    LanUrl = "http://$(Get-LanIp):$($Connection.LocalPort)"
    DataDir = $DataDir
    AuthUser = if ($AuthConfig) { $AuthConfig.user } else { "" }
    AuthPassword = if ($AuthConfig) { $AuthConfig.password } else { "" }
    CommandLine = $Process.CommandLine
  }
}

if (-not $Running) {
  Write-Host "Project Graph Web is not running in port range $PortStart-$PortEnd."
  exit 1
}

$Running | Format-List
