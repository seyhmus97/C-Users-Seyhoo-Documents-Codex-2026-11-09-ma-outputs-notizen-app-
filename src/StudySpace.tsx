import { useEffect, useMemo, useState } from "react";
import NoteCanvas, { kvGet, kvSet } from "./NoteCanvas";

type Role = "admin" | "teacher" | "member";
type Member = { id: string; name: string; role: Role; canTransmit: boolean; canEditShared: boolean };
type GroupDoc = { id: string; title: string };
type StudyGroup = {
  id: string;
  name: string;
  inviteCode: string;
  members: Member[];
  docs: GroupDoc[];
  selectedDocId: string;
  liveDocId: string | null;
  transmitting: boolean;
  presenterId: string | null;
};

const SELF_ID = "me";
const uid = () => Math.random().toString(36).slice(2, 9);
const code = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const sharedNoteId = (groupId: string, docId: string) => `study-shared:${groupId}:${docId}`;
const privateNoteId = (groupId: string, docId: string) => `study-private:${groupId}:${SELF_ID}:${docId}`;
const roleName: Record<Role, string> = { admin: "Admin", teacher: "Lehrkraft", member: "Mitglied" };

const demoGroup = (): StudyGroup => ({
  id: "study-demo-math",
  name: "Lerngruppe Mathematik",
  inviteCode: "MATHE7",
  members: [
    { id: SELF_ID, name: "Du", role: "admin", canTransmit: false, canEditShared: false },
    { id: "teacher-1", name: "Frau Hartmann", role: "teacher", canTransmit: true, canEditShared: true },
    { id: "member-1", name: "Leonie Berger", role: "member", canTransmit: true, canEditShared: false },
    { id: "member-2", name: "Amir Yilmaz", role: "member", canTransmit: false, canEditShared: false },
  ],
  docs: [
    { id: "quadratic-functions", title: "Quadratische Funktionen" },
    { id: "exam-prep", title: "Prüfungsvorbereitung" },
  ],
  selectedDocId: "quadratic-functions",
  liveDocId: "quadratic-functions",
  transmitting: true,
  presenterId: "teacher-1",
});

async function seedDemoNote() {
  const key = "note:" + sharedNoteId("study-demo-math", "quadratic-functions");
  if (await kvGet(key)) return;
  const blockId = "study-demo-page";
  await kvSet(key, {
    blocks: [{ id: blockId, kind: "blank", height: 1700, gap: 0 }],
    strokes: [],
    texts: [
      { id: "study-demo-title", blockId, text: "Quadratische Funktionen", x: 62, y: 62, width: 620, height: 64, fontSize: 32, color: "#1f2937" },
      { id: "study-demo-formula", blockId, text: "Scheitelpunktform", x: 66, y: 160, width: 420, height: 46, fontSize: 23, color: "#2563eb" },
      { id: "study-demo-equation", blockId, text: "f(x) = a(x − d)² + e", x: 66, y: 221, width: 580, height: 54, fontSize: 27, color: "#1f2937" },
      { id: "study-demo-example", blockId, text: "Beispiel:  f(x) = 2(x − 3)² − 4\nScheitelpunkt:  S(3 | −4)", x: 66, y: 316, width: 590, height: 106, fontSize: 21, color: "#1f2937" },
    ],
    tpl: "lined",
  });
}

function initialGroup(): StudyGroup {
  const id = uid(), docId = uid();
  return {
    id, name: "Meine Lerngruppe", inviteCode: code(),
    members: [{ id: SELF_ID, name: "Du", role: "admin", canTransmit: true, canEditShared: true }],
    docs: [{ id: docId, title: "Erstes Gruppendokument" }],
    selectedDocId: docId, liveDocId: null, transmitting: false, presenterId: null,
  };
}

