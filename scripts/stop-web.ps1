param(
  [int]$PortStart = 37820,
  [int]$PortEnd = 37920
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")

function Test-ProjectGraphHealth([int]$Port) {
  try {
    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -Method Get -TimeoutSec 2
    return [bool]$Health.ok
  } catch {
    return $false
  }
}

$Targets = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -ge $PortStart -and $_.LocalPort -le $PortEnd } |
  Where-Object { Test-ProjectGraphHealth $_.LocalPort } |
  Select-Object -Property OwningProcess, LocalPort -Unique

if (-not $Targets) {
  Write-Host "Project Graph Web is not running in port range $PortStart-$PortEnd."
  exit 0
}

foreach ($Target in $Targets) {
  Write-Host "Stopping Project Graph Web PID $($Target.OwningProcess) on port $($Target.LocalPort)..."
  Stop-Process -Id $Target.OwningProcess -Force -ErrorAction Stop
  Remove-WebBackendRegistryTarget -Port $Target.LocalPort
}

Write-Host "Stopped."
