# Notizraum

Notizraum verbindet PDF-Unterlagen mit eigenen Schreibflächen, Stiftwerkzeugen und einer Fächerbibliothek. Die Startseite erklärt die App; die Arbeitsfläche läuft unter `app.html`.

## Lokal starten

Voraussetzung: Node.js 22 oder neuer und pnpm.

```powershell
pnpm install
pnpm dev
```

## GitHub Pages veröffentlichen

Das Repository enthält bereits einen GitHub-Actions-Workflow. Er baut die App und veröffentlicht sie bei jedem Push auf `main`.

1. Lege auf GitHub ein Repository für Notizraum an und lade den vollständigen Projektordner hoch. Der Workflow und die Quelldateien müssen mit hochgeladen werden; nur `dist/` reicht nicht.
2. Öffne im Repository **Settings → Pages** und setze **Source** auf **GitHub Actions**.
3. Warte auf den erfolgreichen Lauf unter **Actions**. Die Seite wird unter `https://<konto>.github.io/<repository>/` veröffentlicht. Wenn das Repository `<konto>.github.io` heißt, liegt sie direkt unter `https://<konto>.github.io/`.

GitHub Pages ist auf einem kostenlosen GitHub-Konto für öffentliche Repositories verfügbar. Die Website selbst ist öffentlich erreichbar. Prüfe vor dem Hochladen, dass keine privaten Dateien im Repository liegen. Die Notizen und importierten PDFs der App werden lokal im Browser gespeichert und nicht mit dem Repository veröffentlicht.

Der Build setzt den richtigen URL-Unterpfad automatisch anhand des Repository-Namens, damit App, PWA-Manifest, Icons und Offline-Service-Worker auch auf einem GitHub-Pages-Projektlink funktionieren.

## Alternative: Netlify, Cloudflare Pages oder Vercel (ohne GitHub)

```powershell
pnpm install
pnpm run build
```

Lade danach den Ordner `dist` auf Netlify (Drag & Drop unter app.netlify.com/drop) oder Cloudflare Pages hoch. Dort muss `VITE_BASE_PATH` nicht gesetzt werden, weil die Seite direkt unter dem Hauptpfad `/` liegt. Der Ordner `dist` im Projekt kann veraltet sein – baue immer vorher neu.

Wichtig: Die App funktioniert (Service Worker, Installation, Offline) nur über HTTPS. Alle genannten Anbieter liefern HTTPS automatisch.

## App installieren und speichern

Öffne die veröffentlichte Seite online, starte die App einmal und installiere sie über das Browsermenü. Android: **App installieren**. iPad: in Safari **Teilen → Zum Home-Bildschirm**. Nach dem ersten Laden kann die App-Oberfläche offline starten.

Notizen und importierte PDFs liegen im IndexedDB-Speicher des jeweiligen Browsers. Backups lassen sich in der App manuell exportieren und wieder importieren. Automatisches Cloud-Backup ist nicht eingerichtet.

PDF-Seiten bleiben im Dokumentfluss. Zwischen ihnen kannst du Blanko-, Linien-, Karoraster- oder Punktrasterflächen einsetzen. Stiftprofile unterstützen Füller, Kugelschreiber, Bleistift und Textmarker. Linien können durchgezogen, gestrichelt oder gepunktet sein und Pfeile tragen. Haltegesten glätten Linien und geometrische Grundformen. „Schaltbild glätten“ richtet ausgewählte Formen und Verbindungen aus, erkennt aber keine elektrischen Bauteile oder Beschriftungen semantisch.

Ein globaler Dunkelmodus für die gesamte App-Oberfläche ist in dieser Version noch nicht enthalten. Importierte PDF-Seiten werden beim Anzeigen nicht invertiert.

## Build und PWA-Icons

```powershell
pnpm run build
pnpm run preview
```

Die PWA-Icons basieren auf `public/icon.svg`. Nach einer Logoänderung führe `pnpm run generate-pwa-assets` und danach erneut den Build aus.
