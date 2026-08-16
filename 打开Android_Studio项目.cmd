@echo off
chcp 65001 >nul
setlocal
set "STUDIO_EXE=E:\as\bin\studio64.exe"
if not exist "%STUDIO_EXE%" set "STUDIO_EXE=C:\Program Files\Android\Android Studio\bin\studio64.exe"
if not exist "%STUDIO_EXE%" (
  echo 未找到 Android Studio，请先安装或修改本脚本中的 STUDIO_EXE 路径。
  pause
  exit /b 1
)
echo 正在启动 Android Studio 并打开 Q3 季度考刷题 App 工程...
start "" "%STUDIO_EXE%" "%~dp0android"
echo 启动完成！可在 Android Studio 中点击 Run 或 Build 生成 APK 安装包。
endlocal
