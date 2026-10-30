@echo off
setlocal
cd /d "%~dp0"
title Reading Companion - keep this window open
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.19 or newer is required. Install Node.js, then try again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing the local app's dependencies...
  call npm ci --ignore-scripts
  if errorlevel 1 goto failed
)
echo Preparing Reading Companion...
call npm run build
if errorlevel 1 goto failed
call npm run open
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Reading Companion could not start. See the error above.
pause
exit /b 1
