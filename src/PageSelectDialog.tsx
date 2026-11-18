// PageSelectDialog.tsx – gemeinsamer Dialog für selektiven Import und Export:
// „Alle Seiten“, „Seitenbereich“ (z. B. 10–25, 30) oder „Einzelne Seiten“ über eine Vorschau mit Häkchen.
// Beim Import zusätzlich: wohin die Seiten in der Notiz kommen (Ende, Anfang, nach einer bestimmten Seite).
// Vorschaubilder werden erst gezeichnet, wenn sie in Sicht kommen, und nacheinander (schont Tablets bei 300+ Seiten).
import { useEffect, useMemo, useRef, useState } from "react";
import { formatPageRange, parsePageRange } from "./pageRange";

export type PageSelectSuggestion = { pages: number[]; note: string };
export type PageSelectResult = { pages: number[]; insertAt: string };

type Props = {
  mode: "import" | "export";
  title: string;
  subtitle?: string;
  pageCount: number;
  pageLabel?: (i: number) => string;
  renderThumb: (i: number, canvas: HTMLCanvasElement, width: number) => Promise<void>;
  insertOptions?: { value: string; label: string }[];
  defaultInsert?: string;
  suggestion?: Promise<PageSelectSuggestion | null>;
  confirmLabel: (count: number) => string;
  onCancel: () => void;
  onConfirm: (r: PageSelectResult) => void;
};

const THUMB_W = 118;

