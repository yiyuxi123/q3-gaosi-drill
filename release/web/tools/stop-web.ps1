$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $PackageRoot '.runtime\q3-web.pid'

if (-not (Test-Path -LiteralPath $PidFile)) {
  Write-Host 'No running service was found for this package.'
  exit 0
}

$serverPid = [int](Get-Content -LiteralPath $PidFile -Raw)
$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $serverPid -Force
  Write-Host 'The web service has stopped.'
} else {
  Write-Host 'The web service was already stopped.'
}
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
