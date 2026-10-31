# pixel-mods installer for Windows (PowerShell).
# Asks which version to install, Windows or macOS, then installs its four mods at user scope
# and removes the other version's four, since both sets together clash on /board and the rest.
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/akaz01/pixel-mods/main/install.ps1)))
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun   ask, then only print the commands
# Pasted into PowerShell it runs inside the person's window, so it ends with return, never exit.
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$MarketplaceRepo = 'akaz01/pixel-mods'
$Marketplace = 'pixel-mods'
$Mods = @('work-board', 'agent-router', 'collab-hub', 'safe-shell')

function Invoke-Step([string[]]$Arguments) {
  if ($DryRun) { Write-Host "  [dry-run] claude $($Arguments -join ' ')"; return }
  & claude @Arguments
  if ($LASTEXITCODE -ne 0) { throw "claude $($Arguments -join ' ') failed ($LASTEXITCODE)." }
}

# A step that may fail harmlessly, such as removing a mod that is not installed.
function Invoke-QuietStep([string[]]$Arguments) {
  if ($DryRun) { Write-Host "  [dry-run] claude $($Arguments -join ' ')"; return }
  & claude @Arguments *> $null
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host 'Claude Code (claude) is not installed or not on PATH. Install it first.' -ForegroundColor Red
  return
}

$detected = if ($IsMacOS) { '2' } else { '1' }
Write-Host 'Which version of pixel-mods should be installed?'
Write-Host '  1) Windows'
Write-Host '  2) macOS'
$choice = Read-Host "Choose 1 or 2 [$detected]"
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = $detected }

switch ($choice.Trim()) {
  '1' { $installSuffix = '';       $removeSuffix = '-macos'; $label = 'Windows' }
  '2' { $installSuffix = '-macos'; $removeSuffix = '';       $label = 'macOS' }
  default { Write-Host 'Please choose 1 or 2.' -ForegroundColor Red; return }
}

Write-Host ''
Write-Host "Installing the $label version."

Write-Host '- Marketplace'
$known = (& claude plugin marketplace list 2>$null) -join "`n"
if ($known -match [regex]::Escape($Marketplace)) {
  Invoke-Step @('plugin', 'marketplace', 'update', $Marketplace)
} else {
  Invoke-Step @('plugin', 'marketplace', 'add', $MarketplaceRepo)
}

Write-Host '- Removing the other version, if installed'
foreach ($mod in $Mods) { Invoke-QuietStep @('plugin', 'uninstall', "$mod$removeSuffix@$Marketplace", '--scope', 'user') }

Write-Host '- Installing'
foreach ($mod in $Mods) { Invoke-Step @('plugin', 'install', "$mod$installSuffix@$Marketplace", '--scope', 'user') }

Write-Host ''
if ($DryRun) { Write-Host 'Dry run only: nothing was installed.' }
else { Write-Host 'Done. Open a new Claude Code session: the Work Board opens by itself.' }
