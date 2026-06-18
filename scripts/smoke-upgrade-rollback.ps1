param(
  [int]$Port = 37931,
  [string]$DataDir = "",
  [string]$BackupDir = "",
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path

if (-not $DataDir) {
  $DataDir = Join-Path $env:TEMP "project-graph-rollback-smoke-data-$([guid]::NewGuid().ToString('N'))"
}
if (-not $BackupDir) {
  $BackupDir = Join-Path $env:TEMP "project-graph-rollback-smoke-backups-$([guid]::NewGuid().ToString('N'))"
}
$DataDir = [IO.Path]::GetFullPath($DataDir)
$BackupDir = [IO.Path]::GetFullPath($BackupDir)
if (-not $LogPath) {
  $LogPath = Join-Path $DataDir "logs\rollback-smoke.log"
}
$LogPath = [IO.Path]::GetFullPath($LogPath)

function Start-SmokeBackend {
  param(
    [int]$Value,
    [string]$DataPath,
    [string]$LogFile
  )

  $StartScript = Join-Path $ScriptDir "start-web.ps1"
  $Arguments = Join-ProcessArguments @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $StartScript,
    "-SkipBuild",
    "-NoAuth",
    "-Port",
    [string]$Value,
    "-DataDir",
    $DataPath,
    "-LogPath",
    $LogFile
  )

  return Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList $Arguments `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru
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

function Wait-SmokeBackend {
  param(
    [int]$Value,
    [Diagnostics.Process]$Process,
    [string]$LogFile
  )

  $Deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $Deadline) {
    if ($Process.HasExited) {
      $LogText = if (Test-Path -LiteralPath $LogFile) { Get-Content -Raw -LiteralPath $LogFile } else { "" }
      throw "Project Graph Web exited before rollback smoke health check. ExitCode=$($Process.ExitCode)`n$LogText"
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

function Stop-SmokeBackend {
  param(
    [int]$Value,
    [Diagnostics.Process]$Process
  )

  & (Join-Path $ScriptDir "stop-web.ps1") -PortStart $Value -PortEnd $Value | Out-Host
  if ($Process -and -not $Process.HasExited) {
    Wait-Process -Id $Process.Id -Timeout 10 -ErrorAction SilentlyContinue
    if (-not $Process.HasExited) {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

function New-SmokePrg([string]$OutputPath) {
  $CliPath = Join-Path $Root "packages\project-graph-cli\dist\index.mjs"
  if (-not (Test-Path -LiteralPath $CliPath)) {
    throw "Missing CLI build output: $CliPath. Run pnpm nx build @graphif/project-graph-cli first."
  }
  $TempDir = Join-Path $env:TEMP "project-graph-rollback-prg-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
  try {
    $MarkdownPath = Join-Path $TempDir "baseline.md"
    Set-Content -LiteralPath $MarkdownPath -Encoding UTF8 -Value "# Rollback Baseline`n`n## Keep Me`n"
    & node $CliPath import $MarkdownPath --format markdown -o $OutputPath
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create rollback smoke .prg document."
    }
  } finally {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function New-ServerProject([string]$Name) {
  return Invoke-RestMethod `
    -Uri "http://127.0.0.1:$Port/api/projects" `
    -Method Post `
    -Headers @{ "X-Project-Graph-Client" = "rollback-smoke" } `
    -ContentType "application/json" `
    -Body (@{ name = $Name } | ConvertTo-Json -Compress)
}

function Write-ServerProjectBlob([string]$ProjectId, [string]$PrgPath) {
  $Bytes = [IO.File]::ReadAllBytes($PrgPath)
  Invoke-WebRequest `
    -Uri "http://127.0.0.1:$Port/api/projects/$ProjectId/blob" `
    -Method Put `
    -Headers @{ "X-Project-Graph-Client" = "rollback-smoke" } `
    -ContentType "application/vnd.project-graph" `
    -Body $Bytes `
    -UseBasicParsing | Out-Null
}

function Get-ProjectByName([string]$Name) {
  $Projects = Invoke-RestMethod `
    -Uri "http://127.0.0.1:$Port/api/projects" `
    -Headers @{ "X-Project-Graph-Client" = "rollback-smoke" }
  return @($Projects.projects | Where-Object { $_.name -eq $Name } | Select-Object -First 1)
}

New-Item -ItemType Directory -Path $DataDir, $BackupDir -Force | Out-Null
$PrgPath = Join-Path $env:TEMP "project-graph-rollback-baseline.prg"
$ServerProcess = $null

try {
  New-SmokePrg -OutputPath $PrgPath

  $ServerProcess = Start-SmokeBackend -Value $Port -DataPath $DataDir -LogFile $LogPath
  Wait-SmokeBackend -Value $Port -Process $ServerProcess -LogFile $LogPath

  $Baseline = New-ServerProject -Name "Rollback Baseline"
  Write-ServerProjectBlob -ProjectId $Baseline.project.id -PrgPath $PrgPath
  $Validation = Invoke-RestMethod `
    -Uri "http://127.0.0.1:$Port/api/projects/$($Baseline.project.id)/validate" `
    -Headers @{ "X-Project-Graph-Client" = "rollback-smoke" }
  if (-not $Validation.ok) {
    throw "Baseline project did not validate before backup."
  }

  Stop-SmokeBackend -Value $Port -Process $ServerProcess
  $ServerProcess = $null

  $BackupOutput = & (Join-Path $ScriptDir "backup-data.ps1") -DataDir $DataDir -BackupDir $BackupDir -Keep 20
  $BackupPath = @($BackupOutput | Where-Object { $_ -like "*.zip" } | Select-Object -Last 1)[0]
  if (-not $BackupPath -or -not (Test-Path -LiteralPath $BackupPath)) {
    throw "Backup script did not produce a zip path."
  }
  & (Join-Path $ScriptDir "restore-data.ps1") -BackupPath $BackupPath -DataDir $DataDir -Port $Port -ValidateOnly

  $ServerProcess = Start-SmokeBackend -Value $Port -DataPath $DataDir -LogFile $LogPath
  Wait-SmokeBackend -Value $Port -Process $ServerProcess -LogFile $LogPath
  $AfterUpgrade = New-ServerProject -Name "After Upgrade Should Roll Back"
  Write-ServerProjectBlob -ProjectId $AfterUpgrade.project.id -PrgPath $PrgPath
  Stop-SmokeBackend -Value $Port -Process $ServerProcess
  $ServerProcess = $null

  & (Join-Path $ScriptDir "restore-data.ps1") -BackupPath $BackupPath -DataDir $DataDir -Port $Port -PreRestoreBackupDir $BackupDir

  $ServerProcess = Start-SmokeBackend -Value $Port -DataPath $DataDir -LogFile $LogPath
  Wait-SmokeBackend -Value $Port -Process $ServerProcess -LogFile $LogPath

  $RestoredBaseline = Get-ProjectByName "Rollback Baseline"
  if (-not $RestoredBaseline) {
    throw "Rollback smoke did not restore the baseline project."
  }
  if (Get-ProjectByName "After Upgrade Should Roll Back") {
    throw "Rollback smoke did not remove the after-upgrade project."
  }
  $RestoredValidation = Invoke-RestMethod `
    -Uri "http://127.0.0.1:$Port/api/projects/$($RestoredBaseline.id)/validate" `
    -Headers @{ "X-Project-Graph-Client" = "rollback-smoke" }
  if (-not $RestoredValidation.ok) {
    throw "Rollback smoke restored metadata, but the baseline project blob is invalid."
  }
  $RestoredQuery = Invoke-RestMethod `
    -Uri "http://127.0.0.1:$Port/api/projects/$($RestoredBaseline.id)/query?kind=node&text=Keep%20Me" `
    -Headers @{ "X-Project-Graph-Client" = "rollback-smoke" }
  if ($RestoredQuery.result.total -ne 1) {
    throw "Rollback smoke restored blob did not contain the expected baseline node."
  }

  Write-Host "Upgrade rollback smoke passed: $BackupPath"
  Write-Host "Data: $DataDir"
} finally {
  Stop-SmokeBackend -Value $Port -Process $ServerProcess
  Remove-Item -LiteralPath $PrgPath -Force -ErrorAction SilentlyContinue
}
