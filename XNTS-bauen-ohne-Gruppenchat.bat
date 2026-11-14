@echo off
rem XNTS Solo (ohne Lerngruppen und Gruppenchat) als Windows-Installer bauen (braucht Node.js, pnpm und Rust)
cd /d "%~dp0"
call pnpm install
call pnpm run desktop:build:solo
echo.
echo Installer liegen unter src-tauri\target\release\bundle
pause
