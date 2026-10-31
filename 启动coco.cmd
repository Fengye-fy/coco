@echo off
chcp 65001 >nul
cd /d "%~dp0"
title coco
if exist "release\v0.5.0\win-unpacked\coco.exe" (
  start "" "%~dp0release\v0.5.0\win-unpacked\coco.exe"
  exit /b 0
)
if exist "release\v0.4.0\win-unpacked\coco.exe" (
  start "" "%~dp0release\v0.4.0\win-unpacked\coco.exe"
  exit /b 0
)
if exist "release\win-unpacked\coco.exe" (
  start "" "%~dp0release\win-unpacked\coco.exe"
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 LTS，然后重新启动。
  pause
  exit /b 1
)
if not exist "node_modules\electron\package.json" (
  call npm.cmd install
  if errorlevel 1 goto failed
)
if not exist "dist\index.html" (
  call npm.cmd run build
  if errorlevel 1 goto failed
)
call npm.cmd start
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo coco 启动失败，请查看上方提示。
pause
exit /b 1
