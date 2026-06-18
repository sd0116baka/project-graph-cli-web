param(
  [int]$Port = 37820,
  [string]$DataDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$DataDir = Resolve-WebDataDir -Root $Root -DataDir $DataDir
$AuthPath = Join-Path $DataDir "auth.json"
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

$ServerInfo = Invoke-RestMethod -Uri "$Base/api/server-info" -Headers $Headers -TimeoutSec 5
if (-not $ServerInfo.ok -or -not $ServerInfo.dataDirName) {
  throw "Server info smoke failed"
}
Write-Host "OK: server info"

$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("project-graph-web-smoke-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
$CliPath = Join-Path $Root "packages\project-graph-cli\dist\index.mjs"
if (-not (Test-Path $CliPath)) {
  throw "Missing CLI build output: $CliPath. Run pnpm nx run @graphif/project-graph-cli:build first."
}
$MarkdownPath = Join-Path $TempDir "outline.md"
$PrgPath = Join-Path $TempDir "outline.prg"
Set-Content -LiteralPath $MarkdownPath -Encoding UTF8 -Value "# Intake`n`n## Review`n"
& node $CliPath import $MarkdownPath --format markdown -o $PrgPath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create smoke .prg document"
}

$Project = Invoke-RestMethod `
  -Uri "$Base/api/projects" `
  -Method Post `
  -Headers $Headers `
  -ContentType "application/json" `
  -Body (@{ name = "Smoke Web Probe" } | ConvertTo-Json -Compress)

$ProjectId = $Project.project.id
$ProjectDeleted = $false

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

  $BlobBytes = [IO.File]::ReadAllBytes($PrgPath)
  $BlobResponse = Invoke-WebRequest `
    -Uri "$Base/api/projects/$ProjectId/blob" `
    -Method Put `
    -Headers $Headers `
    -ContentType "application/vnd.project-graph" `
    -Body $BlobBytes `
    -UseBasicParsing
  $OriginalEtag = [string](($BlobResponse.Headers.ETag | Select-Object -First 1))
  if (-not $OriginalEtag) {
    throw "Project blob write did not return an ETag"
  }
  Write-Host "OK: blob write"

  $ReviewQuery = Invoke-RestMethod -Uri "$Base/api/projects/$ProjectId/query?kind=node&text=Review" -Headers $Headers
  if ($ReviewQuery.result.total -ne 1) {
    throw "Graph query smoke failed"
  }
  Write-Host "OK: graph query"

  $PatchHeaders = @{}
  foreach ($Key in $Headers.Keys) {
    $PatchHeaders[$Key] = $Headers[$Key]
  }
  $PatchHeaders["If-Match"] = $OriginalEtag
  $PatchBody = '[{"op":"add_text_node","id":"ship","text":"Ship","position":{"x":520,"y":0}},{"op":"connect","id":"review-ship","source":"Review","target":"ship","text":"ready"}]'
  $Patch = Invoke-RestMethod `
    -Uri "$Base/api/projects/$ProjectId/patch" `
    -Method Post `
    -Headers $PatchHeaders `
    -ContentType "application/json" `
    -Body $PatchBody
  if ($Patch.changed -notcontains "ship") {
    throw "Graph patch smoke failed"
  }
  Write-Host "OK: graph patch"

  $ShipQuery = Invoke-RestMethod -Uri "$Base/api/projects/$ProjectId/query?kind=node&text=Ship" -Headers $Headers
  if ($ShipQuery.result.total -ne 1) {
    throw "Graph query after patch smoke failed"
  }
  Write-Host "OK: graph query after patch"

  $History = Invoke-RestMethod -Uri "$Base/api/projects/$ProjectId/history" -Headers $Headers
  if ($History.history.Count -lt 1) {
    throw "Graph patch did not create a backup revision"
  }
  Write-Host "OK: graph patch backup"

  $MermaidExport = Invoke-RestMethod -Uri "$Base/api/projects/$ProjectId/export?format=mermaid" -Headers $Headers
  if ($MermaidExport.content -notmatch "ready") {
    throw "Graph export smoke failed"
  }
  Write-Host "OK: graph export"

  Expect-Status {
    Invoke-RestMethod `
      -Uri "$Base/api/projects/$ProjectId/patch" `
      -Method Post `
      -Headers $Headers `
      -ContentType "application/json" `
      -Body '[{"op":"add_text_node","text":42}]'
  } 400 "invalid graph patch"

  $OtherHeaders = @{}
  foreach ($Key in $Headers.Keys) {
    $OtherHeaders[$Key] = $Headers[$Key]
  }
  $OtherHeaders["X-Project-Graph-Client"] = "smoke-web-other-client"
  Invoke-RestMethod `
    -Uri "$Base/api/projects/$ProjectId/lock" `
    -Method Post `
    -Headers $OtherHeaders `
    -ContentType "application/json" `
    -Body (@{ ttlSeconds = 60; clientName = "Smoke Other Client" } | ConvertTo-Json -Compress) | Out-Null
  Expect-Status {
    Invoke-RestMethod `
      -Uri "$Base/api/projects/$ProjectId/patch" `
      -Method Post `
      -Headers $Headers `
      -ContentType "application/json" `
      -Body '[{"op":"rename_node","id":"ship","text":"Locked Ship"}]'
  } 423 "locked graph patch"
  Invoke-RestMethod -Uri "$Base/api/projects/$ProjectId/unlock" -Method Post -Headers $OtherHeaders | Out-Null

  $StaleHeaders = @{}
  foreach ($Key in $Headers.Keys) {
    $StaleHeaders[$Key] = $Headers[$Key]
  }
  $StaleHeaders["If-Match"] = $OriginalEtag
  Expect-Status {
    Invoke-RestMethod `
      -Uri "$Base/api/projects/$ProjectId/patch" `
      -Method Post `
      -Headers $StaleHeaders `
      -ContentType "application/json" `
      -Body '[{"op":"rename_node","id":"ship","text":"Stale Ship"}]'
  } 412 "stale graph patch"

  Invoke-RestMethod -Uri "$Base/api/projects/$ProjectId" -Method Delete -Headers $Headers | Out-Null
  $ProjectDeleted = $true
  Write-Host "OK: delete"
} finally {
  if (-not $ProjectDeleted) {
    try {
      Invoke-RestMethod -Uri "$Base/api/projects/$ProjectId" -Method Delete -Headers $Headers | Out-Null
    } catch {
      Write-Warning "Cleanup project delete failed: $($_.Exception.Message)"
    }
  }
  try {
    Remove-Item -LiteralPath $TempDir -Recurse -Force
  } catch {
    Write-Warning "Cleanup temp dir failed: $($_.Exception.Message)"
  }
}

Write-Host "Smoke test passed: $Base"
