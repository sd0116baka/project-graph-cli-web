param(
  [string]$PortableZip = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location $Root

$RequiredPaths = @(
  ".github\workflows\cli-web-ci.yml",
  "docs\backend-first-architecture.md",
  "docs\distribution.md",
  "docs\security.md",
  "README-cli.md",
  "README-web.md",
  "scripts\package-portable.ps1",
  "scripts\smoke-web.ps1",
  "scripts\backup-data.ps1",
  "scripts\restore-data.ps1"
)

foreach ($Path in $RequiredPaths) {
  if (-not (Test-Path -LiteralPath (Join-Path $Root $Path))) {
    throw "Missing release readiness path: $Path"
  }
}

function Read-ApiVersion {
  param(
    [string]$Path,
    [string]$Pattern,
    [string]$Label
  )

  $Text = Get-Content -Raw -LiteralPath (Join-Path $Root $Path)
  $Match = [regex]::Match($Text, $Pattern)
  if (-not $Match.Success) {
    throw "Cannot find $Label API version in $Path"
  }
  return $Match.Groups[1].Value
}

$CliApiVersion = Read-ApiVersion `
  -Path "packages\project-graph-cli\src\index.ts" `
  -Pattern 'const\s+supportedBackendApiVersion\s*=\s*"([^"]+)"' `
  -Label "CLI"
$ApiVersions = [ordered]@{
  "server\src\server.js" = Read-ApiVersion `
    -Path "server\src\server.js" `
    -Pattern 'const\s+apiVersion\s*=\s*"([^"]+)"' `
    -Label "server"
  "scripts\web-paths.ps1" = Read-ApiVersion `
    -Path "scripts\web-paths.ps1" `
    -Pattern 'apiVersion\s*=\s*"([^"]+)"' `
    -Label "registry"
}

foreach ($Path in $ApiVersions.Keys) {
  if ($ApiVersions[$Path] -ne $CliApiVersion) {
    throw "API version mismatch: CLI=$CliApiVersion $Path=$($ApiVersions[$Path])"
  }
}

$SecurityDoc = Get-Content -Raw -LiteralPath (Join-Path $Root "docs\security.md")
if ($SecurityDoc -notmatch [regex]::Escape($CliApiVersion)) {
  throw "docs\security.md does not mention backend API version $CliApiVersion"
}

if (-not $PortableZip) {
  $PortableZip = Get-ChildItem -LiteralPath (Join-Path $Root "dist\portable") -Filter "project-graph-cli-web-*-windows-preview.zip" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not $PortableZip -or -not (Test-Path -LiteralPath $PortableZip)) {
  throw "Missing portable preview zip. Run scripts\package-portable.ps1 first."
}

$PortableZipItem = Get-Item -LiteralPath $PortableZip
if ($PortableZipItem.Length -lt 1MB) {
  throw "Portable preview zip is unexpectedly small: $($PortableZipItem.FullName)"
}

$Ci = Get-Content -Raw -LiteralPath (Join-Path $Root ".github\workflows\cli-web-ci.yml")
foreach ($Needle in @("Test CLI", "Test Web server API", "Smoke Web server", "Package portable preview", "Upload portable preview")) {
  if ($Ci -notmatch [regex]::Escape($Needle)) {
    throw "CLI/Web CI is missing gate: $Needle"
  }
}

Write-Host "Release readiness OK"
Write-Host "Portable: $($PortableZipItem.FullName)"
