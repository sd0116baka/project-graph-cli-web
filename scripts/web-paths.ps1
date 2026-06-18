function Resolve-WebDataDir {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [string]$DataDir = ""
  )

  if (-not [string]::IsNullOrWhiteSpace($DataDir)) {
    if ([IO.Path]::IsPathRooted($DataDir)) {
      return [IO.Path]::GetFullPath($DataDir)
    }
    return [IO.Path]::GetFullPath((Join-Path $Root $DataDir))
  }

  $Runtime = Read-WebRuntime -Root $Root
  if ($Runtime -and $Runtime.dataDir) {
    return [IO.Path]::GetFullPath([string]$Runtime.dataDir)
  }

  return [IO.Path]::GetFullPath((Join-Path $Root "server\data"))
}

function Read-WebRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  $RuntimePath = Get-WebRuntimePath -Root $Root
  if (-not (Test-Path $RuntimePath)) {
    return $null
  }

  try {
    return Get-Content -Raw $RuntimePath | ConvertFrom-Json
  } catch {
    Write-Warning "Ignoring unreadable Web runtime metadata at $RuntimePath. $($_.Exception.Message)"
    return $null
  }
}

function Test-SameWebPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Left,
    [Parameter(Mandatory = $true)]
    [string]$Right
  )

  try {
    $LeftFull = [IO.Path]::GetFullPath($Left).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $RightFull = [IO.Path]::GetFullPath($Right).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    return $LeftFull.Equals($RightFull, [StringComparison]::OrdinalIgnoreCase)
  } catch {
    Write-Warning "Could not compare paths '$Left' and '$Right'. $($_.Exception.Message)"
    return $false
  }
}

function Get-WebRuntimePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )
  return Join-Path $Root "server\web-runtime.json"
}

function Get-WebBackendRegistryPath {
  if (-not [string]::IsNullOrWhiteSpace($env:PROJECT_GRAPH_BACKEND_REGISTRY)) {
    return [IO.Path]::GetFullPath($env:PROJECT_GRAPH_BACKEND_REGISTRY)
  }
  return Join-Path ([IO.Path]::GetTempPath()) "project-graph-backends.json"
}

function Read-WebBackendRegistry {
  $RegistryPath = Get-WebBackendRegistryPath
  if (-not (Test-Path $RegistryPath)) {
    return @()
  }

  try {
    $Registry = Get-Content -Raw $RegistryPath | ConvertFrom-Json
  } catch {
    Write-Warning "Ignoring unreadable backend registry at $RegistryPath. $($_.Exception.Message)"
    return @()
  }
  if ($Registry -and ($Registry.PSObject.Properties.Name -contains "targets")) {
    return @($Registry.targets)
  }
  return @($Registry)
}

function Write-WebBackendRegistryTarget {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [Parameter(Mandatory = $true)]
    [string]$DataDir,
    [Parameter(Mandatory = $true)]
    [bool]$AuthEnabled,
    [Parameter(Mandatory = $true)]
    [string]$AuthUser,
    [Parameter(Mandatory = $true)]
    [string]$LanIp
  )

  $RegistryPath = Get-WebBackendRegistryPath
  New-Item -ItemType Directory -Path (Split-Path -Parent $RegistryPath) -Force | Out-Null
  $Existing = @(Read-WebBackendRegistry | Where-Object { [int]$_.port -ne $Port })
  $Target = [ordered]@{
    id = "local-$Port"
    kind = "daemon"
    url = "http://127.0.0.1:$Port"
    localUrl = "http://127.0.0.1:$Port"
    lanUrl = "http://$LanIp`:$Port"
    port = $Port
    apiVersion = "0.1"
    authMode = if ($AuthEnabled) { "basic" } else { "none" }
    authUser = if ($AuthEnabled) { $AuthUser } else { "" }
    lanMode = $true
    dataDirName = Split-Path -Leaf $DataDir
    localDataDir = $DataDir
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    capabilities = [ordered]@{
      projects = $true
      blobs = $true
      query = $true
      patch = $true
      export = $true
      validate = $false
      import = $false
      history = $true
      restore = $true
      locks = $true
      events = $false
    }
  }
  @{ targets = @($Existing + $Target) } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $RegistryPath -Encoding UTF8
}

function Remove-WebBackendRegistryTarget {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $RegistryPath = Get-WebBackendRegistryPath
  if (-not (Test-Path $RegistryPath)) {
    return
  }
  $Remaining = @(Read-WebBackendRegistry | Where-Object { [int]$_.port -ne $Port })
  if ($Remaining.Count -eq 0) {
    Remove-Item -LiteralPath $RegistryPath -Force
    return
  }
  @{ targets = $Remaining } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $RegistryPath -Encoding UTF8
}

function Write-WebRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$DataDir,
    [Parameter(Mandatory = $true)]
    [string]$StaticDir,
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [Parameter(Mandatory = $true)]
    [bool]$AuthEnabled,
    [string]$AuthUser = "",
    [string]$LanIp = "127.0.0.1"
  )

  $RuntimePath = Get-WebRuntimePath -Root $Root
  New-Item -ItemType Directory -Path (Split-Path -Parent $RuntimePath) -Force | Out-Null
  @{
    port = $Port
    dataDir = $DataDir
    staticDir = $StaticDir
    authEnabled = $AuthEnabled
    authUser = $AuthUser
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $RuntimePath -Encoding UTF8

  Write-WebBackendRegistryTarget -Port $Port -DataDir $DataDir -AuthEnabled $AuthEnabled -AuthUser $AuthUser -LanIp $LanIp
}

function Assert-SafeWebDataDir {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$DataDir
  )

  $FullDataDir = [IO.Path]::GetFullPath($DataDir).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $FullRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $DriveRoot = [IO.Path]::GetPathRoot($FullDataDir).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)

  if ([string]::IsNullOrWhiteSpace($FullDataDir) -or $FullDataDir -eq $DriveRoot) {
    throw "Refusing to use a drive root as the data directory: $DataDir"
  }

  if ($FullDataDir.Equals($FullRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use the repository root as the data directory: $DataDir"
  }
}
