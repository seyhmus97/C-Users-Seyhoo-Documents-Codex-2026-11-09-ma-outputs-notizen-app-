@echo off
rem XNTS zum Testen im Browser starten (Solo-Edition). Fenster offen lassen – Schliessen beendet die Test-App.
cd /d "%~dp0"
echo ===== XNTS wird gestartet ... =====
echo Die App oeffnet sich gleich im Browser: http://localhost:5173/app.html
echo Zum Beenden dieses Fenster schliessen.
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:5173/app.html"
where node >nul 2>nul || (echo Node.js fehlt - bitte von https://nodejs.org installieren ^(LTS^). & start https://nodejs.org & pause & exit /b 1)
set "PNPM=pnpm"
where pnpm >nul 2>nul || set "PNPM=npx -y pnpm@10"
if not exist node_modules call %PNPM% install
call %PNPM% dev --mode solo --port 5173
pause
