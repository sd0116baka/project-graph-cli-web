param(
  [int]$LivePort = 42337,
  [int]$VitePort = 1420,
  [switch]$SkipCliBuild,
  [switch]$ReuseVite,
  [string]$AppExe = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("project-graph-live-smoke-" + [Guid]::NewGuid().ToString("N"))
$RegistryPath = Join-Path ([IO.Path]::GetTempPath()) "project-graph-live-session.json"
$CliEntry = Join-Path $Root "packages\project-graph-cli\dist\index.mjs"
$LogsDir = Join-Path $TempRoot "logs"
$StartedVite = $null
$StartedApp = $null

function Test-PortBusy([int]$Value) {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $Value -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

function Wait-Http([string]$Url, [string]$Label, [int]$TimeoutSeconds = 90) {
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
      Write-Host "OK: $Label"
      return
    } catch {
      Start-Sleep -Milliseconds 500
    }
  } while ((Get-Date) -lt $Deadline)
  throw "Timed out waiting for $Label at $Url"
}

function Wait-LiveRegistry([int]$ExpectedPort, [int]$TimeoutSeconds = 90) {
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-Path $RegistryPath) {
      try {
        $Session = Get-Content -Raw -LiteralPath $RegistryPath | ConvertFrom-Json
        if ([int]$Session.port -eq $ExpectedPort -and $Session.token) {
          Write-Host "OK: live registry"
          return $Session
        }
      } catch {
      }
    }
    if ($StartedApp -and $StartedApp.HasExited) {
      throw "Project Graph exited before live registry was ready. See $LogsDir."
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $Deadline)
  throw "Timed out waiting for live registry at $RegistryPath"
}

function Invoke-Cli([string[]]$Arguments, [switch]$AllowFailure) {
  $Output = & node $CliEntry @Arguments 2>&1
  $Code = $LASTEXITCODE
  $Text = ($Output | ForEach-Object { $_.ToString() }) -join "`n"
  if ($Code -ne 0 -and -not $AllowFailure) {
    throw "CLI failed ($Code): node $CliEntry $($Arguments -join ' ')`n$Text"
  }
  return [pscustomobject]@{
    Code = $Code
    Text = $Text
  }
}

function Invoke-CliJson([string[]]$Arguments) {
  $Result = Invoke-Cli $Arguments
  return $Result.Text | ConvertFrom-Json
}

function Stop-ProcessTree([Diagnostics.Process]$Process) {
  if ($null -eq $Process -or $Process.HasExited) {
    return
  }
  taskkill /PID $Process.Id /T /F | Out-Null
}

