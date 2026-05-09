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
    echo Please install Node.js 20 or later: https://nodejs.org/
    echo Then run this file again.
    echo.
    pause
    exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js version is too old.
    echo Current version:
    node -v
    echo Required: Node.js 20 or later. Download: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Please reinstall Node.js 20 or later.
    echo.
    pause
    exit /b 1
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
echo [INFO] Browser URL: http://localhost:3000
echo [INFO] If the browser does not open automatically, copy the URL above.
echo.

start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:3000'"
call npm run dev

echo.
echo [INFO] Server stopped.
pause
