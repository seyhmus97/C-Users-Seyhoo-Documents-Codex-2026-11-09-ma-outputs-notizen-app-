@echo off
rem XNTS 1.0.19 Solo veroeffentlichen: pruefen, bauen, nur die geaenderten Dateien hochladen.
rem Kein --force, keine Gruppenchat-Edition; Update-Ordner und MINT-Test-App bleiben lokal.
cd /d "%~dp0"
set DATEIEN=src/NoteCanvas.tsx src/App.tsx src/style.css src/pdfRaster.worker.ts src/PageSelectDialog.tsx src/officeConvert.ts src/zipReader.ts src/pageRange.ts src/imageImport.ts tests/importFormats.test.ts tests/fixtures/beispiel.docx PROJEKTKONTEXT.md package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json android/app/build.gradle .github/workflows/native-builds.yml XNTS-veroeffentlichen.bat XNTS-testen.bat
echo ===== XNTS 1.0.19 Solo veroeffentlichen =====
echo.
where git >nul 2>nul || (echo Git fehlt - bitte von https://git-scm.com/download/win installieren. & start https://git-scm.com/download/win & goto fehler)
where node >nul 2>nul || (echo Node.js fehlt - bitte von https://nodejs.org installieren ^(LTS^), dann neu starten. & start https://nodejs.org & goto fehler)
rem pnpm: vorhandenes pnpm nutzen, sonst ueber npx (wird automatisch geladen, nichts dauerhaft installiert)
set "PNPM=pnpm"
where pnpm >nul 2>nul || set "PNPM=npx -y pnpm@10"
echo pnpm-Aufruf: %PNPM%
echo.
echo [1/6] Neue Workflow-Datei einsetzen ...
if exist native-builds.neu.yml (copy /y native-builds.neu.yml .github\workflows\native-builds.yml >nul || goto fehler)
echo [2/6] Pakete installieren ...
call %PNPM% install || goto fehler
echo [3/6] Tests ...
call %PNPM% test || goto fehler
echo [4/6] Solo-Fassung bauen (TypeScript + Vite) ...
call %PNPM% run build:solo || goto fehler
echo [5/6] Online-Stand holen, versehentlich hochgeladene Datei entfernen, Commit erstellen ...
git pull --ff-only origin main || goto fehler
set "WEG="
if exist .github\native-builds.yml (git rm -q .github/native-builds.yml && set "WEG=.github/native-builds.yml")
git add -- %DATEIEN% || goto fehler
git commit -m "Release XNTS 1.0.19 solo updates" -- %DATEIEN% %WEG% || goto fehler
echo [6/6] Hochladen (evtl. GitHub-Anmeldung) ...
git push origin main || goto fehler
if exist native-builds.neu.yml del native-builds.neu.yml
echo.
echo ===== Hochgeladen. GitHub baut jetzt Website, Windows-Installer und Android-APK (ca. 10-25 Minuten). =====
echo Das Release erscheint als "XNTS v1.0.19".
start https://github.com/seyhmus97/C-Users-Seyhoo-Documents-Codex-2026-11-09-ma-outputs-notizen-app-/actions
pause
exit /b 0
:fehler
echo.
echo ===== ABGEBROCHEN. Bis Schritt 5 wurde nichts hochgeladen. Bitte den Text oben an Claude schicken. =====
pause
exit /b 1
