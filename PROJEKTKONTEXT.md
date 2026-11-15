# XNTS – Projektkontext

XNTS steht für Xnotes. Die offizielle Web- und Installationsversion ist derzeit die Solo-Edition: persönliche Notizen, PDF-Bearbeitung und ein virtuelles Labor. Lerngruppen und Gruppenchat sind in dieser öffentlichen Ausgabe und auf der Website nicht freigeschaltet.

## Veröffentlichung

- Produktseite und Web-App: https://seyhmus97.github.io/C-Users-Seyhoo-Documents-Codex-2026-11-09-ma-outputs-notizen-app-/
- Installationsdateien: https://github.com/seyhmus97/C-Users-Seyhoo-Documents-Codex-2026-11-09-ma-outputs-notizen-app-/releases/latest
- Öffentliches Quellprojekt: https://github.com/seyhmus97/C-Users-Seyhoo-Documents-Codex-2026-11-09-ma-outputs-notizen-app-
- Die Website erkennt Windows x64, Windows ARM64 und Android und verlinkt zum neuesten Release. Für Surface-Geräte mit Snapdragon ist Windows ARM64 vorgesehen.
- Die Windows-Pakete und Android-APK werden per GitHub Actions gebaut. Android verwendet derzeit einen Debug-Build; er ist kein Play-Store-Release. iOS/iPadOS benötigt einen Xcode-Build und Apples Signierung.
- Neue Webveröffentlichung: `.github/workflows/pages.yml` baut mit `pnpm run build:solo`. Der native Release-Workflow baut mit `src-tauri/tauri.solo.conf.json` und `pnpm run native:sync:android:solo`.

## Marke und Website

- Der Produktname lautet **XNTS** (Xnotes); die Wortmarke „XNTS“ und der Zusatz „XNOTES · IDEAS · ART“ bleiben bestehen.
- Das bisherige X im gelben Rahmen wurde durch ein eigenes, handgezeichnetes Notizseiten-Signet ersetzt: gelbes Papier, violette Eselsohr-Ecke und gezeichnete Schreibspur.
- Wortmarke, PWA-Symbole und Installationssymbole verwenden dieselbe neue Gestaltung.
- Die Produktseite zeigt eine künstlerische Produktkampagne und realistische Beispiele der Notizoberfläche. Sie beschreibt nur derzeit verfügbare Funktionen und enthält keine Gruppenchat-Werbung.

## Funktionen der öffentlichen Solo-Edition

