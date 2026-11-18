# XNTS – Projektkontext

XNTS steht für Xnotes. Die offizielle Web- und Installationsversion ist derzeit die Solo-Edition: persönliche Notizen, PDF-Bearbeitung und ein virtuelles Labor. Lerngruppen und Gruppenchat sind in dieser öffentlichen Ausgabe und auf der Website nicht freigeschaltet.

## Arbeitsweise bei Änderungen (verbindlich)

- Jede Änderung an Bedienung, Gestaltung oder Funktionen wird zuerst als **interaktive Vorlage** (anklickbarer Entwurf) erstellt und mit dem Projektinhaber abgestimmt.
- Erst nach ausdrücklicher Erlaubnis wird die Änderung in der App umgesetzt. Kommentare zur Vorlage werden in der Vorlage selbst eingearbeitet.
- Aktuelle Vorlage der Werkzeugleiste: Artefakt „XNTS Werkzeugleiste – Vorlage“ (Zeichenflächen: normale Leiste, Fokusmodus, Zuordnung).
- Ausnahme: reine Fehlerbehebungen ohne sichtbare Bedienänderung (z. B. Darstellungsfehler) dürfen direkt erfolgen und werden danach gemeldet.

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
- Virtuelles Labor mit simulierten Messgeräten und vier geführten Übungen. „In Notiz übernehmen“ fügt nur die Grafik (Oszillogramm) ohne Protokolltext unter vorhandenen Notizen ein. Es steuert keine realen Geräte.
- Kritzelradierer ist standardmäßig aktiv und kann in den Einstellungen abgeschaltet werden. Eine deutliche Zickzackbewegung über getroffene Striche oder Textfelder löscht diese in einem rückgängig machbaren Schritt.
- Der Funktionsknopf `f(x)` und Textfelder mit `f(x) = ...` zeigen lokale interaktive Graphen. Eine markierte Handschrift kann nach kurzer manueller Formeleingabe einen Graphen darunter erhalten; automatische Handschrift- oder PDF-Texterkennung ist nicht enthalten. Unterstützt werden u. a. `x²`, `√x`, `|x|`, `sin x` und `xsin(x)`. Die Integralansicht ermöglicht zieh- oder eingebbare Grenzen, Flächenfärbung, numerische Ergebnisse und optional eine numerische Stammfunktion. Graphen erscheinen noch nicht im PDF-Export.
- Ausgewählte Vektorstriche werden im Labor als Skizzenvorschau angezeigt. Einfach wirkende RC-Schaltungen können in den bestehenden RC-Tiefpass übernommen werden; Bauteilwerte müssen manuell geprüft werden. Es gibt noch keinen allgemeinen Schaltungslöser und keine Erkennung von Bild-/PDF-Schaltplänen.
- Finger-Pan startet nach etwa 3 px Bewegung; die frühere mehrsekündige Wartezone nach dem Schreiben wurde entfernt. Surface-Pen und Finger müssen gemeinsam auf echter Hardware geprüft werden.
- Die Werkzeugleiste ist einzeilig: links Bibliothek und **Ansicht**, **mittig** Werkzeuge, **Rückgängig/Wiederholen** (immer sichtbar), **Mehr** (⋯-Symbol) und **Fokusmodus** (Symbol), rechts Titel/Speicherstatus und ⚙ Einstellungen. **Ansicht** (Seitenliste, Leistengröße, Zoom) und **Mehr** (Papiervorlage, PDF-Import/-Export, abgesetzt darunter „PDF-Seiten löschen …“) öffnen sich wie die Stift-Leiste als helle, schwebende Karte mittig unter der Werkzeugleiste (gleiche Knöpfe und Trennstriche) und schieben die Notizfläche nicht nach unten. „PDF-Seiten löschen“ steht nicht mehr neben den Einstellungen; während des Löschmodus erscheint in der Leiste nur „Löschmodus beenden“. Die Werkzeugleiste verwendet den einfarbigen Goldton `#C8952C` ohne Verlauf. Die vier kompakten, freigestellten Stiftköpfe folgen der klassischen XNTS-Vorlage und zeigen die ausgewählte Strichfarbe an der Spitze.
- **Platz einfügen:** Zwischen PDF-Seiten liegt kein Papier mehr. Ein Blatt entsteht erst, wenn Platz eingefügt wird – genau in dieser Größe, sofort beschreibbar. „Platz einfügen“ ist kein eigener Knopf mehr, sondern eine Funktion: Zwischen zwei PDF-Seiten wird nur am Griff ⇕ rechts gezogen (Stift, Maus, Finger; nach unten = mehr, nach oben = weniger, Doppelklick = leeren Platz entfernen). Auf Seiten ohne PDF, unter der letzten PDF-Seite und am Notizende („＋ Mehr Platz“) fügt ＋ in Schritten von 200 px ein. Feste Leerseiten gibt es nicht mehr. Notizen im Platz werden dabei nie unter die nächste Seite geschoben.
- **Trennlinien:** Bibliothek und Seitenliste lassen sich an der ganzen Trennlinie in der Breite ziehen (kein sichtbarer Griff; die Linie leuchtet beim Überfahren violett). Die Greifzone liegt über der Zeichenfläche, Ziehen malt nie. Breite der Seitenliste 132–380 px, gespeichert.
- **Seitenliste:** PDF-Seiten heißen „Seite 51“ wie im PDF (PDF-Seitenbeschriftung, sonst Seitennummer in der Datei); eingefügte Blätter zählen nicht mit. Eingefügter Platz erscheint als Unterpunkt „↳ Notizplatz“ unter seiner PDF-Seite. ＋ steht nur dort, wo keine PDF-Seite folgt, und fügt Platz in Schritten von 200 px ein (bewusst keine festen A4-Seiten, weil PDF-Seiten oft kleiner sind); zwischen PDF-Seiten wird am Griff ⇕ gezogen. ✕ entfernt leeren Platz. Die aktuelle Seite ist hervorgehoben; nur dort erscheinen „nach oben“ und „nach unten“. In Notizen mit PDF entfallen die zusätzlichen A4-Markierungen „Seite N“, damit es nur eine Seitenzählung gibt.
- **Bibliothek:** Aktionen eines Ordners oder einer Notiz öffnen sich als Kontextmenü direkt am Eintrag (⋯, Rechtsklick oder Gedrückthalten). Die Kopfzeile nennt Name, Art und Ort des Eintrags; der Eintrag bleibt markiert, solange das Menü offen ist.
- Pinch-Zoom: Während der Geste skaliert die Grafikkarte die Notiz (kein React-Neuaufbau pro Bild), die Tinte wird im selben Bild mitgezeichnet; der Punkt zwischen den Fingern bleibt fest. Beim Loslassen wird der Zoom in einem Schritt übernommen. Zoomen beginnt ab 4 % Abstandsänderung; wachsende Fingerkontakte während des Zoomens gelten nicht als Handballen. Strg+Mausrad/Touchpad wird auf ein Update pro Bild gebündelt.
- Farbfenster: Papierkorb (oder Rechtsklick/Gedrückthalten auf eine Farbe) schaltet den Löschmodus mit × ein; eigene Farben werden gelöscht, Grundfarben ausgeblendet und sind wiederherstellbar.
- Radierer: Beim Ändern der Größe erscheint sofort ein Vorschau-Kreis in echter Größe in der Bildmitte.
- Textmarker: eigene Ebene unter der Handschrift mit Mischmodus – `multiply` auf hellem Papier/PDF (38 %), `screen` auf dunklem Notizpapier im Dunkelmodus (40 %). Schrift, PDF-Text und Textfelder darunter bleiben scharf; überlappende Markerstriche dunkeln nicht auf. PDF-Export ebenso (multiply). Der Stift-Knopf der Werkzeugleiste zeigt bei aktivem Textmarker dessen Symbol.
- **Importieren** (Mehr › Importieren ⌄): „Dokument / PDF importieren“ (PDF, .docx, .pptx, .txt, .md), „Bild aus Galerie einfügen“ (JPG, PNG, WebP, HEIC) und „Foto aufnehmen“ (Kamera). Vor dem Einfügen erscheint die Seitenauswahl: Alle Seiten (Standard), Seitenbereich (z. B. `10-25, 30`) oder einzelne Seiten per Vorschau; dazu die Einfügeposition (Ende, aktuelle Seite, Anfang, nach einer bestimmten Seite). Stimmen die ersten Seiten per Text mit einem schon importierten PDF überein (fortgeschriebenes Skript), sind nur die neuen Seiten vorausgewählt. Nur die gewählten Seiten bekommen Rasterbilder; das Original-PDF wird wie bisher vollständig gespeichert.
- Word/PowerPoint/Text/Markdown werden lokal in ein PDF mit festen Seiten umgewandelt (Systemschriften, Unicode) und danach wie jedes PDF behandelt. Vereinfachte Darstellung: keine eingebetteten Schriften, SmartArt/Diagramme nur als Hinweisrahmen, EMF/WMF-Grafiken entfallen. .doc/.ppt (alt) werden nicht unterstützt. HEIC nur in Browsern mit Decoder (Safari).
- Bilder: als Objekt auf der aktuellen Seite (mit dem Lasso antippen → verschieben, Ecke = proportional skalieren, ✕/Entf = entfernen, Rückgängig möglich) oder als eigene, seitenbreite Seite. Gespeichert in der Notiz als `images` (Block-relativ wie Striche), Bilddaten einmal je Bild unter `img:<id>` in IndexedDB (im Backup enthalten, beim Löschen der Notiz entfernt). Große Fotos werden auf 2400 px Kantenlänge verkleinert.
- **Export** (Als PDF exportieren): dieselbe Seitenauswahl (alle, Bereich, einzelne A4-Seiten mit Vorschau); Exportformat und -logik unverändert, Bilder werden mit exportiert.
- Seitenliste: kein Browser-Kontextmenü; Notizblätter lassen sich per Rechtsklick, Gedrückthalten oder ⋯ löschen (mit Rückfrage, Rückgängig möglich).
- f(x)-Graphen haben ein ✕ (auch Esc); danach bleibt „📈 Graph zeigen“ zum Wiederöffnen.
- A4-Grenzen erscheinen in Notizen ohne PDF als sanfter Schimmer mit feiner auslaufender Linie. Die Seitenliste ist eine Liste der Seiten.
- Responsive Oberfläche, Hell- und Dunkelmodus, PWA-Installation und Offline-Nutzung.

