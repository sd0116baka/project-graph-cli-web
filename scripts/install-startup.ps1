param(
  [int]$Port = 37820,
  [string]$TaskName = "Project Graph Web",
  [string]$DataDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir "web-paths.ps1")
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$StartScript = Join-Path $ScriptDir "start-web.ps1"
$ResolvedDataDir = Resolve-WebDataDir -Root $Root -DataDir $DataDir
Assert-SafeWebDataDir -Root $Root -DataDir $ResolvedDataDir
$LogDir = Join-Path $ResolvedDataDir "logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$PowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`" -SkipBuild -Port $Port"
if ($ResolvedDataDir) {
  $Arguments += " -DataDir `"$ResolvedDataDir`""
}
$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 30) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Principal $Principal `
  -Settings $Settings `
  -Description "Start Project Graph Web for the current user at logon." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Trigger: current user logon"
Write-Host "Port: $Port"
Write-Host "Data directory: $ResolvedDataDir"
Write-Host "Start script: $StartScript"

$Task = Get-ScheduledTask -TaskName $TaskName
$Task | Select-Object TaskName, State, TaskPath | Format-List
