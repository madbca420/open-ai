@echo off
title JARVIS AI Assistant - Code Sanctum OS Launcher
color 0A
cls
echo =======================================================================
echo   JARVIS AI DESKTOP ASSISTANT // CODE SANCTUM OS LAUNCHER
echo =======================================================================
echo.

cd /d "%~dp0"

echo [1/3] Checking system environment...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    pause
    exit /b 1
)

echo [2/3] Cleaning up stale dev server instances...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo [3/3] Booting JARVIS AI Desktop Assistant...
echo.
call npm run dev

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo =======================================================================
    echo  [JARVIS LAUNCHER] Application session closed with code %ERRORLEVEL%.
    echo =======================================================================
)

pause
