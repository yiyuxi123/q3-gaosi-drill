@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
call "%~dp0start-web.cmd"
if errorlevel 1 (
  echo.
  echo 启动没有完成，请保留本窗口并联系维护人员。
  pause
)
endlocal
