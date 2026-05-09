@echo off
setlocal

cd /d "%~dp0"
title GPT Image Playground Customer Package

echo.
echo ========================================
echo GPT Image Playground Customer Package
echo ========================================
echo.

where powershell >nul 2>nul
if errorlevel 1 (
    echo [ERROR] PowerShell was not found. Cannot create the zip package.
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package-customer.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to create customer package.
    echo.
    pause
    exit /b 1
)

echo.
echo [DONE] Customer package created.
echo.
pause
