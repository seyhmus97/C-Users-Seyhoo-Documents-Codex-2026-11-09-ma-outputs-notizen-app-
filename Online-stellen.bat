@echo off
cd /d "%~dp0"
echo ===== Notizraum auf GitHub hochladen =====
where git >/dev/null 2>nul
if errorlevel 1 (
  echo Git ist nicht installiert. Bitte installieren: https://git-scm.com/download/win
  echo Danach diese Datei noch einmal doppelklicken.
  start https://git-scm.com/download/win
  pause
  exit /b 1
)
if not exist .git git init
git config user.email >/dev/null 2>/dev/null || git config user.email "seyhmus97@outlook.com"
git config user.name >/dev/null 2>/dev/null || git config user.name "seyhmus97"
git add .
git commit -m "Notizraum"
git branch -M main
git remote remove origin >/dev/null 2>nul
git remote add origin https://github.com/seyhmus97/C-Users-Seyhoo-Documents-Codex-2026-11-09-ma-outputs-notizen-app-.git
echo.
echo Gleich oeffnet sich evtl. ein Fenster zur GitHub-Anmeldung. Bitte anmelden.
git push -u origin main --force
echo.
echo ===== Fertig. Wenn oben kein Fehler steht, ist alles hochgeladen. =====
pause
