@echo off
setlocal

cd /d "%~dp0"
title GPT Image Playground Launcher

echo.
echo ========================================
echo GPT Image Playground Launcher
echo ========================================
echo.

if not exist "package.json" (
    echo [ERROR] package.json was not found. Please keep this file in the project root.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    echo Please install Node.js 20.10.0 or later: https://nodejs.org/
    echo Then run this file again.
    echo.
    pause
    exit /b 1
)

node -e "import('./scripts/node-version.mjs').then(function(module){process.exit(module.isSupportedNodeVersion()?0:1)})"
if errorlevel 1 (
    echo [ERROR] Node.js version is too old.
    echo Current version:
    node -v
    echo Required: Node.js 20.10.0 or later. Download: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Please reinstall Node.js 20.10.0 or later.
    echo.
    pause
    exit /b 1
)

node -e "const net=require('net'); const s=net.createServer(); s.once('error',()=>process.exit(1)); s.once('listening',()=>s.close(()=>process.exit(0))); s.listen(4783)" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Port 4783 is already in use. Please stop the existing service and run this file again.
    echo.
    pause
    exit /b 1
)

if not exist ".env.local" (
    if exist ".env.example" (
        copy ".env.example" ".env.local" >nul
        echo [INFO] Created .env.local from .env.example.
        echo [INFO] You can edit .env.local or use API Settings in the browser.
        echo.
    ) else (
        echo [WARN] .env.example was not found. Skipping env file setup.
        echo.
    )
) else (
    echo [INFO] .env.local found.
)

if not exist "node_modules" (
    echo [INFO] First run: installing dependencies. This may take a few minutes.
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Dependency installation failed. Please check the network and run again.
        echo.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Dependencies found. Skipping installation.
)

echo.
echo [INFO] Starting local server. Keep this window open.
echo [INFO] Browser URL: http://localhost:4783
echo [INFO] If the browser does not open automatically, copy the URL above.
echo.

start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:4783'"
set PORT=4783
call npm run dev

echo.
echo [INFO] Server stopped.
pause