export default function PageSelectDialog({ mode, title, subtitle, pageCount, pageLabel = (i) => `Seite ${i + 1}`, renderThumb, insertOptions, defaultInsert, suggestion, confirmLabel, onCancel, onConfirm }: Props) {
  const [choice, setChoice] = useState<"all" | "range" | "pick">("all");
  const [rangeText, setRangeText] = useState(pageCount > 1 ? `1-${pageCount}` : "1");
  const [picked, setPicked] = useState<Set<number>>(() => new Set(Array.from({ length: pageCount }, (_, i) => i)));
  const [insertAt, setInsertAt] = useState(defaultInsert ?? insertOptions?.[0]?.value ?? "end");
  const [hint, setHint] = useState<string | null>(null);
  const touched = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const range = useMemo(() => parsePageRange(rangeText, pageCount), [rangeText, pageCount]);
  const selected = useMemo(() => choice === "all" ? Array.from({ length: pageCount }, (_, i) => i) : choice === "range" ? range.pages : [...picked].sort((a, b) => a - b), [choice, range, picked, pageCount]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Vorschlag (z. B. „Seiten 1–40 sind schon in dieser Notiz“) übernehmen, solange noch nichts von Hand gewählt wurde
  useEffect(() => {
    let alive = true;
    suggestion?.then((s) => {
      if (!alive || !s) return;
      setHint(s.note);
      if (touched.current || !s.pages.length) return;
      setChoice("range"); setRangeText(formatPageRange(s.pages).replace(/–/g, "-")); setPicked(new Set(s.pages));
    }, () => {});
    return () => { alive = false; };
  }, [suggestion]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", k, true);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", k, true);
  }, [onCancel]);

  // Vorschaubilder: sichtbar → in die Warteschlange; immer nur eins gleichzeitig rendern
  useEffect(() => {
    const root = gridRef.current;
    if (!root) return;
    const done = new Set<number>(), queue: number[] = [];
    let running = false, alive = true;
    const pump = async () => {
      if (running) return;
      running = true;
      while (alive && queue.length) {
        const i = queue.shift()!;
        if (done.has(i)) continue;
        done.add(i);
        const cv = root.querySelector<HTMLCanvasElement>(`canvas[data-page="${i}"]`);
        if (!cv) continue;
        try { await renderThumb(i, cv, THUMB_W * Math.min(2, window.devicePixelRatio || 1)); cv.dataset.ready = "1"; } catch { cv.dataset.failed = "1"; }
      }
      running = false;
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { const i = +(e.target as HTMLElement).dataset.page!; if (!done.has(i) && !queue.includes(i)) queue.push(i); }
      queue.sort((a, b) => a - b); void pump();
    }, { root, rootMargin: "300px 0px" });
    root.querySelectorAll("canvas[data-page]").forEach((c) => io.observe(c));
    return () => { alive = false; io.disconnect(); };
  }, [renderThumb, pageCount]);

  const toggle = (i: number) => {
    touched.current = true;
    const base = choice === "pick" ? picked : new Set(selected);
    const next = new Set(base);
    if (next.has(i)) next.delete(i); else next.add(i);
    setPicked(next); setChoice("pick");
  };
  const setAllPicked = (v: boolean) => { touched.current = true; setChoice("pick"); setPicked(new Set(v ? Array.from({ length: pageCount }, (_, i) => i) : [])); };
  const invert = () => { touched.current = true; setChoice("pick"); setPicked(new Set(Array.from({ length: pageCount }, (_, i) => i).filter((i) => !selectedSet.has(i)))); };

  const canConfirm = selected.length > 0 && !(choice === "range" && range.invalid.length);
  const confirm = () => { if (canConfirm) onConfirm({ pages: selected, insertAt }); };

  return (
    <div className="xnts-psd-backdrop" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={dialogRef} className="xnts-psd" role="dialog" aria-modal="true" aria-labelledby="xnts-psd-title" tabIndex={-1} onPointerDown={(e) => e.stopPropagation()}>
        <header className="xnts-psd__head">
          <div>
            <h2 id="xnts-psd-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="xnts-psd__close" onClick={onCancel} aria-label="Schließen" title="Schließen (Esc)">✕</button>
        </header>

        <fieldset className="xnts-psd__modes">
          <legend>{mode === "import" ? "Welche Seiten importieren?" : "Welche Seiten exportieren?"}</legend>
          <label><input type="radio" name="psd-mode" checked={choice === "all"} onChange={() => { touched.current = true; setChoice("all"); }} /> <span><b>Alle Seiten</b><small>{pageCount} {pageCount === 1 ? "Seite" : "Seiten"}</small></span></label>
          <label><input type="radio" name="psd-mode" checked={choice === "range"} onChange={() => { touched.current = true; setChoice("range"); }} /> <span><b>Seitenbereich angeben</b>
            <input type="text" inputMode="numeric" value={rangeText} aria-label="Seitenbereich, z. B. 10-25, 30" placeholder="z. B. 10-25, 30"
              onFocus={() => { touched.current = true; setChoice("range"); }} onChange={(e) => { touched.current = true; setChoice("range"); setRangeText(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} aria-invalid={choice === "range" && range.invalid.length > 0} />
            {choice === "range" && range.invalid.length > 0 && <small className="xnts-psd__err">Ungültig: {range.invalid.join(", ")} (1–{pageCount})</small>}
          </span></label>
          <label><input type="radio" name="psd-mode" checked={choice === "pick"} onChange={() => { touched.current = true; if (choice !== "pick") setPicked(new Set(selected)); setChoice("pick"); }} /> <span><b>Einzelne Seiten auswählen</b><small>In der Vorschau antippen</small></span></label>
        </fieldset>

        {hint && <p className="xnts-psd__hint" role="status">ℹ {hint}</p>}

        <div className="xnts-psd__tools">
          <span>{selected.length} von {pageCount} ausgewählt{selected.length > 0 && selected.length < pageCount ? ` · ${formatPageRange(selected)}` : ""}</span>
          <span className="xnts-psd__toolbtns">
            <button type="button" onClick={() => setAllPicked(true)}>Alle</button>
            <button type="button" onClick={() => setAllPicked(false)}>Keine</button>
            <button type="button" onClick={invert}>Umkehren</button>
          </span>
        </div>

        <div ref={gridRef} className="xnts-psd__grid" role="group" aria-label="Seitenvorschau">
          {Array.from({ length: pageCount }, (_, i) => (
            <button key={i} type="button" className="xnts-psd__thumb" aria-pressed={selectedSet.has(i)} onClick={() => toggle(i)} title={`${pageLabel(i)} ${selectedSet.has(i) ? "abwählen" : "auswählen"}`}>
              <span className="xnts-psd__paper"><canvas data-page={i} width={THUMB_W} height={Math.round(THUMB_W * 1.414)} /></span>
              <span className="xnts-psd__check" aria-hidden="true">{selectedSet.has(i) ? "✓" : ""}</span>
              <span className="xnts-psd__label">{pageLabel(i)}</span>
            </button>
          ))}
        </div>

        <footer className="xnts-psd__foot">
          {insertOptions && insertOptions.length > 0 && <label className="xnts-psd__insert">
            <span>Einfügen:</span>
            <select value={insertAt} onChange={(e) => setInsertAt(e.target.value)} aria-label="Einfügeposition">
              {insertOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>}
          <span className="xnts-psd__spacer" />
          <button type="button" className="xnts-psd__btn" onClick={onCancel}>Abbrechen</button>
          <button type="button" className="xnts-psd__btn xnts-psd__btn--primary" disabled={!canConfirm} onClick={confirm}>{confirmLabel(selected.length)}</button>
        </footer>
        {mode === "import" && <p className="xnts-psd__foot-note">Bestehende Seiten und Notizen bleiben unverändert – neue Seiten werden nur dazwischen eingefügt.</p>}
      </div>
    </div>
  );
}

/** Kleiner Dialog nach der Bildauswahl: als Objekt auf die aktuelle Seite oder als eigene neue Seite. */
export function ImagePlaceDialog({ count, onCancel, onChoose }: { count: number; onCancel: () => void; onChoose: (asPage: boolean) => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onCancel]);
  const n = count === 1 ? "Bild" : `${count} Bilder`;
  return (
    <div className="xnts-psd-backdrop" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="xnts-psd xnts-psd--small" role="dialog" aria-modal="true" aria-labelledby="xnts-img-title" onPointerDown={(e) => e.stopPropagation()}>
        <header className="xnts-psd__head"><h2 id="xnts-img-title">{n} einfügen</h2><button type="button" className="xnts-psd__close" onClick={onCancel} aria-label="Schließen">✕</button></header>
        <div className="xnts-psd__choices">
          <button type="button" className="xnts-psd__choice" onClick={() => onChoose(false)} autoFocus>
            <b>Auf dieser Seite einfügen</b><small>Frei verschieb- und skalierbar (mit dem Lasso antippen)</small>
          </button>
          <button type="button" className="xnts-psd__choice" onClick={() => onChoose(true)}>
            <b>{count === 1 ? "Als neue Seite anlegen" : "Je Bild eine neue Seite"}</b><small>Seitenbreit, z. B. für Tafelfotos und Arbeitsblätter</small>
          </button>
        </div>
      </div>
    </div>
  );
}
