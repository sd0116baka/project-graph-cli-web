param(
  [string]$Url = "",
  [string]$User = "",
  [string]$Password = "",
  [string]$DataDir = "",
  [switch]$Lan,
  [switch]$NoAuth,
  [switch]$Persist,
  [ValidateSet("User", "Machine")]
  [string]$PersistScope = "User",
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path

function Read-AuthConfig([string]$AuthPath) {
  if (-not (Test-Path $AuthPath)) {
    return $null
  }
  return Get-Content -Raw $AuthPath | ConvertFrom-Json
}

function Resolve-ServerUrl {
  param(
    [string]$ExplicitUrl,
    [bool]$UseLan
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitUrl)) {
    return $ExplicitUrl.TrimEnd("/")
  }

  $Runtime = Read-WebRuntime -Root $Root
  if ($Runtime -and ($Runtime.PSObject.Properties.Name -contains "port")) {
    $Port = [int]$Runtime.port
    if ($UseLan) {
      $Target = Read-WebBackendRegistry |
        Where-Object { ($_.lanUrl) -and ([int]$_.port -eq $Port) } |
        Select-Object -First 1
      if ($Target) {
        return ([string]$Target.lanUrl).TrimEnd("/")
      }
    }
    return "http://127.0.0.1:$Port"
  }

  $Target = Read-WebBackendRegistry |
    Where-Object { if ($UseLan) { $_.lanUrl } else { $_.url -or $_.localUrl } } |
    Select-Object -First 1
  if ($Target) {
    $TargetUrl = if ($UseLan) {
      [string]$Target.lanUrl
    } elseif ($Target.url) {
      [string]$Target.url
    } else {
      [string]$Target.localUrl
    }
    return $TargetUrl.TrimEnd("/")
  }

  return "http://127.0.0.1:37820"
}

function Set-ProjectGraphEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [AllowNull()]
    [string]$Value
  )

  $ResolvedValue = if ($null -eq $Value) { "" } else { $Value }
  Set-Item -LiteralPath "Env:$Name" -Value $ResolvedValue
  if ($Persist) {
    [Environment]::SetEnvironmentVariable($Name, $ResolvedValue, $PersistScope)
  }
}

$ResolvedDataDir = Resolve-WebDataDir -Root $Root -DataDir $DataDir
$AuthPath = Join-Path $ResolvedDataDir "auth.json"
$AuthConfig = Read-AuthConfig -AuthPath $AuthPath
$ResolvedUrl = Resolve-ServerUrl -ExplicitUrl $Url -UseLan ([bool]$Lan)
$ResolvedUser = if (-not [string]::IsNullOrWhiteSpace($User)) {
  $User
} elseif ($AuthConfig -and $AuthConfig.user) {
  [string]$AuthConfig.user
} else {
  "pg"
}
$ResolvedPassword = if (-not [string]::IsNullOrWhiteSpace($Password)) {
  $Password
} elseif ($AuthConfig -and $AuthConfig.password) {
  [string]$AuthConfig.password
} else {
  ""
}

Set-ProjectGraphEnvValue -Name "PROJECT_GRAPH_SERVER_URL" -Value $ResolvedUrl

if ($NoAuth) {
  Remove-Item Env:\PROJECT_GRAPH_SERVER_USER -ErrorAction SilentlyContinue
  Remove-Item Env:\PROJECT_GRAPH_SERVER_PASSWORD -ErrorAction SilentlyContinue
  if ($Persist) {
    [Environment]::SetEnvironmentVariable("PROJECT_GRAPH_SERVER_USER", $null, $PersistScope)
    [Environment]::SetEnvironmentVariable("PROJECT_GRAPH_SERVER_PASSWORD", $null, $PersistScope)
  }
} else {
  if ([string]::IsNullOrWhiteSpace($ResolvedPassword)) {
    throw "No backend password was provided and no auth.json was found at $AuthPath. Pass -Password, start an authenticated backend first, or use -NoAuth."
  }
  Set-ProjectGraphEnvValue -Name "PROJECT_GRAPH_SERVER_USER" -Value $ResolvedUser
  Set-ProjectGraphEnvValue -Name "PROJECT_GRAPH_SERVER_PASSWORD" -Value $ResolvedPassword
}

if (-not $Quiet) {
  Write-Host "PROJECT_GRAPH_SERVER_URL=$ResolvedUrl"
  if ($NoAuth) {
    Write-Host "Auth: disabled"
  } else {
    Write-Host "PROJECT_GRAPH_SERVER_USER=$ResolvedUser"
    Write-Host "PROJECT_GRAPH_SERVER_PASSWORD=<set>"
  }
  if ($Persist) {
    Write-Host "Persisted to $PersistScope environment variables. Open a new terminal for persisted values to appear automatically."
  } else {
    Write-Host "Set for this PowerShell process. Dot-source this script to set the variables in your current shell."
  }
}
