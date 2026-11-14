// App.tsx – Bibliothek mit beliebig tiefen Ordnern; jede Notiz ist eine eigene unendliche Leinwand
import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import NoteCanvas, { kvAll, kvDel, kvGet, kvReplaceAll, kvSet, rasterKey } from "./NoteCanvas";
import { saveFile } from "./saveFile";
import StudySpace from "./StudySpace";
import Tutorial, { openTutorial } from "./Tutorial";
import { GROUPS_ENABLED } from "./features";

const toB64 = (b: ArrayBuffer) => { let s = ""; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;

type N = { id: string; parentId: string | null; type: "folder" | "note"; name: string; open?: boolean; color?: string; icon?: string };
type Theme = "system" | "light" | "dark";
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const uid = () => Math.random().toString(36).slice(2, 10);
const FOLDER_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#475569"];
const FOLDER_ICONS = ["📁", "📚", "🎓", "⚡", "📐", "🧪", "💻", "🔬", "🧠", "🗂️"];
// Bibliotheksbreite (Desktop): per Griff am rechten Rand frei verschiebbar, wird lokal gemerkt
const LIB_MIN = 200, LIB_MAX = 560, LIB_DEFAULT = 288, LIB_CLOSE = 150;
const readLibWidth = () => { try { const v = Number(localStorage.getItem("xnts-library-width")); return Number.isFinite(v) && v >= LIB_MIN && v <= LIB_MAX ? v : LIB_DEFAULT; } catch { return LIB_DEFAULT; } };

export default function App() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  const [nodes, setNodes] = useState<N[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [studySpace, setStudySpace] = useState(false);
  const [lib, setLib] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [libWidth, setLibWidth] = useState(readLibWidth);
  const [libDragging, setLibDragging] = useState(false);
  // Fokusmodus der Notiz: Bibliothek mit ausblenden und beim Beenden wieder so herstellen, wie sie war
  const libBeforeFocus = useRef<boolean | null>(null);
  const libRef = useRef(lib); libRef.current = lib;
  const onNoteFocus = useRef((on: boolean) => {
    if (on) { if (libBeforeFocus.current === null) libBeforeFocus.current = libRef.current; setLib(false); }
    else if (libBeforeFocus.current !== null) { setLib(libBeforeFocus.current); libBeforeFocus.current = null; }
  }).current;
  useEffect(() => { try { localStorage.setItem("xnts-library-width", String(Math.round(libWidth))); } catch { /* gilt dann nur für diese Sitzung */ } }, [libWidth]);
  /** Griff zwischen Bibliothek und Notiz: ziehen = Breite ändern, ganz nach links = Bibliothek einklappen, Doppelklick = Standardbreite */
  const startLibResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget, x0 = e.clientX, w0 = libWidth;
    try { el.setPointerCapture(e.pointerId); } catch { /* Fenster-Listener reichen auch ohne Capture */ }
    setLibDragging(true);
    let latest = w0;
    const move = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; latest = w0 + ev.clientX - x0; setLibWidth(Math.min(LIB_MAX, Math.max(LIB_MIN, latest))); };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      setLibDragging(false);
      if (latest < LIB_CLOSE) { setLibWidth(w0 < LIB_MIN + 20 ? LIB_DEFAULT : w0); setLib(false); } // weit nach links gezogen → einklappen (Breite bleibt gemerkt)
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };
  const [q, setQ] = useState("");
  const [libraryMenu, setLibraryMenu] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("notizraum-theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch { return "system"; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const darkMode = theme === "dark" || (theme === "system" && systemDark);
  const ready = useRef(false);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    try { localStorage.setItem("notizraum-theme", theme); } catch { /* app theme still works for this session */ }
  }, [theme, darkMode]);

  useEffect(() => {
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onInstall); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  /* Laden (beim ersten Start: Semester 1 › Fach 1 › Thema 1; alte Einzelnotiz wird übernommen) */
  useEffect(() => {
    (async () => {
      const t = await kvGet<{ nodes: N[]; active: string | null }>("tree");
      if (t) { setNodes(t.nodes); setActive(t.active); }
      else {
        const a = uid(), b = uid(), c = uid();
        setNodes([
          { id: a, parentId: null, type: "folder", name: "Semester 1", open: true },
          { id: b, parentId: a, type: "folder", name: "Fach 1", open: true },
          { id: c, parentId: b, type: "note", name: "Thema 1" },
        ]);
        const old = await kvGet("state");
        if (old) await kvSet("note:" + c, old);
        setActive(c);
      }
      ready.current = true;
    })();
  }, []);
  useEffect(() => { if (ready.current) kvSet("tree", { nodes, active }); }, [nodes, active]);

  /* Helfer */
  const byId = (id: string) => nodes.find((n) => n.id === id);
  const depthOf = (n: N) => { let d = 0, p = n.parentId; while (p) { d++; p = byId(p)!.parentId; } return d; };
  const pathOf = (id: string) => { const a: string[] = []; let n = byId(id); while (n) { a.unshift(n.name); n = n.parentId ? byId(n.parentId) : undefined; } return a.join(" › "); };
  const patch = (id: string, p: Partial<N>) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...p } : n)));
  const desc = (id: string): string[] => nodes.filter((n) => n.parentId === id).flatMap((c) => [c.id, ...desc(c.id)]);
  const reveal = (id: string) => { const up = new Set<string>(); let n = byId(id)?.parentId; while (n) { up.add(n); n = byId(n)?.parentId ?? null; } setNodes((ns) => ns.map((x) => (up.has(x.id) ? { ...x, open: true } : x))); };

  const add = (parentId: string | null, type: "folder" | "note") => {
    const id = uid(), d = parentId ? depthOf(byId(parentId)!) + 1 : 0;
    const name = type === "note" ? "Neues Thema" : d === 0 ? "Neues Semester" : d === 1 ? "Neues Fach" : "Neuer Ordner";
    setNodes((ns) => [...ns.map((n) => (n.id === parentId ? { ...n, open: true } : n)), { id, parentId, type, name, ...(type === "folder" ? { color: FOLDER_COLORS[d % FOLDER_COLORS.length], icon: d === 0 ? "🎓" : "📚" } : {}) }]);
    setEdit(id); setMenu(null);
    if (type === "note") setActive(id);
  };
  const remove = (id: string) => {
    const ids = [id, ...desc(id)];
    if (!confirm(`„${byId(id)!.name}“ ${ids.length > 1 ? `und ${ids.length - 1} enthaltene Einträge ` : ""}endgültig löschen?`)) return;
    // Müllabfuhr: Notiz-Inhalt UND zugehörige PDFs löschen (verzögert, damit ein letztes Auto-Speichern der geschlossenen Notiz nicht zurückschreibt)
    const notes = ids.filter((i) => byId(i)?.type === "note");
    setTimeout(() => notes.forEach(async (i) => {
      const d = await kvGet<{ blocks?: { docId?: string; pageNum?: number }[] }>("note:" + i);
      new Set(d?.blocks?.map((b) => b.docId).filter(Boolean)).forEach((x) => kvDel("pdf:" + x));
      d?.blocks?.forEach((b) => { if (b.docId && b.pageNum) kvDel(rasterKey(b.docId, b.pageNum)); }); // Rasterbilder der Seiten
      kvDel("note:" + i);
    }), 400);
    const rest = nodes.filter((n) => !ids.includes(n.id));
    setNodes(rest); setMenu(null);
    if (active && ids.includes(active)) setActive(rest.find((n) => n.type === "note")?.id ?? null);
  };
  const moveTo = (to: string | null) => {
    if (!moving || to === moving || (to && desc(moving).includes(to))) return;
    patch(moving, { parentId: to });
    if (to) patch(to, { open: true });
    setMoving(null);
  };
  const commit = (id: string, v: string) => { if (v.trim()) patch(id, { name: v.trim() }); setEdit(null); };
  const open = (n: N) => {
    if (n.type === "folder") patch(n.id, { open: !n.open });
    else {
      setActive(n.id);
      if (window.matchMedia("(max-width: 1279px)").matches) setLib(false);
    }
  };

  const backup = async () => {
    // Rasterbilder (pgimg:) sind abgeleitet und werden nicht gesichert; PDF-Originale können Blob oder ArrayBuffer sein
    const entries = await Promise.all((await kvAll()).filter(([k]) => !k.startsWith("pgimg:") && k !== "app:preferences").map(async ([k, v]) => [
      k, v instanceof Blob ? { __ab: toB64(await v.arrayBuffer()), type: v.type } : v instanceof ArrayBuffer ? { __ab: toB64(v) } : v,
    ]));
    const preferenceKeys = ["notizraum-theme", "notizraum-pen-profiles", "notizraum-custom-colors", "notizraum-pressure-sensitivity", "notizraum-smart-shapes", "notizraum-circuit-assist", "notizraum-toolbar-collapsed", "notizraum-angle-snap", "notizraum-ink-smoothing", "notizraum-pen-barrel", "notizraum-auto-straighten", "xnts-study-panel", "xnts-tutorial-seen", "xnts-library-width", "xnts-handedness", "xnts-one-finger-scroll", "xnts-page-markers", "xnts-study-toolbar-collapsed", "xnts-study-chat"];
    entries.push(["app:preferences", Object.fromEntries(preferenceKeys.map((k) => [k, localStorage.getItem(k)]))]);
    await saveFile(new Blob([JSON.stringify({ app: "notizen", version: 1, entries })], { type: "application/json" }), `notizen-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };
  const restore = async (f: File) => {
    try {
      const d = JSON.parse(await f.text());
      if (d?.app !== "notizen" || !Array.isArray(d.entries) || !d.entries.every((e: unknown) => Array.isArray(e) && typeof e[0] === "string")) throw new Error();
      if (!d.entries.some((e: [string]) => e[0] === "tree")) throw new Error();
      if (!confirm("Alle Notizen auf diesem Gerät werden durch das Backup ersetzt. Fortfahren?")) return;
      const entries: [string, unknown][] = d.entries.map(([k, v]: [string, unknown]): [string, unknown] => [k, v && typeof v === "object" && "__ab" in v ? (() => { const o = v as { __ab: string; type?: string }, ab = fromB64(o.__ab); return o.type ? new Blob([ab], { type: o.type }) : ab; })() : v]);
      const preferences = entries.find(([k]) => k === "app:preferences")?.[1];
      if (preferences && typeof preferences === "object") {
        const allowed = new Set(["notizraum-theme", "notizraum-pen-profiles", "notizraum-custom-colors", "notizraum-pressure-sensitivity", "notizraum-smart-shapes", "notizraum-circuit-assist", "notizraum-toolbar-collapsed", "notizraum-angle-snap", "notizraum-ink-smoothing", "notizraum-pen-barrel", "notizraum-auto-straighten", "xnts-study-panel", "xnts-tutorial-seen", "xnts-library-width", "xnts-handedness", "xnts-one-finger-scroll", "xnts-page-markers", "xnts-study-toolbar-collapsed", "xnts-study-chat"]);
        for (const [key, value] of Object.entries(preferences)) if (allowed.has(key)) {
          if (typeof value === "string") localStorage.setItem(key, value); else localStorage.removeItem(key);
        }
      }
      (window as unknown as { restoring: boolean }).restoring = true; ready.current = false;
      await kvReplaceAll(entries.filter(([k]) => k !== "app:preferences"));
      location.reload();
    } catch { alert("Diese Datei ist kein gültiges Notizen-Backup."); }
  };

  const Btn = ({ on, children }: { on: () => void; children: React.ReactNode }) => (
    <button onClick={on} className="px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs hover:bg-slate-100">{children}</button>
  );

  const row = (n: N, depth: number, flat = false): React.ReactNode => {
    const isAct = active === n.id, canDrop = moving && n.type === "folder" && n.id !== moving && !desc(moving).includes(n.id);
    return (
      <div key={n.id}>
        <div className={`flex items-center rounded-lg pr-1 ${isAct ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`} style={{ paddingLeft: flat ? 8 : 6 + depth * 14 }}>
          {edit === n.id ? (
            <input autoFocus defaultValue={n.name} className="flex-1 min-w-0 my-1 px-2 py-1 rounded bg-white text-slate-900 text-sm outline-none ring-2 ring-blue-400"
              onFocus={(e) => e.target.select()} onBlur={(e) => commit(n.id, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          ) : (
            <button className="flex-1 min-w-0 text-left py-2 text-sm" onClick={() => { if (flat) { reveal(n.id); setQ(""); } open(n); }}>
              <span className="opacity-60">{n.type === "folder" ? (n.open && !flat ? "▾ " : "▸ ") : "▪ "}</span>
              {n.type === "folder" && <span className="mr-1" aria-hidden="true">{n.icon ?? "📁"}</span>}
              {n.type === "folder" && <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ backgroundColor: n.color ?? FOLDER_COLORS[0] }} />}
              <span className="truncate">{n.name}</span>
              {flat && <div className="text-xs opacity-60 truncate pl-4">{pathOf(n.id)}</div>}
            </button>
          )}
          {canDrop && <button className="notiz-library-drop" onClick={() => moveTo(n.id)}>In Ordner</button>}
          {edit !== n.id && !moving && <button aria-label="Aktionen" className="px-2 py-1 rounded opacity-70 hover:opacity-100" onClick={() => setMenu(menu === n.id ? null : n.id)}>⋯</button>}
        </div>
        {menu === n.id && (
          <div className="flex flex-wrap gap-1 py-1.5" style={{ paddingLeft: flat ? 8 : 10 + depth * 14 }}>
            {n.type === "folder" && <Btn on={() => add(n.id, "folder")}>Neuer Ordner</Btn>}
            {n.type === "folder" && <Btn on={() => add(n.id, "note")}>Neue Notiz</Btn>}
            {n.type === "folder" && (
              <div className="w-full flex items-center gap-1.5 py-1" aria-label="Fachfarbe und Fachsymbol">
                {FOLDER_COLORS.map((c) => <button key={c} title={`Farbe ${c}`} aria-label={`Farbe ${c}`} onClick={() => patch(n.id, { color: c })}
                  className={`w-5 h-5 rounded-full border border-slate-300 ${n.color === c ? "ring-2 ring-offset-1 ring-slate-800" : ""}`} style={{ backgroundColor: c }} />)}
                <select aria-label="Fach-Icon" value={n.icon ?? "📁"} onChange={(e) => patch(n.id, { icon: e.target.value })} className="ml-1 rounded border border-slate-200 bg-white px-1 py-0.5 text-base">
                  {FOLDER_ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
                </select>
              </div>
            )}
            <Btn on={() => { setEdit(n.id); setMenu(null); }}>Umbenennen</Btn>
            <Btn on={() => { setMoving(n.id); setMenu(null); }}>Verschieben</Btn>
            <Btn on={() => remove(n.id)}>Löschen</Btn>
          </div>
        )}
        {!flat && n.type === "folder" && n.open && nodes.filter((c) => c.parentId === n.id).map((c) => row(c, depth + 1))}
      </div>
    );
  };

  // Im Lernraum gehört die Breite der Gruppennotiz: die persönliche Bibliothek bleibt dort ausgeblendet
  const showLib = lib && !(GROUPS_ENABLED && studySpace);
  const hits = q.trim() ? nodes.filter((n) => n.name.toLowerCase().includes(q.trim().toLowerCase())) : null;

  return (
    <div className="notiz-app h-screen flex bg-slate-100 text-slate-800" data-theme={darkMode ? "dark" : "light"}>
      {showLib && <button className="notiz-library-backdrop" aria-label="Bibliothek schließen" onClick={() => setLib(false)} />}
      {showLib && (
        <aside className={`notiz-library shrink-0 flex flex-col bg-white border-r border-slate-200${libDragging ? " is-resizing" : ""}`} style={{ width: libWidth }}>
          <div className="notiz-library-resizer" role="separator" aria-orientation="vertical" aria-label="Bibliotheksbreite ändern" aria-valuemin={LIB_MIN} aria-valuemax={LIB_MAX} aria-valuenow={Math.round(libWidth)} tabIndex={0}
            title="Ziehen = Breite ändern · ganz nach links = einklappen · Doppelklick = Standardbreite"
            onPointerDown={startLibResize} onDoubleClick={() => setLibWidth(LIB_DEFAULT)}
            onKeyDown={(e) => { if (e.key === "ArrowLeft") setLibWidth((w) => Math.max(LIB_MIN, w - 16)); else if (e.key === "ArrowRight") setLibWidth((w) => Math.min(LIB_MAX, w + 16)); }}>
            <span aria-hidden="true">‹‖›</span>
          </div>
          <div className="notiz-library-brand flex items-center justify-between px-3 pt-3 pb-1">
            <img src={import.meta.env.BASE_URL + "notizraum-logo.svg"} alt="XNTS" className="h-9 w-auto" />
            <button className="notiz-library-close" onClick={() => setLib(false)} aria-label="Bibliothek schließen">✕</button>
          </div>
          <div className="notiz-library-tools p-2 border-b border-slate-200">
            <label className="notiz-library-search"><span aria-hidden="true">⌕</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bibliothek durchsuchen" aria-label="Bibliothek durchsuchen" />{q && <button aria-label="Suche leeren" onClick={() => setQ("")}>×</button>}</label>
            <div className="notiz-library-primary-actions">
              <button className="notiz-library-add notiz-library-add--primary" onClick={() => add(null, "note")}>＋ <span>Notiz</span></button>
              <button className="notiz-library-add" onClick={() => add(null, "folder")}>＋ <span>Ordner</span></button>
            </div>
            {GROUPS_ENABLED && <button onClick={() => setStudySpace(true)} className="notiz-library-groups"><span>👥 Lerngruppen &amp; Chat</span><small>Prototyp</small><b aria-hidden="true">›</b></button>}
            <div className="notiz-library-more-wrap">
              <button className="notiz-library-more" aria-haspopup="menu" aria-expanded={libraryMenu} onClick={() => setLibraryMenu((v) => !v)}>⋯ <span>Mehr</span></button>
              {libraryMenu && <div className="notiz-library-more-menu" role="menu" onKeyDown={(e) => { if (e.key === "Escape") setLibraryMenu(false); }}>
                <button role="menuitem" onClick={() => { setLibraryMenu(false); backup(); }}>Backup speichern</button>
                <button role="menuitem" onClick={() => { setLibraryMenu(false); restoreInput.current?.click(); }}>Backup laden</button>
                <button role="menuitem" onClick={() => { setLibraryMenu(false); openTutorial("overview"); }}>Hilfe · Visuelle Anleitungen</button>
                {installPrompt && <button role="menuitem" onClick={() => { setLibraryMenu(false); installApp(); }}>XNTS installieren</button>}
              </div>}
            </div>
            {moving && (
              <div className="notiz-library-move-notice" role="status">
                <strong>Eintrag verschieben</strong>
                <span>„{byId(moving)?.name}“ · Zielordner in der Liste wählen</span>
                <span className="notiz-library-move-path">Aktuell: {pathOf(moving)}</span>
                <div><button onClick={() => moveTo(null)}>An oberste Ebene</button><button onClick={() => setMoving(null)}>Abbrechen</button></div>
              </div>
            )}
          </div>
          <nav className="flex-1 overflow-auto p-2 space-y-0.5">
            {hits ? (hits.length ? hits.map((n) => row(n, 0, true)) : <div className="notiz-library-empty notiz-library-empty--search"><span aria-hidden="true">⌕</span><strong>Keine Treffer</strong><p>Versuche einen anderen Suchbegriff.</p><button onClick={() => setQ("")}>Suche leeren</button></div>)
              : nodes.length ? nodes.filter((n) => !n.parentId).map((n) => row(n, 0))
              : <div className="notiz-library-empty"><div className="notiz-library-empty-art" aria-hidden="true"><span>✳</span><i>✎</i></div><strong>Dein Notizraum beginnt hier</strong><p>Erstelle eine Notiz für deine Ideen oder einen Ordner, um Themen zu sammeln.</p><button className="notiz-library-empty-primary" onClick={() => add(null, "note")}>＋ Erste Notiz</button><button onClick={() => add(null, "folder")}>Ordner anlegen</button></div>}
          </nav>
          <div className="xnts-sidebar-art" aria-hidden="true">
            <img src={import.meta.env.BASE_URL + "xnts-art-collage.webp"} alt="" />
            <span>IDEAS · STUDY · ART</span>
          </div>
        </aside>
      )}
      <Tutorial />
      <main className="flex-1 min-w-0 flex h-screen">
        {GROUPS_ENABLED && studySpace ? (
          <StudySpace onBack={() => setStudySpace(false)} darkMode={darkMode} theme={theme} onThemeChange={setTheme} onBackup={backup} onRestore={() => restoreInput.current?.click()} />
        ) : active && byId(active) ? (
          <NoteCanvas key={active} noteId={active} title={pathOf(active)} onLibrary={() => setLib(!lib)} onFocusChange={onNoteFocus} darkMode={darkMode} theme={theme} onThemeChange={setTheme} onBackup={backup} onRestore={() => restoreInput.current?.click()} />
        ) : (
          <div className="m-auto text-center text-slate-500 space-y-3">
            <p>Wähle ein Thema oder lege eine Notiz an.</p>
            {!lib && <Btn on={() => setLib(true)}>Bibliothek öffnen</Btn>}
          </div>
        )}
      </main>
      <input ref={restoreInput} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ""; }} />
      {(offlineReady || needRefresh) && (
        <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <p className="text-sm text-slate-800">
            {needRefresh ? "Eine neue Version von XNTS ist bereit." : "XNTS ist jetzt offline verfügbar."}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            {needRefresh && <button onClick={() => updateServiceWorker(true)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">Jetzt aktualisieren</button>}
            <button onClick={() => { setOfflineReady(false); setNeedRefresh(false); }} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Schließen</button>
          </div>
        </div>
      )}
    </div>
  );
}
