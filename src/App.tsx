// App.tsx – Bibliothek mit beliebig tiefen Ordnern; jede Notiz ist eine eigene unendliche Leinwand
import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import NoteCanvas, { kvAll, kvDel, kvGet, kvReplaceAll, kvSet, rasterKey } from "./NoteCanvas";
import { saveFile } from "./saveFile";
import StudySpace from "./StudySpace";

const toB64 = (b: ArrayBuffer) => { let s = ""; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;

type N = { id: string; parentId: string | null; type: "folder" | "note"; name: string; open?: boolean; color?: string; icon?: string };
type Theme = "system" | "light" | "dark";
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const uid = () => Math.random().toString(36).slice(2, 10);
const FOLDER_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#475569"];
const FOLDER_ICONS = ["📁", "📚", "🎓", "⚡", "📐", "🧪", "💻", "🔬", "🧠", "🗂️"];

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
  const [q, setQ] = useState("");
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
    const preferenceKeys = ["notizraum-theme", "notizraum-pen-profiles", "notizraum-custom-colors", "notizraum-pressure-sensitivity", "notizraum-smart-shapes", "notizraum-circuit-assist", "notizraum-toolbar-collapsed"];
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
        const allowed = new Set(["notizraum-theme", "notizraum-pen-profiles", "notizraum-custom-colors", "notizraum-pressure-sensitivity", "notizraum-smart-shapes", "notizraum-circuit-assist", "notizraum-toolbar-collapsed"]);
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
          {canDrop && <Btn on={() => moveTo(n.id)}>Hierher</Btn>}
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

  const hits = q.trim() ? nodes.filter((n) => n.name.toLowerCase().includes(q.trim().toLowerCase())) : null;

  return (
    <div className="notiz-app h-screen flex bg-slate-100 text-slate-800" data-theme={darkMode ? "dark" : "light"}>
      {lib && <button className="notiz-library-backdrop" aria-label="Bibliothek schließen" onClick={() => setLib(false)} />}
      {lib && (
        <aside className="notiz-library w-72 shrink-0 flex flex-col bg-white border-r border-slate-200">
          <div className="notiz-library-brand flex items-center justify-between px-3 pt-3 pb-1">
            <img src={import.meta.env.BASE_URL + "notizraum-logo.svg"} alt="Notizraum" className="h-9 w-auto" />
            <button className="notiz-library-close" onClick={() => setLib(false)} aria-label="Bibliothek schließen">✕</button>
          </div>
          <div className="p-2 space-y-2 border-b border-slate-200">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen (Semester, Fach, Thema)…" className="w-full px-3 py-2 rounded-lg bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
            <div className="flex gap-1">
              <Btn on={() => add(null, "folder")}>+ Semester / Ordner</Btn>
              <Btn on={() => add(null, "note")}>+ Notiz</Btn>
            </div>
            <div className="flex gap-1">
              <Btn on={backup}>Backup speichern</Btn>
              <Btn on={() => restoreInput.current?.click()}>Backup laden</Btn>
            </div>
            <button onClick={() => setStudySpace(true)} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-left text-sm font-semibold text-white hover:bg-indigo-700">👥 Lerngruppen · MVP</button>
            {installPrompt && <button onClick={installApp} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Notizraum installieren</button>}
            {moving && (
              <div className="p-2 rounded-lg bg-blue-50 text-xs text-blue-900 space-y-1.5">
                <div>„{byId(moving)?.name}“ verschieben nach …</div>
                <div className="flex gap-1"><Btn on={() => moveTo(null)}>Oberste Ebene</Btn><Btn on={() => setMoving(null)}>Abbrechen</Btn></div>
              </div>
            )}
          </div>
          <nav className="flex-1 overflow-auto p-2 space-y-0.5">
            {hits ? (hits.length ? hits.map((n) => row(n, 0, true)) : <p className="text-sm text-slate-500 p-2">Nichts gefunden.</p>)
              : nodes.length ? nodes.filter((n) => !n.parentId).map((n) => row(n, 0))
              : <p className="text-sm text-slate-500 p-2">Lege oben dein erstes Semester an.</p>}
          </nav>
        </aside>
      )}
      <main className="flex-1 min-w-0 flex h-screen">
        {studySpace ? (
          <StudySpace onBack={() => setStudySpace(false)} darkMode={darkMode} theme={theme} onThemeChange={setTheme} onBackup={backup} onRestore={() => restoreInput.current?.click()} />
        ) : active && byId(active) ? (
          <NoteCanvas key={active} noteId={active} title={pathOf(active)} onLibrary={() => setLib(!lib)} darkMode={darkMode} theme={theme} onThemeChange={setTheme} onBackup={backup} onRestore={() => restoreInput.current?.click()} />
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
            {needRefresh ? "Eine neue Version von Notizraum ist bereit." : "Notizraum ist jetzt offline verfügbar."}
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