- Bibliothek für Fächer, Semester, Ordner und Notizen mit Suche, klaren Direktaktionen, besserem Leerzustand und sichtbarem Verschiebeziel.
- PDFs importieren, markieren und mit eigenen Papierflächen ergänzen. Blanko-, Linien-, Karoraster- und Punktraster-Vorlagen bleiben im Dokumentfluss.
- Stiftwerkzeuge: Füller, Kugelschreiber, Bleistift, Textmarker, Lasso, Radierer, Formen und Text; anpassbare Farben, Stärken und Profile.
- Freie Linienwinkel: im Lasso eine Linie antippen und einen Endpunkt ziehen. Das optionale 15°-Raster greift nur bei Aktivierung oder gedrückter Umschalttaste.
- Schaltbilder lassen sich nach einer Lasso-Auswahl oder per Doppelklick prüfen. Die lokale Erkennung richtet Leitungen aus, ergänzt Lötpunkte und zeichnet Dioden, Operationsverstärker (Ausrichtung und Vorzeichen), Kondensatoren, Batterien und Widerstände neu. Bauteilwerte und PDF-Bilder werden nicht gelesen.
- Visueller Rundgang beim ersten Start; acht kurze Anleitungen können jederzeit über Einstellungen › Hilfe oder Bibliothek › ⋯ wieder geöffnet werden.
- Virtuelles Labor mit simulierten Messgeräten, vier geführten Übungen und Messprotokoll-Export in die Notiz. Es steuert keine realen Geräte.
- Kritzelradierer ist standardmäßig aktiv und kann in den Einstellungen abgeschaltet werden. Eine deutliche Zickzackbewegung über getroffene Striche oder Textfelder löscht diese in einem rückgängig machbaren Schritt.
- Der Funktionsknopf `f(x)` und Textfelder mit `f(x) = ...` zeigen lokale interaktive Graphen. Eine markierte Handschrift kann nach kurzer manueller Formeleingabe einen Graphen darunter erhalten; automatische Handschrift- oder PDF-Texterkennung ist nicht enthalten. Unterstützt werden u. a. `x²`, `√x`, `|x|`, `sin x` und `xsin(x)`. Die Integralansicht ermöglicht zieh- oder eingebbare Grenzen, Flächenfärbung, numerische Ergebnisse und optional eine numerische Stammfunktion. Graphen erscheinen noch nicht im PDF-Export.
- Ausgewählte Vektorstriche werden im Labor als Skizzenvorschau angezeigt. Einfach wirkende RC-Schaltungen können in den bestehenden RC-Tiefpass übernommen werden; Bauteilwerte müssen manuell geprüft werden. Es gibt noch keinen allgemeinen Schaltungslöser und keine Erkennung von Bild-/PDF-Schaltplänen.
- Finger-Pan startet nach etwa 3 px Bewegung; die frühere mehrsekündige Wartezone nach dem Schreiben wurde entfernt. Surface-Pen und Finger müssen gemeinsam auf echter Hardware geprüft werden.
- **Ansicht** bündelt Bibliothek, Seitenliste, Fokus, Zoom, Leistenmodus und Rückgängig/Wiederholen. **Funktion** bündelt Form, Text, Labor, f(x), Papierlayout sowie PDF-Import und -Export. Die Werkzeugleiste verwendet den einfarbigen Goldton `#C8952C` ohne Verlauf; A4-Grenzen erscheinen als sanfter Schimmer mit feiner auslaufender Linie. Die vier kompakten, freigestellten Stiftköpfe folgen der klassischen XNTS-Vorlage und zeigen die ausgewählte Strichfarbe an der Spitze. Die Seitenliste ist eine nummerierte Liste.
- Responsive Oberfläche, Hell- und Dunkelmodus, PWA-Installation und Offline-Nutzung.

## Lerngruppen und Infrastruktur

Im Projektcode ist der Gruppen-Prototyp weiterhin vorhanden; der öffentliche Build und die Website schalten ihn ab. Übertragung, gemeinsame Bearbeitung auf mehreren Geräten, Einladungen und verbindliche Rollen brauchen ein Backend mit Echtzeit-Synchronisierung. Gruppenanrufe benötigen zusätzlich Telefonie-Infrastruktur. Diese Funktionen dürfen erst nach eigener Prüfung und Freigabe in die Produktseite und den offiziellen Release aufgenommen werden.

## Speicherung und Datenschutz

- Notizstruktur, Striche, Texte, PDFs und weitere Notizdaten werden lokal in IndexedDB gespeichert; Einstellungen liegen in `localStorage`.
- Webdaten gehören zu Browser und Website-Origin. Installierte Apps verwenden den privaten Speicher ihrer WebView.
- Es gibt kein Konto, kein automatisches Cloud-Backup und keine geräteübergreifende Synchronisierung. Für den Gerätewechsel dient der Backup-Export und -Import.
- Vor Neuinstallation oder Deinstallation sollte ein Backup exportiert werden.

## Lokaler Start und Builds

Voraussetzungen: Node.js 22 oder neuer und pnpm.

```powershell
pnpm install
pnpm dev
pnpm run build:solo
pnpm run desktop:build:solo
pnpm run native:sync:android:solo
```

## Tests und bekannte Grenzen

- `pnpm test` führt 59 Node-Tests für Stiftprofile, Druck, Glättung, Leitungsgeometrie, Schaltsymbole, Formelschreibweisen und numerische Integrale aus.
- TypeScript-Prüfung sowie Produktions-Builds der Solo- und Gruppen-Edition waren erfolgreich. Ein interaktiver Browserlauf konnte in dieser Umgebung nicht geöffnet werden; die Funktionen im Browser und die Eingabe mit Surface Pen bleiben am echten Gerät zu prüfen.
- Die Stift-Diagnose zeigt Zeigergerät und Druck lokal an; Werte werden nicht gesendet. Tasten und Druck auf echter Surface-Pen-Hardware müssen noch am Gerät geprüft werden.
- Für Android ist die APK installierbar, aber nicht signiert als Play-Store-Release. Für iOS fehlen weiterhin Mac-Build und Apple-Signierung.
