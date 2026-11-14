// XNTS: visuelle Einführung beim ersten Start und Themenübersicht zum späteren Nachschlagen.
import { useEffect, useRef, useState } from "react";
import { GROUPS_ENABLED } from "./features";
import TutorialArt, { type TutorialArtKey } from "./TutorialArt";

const SEEN_KEY = "xnts-tutorial-seen";
export const OPEN_TUTORIAL_EVENT = "xnts-open-tutorial";
type TutorialMode = "overview" | "walkthrough";
export const openTutorial = (mode: TutorialMode = "overview") => window.dispatchEvent(new CustomEvent(OPEN_TUTORIAL_EVENT, { detail: { mode } }));

type Step = { key: TutorialArtKey; title: string; body: string[]; tag?: { cls: string; text: string }; groups?: boolean };
const ALL_STEPS: Step[] = [
  { key: "welcome", title: "Willkommen bei XNTS", body: [GROUPS_ENABLED ? "XNTS verbindet persönliche Notizen, PDFs, Unterricht und Lerngruppen." : "XNTS verbindet persönliche Notizen, PDFs und Unterricht auf einer ruhigen Schreibfläche.", "Deine Inhalte bleiben auf diesem Gerät. Die Notizfläche ist groß, die Bibliothek hilft dir beim Ordnen."], tag: { cls: "local", text: "lokal gespeichert" } },
  { key: "library", title: "Bibliothek ordnen", body: ["Lege Ordner und Notizen an. Ordner können aufgeklappt, eingefärbt und mit einem Symbol versehen werden.", "Über die Suche findest du Themen und Ordner schnell wieder. Mit ⋯ kannst du Einträge umbenennen, verschieben oder löschen.", "Backup, Installation und weitere Hilfe findest du im Menü ⋯ oben in der Bibliothek."] },
  { key: "writing", title: "Schreiben & Stifte", body: ["Wähle in der Werkzeugleiste Kugelschreiber, Füller, Bleistift oder Marker. Druck und Glättung stellst du unter Einstellungen › Stift & Handschrift ein.", "Mit einem Surface Pen radiert die Rückseite. Die Seitentaste lässt sich in den Einstellungen belegen."] },
  { key: "lines", title: "Linien & Formen", body: ["Strichende ruhig halten: Linien und einfache Formen werden sauber geglättet.", "Den Winkel einer fertigen Linie änderst du mit dem Lasso: Linie antippen, einen violetten Endpunkt ziehen. Das 15°-Raster ist optional; Strg+Z macht Änderungen rückgängig."] },
  { key: "circuits", title: "Schaltbilder", body: ["Markiere eine Schaltung mit dem Lasso und wähle „Schaltbild glätten“. Eindeutige Leitungen werden begradigt und Enden können an Formen andocken.", "Handschrift, Kurven und von Hand eingestellte Winkel bleiben erhalten. Virtuelle Laborgeräte findest du in der Werkzeugleiste."] },
  { key: "groups", title: "Lerngruppen, Chat & Anrufe", groups: true, body: ["Im Lernraum siehst du Gruppennotizen, Rollen, Rechte, Übertragung, Chat und Anrufe als Prototyp. Inhalte und Nachrichten bleiben derzeit auf diesem Gerät.", "Echte Synchronisierung, Live-Übertragung, verbindliche Rechte und Anrufe benötigen noch Backend-, Echtzeit- und Telefonie-Dienste."], tag: { cls: "prototype", text: "Prototyp · Backend/Realtime erforderlich" } },
  { key: "focus", title: "Mehr Platz für die Notiz", body: ["„Leiste −“ zeigt die Werkzeugleiste in einer Zeile. Seitliches Wischen bringt weitere Werkzeuge ins Bild.", "„Fokus“ blendet Leisten und Bibliothek aus. Mit „✕ Leisten“ oder Esc kehrst du zur normalen Ansicht zurück.", "Die Bibliothek lässt sich am Griff ‹‖› schmaler ziehen oder einklappen."] },
  { key: "gestures", title: "Hand auflegen & Gesten", body: ["Finger zeichnen nicht: Mit einem Finger scrollst du, mit zwei Fingern verschiebst und zoomst du.", "Unter Einstellungen › Handballen & Finger stellst du deine Schreibhand ein oder schaltest Scrollen mit einem Finger ab."] },
  { key: "backup", title: "Sichern & wiederherstellen", body: ["Ein Backup enthält Notizen, PDFs und Einstellungen. Du kannst es unter Einstellungen › Speicherung & Export oder im Bibliotheksmenü erstellen.", "Beim Wiederherstellen ersetzt das Backup die lokalen Inhalte auf diesem Gerät. Die Anleitung findest du jederzeit in Einstellungen › Hilfe."] },
];
const STEPS = ALL_STEPS.filter((step) => GROUPS_ENABLED || !step.groups);

