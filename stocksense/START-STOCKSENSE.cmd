@echo off
setlocal
cd /d "%~dp0"
title StockSense - Local Development

where node >nul 2>nul
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node
if not exist package.json goto missing_project

if exist node_modules\vite\bin\vite.js goto start_app
echo Installing StockSense dependencies. Internet is needed for this first step.
call npm ci
if errorlevel 1 goto failed

:start_app
echo.
echo Starting StockSense. Keep this window open while using the app.
echo Open http://localhost:5173 in your browser after the servers start.
echo If Vite prints another port, open the address it prints instead.
echo Press Ctrl+C here to stop the servers.
echo.
call npm run dev
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo Node.js and npm are required. Install Node.js 24, then reopen this file.
pause
exit /b 1

:missing_project
echo Extract the entire ZIP first. Keep this launcher beside package.json.
pause
exit /b 1

:failed
echo.
echo StockSense could not start. The error details are shown above.
pause
exit /b 1
