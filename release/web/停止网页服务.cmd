@echo off
chcp 65001 >nul
call "%~dp0stop-web.cmd"
if errorlevel 1 pause
