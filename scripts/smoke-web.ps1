param(
  [int]$Port = 37820
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$AuthPath = Join-Path $Root "server\data\auth.json"
$Base = "http://127.0.0.1:$Port"

function Get-AuthHeaders {
  if (-not (Test-Path $AuthPath)) {
    return @{}
  }
  $Auth = Get-Content -Raw $AuthPath | ConvertFrom-Json
  if (-not $Auth.user -or -not $Auth.password) {
    return @{}
  }
  $Token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($Auth.user):$($Auth.password)"))
  return @{ Authorization = "Basic $Token" }
}

function Expect-Status([scriptblock]$Request, [int]$StatusCode, [string]$Label) {
  try {
    & $Request | Out-Null
  } catch {
    $Actual = $_.Exception.Response.StatusCode.value__
    if ($Actual -eq $StatusCode) {
      Write-Host "OK: $Label returned $StatusCode"
      return
    }
    throw
  }
  throw "$Label did not return expected status $StatusCode"
}

$Health = Invoke-RestMethod -Uri "$Base/api/health" -TimeoutSec 5
if (-not $Health.ok) {
  throw "Health check failed"
}
Write-Host "OK: health"

$AuthHeaders = Get-AuthHeaders
$HasAuth = $AuthHeaders.Count -gt 0

if ($HasAuth) {
  Expect-Status { Invoke-WebRequest -Uri "$Base/" -UseBasicParsing -TimeoutSec 5 } 401 "unauthenticated page"
  Expect-Status { Invoke-RestMethod -Uri "$Base/api/projects" -TimeoutSec 5 } 401 "unauthenticated API"
}

$Headers = @{}
foreach ($Key in $AuthHeaders.Keys) {
  $Headers[$Key] = $AuthHeaders[$Key]
}
$Headers["X-Project-Graph-Client"] = "smoke-web"

$Page = Invoke-WebRequest -Uri "$Base/" -Headers $Headers -UseBasicParsing -TimeoutSec 5
if ($Page.StatusCode -ne 200 -or $Page.Content -notmatch '<div id="root"') {
  throw "Page smoke failed"
}
Write-Host "OK: page"

$ProjectsBefore = Invoke-RestMethod -Uri "$Base/api/projects" -Headers $Headers -TimeoutSec 5
if ($null -eq $ProjectsBefore.projects) {
  throw "Project list smoke failed"
}
Write-Host "OK: project list"

$Project = Invoke-RestMethod `
  -Uri "$Base/api/projects" `
  -Method Post `
  -Headers $Headers `
  -ContentType "application/json" `
  -Body (@{ name = "Smoke Web Probe" } | ConvertTo-Json -Compress)

$ProjectId = $Project.project.id

try {
  $Renamed = Invoke-RestMethod `
    -Uri "$Base/api/projects/$ProjectId" `
    -Method Patch `
    -Headers $Headers `
    -ContentType "application/json" `
    -Body (@{ name = "Smoke Web Probe Renamed" } | ConvertTo-Json -Compress)

  if ($Renamed.project.name -ne "Smoke Web Probe Renamed") {
    throw "Rename smoke failed"
  }
  Write-Host "OK: rename"

  Invoke-RestMethod -Uri "$Base/api/projects/$ProjectId" -Method Delete -Headers $Headers | Out-Null
  Write-Host "OK: delete"
} finally {
  try {
    Invoke-RestMethod -Uri "$Base/api/projects/$ProjectId" -Method Delete -Headers $Headers | Out-Null
  } catch {
  }
}

Write-Host "Smoke test passed: $Base"