export default function Tutorial() {
  const firstRun = (() => { try { return !localStorage.getItem(SEEN_KEY); } catch { return false; } })();
  const [open, setOpen] = useState(firstRun);
  const [mode, setMode] = useState<TutorialMode>(firstRun ? "walkthrough" : "overview");
  const [isOnboarding, setIsOnboarding] = useState(firstRun);
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (event: Event) => {
      const requested = (event as CustomEvent<{ mode?: TutorialMode }>).detail?.mode;
      setIsOnboarding(false);
      setMode(requested === "walkthrough" ? "walkthrough" : "overview");
      setI(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_TUTORIAL_EVENT, h);
    return () => window.removeEventListener(OPEN_TUTORIAL_EVENT, h);
  }, []);
  useEffect(() => { if (open) ref.current?.focus(); }, [open, i, mode]);
  const close = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* Einführung erscheint beim nächsten Start erneut. */ } setOpen(false); };
  if (!open) return null;
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <div className="xnts-tutorial" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      <div ref={ref} tabIndex={-1} className={`xnts-tutorial__card${mode === "overview" ? " xnts-tutorial__card--overview" : ""}`} role="dialog" aria-modal="true" aria-labelledby="xnts-tut-title">
        {mode === "overview" ? <>
          <div className="xnts-tutorial__topline"><span className="xnts-tutorial__step">XNTS · HILFE</span><button className="xnts-tutorial__close" aria-label="Hilfe schließen" onClick={close}>×</button></div>
          <h2 id="xnts-tut-title">Was möchtest du anschauen?</h2>
          <p className="xnts-tutorial__intro">Wähle ein Thema für eine kurze, illustrierte Anleitung.</p>
          <div className="xnts-tutorial__topics">
            {STEPS.map((step, index) => <button key={step.key} className="xnts-tutorial__topic" onClick={() => { setI(index); setMode("walkthrough"); }}>
              <span className="xnts-tutorial__topic-art"><TutorialArt kind={step.key} compact /></span>
              <span>{step.title}</span><b aria-hidden="true">›</b>
            </button>)}
          </div>
          <div className="xnts-tutorial__actions"><button onClick={close}>Schließen</button><button className="primary" onClick={() => { setI(0); setMode("walkthrough"); }}>Rundgang starten</button></div>
        </> : <>
          <div className="xnts-tutorial__topline"><span className="xnts-tutorial__step">Schritt {i + 1} von {STEPS.length}</span><button className="xnts-tutorial__close" aria-label="Hilfe schließen" onClick={close}>×</button></div>
          <TutorialArt kind={s.key} />
          <h2 id="xnts-tut-title">{s.title}</h2>
          {s.tag && <span className={`xnts-status xnts-status--${s.tag.cls}`}>{s.tag.text}</span>}
          {s.body.map((text) => <p key={text}>{text}</p>)}
          <div className="xnts-tutorial__dots" aria-hidden="true">{STEPS.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>
          <div className="xnts-tutorial__actions">
            <button onClick={isOnboarding ? close : () => setMode("overview")}>{isOnboarding ? (last ? "Schließen" : "Überspringen") : "Alle Themen"}</button>
            {i > 0 && <button onClick={() => setI(i - 1)}>Zurück</button>}
            {!last && <button className="primary" onClick={() => setI(i + 1)}>Weiter</button>}
            {last && <button className="primary" onClick={close}>Fertig</button>}
          </div>
        </>}
      </div>
    </div>
  );
}
