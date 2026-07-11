@echo off
title OneTracker - dev server
cd /d "%~dp0"

rem If it's already running, just open the browser
netstat -ano | findstr :5173 | findstr LISTENING >nul
if %errorlevel%==0 (
    echo OneTracker e' gia' in esecuzione, apro il browser...
    start "" http://localhost:5173
    timeout /t 2 >nul
    exit
)

rem Open the browser after a short delay, then start the server
start "" cmd /c "timeout /t 3 >nul & start http://localhost:5173"
echo Avvio OneTracker su http://localhost:5173
echo (chiudi questa finestra o usa STOP-OneTracker.bat per fermarla)
npm run dev