try {
  Set-Location $Root
  New-Item -ItemType Directory -Path $TempRoot, $LogsDir -Force | Out-Null
  Remove-Item -LiteralPath $RegistryPath -Force -ErrorAction SilentlyContinue

  if (-not $SkipCliBuild) {
    pnpm --filter @graphif/project-graph-cli build
  }
  if (-not (Test-Path $CliEntry)) {
    throw "Missing $CliEntry. Run pnpm --filter @graphif/project-graph-cli build first."
  }

  if (-not $AppExe) {
    $AppExe = Join-Path $Root "app\src-tauri\target\debug\project-graph.exe"
  }
  if (-not (Test-Path $AppExe)) {
    throw "Missing $AppExe. Build it with: cd app/src-tauri; cargo build --no-default-features"
  }

  $FirstMarkdown = Join-Path $TempRoot "first.md"
  $SecondMarkdown = Join-Path $TempRoot "second.md"
  $FirstPrg = Join-Path $TempRoot "first.prg"
  $SecondPrg = Join-Path $TempRoot "second.prg"
  $BadPrg = Join-Path $TempRoot "bad.prg"
  $PatchFile = Join-Path $TempRoot "ops.json"
  $LiveExport = Join-Path $TempRoot "live-export.pg.json"
  $DiskExport = Join-Path $TempRoot "disk-export.pg.json"

  Set-Content -LiteralPath $FirstMarkdown -Value "# First`n`n## First child`n" -Encoding UTF8
  Set-Content -LiteralPath $SecondMarkdown -Value "# Second`n" -Encoding UTF8
  Set-Content -LiteralPath $BadPrg -Value "not a project graph archive" -Encoding UTF8
  @(
    @{
      op = "add_text_node"
      id = "smoke-live-node"
      text = "Live smoke node"
      position = @{ x = 520; y = 0 }
    }
  ) | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $PatchFile -Encoding UTF8

  Invoke-Cli @("import", $FirstMarkdown, "--format", "markdown", "-o", $FirstPrg) | Out-Null
  Invoke-Cli @("import", $SecondMarkdown, "--format", "markdown", "-o", $SecondPrg) | Out-Null
  Write-Host "OK: fixture documents"

  $ViteUrl = "http://127.0.0.1:$VitePort"
  if (Test-PortBusy $VitePort) {
    if (-not $ReuseVite) {
      throw "Port $VitePort is already busy. Stop the existing server or pass -ReuseVite."
    }
    Wait-Http $ViteUrl "existing Vite server"
  } else {
    $Pnpm = (Get-Command pnpm -ErrorAction Stop).Source
    $ViteOut = Join-Path $LogsDir "vite.out.log"
    $ViteErr = Join-Path $LogsDir "vite.err.log"
    $StartedVite = Start-Process `
      -FilePath $Pnpm `
      -ArgumentList @("--filter", "@graphif/project-graph", "dev", "--", "--host", "127.0.0.1", "--port", [string]$VitePort, "--strictPort") `
      -WorkingDirectory $Root `
      -PassThru `
      -WindowStyle Hidden `
      -RedirectStandardOutput $ViteOut `
      -RedirectStandardError $ViteErr
    Wait-Http $ViteUrl "Vite server"
  }

  if (Test-PortBusy $LivePort) {
    throw "Live port $LivePort is already busy."
  }

  $AppOut = Join-Path $LogsDir "app.out.log"
  $AppErr = Join-Path $LogsDir "app.err.log"
  $StartedApp = Start-Process `
    -FilePath $AppExe `
    -ArgumentList @("--live", "--live-port", [string]$LivePort, $FirstPrg) `
    -WorkingDirectory $Root `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $AppOut `
    -RedirectStandardError $AppErr

  $Session = Wait-LiveRegistry $LivePort
  $Token = [string]$Session.token

  $InitialDocs = Invoke-CliJson @("live", "list-documents", "--port", [string]$LivePort, "--token", $Token, "--json")
  if ($InitialDocs.Count -ne 1) {
    throw "Expected one open document, got $($InitialDocs.Count)."
  }
  Write-Host "OK: initial document list"

  $Open = Invoke-CliJson @("live", "open", $SecondPrg, "--port", [string]$LivePort, "--token", $Token, "--json")
  if (-not $Open.opened -or $Open.alreadyOpen) {
    throw "Expected second document to open."
  }
  $SecondDocumentId = [string]$Open.document.id
  Write-Host "OK: live open"

  $DuplicateOpen = Invoke-CliJson @("live", "open", $SecondPrg, "--port", [string]$LivePort, "--token", $Token, "--json")
  if (-not $DuplicateOpen.alreadyOpen) {
    throw "Expected duplicate live open to reuse the tab."
  }
  Write-Host "OK: duplicate open guard"

  $AmbiguousInspect = Invoke-Cli @("live", "inspect", "--port", [string]$LivePort, "--token", $Token, "--json") -AllowFailure
  if ($AmbiguousInspect.Code -eq 0 -or $AmbiguousInspect.Text -notmatch "Multiple Project Graph documents") {
    throw "Expected live inspect without --document to fail when two documents are open."
  }
  Write-Host "OK: ambiguous document guard"

  $ManualFileUri = ([System.Uri]::new((Resolve-Path -LiteralPath $SecondPrg).Path)).AbsoluteUri
  $Patch = Invoke-CliJson @(
    "live", "patch", $PatchFile,
    "--document", $ManualFileUri,
    "--base-revision", "0",
    "--port", [string]$LivePort,
    "--token", $Token,
    "--json"
  )
  if (-not $Patch.saved -or $Patch.revision -ne 1) {
    throw "Expected live patch to save and advance revision."
  }
  Write-Host "OK: live patch saved"

  Invoke-Cli @(
    "live", "export",
    "--format", "pgjson",
    "--document", $SecondDocumentId,
    "--port", [string]$LivePort,
    "--token", $Token,
    "-o", $LiveExport
  ) | Out-Null
  $LiveJson = Get-Content -Raw -LiteralPath $LiveExport | ConvertFrom-Json
  if (-not ($LiveJson.nodes | Where-Object { $_.id -eq "smoke-live-node" })) {
    throw "Live export did not include the patched node."
  }
  Write-Host "OK: live export"

  Invoke-Cli @("export", $SecondPrg, "--format", "pgjson", "-o", $DiskExport) | Out-Null
  $DiskJson = Get-Content -Raw -LiteralPath $DiskExport | ConvertFrom-Json
  if (-not ($DiskJson.nodes | Where-Object { $_.id -eq "smoke-live-node" })) {
    throw "Disk export did not include the patched node."
  }
  Invoke-Cli @("validate", $SecondPrg) | Out-Null
  Write-Host "OK: autosaved disk document"

  $BadOpen = Invoke-Cli @("live", "open", $BadPrg, "--port", [string]$LivePort, "--token", $Token, "--json") -AllowFailure
  if ($BadOpen.Code -eq 0 -or $BadOpen.Text -notmatch "File format is not recognized") {
    throw "Expected corrupt .prg live open to fail without blocking."
  }
  Write-Host "OK: corrupt open fails fast"

  Write-Host "Smoke test passed: live CLI bridge"
} finally {
  Stop-ProcessTree $StartedApp
  if ($StartedVite) {
    Stop-ProcessTree $StartedVite
  }
  Remove-Item -LiteralPath $RegistryPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
