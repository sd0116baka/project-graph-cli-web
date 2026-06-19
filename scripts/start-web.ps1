param(
  [int]$Port = 37820,
  [switch]$SkipBuild,
  [switch]$NoAuth,
  [string]$AuthUser = "pg",
  [string]$AuthPassword = "",
  [string]$DataDir = "",
  [string]$LogPath = "",
  [switch]$LocalOnly
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $Root

if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
  $LogPath = [IO.Path]::GetFullPath($LogPath)
  New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value ""
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$((Get-Date).ToUniversalTime().ToString("o"))] Project Graph Web startup"
}

function Write-WebLine([string]$Message = "") {
  Write-Host $Message
  if ($LogPath) {
    Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value $Message
  }
}

function Test-PortBusy([int]$Value) {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $Value -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

function Test-ProjectGraphHealth([int]$Value) {
  try {
    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Value/api/health" -Method Get -TimeoutSec 2
    return [bool]$Health.ok
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

try {

if (-not $SkipBuild) {
  pnpm run web:build
}

$DistDir = (Resolve-Path (Join-Path $Root "app\dist")).Path
$IndexHtml = Join-Path $DistDir "index.html"
if (-not (Test-Path $IndexHtml)) {
  throw "Missing app/dist/index.html. Run pnpm run web:build first."
}

$DataDir = Resolve-WebDataDir -Root $Root -DataDir $DataDir
Assert-SafeWebDataDir -Root $Root -DataDir $DataDir
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
$AuthPath = Join-Path $DataDir "auth.json"

if (-not $NoAuth) {
  $ShouldWriteAuthConfig = $false
  if (-not $AuthPassword -and (Test-Path $AuthPath)) {
    $AuthConfig = Get-Content -Raw $AuthPath | ConvertFrom-Json
    $AuthUser = if ($AuthConfig.user) { [string]$AuthConfig.user } else { $AuthUser }
    $AuthPassword = if ($AuthConfig.password) { [string]$AuthConfig.password } else { "" }
  }

  if (-not $AuthPassword) {
    $AuthPassword = New-RandomPassword
    $ShouldWriteAuthConfig = $true
  } elseif ($PSBoundParameters.ContainsKey("AuthPassword")) {
    $ShouldWriteAuthConfig = $true
  }

  if ($ShouldWriteAuthConfig) {
    @{
      user = $AuthUser
      password = $AuthPassword
      createdAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $AuthPath -Encoding UTF8
  }
}

$Runtime = Read-WebRuntime -Root $Root
if ($Runtime -and ($Runtime.PSObject.Properties.Name -contains "port") -and $Runtime.dataDir) {
  $RuntimePort = [int]$Runtime.port
  $RuntimeLanMode = if ($Runtime.PSObject.Properties.Name -contains "lanMode") { [bool]$Runtime.lanMode } else { $true }
  $RequestedLanMode = -not $LocalOnly
  if ((Test-SameWebPath -Left ([string]$Runtime.dataDir) -Right $DataDir) -and ($RuntimeLanMode -eq $RequestedLanMode) -and (Test-ProjectGraphHealth $RuntimePort)) {
    $LanIp = if ($LocalOnly) { "127.0.0.1" } else { Get-LanIp }
    $ExistingAuthEnabled = if ($Runtime.PSObject.Properties.Name -contains "authEnabled") { [bool]$Runtime.authEnabled } else { -not $NoAuth }
    $ExistingAuthUser = if (($Runtime.PSObject.Properties.Name -contains "authUser") -and $Runtime.authUser) { [string]$Runtime.authUser } else { $AuthUser }
    $ExistingAuthPassword = $AuthPassword
    if ($ExistingAuthEnabled -and (Test-Path $AuthPath)) {
      $ExistingAuthConfig = Get-Content -Raw $AuthPath | ConvertFrom-Json
      $ExistingAuthUser = if ($ExistingAuthConfig.user) { [string]$ExistingAuthConfig.user } else { $ExistingAuthUser }
      $ExistingAuthPassword = if ($ExistingAuthConfig.password) { [string]$ExistingAuthConfig.password } else { $ExistingAuthPassword }
    }
    Write-WebBackendRegistryTarget -Port $RuntimePort -DataDir $DataDir -AuthEnabled $ExistingAuthEnabled -AuthUser $ExistingAuthUser -LanIp $LanIp -LanMode (-not $LocalOnly)
    Write-WebLine ""
    Write-WebLine "Project Graph Web is already running."
    Write-WebLine "Local:  http://127.0.0.1:$RuntimePort"
    if ($LocalOnly) {
      Write-WebLine "LAN:    disabled"
    } else {
      Write-WebLine "LAN:    http://$LanIp`:$RuntimePort"
    }
    Write-WebLine "Data:   $DataDir"
    if ($ExistingAuthEnabled) {
      Write-WebLine "User:   $ExistingAuthUser"
      if ($LogPath) {
        Write-WebLine "Pass:   saved in $AuthPath"
      } else {
        Write-WebLine "Pass:   $ExistingAuthPassword"
      }
    } else {
      Write-WebLine "Auth:   disabled"
    }
    return
  }
}

$SelectedPort = Get-FreePort $Port
$LanIp = if ($LocalOnly) { "127.0.0.1" } else { Get-LanIp }
$BindHost = if ($LocalOnly) { "127.0.0.1" } else { "0.0.0.0" }

$env:PG_WEB_HOST = $BindHost
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

Write-WebLine ""
Write-WebLine "Project Graph Web is starting..."
Write-WebLine "Local:  http://127.0.0.1:$SelectedPort"
if ($LocalOnly) {
  Write-WebLine "LAN:    disabled"
} else {
  Write-WebLine "LAN:    http://$LanIp`:$SelectedPort"
}
Write-WebLine "Data:   $DataDir"
if (-not $NoAuth) {
  Write-WebLine "User:   $AuthUser"
  if ($LogPath) {
    if (Test-Path $AuthPath) {
      Write-WebLine "Pass:   saved in $AuthPath"
    } else {
      Write-WebLine "Pass:   configured by startup arguments; not logged"
    }
  } else {
    Write-WebLine "Pass:   $AuthPassword"
  }
} else {
  Write-WebLine "Auth:   disabled"
}
Write-WebLine ""
Write-WebLine "Keep this window open. Press Ctrl+C to stop."
if ($LogPath) {
  Write-WebLine "Log:    $LogPath"
}
Write-WebLine ""

Write-WebRuntime -Root $Root -DataDir $DataDir -StaticDir $DistDir -Port $SelectedPort -AuthEnabled (-not $NoAuth) -AuthUser $AuthUser -LanIp $LanIp -LanMode (-not $LocalOnly)

if ($LogPath) {
  & node server/src/server.js 2>&1 | Tee-Object -FilePath $LogPath -Append
} else {
  node server/src/server.js
}
if ($LASTEXITCODE -ne 0) {
  throw "Web server exited with code $LASTEXITCODE"
}
} catch {
  if ($LogPath) {
    Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "ERROR: $($_.Exception.Message)"
  }
  throw
}
