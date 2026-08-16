@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm，请先安装 Node.js。
  pause
  exit /b 1
)
echo 正在启动 2026 Q3 季度考智能备考与刷题系统...
start "Q3本地服务" /D "%~dp0" cmd /k "npm run dev"
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(30); do { try { $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173/' -TimeoutSec 2; if ($response.StatusCode -lt 500) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo 本地服务在 30 秒内没有启动，请查看“Q3本地服务”窗口中的提示。
  pause
  exit /b 1
)
start "" "http://localhost:5173/"
echo 页面已打开；关闭“Q3本地服务”窗口即可停止服务。
endlocal
