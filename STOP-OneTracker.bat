@echo off
title OneTracker - stop
echo Fermo OneTracker (porta 5173)...

set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do (
    set FOUND=1
    taskkill /f /pid %%a >nul 2>&1
)

if %FOUND%==1 (
    echo Server fermato.
) else (
    echo OneTracker non era in esecuzione.
)
timeout /t 2 >nul
