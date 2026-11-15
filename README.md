# XNTS (Xnotes, vormals Notizraum)

XNTS verbindet PDF-Unterlagen mit eigenen Schreibflächen, Stiftwerkzeugen, einer Fächerbibliothek und virtuellen Laborgeräten. Die Startseite erklärt die App; die Arbeitsfläche läuft unter `app.html`.

## Lokal starten

Voraussetzung: Node.js 22 oder neuer und pnpm.

```powershell
pnpm install
pnpm dev
```

## Offizielle Downloads

Die Produktseite steht unter [XNTS herunterladen](https://seyhmus97.github.io/C-Users-Seyhoo-Documents-Codex-2026-11-09-ma-outputs-notizen-app-/). Dort erkennt die Downloadauswahl Windows x64, Windows ARM64 und Android und führt zum passenden Installationspaket.

Die neueste Version und alle Installer findest du in den [XNTS-Releases](https://github.com/seyhmus97/C-Users-Seyhoo-Documents-Codex-2026-11-09-ma-outputs-notizen-app-/releases/latest). Für ein Surface Pro mit Snapdragon ist der Windows-ARM64-Installer vorgesehen.

Persönliche Notizen und importierte PDFs werden nicht in das GitHub-Projekt hochgeladen; sie bleiben lokal im Speicher der App auf dem jeweiligen Gerät.

## Installierbare Apps bauen

Die Website dient zum Herunterladen. Die Windows- und Android-Builds starten als eigene installierte App-Fenster ohne Browserleiste; die Notizoberfläche läuft in der eingebetteten WebView des Betriebssystems. Das ist keine native Neuentwicklung der Zeichenoberfläche, sondern eine Desktop- und Mobile-App-Hülle um die bestehende React-App.

```powershell
pnpm install
pnpm run desktop:build:solo            # offizielle Windows-App
pnpm run native:sync:android:solo      # Android-Projekt mit offizieller App-Oberfläche synchronisieren
cd android
.\gradlew.bat assembleDebug
```

GitHub Actions baut Windows x64, Windows ARM64 und eine Android-APK. Die iOS-/iPadOS-Projektdateien sind vorbereitet; ein auf iPad installierbarer Build benötigt Xcode auf macOS und Apples Signierung. Für App-Store-Verteilung werden außerdem ein Apple-Developer-Konto und eine App-Store-Veröffentlichung benötigt.

Notizen und importierte PDFs werden lokal im jeweiligen App-Speicher abgelegt. Die zentrale Einstellungsleiste steuert Design, Papier, Werkzeuge und Stiftdruck. Backups enthalten Notizen, PDFs und App-Einstellungen; automatisches Cloud-Backup ist nicht eingerichtet.

PDF-Seiten bleiben im Dokumentfluss und werden im Dunkelmodus nicht invertiert. Zwischen ihnen kannst du Blanko-, Linien-, Karoraster- oder Punktrasterflächen einsetzen. Stiftprofile unterstützen Füller, Kugelschreiber, Bleistift und Textmarker. Die Schnellleiste bietet durchgezogene, gestrichelte, gepunktete Linien und Pfeile. Haltegesten glätten Linien und geometrische Grundformen; Start, Ende und Winkel der gezeichneten Linie bleiben dabei erhalten. Gerade Stiftlinien werden nur dann automatisch verlängert, wenn sie praktisch exakt fluchten (≤ 2,5° Abweichung, ≤ 4 px neben der Achse); ein Hinweis auf der Fläche zeigt das an und „Rückgängig“ nimmt es zurück. Andere Striche behalten ihren Winkel. „Schaltbild glätten“ richtet ausgewählte Leitungen und Grundformen aus, erkennt aber keine elektrischen Bauteile oder Beschriftungen semantisch.

## Funktionen, Schaltbilder und Navigation

- Über **f(x)** oder ein Textfeld mit `f(x) = ...` wird eine Funktion als interaktiver Graph ergänzt. Der Graph lässt sich vergrößern und zeigt beim Antippen den aktuellen x- und Funktionswert. Unterstützt werden unter anderem Grundrechenarten, Klammern, Potenzen, `x`, `pi`, `e`, `sin`, `cos`, `tan`, `sqrt`, `abs`, `exp`, `ln` und `log`. Das ist eine lokale Eingabehilfe; handschriftliche Formeln oder Formeln in PDFs werden noch nicht automatisch gelesen.
- **Schaltbild erkennen & glätten** prüft ausgewählte Vektorstriche, fasst erkannte Leitungen und Grundformen zusammen und richtet klare Geometrie aus. Es liest keine Bauteilwerte oder gedruckten PDF-Bilder aus.
- Wenn eine Auswahl wie ein einfacher RC-Kreis aussieht, erscheint sie nach der Erkennung im Labor als Vorschau. **Als RC-Versuch verwenden** richtet den vorhandenen RC-Tiefpass mit Startwerten ein. Die gezeichneten Werte werden nicht ausgelesen; R und C müssen vor dem Versuch geprüft werden. Andere Schaltungen werden derzeit nur als Skizze angezeigt und nicht allgemein simuliert.
- **Kritzelradierer** ist standardmäßig aktiv. Eine deutliche Zickzackbewegung über gezeichnete Striche oder Textfelder löscht die getroffenen Elemente; Rückgängig stellt sie wieder her. Die Geste lässt sich in den Einstellungen abschalten.
- Fingerbewegungen verschieben die Notiz ab einer sehr kleinen Bewegung von 3 px. Nach dem Abheben des Stifts wartet die Ein-Finger-Navigation nicht mehr auf eine mehrsekündige Handballen-Zone. Auf dem echten Surface muss das Verhalten noch mit Stift und Finger gemeinsam geprüft werden.

Die Seitenliste bleibt eine einfache nummerierte Liste. Die Werkzeugleiste verwendet einen einfarbigen dunklen Ockerton ohne Farbverlauf und zeigt die Stiftprofile mit kompakten SVG-Stiftbildern.

Im Dunkelmodus bleibt die Tinte über PDF-Seiten und dunkle Notizflächen lesbar; die App passt nur die handgezeichnete Tinte an den jeweiligen Papierhintergrund an. PDF- und Bildinhalte werden nicht gefiltert oder invertiert.

## Build und PWA-Icons

```powershell
pnpm run build
pnpm run preview
```

Die PWA-Icons basieren auf `public/icon.svg`. Nach einer Logoänderung führe `pnpm run generate-pwa-assets` und danach erneut den Build aus.

## Linienwinkel ändern

1. Werkzeug **Lasso** wählen und eine Linie **antippen** (oder mit dem Lasso umfahren).
2. An beiden Enden erscheinen violette **Endpunktgriffe** und ein Etikett mit dem aktuellen Winkel.
3. Einen Endpunkt ziehen: Der andere Endpunkt bleibt fest, Winkel und Länge ändern sich frei.
4. Einrasten in 15°-Schritten nur, wenn **„15°-Raster“** eingeschaltet ist oder die Umschalttaste gedrückt wird. Das gilt auch für den Drehgriff ↻ und das Formwerkzeug „Gerade Linie/Pfeil“.
5. Die Änderung ist ein Undo-Schritt, wird automatisch gespeichert und bleibt beim Notizwechsel erhalten. Doppelklick und „Schaltbild glätten“ verändern bereits geglättete Linien nicht mehr.

## Labor (virtuelle Laborgeräte)

In der Werkzeugleiste öffnet **Labor** ein Seitenpanel (mit „Werkbank groß“ auf volle Breite). Die Geräte erscheinen als **bedienbare Frontplatten**: Drehregler ziehen, Mausrad drehen (Umschalt = fein) oder antippen, Tasten drücken, Drehschalter der Multimeter stellen, rote Messleitung in die richtige Buchse stecken, Oszilloskop-Tastkopf per BNC-Buchse anklemmen, Menüs über CH1/CH2/TRIG MENU/MEASURE und die Softkeys neben dem Schirm. Ein Schaltplan zeigt, wo Messgeräte und Tastköpfe angeschlossen sind. Falsche Bedienung wird erklärt (z. B. Leitung in der A-Buchse bei Spannungsmessung, Sicherung im mA-Eingang, Widerstand unter Spannung messen).

**Übungen Schritt für Schritt:** „Ohmsches Gesetz“, „Strombegrenzung (C.V./C.C.)“, „Signal am Oszilloskop“ und „RC-Tiefpass“. Das nächste Bedienelement pulsiert violett, ein Schritt gilt erst als erledigt, wenn das Gerät wirklich richtig eingestellt ist. „Lösung zeigen“ baut den Versuch fertig auf. **In Notiz übernehmen** fügt ein Messprotokoll an der sichtbaren Stelle ein: Textfeld mit Einstellungen, Messwerten und Messunsicherheit, bei Oszilloskop zusätzlich das Oszillogramm als normale Striche (Lasso, Radierer, Rückgängig und PDF-Export funktionieren).

| Gerät | Abgebildet |
| --- | --- |
| GW Instek GPS-3303 | Unabhängig 0–30 V/0–3 A, Serie 60 V, Parallel 6 A, CH3 5 V fest; CV/CC-Umschaltung, 3-stellige Anzeige, Leistungswarnung am Lastwiderstand |
| Toellner TOE 7402/7404 | Sinus, Dreieck, Rechteck, Impuls, DC; 0,5 Hz (7404: 0,05 Hz) bis 5 MHz; 10 mV–30 Vss; Offset ±10 V; 50 Ω Innenwiderstand; Symmetrie 10–90 % (7404); Last offen / 50 Ω / RC-Tiefpass |
| Tektronix TDS1000/2000 | 2 Kanäle, VOLTS/DIV 2 mV–5 V (×10 Tastkopf), SEC/DIV 5 ns–50 s, DC/AC/GND, Bandbreite je Modell, 1×-Tastkopf 6 MHz, 20-MHz-Begrenzung, Flankentrigger, Autoset, Messungen f, Uss, Mittelwert, Zyklus-Effektivwert |
| Agilent U1241A/U1242A | V/A DC und AC (True RMS, 40 Hz–2 kHz), Ω, Kapazität, Frequenz; Bereiche/Genauigkeit nach Handbuchtabellen; Bürdenwiderstand der Strombereiche |
| PeakTech 3340 | 3999 Counts; V/A DC und AC (AC-Spannung nur 50–100 Hz spezifiziert), Ω, Kapazität, Frequenz (Bereiche bis 500 Hz laut Tabelle) |

Grenzen: Es ist eine **Simulation** nach Handbuch-Kenndaten, keine Verbindung zu echten Geräten. Eingangswiderstände der Messgeräte (1 MΩ/10 MΩ) werden vernachlässigt, Bauteile sind ideal, gerechnet wird der eingeschwungene Zustand. Unklare Handbuchstellen sind in `src/labDevices.ts` als „angenommen“ kommentiert. Die Laboreinstellungen liegen lokal unter `xnts-lab-state` (localStorage).

## Stift, Glättung und Schaltbilder

- **Stiftarten:** Kugelschreiber schreibt fast gleichmäßig, Füller reagiert stark auf Druck und Strichrichtung (Breitfeder, 45°) und läuft an den Enden spitz aus, Bleistift ist dünn, körnig und wird mit Druck dunkler. Der Bleistift wird als ein Pfad gezeichnet; die frühere „Perlenkette“ aus überlappenden halbtransparenten Segmenten entfällt.
- **Strichglättung:** Einstellungen → „Stift & Handschrift“. Die Eingabe wird live beruhigt und beim Absetzen nachgeglättet; Start, Ende und Ecken bleiben erhalten. 0 % schaltet die Glättung aus.
- **Halten zum Begradigen:** Strich-Ende 0,65 s ruhig halten. Zittern des Stifts setzt die Haltezeit nicht mehr zurück. Bei einer Linie folgt der Endpunkt danach dem Stift (Winkel und Länge frei, 15°-Raster nur mit Schalter oder Umschalttaste). Leitungen mit Knicken werden als gerader Linienzug erkannt.
- **Schaltbild glätten:** Lasso um das Schaltbild → „Schaltbild glätten“. Leitungen (auch mit Knicken), Rechtecke und Kreise werden begradigt, fast waagerechte/senkrechte Leitungen ausgerichtet, benachbarte Leitungen auf eine Flucht gezogen und Enden an Leitungen, Rechtecke und Kreise angedockt. Handschrift und Bögen bleiben unverändert; Bauteile werden nicht semantisch erkannt.
- **Stift-Hardware:** Die Stiftrückseite (Radierer-Ende, z. B. Surface Pen/Slim Pen 2) radiert immer. Die Seitentaste wählt per Einstellung Lasso, Radierer oder nichts. Das Kontextmenü auf der Schreibfläche ist unterdrückt. Auf echter Hardware noch zu prüfen: Neigung, haptisches Feedback und Bluetooth-Kurzbefehle des Stifts werden nicht ausgewertet.

## Offizieller App-Stand

Die veröffentlichte Web-App und die Installer verwenden denselben Solo-Build. Notizen, PDFs, Bibliothek und virtuelle Laborgeräte sind auf allen unterstützten Plattformen enthalten. Notizen bleiben lokal; zum Übertragen zwischen Geräten dient das Backup.

Interne Speicherkennungen (`notes`/`kv`, `notizraum-*` in `localStorage`, App-IDs) bleiben bewusst unverändert, damit vorhandene Notizen erhalten bleiben.

## Tests
`pnpm test` führt die wiederholbaren Tests für `inkEngine.ts` (Stiftprofile, Druck, Glättung, geschützte Ecken, Linien-/Kurvenerkennung) und `circuitTidy.ts` (Achsenausrichtung, Diagonalen, Andocken, Schrift/Kurven bleiben unverändert) aus. Sie nutzen nur Node.js (`node:test`), keine zusätzlichen Abhängigkeiten.

## Einführung und Stift-Diagnose
- Beim ersten Start zeigt XNTS einen illustrierten Rundgang. Später öffnen Einstellungen › Hilfe oder Bibliothek › ⋯ › Visuelle Anleitungen eine Themenübersicht mit acht kurzen Anleitungen.
- Die Bibliothek hält Suche, „＋ Notiz“ und „＋ Ordner“ direkt erreichbar. Backup, Wiederherstellung, Hilfe und (wenn verfügbar) Installation liegen im Menü „⋯“. Ein neuer, klarer Leerzustand und ein sichtbarer Zielhinweis erleichtern das Anlegen und Verschieben.
- Einstellungen › Stift & Handschrift zeigt eine Vorschau (Stifttyp, Druck, Glättung) und eine lokale Stift-Diagnose (Zeigergerät, Druck, Rückseite, Seitentaste). Es werden keine Eingabedaten gespeichert oder gesendet. Ob Windows Ink Tasten und Druck tatsächlich meldet, muss auf echter Hardware (z. B. Surface Pen) geprüft werden.
- Das Backup enthält zusätzlich `notizraum-ink-smoothing`, `notizraum-pen-barrel`, `notizraum-auto-straighten`, `xnts-study-panel` und `xnts-tutorial-seen`.


