$ErrorActionPreference = 'Stop'
$NodeVersion = 'v24.19.0'
$PackageRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $PackageRoot '.runtime'
$NodeFolderName = "node-$NodeVersion-win-x64"
$BundledNode = Join-Path $RuntimeRoot "$NodeFolderName\node.exe"
$PidFile = Join-Path $RuntimeRoot 'q3-web.pid'
$LogFile = Join-Path $RuntimeRoot 'q3-web.log'
$ErrorLogFile = Join-Path $RuntimeRoot 'q3-web-error.log'
$WebUrl = 'http://127.0.0.1:5173/'

function Test-Q3Server {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "${WebUrl}bank/questions.json" -TimeoutSec 2
    if ($response.StatusCode -ne 200) { return $false }
    $questions = $response.Content | ConvertFrom-Json
    return $questions.Count -eq 479
  } catch {
    return $false
  }
}

function Get-UsableNode {
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($systemNode) {
    try {
      $versionText = & $systemNode.Source --version
      $major = [int](($versionText -replace '^v', '').Split('.')[0])
      if ($major -ge 20) { return $systemNode.Source }
    } catch {}
  }
  if (Test-Path -LiteralPath $BundledNode) { return $BundledNode }

  New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
  $archiveName = "$NodeFolderName.zip"
  $archivePath = Join-Path $RuntimeRoot $archiveName
  $checksumsPath = Join-Path $RuntimeRoot 'SHASUMS256.txt'
  $baseUrl = "https://nodejs.org/dist/$NodeVersion"

  Write-Host 'First launch: downloading the official portable Node.js runtime...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $checksumsPath
  Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$archiveName" -OutFile $archivePath
  $escapedName = [regex]::Escape($archiveName)
  $checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s+$escapedName$" } | Select-Object -First 1
  if (-not $checksumLine) { throw 'The Node.js checksum manifest does not contain the runtime archive.' }
  $expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) { throw 'The downloaded Node.js runtime failed SHA-256 verification.' }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $RuntimeRoot -Force
  if (-not (Test-Path -LiteralPath $BundledNode)) { throw 'The Node.js runtime could not be extracted.' }
  return $BundledNode
}

function Install-DesktopShortcut {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { return }
  $shortcutName = -join ((0x51, 0x33, 0x8003, 0x9AD8, 0x65AF, 0x5237, 0x9898, 0x2E, 0x6C, 0x6E, 0x6B) | ForEach-Object { [char]$_ })
  $shortcutPath = Join-Path $desktop $shortcutName
  $launcher = Join-Path $PackageRoot 'start-web.cmd'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = $PackageRoot
  $shortcut.Description = 'Launch Q3 Gaosi Drill'
  $shortcut.Save()
}

if (-not (Test-Q3Server)) {
  $node = Get-UsableNode
  New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
  $process = Start-Process -FilePath $node -ArgumentList @('server.cjs') -WorkingDirectory $PackageRoot -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLogFile -PassThru
  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
  $ready = $false
  foreach ($attempt in 1..40) {
    Start-Sleep -Milliseconds 250
    if (Test-Q3Server) { $ready = $true; break }
    if ($process.HasExited) { break }
  }
  if (-not $ready) { throw "The web service failed to start. See: $ErrorLogFile" }
}

Install-DesktopShortcut
Start-Process $WebUrl
Write-Host 'Ready. The browser is open and a desktop shortcut has been created.'