export default function StudySpace({ onBack, darkMode, theme, onThemeChange, onBackup, onRestore }: {
  onBack: () => void;
  darkMode: boolean;
  theme: "system" | "light" | "dark";
  onThemeChange: (theme: "system" | "light" | "dark") => void;
  onBackup: () => void;
  onRestore: () => void;
}) {
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"groups" | "room">("groups");
  const [layer, setLayer] = useState<"shared" | "private">("shared");
  const [callOpen, setCallOpen] = useState(false);
  const [privateLoading, setPrivateLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const saved = await kvGet<StudyGroup[]>("study:groups");
      if (Array.isArray(saved) && saved.length) setGroups(saved);
      else setGroups([demoGroup()]);
      await seedDemoNote();
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (ready) void kvSet("study:groups", groups);
  }, [groups, ready]);

  const group = groups.find((g) => g.id === selectedGroupId) ?? null;
  const doc = group?.docs.find((d) => d.id === group.selectedDocId) ?? group?.docs[0] ?? null;
  const self = group?.members.find((m) => m.id === SELF_ID) ?? null;
  const presenter = group?.members.find((m) => m.id === group.presenterId) ?? null;
  const liveDoc = group?.docs.find((d) => d.id === group.liveDocId) ?? null;
  const canManage = self?.role === "admin";
  const privateId = group && doc ? privateNoteId(group.id, doc.id) : "";
  const sharedId = group && doc ? sharedNoteId(group.id, doc.id) : "";
  const editorTitle = doc ? `${group?.name ?? "Gruppe"} · ${doc.title}` : "Gruppennotiz";

  const updateGroup = (id: string, change: (g: StudyGroup) => StudyGroup) => {
    setGroups((all) => all.map((g) => g.id === id ? change(g) : g));
  };
  const updateMember = (groupId: string, memberId: string, change: Partial<Member>) => {
    updateGroup(groupId, (g) => {
      const nextMembers = g.members.map((m) => m.id === memberId ? { ...m, ...change } : m);
      const revokedPresenter = change.canTransmit === false && g.presenterId === memberId;
      return { ...g, members: nextMembers, ...(revokedPresenter ? { transmitting: false, presenterId: null } : {}) };
    });
  };
  const openGroup = (g: StudyGroup) => {
    setSelectedGroupId(g.id);
    setLayer("shared");
    setMode("room");
  };
  const createGroup = () => {
    const name = window.prompt("Name der Lerngruppe", "Neue Lerngruppe")?.trim();
    if (!name) return;
    const g = initialGroup();
    g.name = name;
    setGroups((old) => [...old, g]);
    openGroup(g);
  };
  const addDoc = () => {
    if (!group) return;
    const title = window.prompt("Name der Gruppennotiz", "Neue Gruppennotiz")?.trim();
    if (!title) return;
    const next = { id: uid(), title };
    updateGroup(group.id, (g) => ({ ...g, docs: [...g.docs, next], selectedDocId: next.id }));
    setLayer("shared");
  };
  const returnToPersonalNotes = async () => {
    await kvSet("study:groups", groups);
    onBack();
  };
  const openPrivateCopy = async () => {
    if (!group || !doc) return;
    setPrivateLoading(true);
    setLayer("private");
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const ownKey = "note:" + privateNoteId(group.id, doc.id);
      if (!(await kvGet(ownKey))) {
        const shared = await kvGet("note:" + sharedNoteId(group.id, doc.id));
        if (shared) await kvSet(ownKey, shared);
      }
    } finally {
      setPrivateLoading(false);
    }
  };
  const startTransmission = () => {
    if (!group || !doc || !self?.canTransmit) return;
    updateGroup(group.id, (g) => ({ ...g, transmitting: true, presenterId: SELF_ID, liveDocId: g.selectedDocId }));
  };
  const stopTransmission = () => {
    if (!group || (!canManage && group.presenterId !== SELF_ID)) return;
    updateGroup(group.id, (g) => ({ ...g, transmitting: false, presenterId: null }));
  };

  const callParticipants = useMemo(() => group?.members ?? [], [group]);

  if (!ready) {
    return <div className="h-full w-full grid place-items-center bg-slate-50 text-sm text-slate-500">Lerngruppen werden geladen …</div>;
  }

  return (
    <section className="notiz-study notiz-app h-full min-h-0 w-full flex flex-col bg-slate-50 text-slate-800" data-theme={darkMode ? "dark" : "light"}>
      <header className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={mode === "room" ? () => setMode("groups") : returnToPersonalNotes} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50">
            {mode === "room" ? "← Gruppen" : "← Meine Notizen"}
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{mode === "room" ? group?.name ?? "Lerngruppe" : "Lerngruppen"}</div>
            <div className="text-[11px] text-slate-500">Notizraum · lokaler MVP</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode === "room" && group && (
            <>
              <span className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex ${group.transmitting ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                <span className={`mr-1.5 mt-1 inline-block h-1.5 w-1.5 rounded-full ${group.transmitting ? "bg-emerald-500" : "bg-slate-400"}`} />
                {group.transmitting ? `Live-Demo · ${presenter?.name ?? "Mitglied"}` : "Übertragung pausiert"}
              </span>
              <button onClick={() => setCallOpen(true)} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">Anruf</button>
            </>
          )}
          <button onClick={onBackup} title="Lokales Backup speichern" className="hidden rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 md:inline-flex">Backup</button>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-950">
        <span aria-hidden="true">ⓘ</span>
        <p><strong>Prototyp auf diesem Gerät.</strong> Gruppen, Rollen und Notizen sind lokal gespeichert. Echte Einladungen und Synchronisierung brauchen Backend/Realtime; Gruppenanrufe brauchen Telefonie-Infrastruktur.</p>
      </div>

      {mode === "groups" ? (
        <main className="flex-1 min-h-0 overflow-auto px-4 py-6 sm:px-8 sm:py-9">
          <div className="mx-auto max-w-5xl">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Gemeinsam lernen</p>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Deine Lerngruppen</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Öffne einen Raum, verfolge eine Übertragung und halte private Ergänzungen neben den Gruppennotizen fest.</p>
              </div>
              <button onClick={createGroup} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">＋ Gruppe erstellen</button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {groups.map((g) => {
                const activePresenter = g.members.find((m) => m.id === g.presenterId);
                const sharedDoc = g.docs.find((d) => d.id === g.liveDocId);
                return (
                  <button key={g.id} onClick={() => openGroup(g)} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-xl">👥</div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${g.transmitting ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {g.transmitting ? "● Live-Demo" : "Bereit"}
                      </span>
                    </div>
                    <h2 className="text-lg font-semibold text-slate-900">{g.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">{g.members.length} Mitglieder · {g.docs.length} Gruppennotizen</p>
                    <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                      {g.transmitting && sharedDoc ? <><strong>{activePresenter?.name ?? "Ein Mitglied"}</strong> überträgt „{sharedDoc.title}“</> : "Keine aktive Übertragung"}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm font-semibold text-indigo-700">
                      <span>Raum öffnen</span><span className="transition group-hover:translate-x-1">→</span>
                    </div>
                  </button>
                );
              })}
              <button onClick={createGroup} className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5 text-center text-slate-500 transition hover:border-indigo-300 hover:bg-indigo-50/40">
                <span><span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-white text-xl text-indigo-600 shadow-sm">＋</span><strong className="block text-sm text-slate-700">Eine Lerngruppe anlegen</strong><small className="mt-1 block">Gruppen und Mitglieder werden lokal verwaltet</small></span>
              </button>
            </div>
            <div className="mt-7 grid gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 sm:grid-cols-3">
              <Feature label="Übertragung" detail="Steuerung und Sprecherwahl sind als lokale Demo abgebildet." />
              <Feature label="Private Ergänzungen" detail="Eine persönliche Kopie je Gruppennotiz lässt sich direkt beschriften." />
              <Feature label="Gruppenanruf" detail="Bedienoberfläche vorbereitet; Audio/Video benötigt einen Dienst." />
            </div>
          </div>
        </main>
      ) : group ? (
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          <aside className="flex max-h-[42vh] shrink-0 flex-col overflow-y-auto border-b border-slate-200 bg-white lg:max-h-none lg:w-[292px] lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-100 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Gruppenraum</h2>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{group.inviteCode} · Demo</span>
              </div>
              <p className="text-sm leading-5 text-slate-600">Der Code dient nur zur Vorschau. Einladungen an andere Geräte sind noch nicht verbunden.</p>
            </div>

            <div className="border-b border-slate-100 p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Gruppennotizen</h2>
                {canManage && <button onClick={addDoc} className="rounded-lg px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">＋ Neu</button>}
              </div>
              <div className="space-y-1">
                {group.docs.map((d) => <button key={d.id} disabled={privateLoading} onClick={() => { updateGroup(group.id, (g) => ({ ...g, selectedDocId: d.id })); setLayer("shared"); }} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm disabled:opacity-50 ${d.id === group.selectedDocId ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-700 hover:bg-slate-50"}`}>
                  <span className="text-base">▤</span><span className="min-w-0 flex-1 truncate">{d.title}</span>{d.id === group.liveDocId && group.transmitting && <span title="Wird übertragen" className="h-2 w-2 rounded-full bg-emerald-500" />}
                </button>)}
              </div>
            </div>

            <div className="border-b border-slate-100 p-3">
              <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Mitglieder · {group.members.length}</h2>
              <div className="space-y-1">
                {group.members.map((m) => <div key={m.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${m.id === SELF_ID ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>{m.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
                  <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-slate-800">{m.name}{m.id === SELF_ID ? " (du)" : ""}</div><div className="text-[10px] text-slate-500">{roleName[m.role]}{m.id === group.presenterId && group.transmitting ? " · überträgt" : ""}</div></div>
                  {m.canEditShared && <span title="Darf gemeinsam bearbeiten" className="text-[10px] text-indigo-600">✎</span>}
                </div>)}
              </div>
            </div>

            <details className="group/access border-b border-slate-100 p-3" open={canManage}>
              <summary className="cursor-pointer list-none px-1 py-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Berechtigungen {canManage ? "⌄" : "· Admin"}</summary>
              {canManage ? <div className="mt-2 space-y-3">
                <p className="px-1 text-[11px] leading-4 text-slate-500">Lege fest, wer in dieser Gruppe übertragen oder die gemeinsame Notiz bearbeiten darf.</p>
                {group.members.map((m) => <div key={m.id} className="rounded-xl bg-slate-50 p-2.5">
                  <div className="mb-1.5 truncate text-xs font-semibold">{m.name}{m.id === SELF_ID ? " (du)" : ""}</div>
                  <label className="mb-1 flex items-center gap-2 text-[11px] text-slate-600">Rolle
                    {m.id === SELF_ID ? <span className="font-semibold text-indigo-700">{roleName[m.role]} · Besitzer</span> : <select value={m.role} onChange={(e) => updateMember(group.id, m.id, { role: e.target.value as Role })} className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px]">
                      <option value="member">Mitglied</option><option value="teacher">Lehrkraft</option><option value="admin">Admin</option>
                    </select>}
                  </label>
                  <label className="flex items-center gap-2 py-1 text-[11px] text-slate-600"><input type="checkbox" checked={m.canTransmit} onChange={(e) => updateMember(group.id, m.id, { canTransmit: e.target.checked })} /> Darf übertragen</label>
                  <label className="flex items-center gap-2 py-1 text-[11px] text-slate-600"><input type="checkbox" checked={m.canEditShared} onChange={(e) => updateMember(group.id, m.id, { canEditShared: e.target.checked })} /> Darf gemeinsam bearbeiten</label>
                </div>)}
                <p className="px-1 text-[10px] leading-4 text-amber-800">Die Auswahl wird hier lokal gespeichert. Ein Server muss diese Rechte später für alle Mitglieder verbindlich durchsetzen.</p>
              </div> : <p className="mt-2 px-1 text-[11px] text-slate-500">Nur Gruppenadmins können Rechte verwalten. Die Prüfung über mehrere Geräte benötigt ein Backend.</p>}
            </details>

            <div className="mt-auto p-3">
              <button onClick={() => setCallOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm font-semibold text-indigo-800 hover:bg-indigo-100">☎ Gruppenanruf öffnen <span className="text-[10px] font-medium">Vorschau</span></button>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-800">{doc?.title ?? "Gruppennotiz"}</div><div className="text-[11px] text-slate-500">{layer === "shared" ? "Gemeinsame Notiz" : "Deine private Notiz zu diesem Dokument"}</div></div>
                <div className="ml-auto flex shrink-0 rounded-xl bg-slate-100 p-1">
                  <button onClick={() => setLayer("shared")} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${layer === "shared" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`}>Gemeinsam</button>
                  <button onClick={() => void openPrivateCopy()} disabled={privateLoading} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:opacity-60 ${layer === "private" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`}>{privateLoading ? "Kopiere …" : "Meine privat"}</button>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {group.transmitting ? <>
                  {liveDoc && <span className="hidden max-w-44 truncate text-[11px] text-emerald-700 sm:inline">Live: {presenter?.name ?? "Mitglied"} · {liveDoc.title}</span>}
                  {liveDoc && liveDoc.id !== doc?.id && <button onClick={() => { updateGroup(group.id, (g) => ({ ...g, selectedDocId: g.liveDocId ?? g.selectedDocId })); setLayer("shared"); }} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Zum Live-Inhalt</button>}
                  {(canManage || group.presenterId === SELF_ID) && <button onClick={stopTransmission} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Stoppen</button>}
                </> : <button onClick={startTransmission} disabled={!self?.canTransmit || !doc} title={self?.canTransmit ? "Aktuelle Gruppennotiz übertragen" : "Ein Admin muss dir das Übertragungsrecht geben"} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300">Übertragung starten</button>}
              </div>
            </div>

            {layer === "private" && <div className="flex shrink-0 items-center gap-2 border-b border-violet-100 bg-violet-50 px-3 py-2 text-[11px] leading-4 text-violet-900 sm:px-4">
              <span aria-hidden="true">🔒</span><span>Deine private Kopie des Gruppendokuments. Zeichne und schreibe direkt darauf; andere Mitglieder sehen deine Ergänzungen nicht. Neue Inhalte anderer Geräte brauchen Realtime-Synchronisierung.</span>
            </div>}
            {layer === "shared" && !self?.canEditShared && <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600 sm:px-4"><span>👁</span><span>Du kannst die Gruppennotiz ansehen. Bitte einen Admin um das gemeinsame Schreibrecht; private Notizen bleiben bearbeitbar.</span></div>}

            <div className="relative flex-1 min-h-0 min-w-0">
              {privateLoading ? <div className="grid h-full place-items-center text-sm text-slate-500">Private Kopie wird gespeichert und vorbereitet …</div> : doc && group && layer === "shared" ? <div className="h-full min-h-0 min-w-0" inert={!self?.canEditShared} aria-disabled={!self?.canEditShared}>
                <NoteCanvas key={sharedId} noteId={sharedId} title={editorTitle} darkMode={darkMode} theme={theme} onThemeChange={onThemeChange} onBackup={onBackup} onRestore={onRestore} />
              </div> : doc && group ? <NoteCanvas key={privateId} noteId={privateId} title={`Privat · ${doc.title}`} darkMode={darkMode} theme={theme} onThemeChange={onThemeChange} onBackup={onBackup} onRestore={onRestore} /> : <div className="grid h-full place-items-center text-sm text-slate-500">Lege eine Gruppennotiz an, um loszulegen.</div>}
            </div>
          </main>
        </div>
      ) : <div className="grid flex-1 place-items-center text-sm text-slate-500">Wähle eine Gruppe aus oder erstelle eine neue.</div>}

      {callOpen && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setCallOpen(false); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="study-call-title" className="w-full max-w-md rounded-3xl border border-white/50 bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div><div className="mb-2 grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 text-xl">☎</div><h2 id="study-call-title" className="text-xl font-semibold">Gruppenanruf</h2><p className="mt-1 text-sm text-slate-500">{group?.name ?? "Lerngruppe"} · {callParticipants.length} Mitglieder</p></div>
            <button onClick={() => setCallOpen(false)} aria-label="Schließen" className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-100">×</button>
          </div>
          <div className="mb-4 space-y-2 rounded-2xl bg-slate-50 p-3">
            {callParticipants.map((m) => <div key={m.id} className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-slate-300" /><span className="flex-1">{m.name}{m.id === SELF_ID ? " (du)" : ""}</span><span className="text-xs text-slate-400">{roleName[m.role]}</span></div>)}
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><strong>Telefonie noch nicht verbunden.</strong> Diese Vorschau startet weder Mikrofon noch Kamera. Für echte Gruppenanrufe fehlen Signalisierung, Medienserver und Berechtigungsdialoge.</div>
          <div className="mt-5 flex justify-end"><button onClick={() => setCallOpen(false)} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Schließen</button></div>
        </div>
      </div>}
    </section>
  );
}

function Feature({ label, detail }: { label: string; detail: string }) {
  return <div className="rounded-xl bg-white/75 p-3"><div className="mb-1 text-xs font-bold text-slate-800">{label}</div><p className="text-[11px] leading-4 text-slate-600">{detail}</p></div>;
}
