param(
  [int]$Port = 37930,
  [string]$DataDir = "",
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path

if (-not $DataDir) {
  $DataDir = Join-Path $env:TEMP "project-graph-lan-auth-smoke-$([guid]::NewGuid().ToString('N'))"
}
$DataDir = [IO.Path]::GetFullPath($DataDir)
if (-not $LogPath) {
  $LogPath = Join-Path $DataDir "logs\lan-auth-smoke.log"
}
$LogPath = [IO.Path]::GetFullPath($LogPath)

function Wait-ProjectGraphHealth([int]$Value, [Diagnostics.Process]$Process, [string]$LogFile) {
  $Deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $Deadline) {
    if ($Process.HasExited) {
      $LogText = if (Test-Path -LiteralPath $LogFile) { Get-Content -Raw -LiteralPath $LogFile } else { "" }
      throw "Project Graph Web exited before LAN auth smoke health check. ExitCode=$($Process.ExitCode)`n$LogText"
    }
    try {
      $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Value/api/health" -TimeoutSec 2
      if ($Health.ok) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "Project Graph Web did not become healthy on port $Value."
}

function Get-SmokeAuthHeaders([string]$AuthPath) {
  $Auth = Get-Content -Raw -LiteralPath $AuthPath | ConvertFrom-Json
  if (-not $Auth.user -or -not $Auth.password) {
    throw "LAN auth smoke found incomplete credentials at $AuthPath."
  }
  $Token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($Auth.user):$($Auth.password)"))
  return @{ Authorization = "Basic $Token" }
}

function Join-ProcessArguments([string[]]$Values) {
  return ($Values | ForEach-Object {
    $Value = [string]$_
    if ($Value -match '[\s"]') {
      '"' + $Value.Replace('"', '\"') + '"'
    } else {
      $Value
    }
  }) -join " "
}

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
$StartScript = Join-Path $ScriptDir "start-web.ps1"
$ServerProcess = $null

try {
  $Arguments = Join-ProcessArguments @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $StartScript,
    "-SkipBuild",
    "-Port",
    [string]$Port,
    "-DataDir",
    $DataDir,
    "-LogPath",
    $LogPath
  )

  $ServerProcess = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList $Arguments `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru

  Wait-ProjectGraphHealth -Value $Port -Process $ServerProcess -LogFile $LogPath

  $AuthPath = Join-Path $DataDir "auth.json"
  if (-not (Test-Path -LiteralPath $AuthPath)) {
    throw "LAN auth smoke expected generated credentials at $AuthPath."
  }

  $AuthHeaders = Get-SmokeAuthHeaders -AuthPath $AuthPath
  $ServerInfo = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/server-info" -Headers $AuthHeaders -TimeoutSec 5
  if ($ServerInfo.authMode -ne "basic" -or -not $ServerInfo.authEnabled) {
    throw "LAN auth smoke expected Basic auth to be enabled."
  }
  if (-not $ServerInfo.lanMode) {
    throw "LAN auth smoke expected lanMode=true."
  }

  $RegistryTarget = Read-WebBackendRegistry |
    Where-Object { [int]$_.port -eq $Port } |
    Select-Object -First 1
  if (-not $RegistryTarget) {
    throw "LAN auth smoke expected backend registry target for port $Port."
  }
  if (-not $RegistryTarget.lanMode -or $RegistryTarget.authMode -ne "basic" -or -not $RegistryTarget.lanUrl) {
    throw "LAN auth smoke expected registry target to advertise LAN mode, Basic auth, and LAN URL."
  }

  $LanBase = ([string]$RegistryTarget.lanUrl).TrimEnd("/")
  $LanServerInfo = Invoke-RestMethod -Uri "$LanBase/api/server-info" -Headers $AuthHeaders -TimeoutSec 5
  if ($LanServerInfo.authMode -ne "basic" -or -not $LanServerInfo.lanMode) {
    throw "LAN auth smoke expected the LAN URL to reach a LAN-mode authenticated backend."
  }
  $LanProjects = Invoke-RestMethod -Uri "$LanBase/api/projects" -Headers $AuthHeaders -TimeoutSec 5
  if ($null -eq $LanProjects.projects) {
    throw "LAN auth smoke could not list projects through the LAN URL."
  }

  & (Join-Path $ScriptDir "smoke-web.ps1") -Port $Port -DataDir $DataDir
  if ($LASTEXITCODE -ne 0) {
    throw "Authenticated Web smoke failed with exit code $LASTEXITCODE."
  }

  Write-Host "LAN auth smoke passed: http://127.0.0.1:$Port"
  Write-Host "LAN URL: $($RegistryTarget.lanUrl)"
  Write-Host "Data: $DataDir"
} finally {
  & (Join-Path $ScriptDir "stop-web.ps1") -PortStart $Port -PortEnd $Port | Out-Host
  if ($ServerProcess -and -not $ServerProcess.HasExited) {
    Wait-Process -Id $ServerProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
    if (-not $ServerProcess.HasExited) {
      Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