## MINT-/Physiklabor (Testversion, getrennt von der App)

- `src/physik/` enthält den Rechenkern fürs HHN-Physikpraktikum: Rundung und Konsistenz nach Musterbericht, Geräte-Toleranzen (Kontron 4121, Keithley 130A, Benning MM 5-2, MA 2H, ALMEMO 3290-8, EKM 265, Sartorius CPA6202P), Statistik, gewichteter Mittelwert, Fehlerfortpflanzung, gewichtete Ausgleichsrechnung (Fehler wie gnuplot), Gnuplot-Skripte und Versuchs-Rechner X1, M2, O1, S1, S2, W3, A1, E1. Die XNTS-App lädt diese Dateien noch nicht.
- `MINT-Labor-Test/index.html` ist eine eigenständige Test-App mit dem geplanten zweistufigen MINT-Menü (Mathematik, Physik, Elektrotechnik) und verschiebbaren Fenstern. Sie wird nicht mitgebaut und nicht veröffentlicht.
- `tests/physik.test.ts` rechnet Musterbericht, FR-Beispiele und X1-Folien nach (`pnpm test`: 75 Tests).
- Offen: Freigabe der Test-App, danach Übernahme in die App; 3D-Modelle brauchen Three.js.

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

- `pnpm test` führt 82 Node-Tests (inkl. `tests/importFormats.test.ts`: Seitenbereich, Duplikat-Erkennung, Dateitypen, ZIP-Leser, Markdown) für Stiftprofile, Kritzelradierer, Druck, Glättung, Leitungsgeometrie, Schaltsymbole, Formelschreibweisen, numerische Integrale und den Physik-Rechenkern aus.
- TypeScript-Prüfung sowie Produktions-Builds der Solo- und Gruppen-Edition waren erfolgreich. Ein interaktiver Browserlauf konnte in dieser Umgebung nicht geöffnet werden; die Funktionen im Browser und die Eingabe mit Surface Pen bleiben am echten Gerät zu prüfen.
- Die Stift-Diagnose zeigt Zeigergerät und Druck lokal an; Werte werden nicht gesendet. Tasten und Druck auf echter Surface-Pen-Hardware müssen noch am Gerät geprüft werden.
- Für Android ist die APK installierbar, aber nicht signiert als Play-Store-Release. Für iOS fehlen weiterhin Mac-Build und Apple-Signierung.
