param(
  [int]$Port = 37820,
  [string]$RuleName = "Project Graph Web",
  [string[]]$Profile = @("Private", "Domain")
)

$ErrorActionPreference = "Stop"

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
$IsAdmin = $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $IsAdmin) {
  throw "Administrator permission is required. Run this script from an elevated PowerShell window."
}

$DisplayName = "$RuleName TCP $Port"
$Existing = Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue

if ($Existing) {
  Set-NetFirewallRule -DisplayName $DisplayName -Enabled True -Profile $Profile -Action Allow | Out-Null
  Set-NetFirewallPortFilter -AssociatedNetFirewallRule $Existing -Protocol TCP -LocalPort $Port | Out-Null
  Write-Host "Updated firewall rule: $DisplayName"
} else {
  New-NetFirewallRule `
    -DisplayName $DisplayName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile $Profile | Out-Null
  Write-Host "Created firewall rule: $DisplayName"
}

$Profiles = Get-NetConnectionProfile | Select-Object Name, NetworkCategory
Write-Host ""
Write-Host "Active network profiles:"
$Profiles | Format-Table -AutoSize
Write-Host ""
Write-Host "Allowed port: TCP $Port"
Write-Host "Allowed profiles: $($Profile -join ',')"
Write-Host "If your current network is Public, either change it to Private or rerun with -Profile Any."
