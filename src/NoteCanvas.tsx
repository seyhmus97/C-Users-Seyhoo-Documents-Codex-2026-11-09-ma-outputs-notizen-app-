// NoteCanvas.tsx v2 – unendliche Leinwand, PDF-Import, Zwischenraum, Teil-Radierer,
// Undo/Redo (Zeichnen, Radieren, Verschieben, Platz), Zoom, dauerhafte Speicherung (IndexedDB)
// npm i react react-dom pdfjs-dist | Tailwind CSS einrichten
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { RasterIn, RasterOut } from "./pdfRaster.worker";
import { saveFile } from "./saveFile";

type PdfJsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJsModule> | undefined;
const loadPdfJs = (): Promise<PdfJsModule> => {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  });
  return pdfjsPromise;
};

/* ───────── Typen & Konstanten ───────── */
const PAGE_W = 794, MIN_GAP = 16, SPACE_STEP = 200, TAIL_GROW = 1200, MIN_Z = 0.4, MAX_Z = 4;
type Tool = "pen" | "highlighter" | "eraser" | "lasso" | "shape" | "text";
type Shape = "rect" | "ellipse" | "triangle" | "line" | "arrow";
type Tpl = "blank" | "lined" | "grid" | "dots";
type PenKind = "ballpoint" | "fountain" | "pencil" | "marker";
type LineStyle = "solid" | "dashed" | "dotted" | "arrow" | "dashedArrow" | "dottedArrow";
type ThemePreference = "system" | "light" | "dark";
type Pt = { x: number; y: number; p: number };
// y ist RELATIV zum Block → Notizen wandern mit, wenn davor Platz eingefügt wird
type Stroke = { id: string; blockId: string; tool: "pen" | "highlighter"; color: string; size: number; pts: Pt[]; raw?: boolean; penKind?: PenKind; lineStyle?: LineStyle }; // raw: Formen (Ecken) nicht glätten
type PenProfile = { id: string; name: string; kind: PenKind; color: string; size: number };
type Block = { id: string; kind: "pdf" | "blank"; height: number; gap: number; docId?: string; pageNum?: number };
// Textfeld: y ist (wie bei Strichen) RELATIV zur Oberkante des Blocks → wandert beim Platz-Einfügen mit
interface TextField { id: string; blockId: string; text: string; x: number; y: number; width: number; height: number; fontSize: number; color: string }
type Snap = { strokes: Stroke[]; blocks: Block[]; texts: TextField[] };
type XF = { px: number; py: number; s: number; rot: number }; // Live-Transformation: Pivot, Skalierung, Winkel
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const COLORS = ["#1f2937", "#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#9333ea", "#0891b2", "#ffffff"];
const DEFAULT_PENS: PenProfile[] = [
  { id: "ballpoint", name: "Kugelschreiber", kind: "ballpoint", color: "#1f2937", size: 2.5 },
  { id: "fountain", name: "Füller", kind: "fountain", color: "#1e3a8a", size: 3.2 },
  { id: "pencil", name: "Bleistift", kind: "pencil", color: "#475569", size: 2.2 },
  { id: "marker", name: "Textmarker", kind: "marker", color: "#facc15", size: 3.5 },
];
const LINE_STYLES: { id: LineStyle; label: string; title: string }[] = [
  { id: "solid", label: "────", title: "Durchgezogene Linie" },
  { id: "dashed", label: "– – –", title: "Gestrichelte Linie" },
  { id: "dotted", label: "····", title: "Gepunktete Linie" },
  { id: "arrow", label: "────›", title: "Pfeil" },
  { id: "dashedArrow", label: "– – ›", title: "Gestrichelter Pfeil" },
  { id: "dottedArrow", label: "···›", title: "Gepunkteter Pfeil" },
];
const readPenProfiles = (): PenProfile[] => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("notizraum-pen-profiles") ?? "null");
    if (Array.isArray(saved) && saved.length && saved.every((p) => p && typeof p.id === "string" && typeof p.name === "string" && ["ballpoint", "fountain", "pencil", "marker"].includes(p.kind) && typeof p.color === "string" && Number.isFinite(p.size))) return saved as PenProfile[];
  } catch { /* private mode or invalid old settings → defaults */ }
  return DEFAULT_PENS;
};
const hasArrow = (style: LineStyle | undefined) => !!style?.toLowerCase().includes("arrow");
const dashFor = (style: LineStyle | undefined) => style?.toLowerCase().includes("dotted") ? [1.5, 5] : style?.toLowerCase().includes("dashed") ? [10, 7] : [];

/* ───────── Mini-IndexedDB (Key-Value) ───────── */
let _db: Promise<IDBDatabase> | null = null;
const db = () =>
  (_db ??= new Promise((res, rej) => {
    const r = indexedDB.open("notes", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
export const kvGet = async <T,>(k: string) => {
  const d = await db();
  return new Promise<T | undefined>((res, rej) => {
    const q = d.transaction("kv").objectStore("kv").get(k);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
};
export const kvSet = async (k: string, v: unknown) => {
  const d = await db();
  return new Promise<void>((res, rej) => {
    const t = d.transaction("kv", "readwrite");
    t.objectStore("kv").put(v, k);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
};

export const kvDel = async (k: string) => {
  const d = await db();
  return new Promise<void>((res, rej) => {
    const t = d.transaction("kv", "readwrite");
    t.objectStore("kv").delete(k);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
};
export const kvAll = async () => {
  const d = await db();
  return new Promise<[string, unknown][]>((res, rej) => {
    const out: [string, unknown][] = [];
    const q = d.transaction("kv").objectStore("kv").openCursor();
    q.onsuccess = () => { const c = q.result; if (c) { out.push([String(c.key), c.value]); c.continue(); } else res(out); };
    q.onerror = () => rej(q.error);
  });
};
export const kvReplaceAll = async (entries: [string, unknown][]) => {
  const d = await db();
  return new Promise<void>((res, rej) => {
    const t = d.transaction("kv", "readwrite"), s = t.objectStore("kv");
    s.clear();
    entries.forEach(([k, v]) => s.put(v, k));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
};

/* ───────── Geometrie ───────── */
// Formen sind normale Striche → Radieren, Lasso, Undo und Export funktionieren automatisch
const shapePts = (kind: Shape, a: { x: number; y: number }, b: { x: number; y: number }): Pt[] => {
  const P = (x: number, y: number): Pt => ({ x, y, p: 0.5 });
  if (kind === "line") return [P(a.x, a.y), P(b.x, b.y)];
  if (kind === "rect") return [P(a.x, a.y), P(b.x, a.y), P(b.x, b.y), P(a.x, b.y), P(a.x, a.y)];
  if (kind === "triangle") return [P((a.x + b.x) / 2, a.y), P(b.x, b.y), P(a.x, b.y), P((a.x + b.x) / 2, a.y)];
  if (kind === "ellipse") {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    return Array.from({ length: 65 }, (_, i) => P(cx + rx * Math.cos((i / 64) * 2 * Math.PI), cy + ry * Math.sin((i / 64) * 2 * Math.PI)));
  }
  const ang = Math.atan2(b.y - a.y, b.x - a.x), L = Math.min(24, Math.hypot(b.x - a.x, b.y - a.y) / 3);
  return [P(a.x, a.y), P(b.x, b.y), P(b.x - L * Math.cos(ang - 0.5), b.y - L * Math.sin(ang - 0.5)), P(b.x, b.y), P(b.x - L * Math.cos(ang + 0.5), b.y - L * Math.sin(ang + 0.5))];
};

const simplifyPoints = (pts: Pt[], tolerance: number): Pt[] => {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length), stack: [number, number][] = [[0, pts.length - 1]];
  keep[0] = keep[pts.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const p = pts[a], q = pts[b], dx = q.x - p.x, dy = q.y - p.y, den = dx * dx + dy * dy;
    let far = tolerance, index = -1;
    for (let i = a + 1; i < b; i++) {
      const t = den ? clamp(((pts[i].x - p.x) * dx + (pts[i].y - p.y) * dy) / den, 0, 1) : 0;
      const dist = Math.hypot(pts[i].x - (p.x + t * dx), pts[i].y - (p.y + t * dy));
      if (dist > far) { far = dist; index = i; }
    }
    if (index >= 0) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return pts.filter((_, i) => keep[i] === 1);
};

const recognizeShape = (pts: Pt[]): Shape | null => {
  if (pts.length < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pathLength = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    if (i) pathLength += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
  }
  const w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h);
  if (diag < 16) return null;
  const closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < Math.max(12, diag * 0.16);
  if (closed) {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const radii = pts.map((p) => Math.hypot(p.x - cx, p.y - cy)), mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    const variation = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length) / Math.max(1, mean);
    if (variation < 0.2 && w / Math.max(1, h) > 0.68 && w / Math.max(1, h) < 1.48) return "ellipse";
    const open = pts.slice(0, -1), corners = simplifyPoints([...open, open[0]], Math.max(3, diag * 0.055));
    const count = corners.length > 1 && Math.hypot(corners[0].x - corners[corners.length - 1].x, corners[0].y - corners[corners.length - 1].y) < diag * 0.1 ? corners.length - 1 : corners.length;
    if (count === 3) return "triangle";
    if (count === 4 || count === 5) return "rect";
    return null;
  }
  const direct = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  return pathLength > 0 && direct / pathLength > 0.91 ? "line" : null;
};

const perfectStroke = (s: Stroke): Stroke | null => {
  const kind = recognizeShape(s.pts);
  if (!kind) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (kind === "ellipse") { const d = Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; x0 = cx - d / 2; x1 = cx + d / 2; y0 = cy - d / 2; y1 = cy + d / 2; }
  const geometry = kind === "line" && hasArrow(s.lineStyle) ? "arrow" : kind;
  return { ...s, pts: shapePts(geometry, { x: x0, y: y0 }, { x: x1, y: y1 }), raw: true };
};
const straightenCircuitWire = (s: Stroke): Stroke | null => {
  if (s.pts.length < 3) return null;
  const first = s.pts[0], last = s.pts[s.pts.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y, direct = Math.hypot(dx, dy);
  if (direct < 24) return null;
  let length = 0;
  for (let i = 1; i < s.pts.length; i++) length += Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].y - s.pts[i - 1].y);
  if (!length || direct / length < 0.68) return null;
  let a = { x: first.x, y: first.y }, b = { x: last.x, y: last.y };
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const tolerance = Math.max(14, direct * 0.42);
  if (horizontal && Math.abs(dy) <= tolerance) {
    const y = s.pts.reduce((sum, p) => sum + p.y, 0) / s.pts.length;
    a = { x: first.x, y }; b = { x: last.x, y };
  } else if (!horizontal && Math.abs(dx) <= tolerance) {
    const x = s.pts.reduce((sum, p) => sum + p.x, 0) / s.pts.length;
    a = { x, y: first.y }; b = { x, y: last.y };
  } else if (direct / length < 0.86) return null;
  const geometry = hasArrow(s.lineStyle) ? "arrow" : "line";
  return { ...s, pts: shapePts(geometry, a, b), raw: true };
};
const IDENT: XF = { px: 0, py: 0, s: 1, rot: 0 };
const PRESSURE_LERP = 0.2; // Tiefpass: Anteil des neuen Druckwerts pro Punkt
const MIN_DIST = 0.8;      // Punkte näher als 0,8 Bildschirm-px werden verworfen (Zittern, weniger Punkte)
const PALM_MAX = 25;       // Touch-Kontaktfläche (CSS-px), ab der ein Finger als Handballen gilt
const PALM_GRACE_MS = 600; // so lange nach dem letzten Stiftereignis werden Finger ignoriert
const isPalm = (e: PointerEvent): boolean => e.pointerType === "touch" && Math.max(e.width, e.height) > PALM_MAX; // Stift/Maus: immer false
// Globale Zwischenablage auf Modul-Ebene (überlebt Notizwechsel); ABSOLUTE Koordinaten, blockId ""
const sharedClip: { noteId: string; strokes: Stroke[]; texts: TextField[] } = { noteId: "", strokes: [], texts: [] };
let clipWrite: Promise<void> = Promise.resolve();
const clipSize = () => sharedClip.strokes.length + sharedClip.texts.length;
const persistClip = () => { // Arrays werden nie verändert, nur ersetzt → der Schnappschuss bleibt konsistent
  const snapshot = { noteId: sharedClip.noteId, strokes: sharedClip.strokes, texts: sharedClip.texts };
  clipWrite = clipWrite.then(() => kvSet("clip", snapshot)).catch(() => {});
};
const textH = (t: TextField) => Math.max(t.height, t.fontSize * 1.5); // tatsächliche Höhe der textarea
const cloneText = (t: TextField): TextField => ({ ...t, id: uid() });
const cloneStroke = (s: Stroke): Stroke => ({ ...s, id: uid(), pts: s.pts.map((p) => ({ ...p })) });
const bbCache = new WeakMap<Stroke, { x0: number; x1: number; y0: number; y1: number }>();
const bbox = (s: Stroke) => {
  let c = bbCache.get(s);
  if (!c) {
    c = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
    for (const p of s.pts) { c.x0 = Math.min(c.x0, p.x); c.x1 = Math.max(c.x1, p.x); c.y0 = Math.min(c.y0, p.y); c.y1 = Math.max(c.y1, p.y); }
    bbCache.set(s, c);
  }
  return c;
};

/* ───────── Radierer-Geometrie: exakt die Kurve, die paint() zeichnet ───────── */
// Scratch-Register: curveAt() schreibt hierhin, es entsteht kein Objekt pro Abtastpunkt
let cvX = 0, cvY = 0, cvP = 0;
const halfW = (s: Stroke, p: number): number => (s.tool === "highlighter" ? s.size * 2.5 : (s.size * (0.4 + p * 1.2)) / 2);

/** Punkt auf Segment i (1..n-1) der SICHTBAREN Kurve bei Parameter t (0..1). Spiegelt die Geometrie aus paint():
 *  Stift/Marker: Start = Mitte(P[i-1],P[i]) (bei i=1: P[0]), Kontrollpunkt P[i], Ende = Mitte(P[i],P[i+1]); letztes Segment gerade bis P[n-1].
 *  Formen (raw) und Striche unter 3 Punkten: gerade Segmente P[i-1] → P[i]. Breite gehört zu P[i].p. */
const curveAt = (P: Pt[], n: number, raw: boolean, i: number, t: number): void => {
  if (raw || n < 3) {
    const a = P[i - 1], b = P[i];
    cvX = a.x + (b.x - a.x) * t; cvY = a.y + (b.y - a.y) * t; cvP = b.p;
    return;
  }
  const c = P[i], last = i === n - 1;
  const sx = i === 1 ? P[0].x : (P[i - 1].x + c.x) / 2, sy = i === 1 ? P[0].y : (P[i - 1].y + c.y) / 2;
  const ex = last ? c.x : (c.x + P[i + 1].x) / 2, ey = last ? c.y : (c.y + P[i + 1].y) / 2;
  if (last) { cvX = sx + (ex - sx) * t; cvY = sy + (ey - sy) * t; }
  else { const u = 1 - t; cvX = u * u * sx + 2 * u * t * c.x + t * t * ex; cvY = u * u * sy + 2 * u * t * c.y + t * t * ey; }
  cvP = c.p;
};

/** Anzahl Abtastschritte eines Segments (Weg über Anfang, Mitte, Ende der Kurve ≈ Länge) */
const segSteps = (P: Pt[], n: number, raw: boolean, i: number, step: number): number => {
  curveAt(P, n, raw, i, 0); const x0 = cvX, y0 = cvY;
  curveAt(P, n, raw, i, 0.5); const xm = cvX, ym = cvY;
  curveAt(P, n, raw, i, 1);
  const len = Math.sqrt((xm - x0) * (xm - x0) + (ym - y0) * (ym - y0)) + Math.sqrt((cvX - xm) * (cvX - xm) + (cvY - ym) * (cvY - ym));
  return Math.max(1, Math.ceil(len / step));
};

/** Schneidet der Radierkreis (cx,cy in Dokumentkoordinaten, Radius r) die sichtbare Kurve inkl. halber Strichbreite? Ohne Allokation. */
const strokeHit = (s: Stroke, top: number, cx: number, cy: number, r: number, step: number): boolean => {
  const P = s.pts, n = P.length, raw = !!s.raw, ly = cy - top, m = r + (s.tool === "highlighter" ? s.size * 2.5 : s.size * 0.8);
  if (n === 1) { const dx = P[0].x - cx, dy = P[0].y - ly, rr = r + halfW(s, P[0].p); return dx * dx + dy * dy < rr * rr; }
  for (let i = 1; i < n; i++) {
    const a = P[i - 1], b = P[i], c = i + 1 < n ? P[i + 1] : b; // die Kurve liegt in der Hülle dieser drei Punkte
    if (cx < Math.min(a.x, b.x, c.x) - m || cx > Math.max(a.x, b.x, c.x) + m || ly < Math.min(a.y, b.y, c.y) - m || ly > Math.max(a.y, b.y, c.y) + m) continue;
    const k = segSteps(P, n, raw, i, step);
    for (let j = i === 1 ? 0 : 1; j <= k; j++) {
      curveAt(P, n, raw, i, j / k);
      const dx = cvX - cx, dy = cvY - ly, rr = r + halfW(s, cvP);
      if (dx * dx + dy * dy < rr * rr) return true;
    }
  }
  return false;
};

/** Zerlegt einen getroffenen Strich: Kurve dicht abtasten, Treffer-Abtastpunkte entfallen, die Reste werden als neue Strokes
 *  (eigene id, gleiche Eigenschaften) in `out` abgelegt. Jedes Bruchstück beginnt und endet auf einem echten Kurvenpunkt. */
const cutStroke = (s: Stroke, top: number, cx: number, cy: number, r: number, step: number, out: Stroke[]): void => {
  const P = s.pts, n = P.length, raw = !!s.raw, ly = cy - top;
  if (n === 1) return; // getroffener Einzelpunkt entfällt
  let run: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const k = segSteps(P, n, raw, i, step);
    for (let j = i === 1 ? 0 : 1; j <= k; j++) {
      curveAt(P, n, raw, i, j / k);
      const dx = cvX - cx, dy = cvY - ly, rr = r + halfW(s, cvP);
      if (dx * dx + dy * dy < rr * rr) { if (run.length > 1) out.push({ ...s, id: uid(), pts: run }); run = []; }
      else run.push({ x: cvX, y: cvY, p: cvP });
    }
  }
  if (run.length > 1) out.push({ ...s, id: uid(), pts: run });
};

/* ───────── PDF-Rasterbilder (Web Worker) ───────── */
const RASTER_SCALE = 2; // Rasterbreite = PAGE_W × 2 px; darüber zeichnet PdfPage zusätzlich scharf per Canvas
export const rasterKey = (docId: string, pageNum: number) => `pgimg:${docId}:${pageNum}`;

/** Rendert alle Seiten im Worker zu JPEGs und übergibt sie nacheinander an onPage. true = vollständig fertig.
 *  Fehler oder fehlende Unterstützung → false; die Seiten fallen dann einfach auf den Canvas-Pfad zurück. */
const rasterizeInWorker = (buf: ArrayBuffer, onPage: (pageNum: number, numPages: number, blob: Blob) => Promise<void>): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    let w: Worker;
    try { w = new Worker(new URL("./pdfRaster.worker.ts", import.meta.url), { type: "module" }); }
    catch { resolve(false); return; }
    let chain: Promise<void> = Promise.resolve(); // Ablage in Reihenfolge
    let ok = true;
    const finish = () => { chain.then(() => { w.terminate(); resolve(ok); }); };
    w.onmessage = (e: MessageEvent<RasterOut | undefined>) => {
      const m = e.data;
      if (!m || typeof m !== "object") return; // pdf.js im Worker sendet eigene Nachrichten: ignorieren
      if (m.type === "page") chain = chain.then(() => onPage(m.pageNum, m.numPages, m.blob)).catch(() => { ok = false; });
      else if (m.type === "error") { ok = false; if (m.pageNum === undefined) finish(); }
      else if (m.type === "done") finish();
    };
    w.onerror = () => { ok = false; finish(); };
    const msg: RasterIn = { type: "start", data: buf, width: PAGE_W * RASTER_SCALE, quality: 0.86 };
    w.postMessage(msg, [buf]);
  });

/* ───────── PDF-Seite: Rasterbild als Basis, Canvas nur bei hohem Zoom; speicherschonend, flackerfrei ───────── */
type RenderTaskT = ReturnType<PDFPageProxy["render"]>;
const isCancel = (err: unknown): boolean => err instanceof Error && err.name === "RenderingCancelledException";
const MAX_PIXELS = 12_000_000; // Obergrenze pro Seitenbitmap (~48 MB), schützt kleine Tablets

function PdfPage({ doc, docId, pageNum, height, zoom, getRoot }: { doc: PDFDocumentProxy; docId: string; pageNum: number; height: number; zoom: number; getRoot: () => HTMLElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const shown = useRef(0); // Skalierung des aktuell angezeigten Canvas-Bitmaps, 0 = leer
  const [visible, setVisible] = useState(false);
  const [rz, setRz] = useState(zoom);
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setRz(zoom), 250); return () => clearTimeout(t); }, [zoom]);

  // Sichtbarkeit mit Hysterese: nahe (600 px) → laden/rendern, weit weg (1400 px) → freigeben.
  // root MUSS der Scroll-Container sein, sonst wirkt rootMargin nicht durch dessen Beschnitt.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = getRoot();
    const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { root, rootMargin: "600px 0px" });
    const far = new IntersectionObserver(([e]) => { if (!e.isIntersecting) setVisible(false); }, { root, rootMargin: "1400px 0px" });
    near.observe(el); far.observe(el);
    return () => { near.disconnect(); far.disconnect(); };
  }, [getRoot]);

  // Canvas-Speicher sofort freigeben, sobald die Seite unsichtbar ist
  useEffect(() => {
    if (visible) return;
    const cv = ref.current;
    if (cv) { cv.width = 0; cv.height = 0; }
    shown.current = 0;
  }, [visible]);
  useEffect(() => {
    const cv = ref.current;
    return () => { if (cv) { cv.width = 0; cv.height = 0; } };
  }, []);

  // Rasterbild aus IndexedDB als Object-URL laden (solange nahe), sonst freigeben.
  // Kommt es erst während des Imports fertig, meldet das Ereignis "pdfraster" die Seite.
  useEffect(() => {
    if (!visible) return;
    const key = rasterKey(docId, pageNum);
    let cancelled = false;
    let url: string | null = null;
    const load = async () => {
      try {
        const b = await kvGet<Blob>(key);
        if (cancelled || !(b instanceof Blob)) return; // kein Rasterbild → Canvas-Pfad
        const next = URL.createObjectURL(b);
        if (url) URL.revokeObjectURL(url);
        url = next; setImgUrl(next);
      } catch { /* IndexedDB nicht lesbar → Canvas-Pfad */ }
    };
    const onRaster = (e: Event) => { if ((e as CustomEvent<string>).detail === key) void load(); };
    window.addEventListener("pdfraster", onRaster);
    void load();
    return () => { cancelled = true; window.removeEventListener("pdfraster", onRaster); if (url) URL.revokeObjectURL(url); setImgUrl(null); };
  }, [visible, docId, pageNum]);

  // Double-Buffering: scharfes Bitmap offscreen rendern, erst nach Abschluss in einem Zug austauschen
  useEffect(() => {
    if (!visible) return;
    const cap = Math.sqrt(MAX_PIXELS / (PAGE_W * height));
    const need = Math.min((window.devicePixelRatio || 1) * rz, 3, cap);
    if (imgUrl && need <= RASTER_SCALE * 1.1) { // Rasterbild genügt: kein Rendern im Haupt-Thread, Canvas freigeben
      const cv = ref.current;
      if (cv && shown.current > 0) { cv.width = 0; cv.height = 0; shown.current = 0; }
      return;
    }
    if (shown.current > 0 && Math.abs(need / shown.current - 1) < 0.15) return; // Auflösung passt noch
    let cancelled = false;
    let task: RenderTaskT | undefined;
    const off = document.createElement("canvas");
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (PAGE_W / base.width) * need });
        off.width = Math.ceil(vp.width); off.height = Math.ceil(vp.height);
        const ctx = off.getContext("2d");
        if (!ctx) return;
        task = page.render({ canvas: off, canvasContext: ctx, viewport: vp } as Parameters<PDFPageProxy["render"]>[0]); // pdfjs-dist 4.x und 5.x
        await task.promise;
        if (cancelled) return;
        const cv = ref.current;
        const dst = cv?.getContext("2d");
        if (!cv || !dst) return;
        cv.width = off.width; cv.height = off.height; // leert das alte Bild …
        dst.drawImage(off, 0, 0);                      // … und zeichnet das neue im selben Frame → kein Weiß-Flackern
        shown.current = need;
        page.cleanup();
      } catch (err) {
        if (!isCancel(err)) console.error("PDF-Seite " + pageNum + " konnte nicht gerendert werden:", err);
      } finally {
        off.width = 0; off.height = 0;
      }
    })();
    return () => {
      cancelled = true;
      try { task?.cancel(); } catch { /* Task war bereits beendet */ }
    };
  }, [visible, doc, pageNum, rz, height, imgUrl]);

  // Unten das native, unselektierbare Rasterbild (sofort da, kein Weiß), darüber das scharfe Canvas bei hohem Zoom
  return (
    <div className="relative" style={{ width: PAGE_W, height }}>
      {imgUrl && (
        <img src={imgUrl} alt="" draggable={false} decoding="async"
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          style={{ userSelect: "none", WebkitUserSelect: "none" }} />
      )}
      <canvas ref={ref} className="absolute inset-0 block pointer-events-none" style={{ width: PAGE_W, height }} />
    </div>
  );
}

/* ───────── Hauptkomponente ───────── */
export default function NoteCanvas({ noteId, title, onLibrary, darkMode, theme, onThemeChange, onBackup, onRestore }: { noteId: string; title?: string; onLibrary?: () => void; darkMode: boolean; theme: ThemePreference; onThemeChange: (theme: ThemePreference) => void; onBackup: () => void; onRestore: () => void }) {
  const [blocks, setBlocks] = useState<Block[]>([{ id: uid(), kind: "blank", height: 1600, gap: 0 }]);
  const [tool, setTool] = useState<Tool>("pen");
  const [eraseMode, setEraseMode] = useState<"pixel" | "stroke">("pixel");
  const [shapeKind, setShapeKind] = useState<Shape>("rect");
  const [lineStyle, setLineStyle] = useState<LineStyle>("solid");
  const [tpl, setTplState] = useState<Tpl>("blank");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(2.5);
  const [penProfiles, setPenProfiles] = useState<PenProfile[]>(readPenProfiles);
  const [activePenId, setActivePenId] = useState("ballpoint");
  const [customColors, setCustomColors] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("notizraum-custom-colors") ?? "[]");
      return Array.isArray(saved) ? [...new Set(saved.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)))].slice(0, 12) : [];
    } catch { return []; }
  });
  const [pressureSensitivity, setPressureSensitivity] = useState(() => {
    try { const saved = Number(localStorage.getItem("notizraum-pressure-sensitivity")); return Number.isFinite(saved) && saved >= 0.25 && saved <= 2 ? saved : 1; }
    catch { return 1; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [smartShapesEnabled, setSmartShapesEnabled] = useState(() => { try { return localStorage.getItem("notizraum-smart-shapes") !== "false"; } catch { return true; } });
  const [circuitAssistEnabled, setCircuitAssistEnabled] = useState(() => { try { return localStorage.getItem("notizraum-circuit-assist") !== "false"; } catch { return true; } });
  const [toolbarCollapsed, setToolbarCollapsed] = useState(() => { try { return localStorage.getItem("notizraum-toolbar-collapsed") === "true"; } catch { return false; } });
  const [sidebar, setSidebar] = useState(true);
  const [zoom, setZoomState] = useState(1);
  const [saved, setSaved] = useState("");
  const [, setReady] = useState(0);

  const scRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const docs = useRef(new Map<string, PDFDocumentProxy>());
  const strokes = useRef<Stroke[]>([]);
  const cur = useRef<Stroke | null>(null);
  const lasso = useRef<{ x: number; y: number }[] | null>(null);
  const sel = useRef<Set<string>>(new Set());
  const drag = useRef<{ x: number; y: number } | null>(null);
  const dragOff = useRef({ x: 0, y: 0 });
  const hover = useRef<{ x: number; y: number } | null>(null);
  const shapeA = useRef<{ x: number; y: number } | null>(null);
  const tplRef = useRef<Tpl>("blank"); tplRef.current = tpl;
  const before = useRef<Snap>({ strokes: [], blocks: [], texts: [] });
  const textFields = useRef<TextField[]>([]);
  const textBefore = useRef<Snap>({ strokes: [], blocks: [], texts: [] });
  const creating = useRef(false);
  const focusId = useRef<string | null>(null);
  const xf = useRef<(XF & { mode: "scale" | "rotate"; d0: number; a0: number }) | null>(null);
  const penActive = useRef(false);
  const penLast = useRef(0);
  const rejected = useRef(new Set<number>());
  const [clipCount, setClipCount] = useState(clipSize); // löst die UI-Aktualisierung der Action-Bar aus
  const [, bump1] = useState(0);
  const bump = () => bump1((n) => n + 1);
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const zoomRef = useRef(1);
  const anchor = useRef<{ dx: number; dy: number; cx: number; cy: number } | null>(null);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const smartHoldTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rawBeforeSmartSnap = useRef<Stroke | null>(null);
  const raf = useRef(0);
  const activePen = penProfiles.find((p) => p.id === activePenId) ?? penProfiles[0] ?? DEFAULT_PENS[0];
  const updatePenProfiles = (next: PenProfile[]) => { setPenProfiles(next); try { localStorage.setItem("notizraum-pen-profiles", JSON.stringify(next)); } catch { /* profiles still work for this session */ } };
  const choosePen = (p: PenProfile) => { setActivePenId(p.id); setColor(p.color); setSize(p.size); setTool(p.kind === "marker" ? "highlighter" : "pen"); };
  const changePen = (patch: Partial<PenProfile>) => updatePenProfiles(penProfiles.map((p) => p.id === activePen.id ? { ...p, ...patch } : p));
  useEffect(() => { try { localStorage.setItem("notizraum-smart-shapes", String(smartShapesEnabled)); } catch { /* preference still works for this session */ } }, [smartShapesEnabled]);
  useEffect(() => { try { localStorage.setItem("notizraum-circuit-assist", String(circuitAssistEnabled)); } catch { /* preference still works for this session */ } }, [circuitAssistEnabled]);
  useEffect(() => { try { localStorage.setItem("notizraum-toolbar-collapsed", String(toolbarCollapsed)); } catch { /* preference still works for this session */ } }, [toolbarCollapsed]);
  useEffect(() => { try { localStorage.setItem("notizraum-custom-colors", JSON.stringify(customColors)); } catch { /* palette still works for this session */ } }, [customColors]);
  useEffect(() => { try { localStorage.setItem("notizraum-pressure-sensitivity", String(pressureSensitivity)); } catch { /* sensitivity still works for this session */ } }, [pressureSensitivity]);
  useEffect(() => {
    if (!penProfiles.some((p) => p.id === activePenId)) setActivePenId(penProfiles[0]?.id ?? "ballpoint");
  }, [penProfiles, activePenId]);
  const addPenProfile = () => {
    const name = window.prompt("Name des neuen Stifts", `Stift ${penProfiles.length + 1}`)?.trim();
    if (!name) return;
    const nextColor = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
    const p: PenProfile = { id: uid(), name, kind: activePen.kind === "marker" ? "ballpoint" : activePen.kind, color: nextColor, size };
    updatePenProfiles([...penProfiles, p]); setActivePenId(p.id); setColor(p.color); setTool("pen");
  };
  const addCustomColor = (value: string) => {
    const normalized = value.toLowerCase();
    setColor(normalized); changePen({ color: normalized });
    setCustomColors((old) => old.includes(normalized) ? old : [...old, normalized].slice(-12));
  };
  const perfectSelected = () => {
    const beforeSelection = snap(); let changed = false;
    strokes.current = strokes.current.map((s) => {
      if (!sel.current.has(s.id)) return s;
      const clean = perfectStroke(s) ?? (circuitAssistEnabled ? straightenCircuitWire(s) : null);
      if (clean) { changed = true; return clean; }
      return s;
    });
    if (changed) { pushHist(beforeSelection); setSaved("Schaltbild und Grundformen geglättet"); schedule(); }
    else setSaved("Keine passende Form erkannt");
  };
  const cancelSmartHold = () => { if (smartHoldTimer.current) clearTimeout(smartHoldTimer.current); smartHoldTimer.current = undefined; };
  const armSmartHold = () => {
    if (!smartShapesEnabled) return;
    cancelSmartHold();
    smartHoldTimer.current = setTimeout(() => {
      const current = cur.current;
      if (!current || current.tool !== "pen" || current.pts.length < 4) return;
      const clean = perfectStroke(current);
      if (clean) { rawBeforeSmartSnap.current = current; cur.current = clean; schedule(); }
    }, 650);
  };

  const { tops, total } = useMemo(() => {
    const t: Record<string, number> = {};
    let y = 0;
    for (const b of blocks) { t[b.id] = y; y += b.height + b.gap; }
    return { tops: t, total: y };
  }, [blocks]);
  const topsRef = useRef(tops); topsRef.current = tops;
  const blocksRef = useRef(blocks); blocksRef.current = blocks;

  const paperAtY = (y: number): "pdf" | "blank" | "gap" => {
    for (const b of blocksRef.current) {
      const top = topsRef.current[b.id] ?? 0;
      if (y >= top && y < top + b.height) return b.kind;
      if (b.kind === "pdf" && y >= top + b.height && y < top + b.height + b.gap) return "gap";
    }
    return blocksRef.current.at(-1)?.kind ?? "blank";
  };
  const displayInk = (ink: string, paperKind: "pdf" | "blank" | "gap") => {
    const rgb = /^#[0-9a-f]{6}$/i.test(ink) ? [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16) / 255) : null;
    const luma = rgb ? 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] : 0.5;
    // PDF-Seiten bleiben im Original. Nur die gezeichnete Tinte wird angepasst,
    // wenn sie sonst auf der weißen PDF-Fläche unsichtbar wäre.
    if (paperKind === "pdf") return luma > 0.94 ? "#111827" : ink;
    if (paperKind === "blank" && !darkMode) return luma > 0.94 ? "#1f2937" : ink;
    if (paperKind === "gap" && !darkMode) return luma > 0.94 ? "#1f2937" : ink;
    const contrast: Record<string, string> = {
      "#1f2937": "#f8fafc", "#1e3a8a": "#93c5fd", "#475569": "#cbd5e1", "#2563eb": "#93c5fd",
      "#dc2626": "#fca5a5", "#16a34a": "#86efac", "#f59e0b": "#fcd34d", "#9333ea": "#d8b4fe",
      "#0891b2": "#67e8f9", "#facc15": "#fef08a",
    };
    const mapped = contrast[ink.toLowerCase()];
    if (mapped) return mapped;
    if (rgb && luma < 0.24) return "#f8fafc";
    return ink;
  };

  const getScroller = useCallback(() => scRef.current, []);
  const offX = () => Math.max(0, ((scRef.current?.clientWidth ?? 0) - PAGE_W * zoomRef.current) / 2);

  /* ───── Speichern / Laden ───── */
  const save = useCallback(async () => {
    try { if ((window as unknown as { restoring?: boolean }).restoring) return; await kvSet("note:" + noteId, { blocks: blocksRef.current, strokes: strokes.current, texts: textFields.current, tpl: tplRef.current }); setSaved("Gespeichert"); }
    catch { setSaved("Speichern fehlgeschlagen"); }
  }, [noteId]);
  const markDirty = useCallback(() => { setSaved("Speichert …"); clearTimeout(timer.current); timer.current = setTimeout(save, 600); }, [save]);
  useEffect(() => { if (loaded.current) markDirty(); }, [blocks, tpl, markDirty]);
  useEffect(() => {
    (async () => {
      navigator.storage?.persist?.(); // verhindert, dass iPadOS/Browser die Daten selbständig löscht
      const st = await kvGet<{ blocks: Block[]; strokes: Stroke[]; texts?: TextField[]; tpl?: Tpl }>("note:" + noteId);
      if (st?.blocks?.length) {
        for (const id of new Set(st.blocks.map((b) => b.docId).filter(Boolean) as string[])) {
          const stored = await kvGet<ArrayBuffer | Blob>("pdf:" + id);
          const bytes = stored instanceof Blob ? await stored.arrayBuffer() : stored?.slice(0);
          if (bytes) docs.current.set(id, await (await loadPdfJs()).getDocument({ data: bytes }).promise);
        }
        strokes.current = st.strokes; textFields.current = st.texts ?? []; setBlocks(st.blocks); if (st.tpl) setTplState(st.tpl);
      }
      await clipWrite; // laufende Schreibvorgänge zuerst abwarten
      if (clipSize() === 0) { // nur nach einem Neustart aus der DB laden; im Speicher ist sonst alles aktueller
        const c = await kvGet<typeof sharedClip>("clip");
        if (c && Array.isArray(c.strokes) && Array.isArray(c.texts)) { sharedClip.noteId = c.noteId ?? ""; sharedClip.strokes = c.strokes; sharedClip.texts = c.texts; }
      }
      setClipCount(clipSize());
      loaded.current = true; setReady((n) => n + 1); setSaved("Gespeichert");
    })();
    const flush = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", flush);
    return () => { document.removeEventListener("visibilitychange", flush); clearTimeout(timer.current); if (loaded.current) save(); };
  }, [save, noteId]);

  /* ───── Verlauf (Undo/Redo über Snapshots; Striche sind unveränderlich) ───── */
  const snap = (): Snap => ({ strokes: strokes.current, blocks: blocksRef.current, texts: textFields.current });
  const pushHist = (b: Snap) => { past.current.push(b); if (past.current.length > 300) past.current.shift(); future.current = []; markDirty(); };
  const apply = (s: Snap) => {
    const cl = blocksRef.current[blocksRef.current.length - 1], sl = s.blocks[s.blocks.length - 1];
    const bs = cl && sl && cl.id === sl.id ? s.blocks.map((b, i, a) => (i === a.length - 1 ? { ...b, height: Math.max(b.height, cl.height) } : b)) : s.blocks;
    strokes.current = s.strokes; textFields.current = s.texts; sel.current = new Set(); bump(); setBlocks(bs); markDirty(); schedule();
  };
  const undo = () => { const s = past.current.pop(); if (s) { future.current.push(snap()); apply(s); } };
  const redo = () => { const s = future.current.pop(); if (s) { past.current.push(snap()); apply(s); } };

  /* ───── Zoom (Pinch, Strg+Mausrad/Touchpad, Buttons) ───── */
  const setZoom = useCallback((z: number, cx?: number, cy?: number) => {
    const sc = scRef.current!;
    z = clamp(z, MIN_Z, MAX_Z); cx ??= sc.clientWidth / 2; cy ??= sc.clientHeight / 2;
    const old = zoomRef.current, ox = Math.max(0, (sc.clientWidth - PAGE_W * old) / 2);
    anchor.current = { dx: (sc.scrollLeft + cx - ox) / old, dy: (sc.scrollTop + cy) / old, cx, cy };
    zoomRef.current = z; setZoomState(z);
  }, []);
  useLayoutEffect(() => {
    const a = anchor.current, sc = scRef.current;
    if (a && sc) { sc.scrollLeft = a.dx * zoom + offX() - a.cx; sc.scrollTop = a.dy * zoom - a.cy; anchor.current = null; }
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
  useEffect(() => {
    const sc = scRef.current!;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      setZoom(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    sc.addEventListener("wheel", wheel, { passive: false });
    return () => sc.removeEventListener("wheel", wheel);
  }, [setZoom]);

  /* ───── Zeichenebene (nur sichtbarer Ausschnitt) ───── */
  // Zero-Allocation: nur Zahlen und Indexschleifen, keine Arrays, Objekte oder Closures pro Aufruf
  const paint = (ctx: CanvasRenderingContext2D, s: Stroke, ox = 0, oy = 0, ink = s.color) => {
    const top = (topsRef.current[s.blockId] ?? 0) + oy, hl = s.tool === "highlighter", P = s.pts, n = P.length;
    const dash = dashFor(s.lineStyle);
    const pressureWidth = (p: number) => {
      const pressure = clamp(0.5 + (p - 0.5) * pressureSensitivity, 0.05, 1);
      return s.size * (s.penKind === "fountain" ? 0.12 + pressure * 1.75 : s.penKind === "pencil" ? 0.35 + pressure * 0.8 : 0.4 + pressure * 1.2);
    };
    ctx.save();
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = ctx.fillStyle = ink;
    if (s.penKind === "pencil" && !hl) ctx.globalAlpha = 0.62;
    if (dash.length) ctx.setLineDash(dash);
    if (hl) { ctx.globalAlpha = 0.35; ctx.lineWidth = s.size * 5; ctx.lineCap = "butt"; }
    if (n === 1) {
      ctx.beginPath(); ctx.arc(P[0].x + ox, top + P[0].y, (hl ? s.size * 2.5 : s.size * (0.4 + P[0].p * 1.2)) / 2, 0, 7); ctx.fill();
    } else if (hl) { // Textmarker: ein einziger Pfad, Kurve durch die Mittelpunkte (Kontrollpunkt = Messpunkt)
      ctx.beginPath(); ctx.moveTo(P[0].x + ox, top + P[0].y);
      if (s.raw || n < 3) { for (let i = 1; i < n; i++) ctx.lineTo(P[i].x + ox, top + P[i].y); }
      else {
        for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(P[i].x + ox, top + P[i].y, (P[i].x + P[i + 1].x) / 2 + ox, top + (P[i].y + P[i + 1].y) / 2);
        ctx.lineTo(P[n - 1].x + ox, top + P[n - 1].y);
      }
      ctx.stroke();
    } else if (dash.length && !s.raw && n >= 3) {
      ctx.lineWidth = pressureWidth(0.5);
      ctx.beginPath(); ctx.moveTo(P[0].x + ox, top + P[0].y);
      for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(P[i].x + ox, top + P[i].y, (P[i].x + P[i + 1].x) / 2 + ox, top + (P[i].y + P[i + 1].y) / 2);
      ctx.lineTo(P[n - 1].x + ox, top + P[n - 1].y); ctx.stroke();
    } else if (s.raw || n < 3) { // Formen und sehr kurze Striche: gerade Segmente, Ecken bleiben scharf
      for (let i = 1; i < n; i++) {
        ctx.lineWidth = pressureWidth(P[i].p);
        ctx.beginPath(); ctx.moveTo(P[i - 1].x + ox, top + P[i - 1].y); ctx.lineTo(P[i].x + ox, top + P[i].y); ctx.stroke();
      }
    } else { // Stift: je Segment eine quadratische Kurve von Mitte zu Mitte, Breite aus dem (geglätteten) Druck
      let sx = P[0].x + ox, sy = top + P[0].y;
      for (let i = 1; i < n; i++) {
        const last = i === n - 1;
        const ex = last ? P[i].x + ox : (P[i].x + P[i + 1].x) / 2 + ox;
        const ey = last ? top + P[i].y : top + (P[i].y + P[i + 1].y) / 2;
        ctx.lineWidth = pressureWidth(P[i].p);
        ctx.beginPath(); ctx.moveTo(sx, sy);
        if (last) ctx.lineTo(ex, ey); else ctx.quadraticCurveTo(P[i].x + ox, top + P[i].y, ex, ey);
        ctx.stroke();
        sx = ex; sy = ey;
      }
    }
    ctx.restore();
  };
  const paintAdaptive = (ctx: CanvasRenderingContext2D, s: Stroke, ox = 0, oy = 0) => {
    if (s.pts.length < 2) {
      const top = topsRef.current[s.blockId] ?? 0;
      paint(ctx, s, ox, oy, displayInk(s.color, paperAtY(top + oy + (s.pts[0]?.y ?? 0))));
      return;
    }
    const top = topsRef.current[s.blockId] ?? 0;
    let run: Pt[] = [], region: "pdf" | "blank" | "gap" | null = null;
    const flush = () => {
      if (!run.length || !region) return;
      paint(ctx, { ...s, pts: run }, ox, oy, displayInk(s.color, region));
    };
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i], nextRegion = paperAtY(top + oy + p.y);
      if (region !== nextRegion) {
        if (run.length) {
          const last = run[run.length - 1];
          flush();
          run = [{ ...last }]; // keep joins clean where a stroke crosses a paper boundary
        }
        region = nextRegion;
      }
      run.push(p);
    }
    flush();
  };
  const eraseR = () => 6 + size * 3;
  const draw = useCallback(() => {
    const cv = cvRef.current, sc = scRef.current;
    if (!cv || !sc) return;
    const dpr = window.devicePixelRatio || 1, w = sc.clientWidth, h = sc.clientHeight, z = zoomRef.current;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = w + "px"; cv.style.height = h + "px"; cv.style.marginBottom = -h + "px";
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(offX() - sc.scrollLeft, -sc.scrollTop);
    ctx.scale(z, z);
    const v0 = sc.scrollTop / z - 40, v1 = (sc.scrollTop + h) / z + 40;
    for (const s of strokes.current) {
      const top = topsRef.current[s.blockId] ?? 0, bb = bbox(s), isSel = sel.current.has(s.id);
      const oy = isSel ? dragOff.current.y : 0;
      if (isSel && xf.current) { paintAdaptive(ctx, xformStroke(s, xf.current)); continue; }
      if (top + bb.y1 + oy < v0 || top + bb.y0 + oy > v1) continue;
      paintAdaptive(ctx, s, isSel ? dragOff.current.x : 0, oy);
    }
    if (cur.current) paintAdaptive(ctx, cur.current);
    for (const t of textFields.current) if (sel.current.has(t.id)) {
      const r = textRect(liveText(t));
      ctx.save(); ctx.setLineDash([]); ctx.fillStyle = "rgba(37,99,235,.10)"; ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.2 / z;
      ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.restore();
    }
    ctx.save();
    ctx.lineWidth = 1.2 / z; ctx.strokeStyle = "#2563eb";
    if (lasso.current && lasso.current.length > 1) {
      ctx.setLineDash([6 / z, 4 / z]); ctx.beginPath();
      lasso.current.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    const bb = selBox();
    if (bb) { ctx.setLineDash([6 / z, 4 / z]); ctx.fillStyle = "rgba(37,99,235,.06)"; ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0); ctx.strokeRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0); }
    if (bb && tool === "lasso") { // Anfasser: 4 Ecken (Skalieren) + Kreis 22 px über der Mitte (Drehen)
      const hs = 10 / z, hp = handlePts(bb);
      ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.5 / z;
      ctx.beginPath(); ctx.moveTo((bb.x0 + bb.x1) / 2, bb.y0); ctx.lineTo(hp.rot.x, hp.rot.y); ctx.stroke();
      hp.corners.forEach((c) => { ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs); ctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs); });
      ctx.beginPath(); ctx.arc(hp.rot.x, hp.rot.y, hs * 0.6, 0, 7); ctx.fill(); ctx.stroke();
    }
    if (tool === "eraser" && hover.current) { ctx.setLineDash([]); ctx.strokeStyle = "#64748b"; ctx.beginPath(); ctx.arc(hover.current.x, hover.current.y, eraseR(), 0, 7); ctx.stroke(); }
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, size, darkMode, pressureSensitivity]);
  const schedule = useCallback(() => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(draw); }, [draw]);
  useEffect(schedule, [blocks, tool, size, darkMode, schedule]);
  useEffect(() => {
    const sc = scRef.current!, ro = new ResizeObserver(schedule);
    ro.observe(sc); sc.addEventListener("scroll", schedule, { passive: true });
    return () => { ro.disconnect(); sc.removeEventListener("scroll", schedule); };
  }, [schedule]);

  /* ───── Hilfsfunktionen ───── */
  const absPts = (s: Stroke) => s.pts.map((p) => ({ x: p.x, y: (topsRef.current[s.blockId] ?? 0) + p.y }));
  function selBox() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
    for (const s of strokes.current) if (sel.current.has(s.id))
      for (const q of absPts(s)) { const p = xfPt(q); n++; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    for (const t of textFields.current) if (sel.current.has(t.id)) {
      const r = textRect(liveText(t));
      n++; x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1);
    }
    return n ? { x0: x0 - 8, y0: y0 - 8, x1: x1 + 8, y1: y1 + 8 } : null;
  }
  function xfPt(p: { x: number; y: number }) { // Live-Transformation (Skalieren/Drehen um Pivot) + Verschiebung
    const t = xf.current, c = t ? Math.cos(t.rot) : 1, n = t ? Math.sin(t.rot) : 0, k = t ? t.s : 1, px = t ? t.px : 0, py = t ? t.py : 0;
    const ax = p.x - px, ay = p.y - py;
    return { x: px + k * (c * ax - n * ay) + dragOff.current.x, y: py + k * (n * ax + c * ay) + dragOff.current.y };
  }
  const blockAt = (y: number) => {
    const bs = blocksRef.current;
    for (const b of bs) if (y < topsRef.current[b.id] + b.height + b.gap) return b;
    return bs[bs.length - 1];
  };
  const inPoly = (pt: { x: number; y: number }, poly: { x: number; y: number }[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if (poly[i].y > pt.y !== poly[j].y > pt.y && pt.x < ((poly[j].x - poly[i].x) * (pt.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
    return c;
  };
  const toDoc = (cx: number, cy: number) => {
    const sc = scRef.current!, r = sc.getBoundingClientRect(), z = zoomRef.current;
    return { x: (cx - r.left + sc.scrollLeft - offX()) / z, y: (cy - r.top + sc.scrollTop) / z };
  };
  const growTail = (absY: number) => {
    const last = blocksRef.current[blocksRef.current.length - 1];
    if (last.kind === "blank" && absY > topsRef.current[last.id] + last.height - 500)
      setBlocks((bs) => bs.map((b) => (b.id === last.id ? { ...b, height: b.height + TAIL_GROW } : b)));
  };
  // Verschieben + Neuzuordnung: Block = der, in dem der MITTELPUNKT der Bounding Box landet
  const moved = (s: Stroke, dx: number, dy: number): Stroke => {
    const top = topsRef.current[s.blockId] ?? 0;
    const abs = s.pts.map((p) => ({ ...p, x: p.x + dx, y: top + p.y + dy }));
    let y0 = 1e9, y1 = -1e9;
    for (const p of abs) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const nb = blockAt((y0 + y1) / 2), nt = topsRef.current[nb.id];
    return { ...s, blockId: nb.id, pts: abs.map((p) => ({ ...p, y: p.y - nt })) };
  };
  const movedText = (t: TextField, dx: number, dy: number): TextField => {
    const top = topsRef.current[t.blockId] ?? 0, h = textH(t), absY = top + t.y + dy;
    const nb = blockAt(absY + h / 2), nt = topsRef.current[nb.id];
    return { ...t, blockId: nb.id, x: t.x + dx, y: absY - nt, height: h };
  };
  const textRect = (t: TextField) => { const top = topsRef.current[t.blockId] ?? 0; return { x0: t.x, y0: top + t.y, x1: t.x + t.width, y1: top + t.y + textH(t) }; };
  // Textfelder bleiben beim Drehen waagerecht: Mittelpunkt wandert auf der Kreisbahn, Breite/Höhe/Schrift skalieren
  const xformText = (t: TextField, k: XF, dx = 0, dy = 0): TextField => {
    const top = topsRef.current[t.blockId] ?? 0, h0 = textH(t), c = Math.cos(k.rot), n = Math.sin(k.rot);
    const ax = t.x + t.width / 2 - k.px, ay = top + t.y + h0 / 2 - k.py;
    const cx = k.px + k.s * (c * ax - n * ay) + dx, cy = k.py + k.s * (n * ax + c * ay) + dy;
    const w = t.width * k.s, h = h0 * k.s;
    return { ...t, x: cx - w / 2, y: cy - h / 2 - top, width: w, height: h, fontSize: t.fontSize * k.s };
  };
  const liveText = (t: TextField): TextField =>
    sel.current.has(t.id) && (xf.current || dragOff.current.x || dragOff.current.y) ? xformText(t, xf.current ?? IDENT, dragOff.current.x, dragOff.current.y) : t;

  const buildShape = (d: { x: number; y: number }) => {
    const a = shapeA.current!, b = blockAt(a.y), top = topsRef.current[b.id];
    const kind = shapeKind === "line" && hasArrow(lineStyle) ? "arrow" : shapeKind;
    cur.current = { id: cur.current?.id ?? uid(), blockId: b.id, tool: activePen.kind === "marker" ? "highlighter" : "pen", color, size, penKind: activePen.kind, lineStyle, pts: shapePts(kind, a, d).map((p) => ({ ...p, y: p.y - top })), raw: true };
    growTail(d.y);
  };

  /* ───── Lasso-Transformation ───── */
  const handlePts = (bb: { x0: number; y0: number; x1: number; y1: number }) => ({
    corners: [{ x: bb.x0, y: bb.y0 }, { x: bb.x1, y: bb.y0 }, { x: bb.x1, y: bb.y1 }, { x: bb.x0, y: bb.y1 }],
    rot: { x: (bb.x0 + bb.x1) / 2, y: bb.y0 - 22 / zoomRef.current },
  });
  const handleAt = (bb: { x0: number; y0: number; x1: number; y1: number }, d: { x: number; y: number }) => {
    const hp = handlePts(bb), r = 14 / zoomRef.current;
    if (Math.hypot(d.x - hp.rot.x, d.y - hp.rot.y) < r) return { kind: "rotate" as const, i: 0, corners: hp.corners };
    const i = hp.corners.findIndex((c) => Math.hypot(d.x - c.x, d.y - c.y) < r);
    return i >= 0 ? { kind: "scale" as const, i, corners: hp.corners } : null;
  };
  const xformStroke = (s: Stroke, t: XF): Stroke => { // Rotationsmatrix + Skalierung um den Pivot; y bleibt relativ zum alten Block
    const top = topsRef.current[s.blockId] ?? 0, c = Math.cos(t.rot), n = Math.sin(t.rot);
    return { ...s, size: s.size * t.s, pts: s.pts.map((p) => { const ax = p.x - t.px, ay = top + p.y - t.py; return { ...p, x: t.px + t.s * (c * ax - n * ay), y: t.py + t.s * (n * ax + c * ay) - top }; }) };
  };

  /* ───── Textfelder ───── */
  const editText = (id: string, patch: Partial<TextField>) => { textFields.current = textFields.current.map((t) => (t.id === id ? { ...t, ...patch } : t)); bump(); markDirty(); };
  const finishText = () => {
    const cleaned = textFields.current.filter((t) => t.text.trim());
    if (cleaned.length !== textFields.current.length) textFields.current = cleaned;
    const b = textBefore.current;
    if (textFields.current.length !== b.texts.length || textFields.current.some((t, i) => t !== b.texts[i])) pushHist(b);
    bump();
  };
  const startTextDrag = (e: React.PointerEvent, tf: TextField) => {
    e.stopPropagation(); e.preventDefault();
    const s0 = snap(), x0 = e.clientX, y0 = e.clientY;
    let did = false;
    const mv = (ev: PointerEvent) => {
      did = true;
      const z = zoomRef.current;
      textFields.current = textFields.current.map((t) => (t.id === tf.id ? { ...t, x: tf.x + (ev.clientX - x0) / z, y: tf.y + (ev.clientY - y0) / z } : t));
      bump();
    };
    const up = () => {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      if (!did) return;
      textFields.current = textFields.current.map((t) => (t.id === tf.id ? movedText(t, 0, 0) : t)); // gleiche Mittelpunkt-Regel wie beim Lasso
      pushHist(s0); bump();
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };

  /* ───── Radierer: ganzer Strich ODER nur der berührte Teil ───── */
  const erase = (d: { x: number; y: number }) => {
    const r = eraseR(), step = clamp(r / 6, 1, 2.5), list = strokes.current, cnt = list.length;
    // Phase 1: nur prüfen (Indexschleifen, Zahlen, keine Objekte) – der häufige Fall "nichts getroffen" erzeugt keinen Müll
    let any = false;
    for (let k = 0; k < cnt && !any; k++) {
      const s = list[k], top = topsRef.current[s.blockId] ?? 0, bb = bbox(s), m = r + s.size * 3;
      if (d.x < bb.x0 - m || d.x > bb.x1 + m || d.y - top < bb.y0 - m || d.y - top > bb.y1 + m) continue;
      any = strokeHit(s, top, d.x, d.y, r, step);
    }
    if (!any) return;
    // Phase 2 (nur bei Treffer): neue Liste, getroffene Striche entfernen oder in Bruchstücke zerlegen
    const out: Stroke[] = [];
    for (let k = 0; k < cnt; k++) {
      const s = list[k], top = topsRef.current[s.blockId] ?? 0, bb = bbox(s), m = r + s.size * 3;
      if (d.x < bb.x0 - m || d.x > bb.x1 + m || d.y - top < bb.y0 - m || d.y - top > bb.y1 + m || !strokeHit(s, top, d.x, d.y, r, step)) { out.push(s); continue; }
      if (eraseMode === "pixel") cutStroke(s, top, d.x, d.y, r, step, out);
    }
    strokes.current = out;
  };

  /* ───── Pointer-Events: Stift/Maus zeichnen, 1 Finger scrollt, 2 Finger zoomen ───── */
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      if (isPalm(e.nativeEvent) || penActive.current || performance.now() - penLast.current < PALM_GRACE_MS || touches.current.size >= 3) {
        rejected.current.add(e.pointerId); return; // Handballen: komplett ignorieren
      }
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) { const [a, b] = [...touches.current.values()]; pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: zoomRef.current }; }
      return;
    }
    if (e.pointerType === "pen") { // Stift setzt auf: laufende Finger-Gesten abbrechen
      penActive.current = true; penLast.current = performance.now();
      touches.current.forEach((_, id) => rejected.current.add(id)); touches.current.clear(); pinch.current = null;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d = toDoc(e.clientX, e.clientY);
    if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur(); // laufende Texteingabe abschließen
    before.current = snap();
    growTail(d.y);
    if (tool === "pen" || tool === "highlighter") {
      cancelSmartHold(); rawBeforeSmartSnap.current = null;
      const b = blockAt(d.y);
      const strokeTool = activePen.kind === "marker" ? "highlighter" : tool;
      cur.current = { id: uid(), blockId: b.id, tool: strokeTool, color, size, penKind: activePen.kind, lineStyle, pts: [{ x: d.x, y: d.y - topsRef.current[b.id], p: e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5 }] };
    } else if (tool === "text") {
      const b = blockAt(d.y), id = uid();
      textBefore.current = snap(); creating.current = true; focusId.current = id;
      textFields.current = [...textFields.current, { id, blockId: b.id, text: "", x: d.x, y: d.y - topsRef.current[b.id], width: Math.max(80, Math.min(260, PAGE_W - d.x - 8)), height: 28, fontSize: Math.round(10 + size * 3), color }];
      bump();
    } else if (tool === "shape") { shapeA.current = d; buildShape(d); }
    else if (tool === "eraser") erase(d);
    else {
      const bb = selBox();
      const h = bb ? handleAt(bb, d) : null;
      if (bb && h) { // Anfasser gegriffen: Skalieren relativ zur gegenüberliegenden Ecke, Drehen um die Mitte
        const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
        if (h.kind === "rotate") xf.current = { mode: "rotate", px: cx, py: cy, s: 1, rot: 0, d0: 1, a0: Math.atan2(d.y - cy, d.x - cx) };
        else { const o = h.corners[(h.i + 2) % 4], c = h.corners[h.i]; xf.current = { mode: "scale", px: o.x, py: o.y, s: 1, rot: 0, d0: Math.max(1, Math.hypot(c.x - o.x, c.y - o.y)), a0: 0 }; }
      } else if (bb && d.x > bb.x0 && d.x < bb.x1 && d.y > bb.y0 && d.y < bb.y1) drag.current = d;
      else { sel.current = new Set(); lasso.current = [d]; }
    }
    schedule();
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      if (rejected.current.has(e.pointerId)) return;
      if (isPalm(e.nativeEvent) || penActive.current) { rejected.current.add(e.pointerId); touches.current.delete(e.pointerId); pinch.current = null; return; }
      const t = touches.current.get(e.pointerId);
      if (!t) return;
      const dy = e.clientY - t.y, dx = e.clientX - t.x;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()], r = scRef.current!.getBoundingClientRect();
        setZoom((pinch.current.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d0, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      } else if (touches.current.size === 1) { scRef.current!.scrollTop -= dy; scRef.current!.scrollLeft -= dx; }
      return;
    }
    if (e.pointerType === "pen") { penLast.current = performance.now(); if (!(e.buttons & 1)) penActive.current = false; }
    hover.current = toDoc(e.clientX, e.clientY);
    if (!(e.buttons & 1)) { if (tool === "eraser") schedule(); return; }
    const evs = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of evs) {
      const d = toDoc(ev.clientX, ev.clientY);
      if (shapeA.current) buildShape(d);
      else if (cur.current) {
        if (rawBeforeSmartSnap.current) { cur.current = rawBeforeSmartSnap.current; rawBeforeSmartSnap.current = null; }
        const pts = cur.current.pts, last = pts[pts.length - 1], ly = d.y - topsRef.current[cur.current.blockId], md = MIN_DIST / zoomRef.current;
        const ddx = d.x - last.x, ddy = ly - last.y;
        if (ddx * ddx + ddy * ddy >= md * md) { // Mikro-Zittern überspringen
          const rawP = e.pointerType === "pen" ? (ev.pressure > 0 ? ev.pressure : last.p) : 0.5;
          pts.push({ x: d.x, y: ly, p: last.p + (rawP - last.p) * PRESSURE_LERP }); // Tiefpass: p = lerp(letzter, neuer, 0,2)
          armSmartHold();
        }
        growTail(d.y);
      } else if (tool === "eraser") erase(d);
      else if (lasso.current) lasso.current.push(d);
      else if (xf.current) {
        const t = xf.current;
        if (t.mode === "scale") t.s = clamp(Math.hypot(d.x - t.px, d.y - t.py) / t.d0, 0.1, 10);
        else t.rot = Math.atan2(d.y - t.py, d.x - t.px) - t.a0;
      }
      else if (drag.current) { dragOff.current = { x: dragOff.current.x + d.x - drag.current.x, y: dragOff.current.y + d.y - drag.current.y }; drag.current = d; }
    }
    if ((xf.current || drag.current) && textFields.current.some((t) => sel.current.has(t.id))) bump(); // Textfeld-Vorschau
    schedule();
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") { rejected.current.delete(e.pointerId); touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null; return; }
    cancelSmartHold();
    if (e.pointerType === "pen") { penActive.current = false; penLast.current = performance.now(); }
    if (cur.current) {
      const stroke = cur.current;
      const finalStroke = !stroke.raw && hasArrow(stroke.lineStyle) && stroke.pts.length > 1
        ? { ...stroke, pts: shapePts("arrow", stroke.pts[0], stroke.pts[stroke.pts.length - 1]), raw: true }
        : stroke;
      strokes.current = [...strokes.current, finalStroke]; cur.current = null; rawBeforeSmartSnap.current = null;
    }
    shapeA.current = null;
    if (focusId.current) { document.getElementById("tf-" + focusId.current)?.focus(); focusId.current = null; }
    if (lasso.current && lasso.current.length > 2) {
      const poly = lasso.current;
      const hitS = strokes.current.filter((s) => { const a = absPts(s); return a.filter((p) => inPoly(p, poly)).length > a.length / 2; }).map((s) => s.id);
      const hitT = textFields.current.filter((t) => { // Textfeld gilt als erfasst, wenn alle 4 Ecken seiner Box im Lasso liegen
        const r = textRect(t);
        return [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }].every((c) => inPoly(c, poly));
      }).map((t) => t.id);
      sel.current = new Set([...hitS, ...hitT]);
      if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur(); // Tastatur gehört jetzt dem Lasso
    }
    if (xf.current) { // Transformation dauerhaft in die Punkte schreiben und über moved() im passenden Block verankern
      const t = xf.current;
      if (t.s !== 1 || t.rot !== 0) {
        const bb = selBox(); if (bb) growTail(bb.y1);
        strokes.current = strokes.current.map((s) => (sel.current.has(s.id) ? moved(xformStroke(s, t), 0, 0) : s));
        textFields.current = textFields.current.map((tf) => (sel.current.has(tf.id) ? movedText(xformText(tf, t), 0, 0) : tf));
      }
      xf.current = null;
    }
    if (drag.current) {
      const { x, y } = dragOff.current;
      if (x || y) {
        const bb = selBox(); if (bb) growTail(bb.y1);
        strokes.current = strokes.current.map((s) => (sel.current.has(s.id) ? moved(s, x, y) : s));
        textFields.current = textFields.current.map((tf) => (sel.current.has(tf.id) ? movedText(tf, x, y) : tf));
      }
      dragOff.current = { x: 0, y: 0 };
    }
    lasso.current = null; drag.current = null;
    if (strokes.current !== before.current.strokes || (tool !== "text" && textFields.current !== before.current.texts)) pushHist(before.current);
    bump(); // 1 Geste = 1 Undo-Schritt
    schedule();
  };

  /* ───── Seiten-Management: leere Seite einfügen, Seiten umsortieren ───── */
  // Striche und Textfelder hängen per blockId an ihrem Block und speichern y relativ zu dessen Oberkante.
  // Die absolute Position ergibt sich bei jedem Rendern aus tops[blockId]; ändert sich die Reihenfolge der Blöcke,
  // wandern deshalb alle Elemente von selbst mit – es muss kein einziges Element angefasst werden.
  const pendingScroll = useRef<string | null>(null);
  useLayoutEffect(() => { // nach der Änderung zur betroffenen Seite scrollen
    const id = pendingScroll.current, sc = scRef.current;
    if (!id || !sc || topsRef.current[id] === undefined) return;
    pendingScroll.current = null;
    sc.scrollTo({ top: Math.max(0, topsRef.current[id] * zoomRef.current - 12), behavior: "smooth" });
  }, [blocks]);

  /** Fügt eine leere Blanko-Seite (1600 px) VOR dem Block an blockIndex ein. Der freie Bereich am Ende bleibt der letzte Block. */
  const insertEmptyPageAt = (blockIndex: number) => {
    const bs = blocksRef.current;
    if (!Number.isFinite(blockIndex)) return;
    const i = clamp(Math.round(blockIndex), 0, bs.length - 1);
    const page: Block = { id: uid(), kind: "blank", height: 1600, gap: MIN_GAP };
    const s0 = snap(); // Verlaufs-Snapshot VOR der Änderung
    pendingScroll.current = page.id;
    setBlocks([...bs.slice(0, i), page, ...bs.slice(i)]);
    pushHist(s0);      // setzt den Undo-Schritt und startet das Auto-Speichern
  };

  /** Verschiebt den Block fromIndex so, dass er danach an toIndex steht. Der freie Bereich am Ende bleibt fest. */
  const moveBlock = (fromIndex: number, toIndex: number) => {
    const bs = blocksRef.current, last = bs.length - 1;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= last || toIndex < 0 || toIndex >= last) return;
    const s0 = snap();
    const next = bs.slice();
    const [b] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, b);
    pendingScroll.current = b.id;
    setBlocks(next);
    pushHist(s0);
  };

  /* ───── Zwischenraum ───── */
  const setGap = (id: string, gap: number) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, gap: Math.max(MIN_GAP, gap) } : b)));
  const addSpaceAtView = () => {
    const sc = scRef.current!, b = blockAt((sc.scrollTop + sc.clientHeight / 2) / zoomRef.current), s0 = snap();
    setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, gap: Math.max(x.gap, MIN_GAP) + SPACE_STEP } : x)));
    pushHist(s0);
  };
  const startGapDrag = (e: React.PointerEvent, b: Block) => {
    e.stopPropagation();
    const y0 = e.clientY, g0 = b.gap, s0 = snap();
    const mv = (ev: PointerEvent) => setGap(b.id, g0 + (ev.clientY - y0) / zoomRef.current);
    const up = () => {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      setTimeout(() => { if (blocksRef.current !== s0.blocks) pushHist(s0); }, 0);
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };

  /* ───── PDF-Import (Datei wird in IndexedDB abgelegt) ───── */
  const importPdf = async (file: File) => {
    const buf = await file.arrayBuffer(), docId = uid();
    await kvSet("pdf:" + docId, new Blob([buf], { type: "application/pdf" })); // Original als Blob offline sichern
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise;       // Vektor-Dokument: scharfes Hochzoomen, Export
    docs.current.set(docId, doc);
    const nb: Block[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
      nb.push({ id: uid(), kind: "pdf", docId, pageNum: i, height: Math.round((vp.height * PAGE_W) / vp.width), gap: MIN_GAP });
    }
    const s0 = snap();
    setBlocks((bs) => [...bs.slice(0, -1), ...nb, bs[bs.length - 1]]); // Seiten sofort sichtbar, ohne auf die Bilder zu warten
    pushHist(s0);
    // Hintergrund: Rasterbilder im Web Worker erzeugen, in IndexedDB ablegen und den fertigen Seiten melden
    setSaved("PDF wird aufbereitet …");
    const ok = await rasterizeInWorker(buf.slice(0), async (n, total, blob) => {
      const key = rasterKey(docId, n);
      await kvSet(key, blob);
      window.dispatchEvent(new CustomEvent("pdfraster", { detail: key }));
      setSaved(`PDF wird aufbereitet … ${n}/${total}`);
    });
    setSaved(ok ? "PDF aufbereitet" : "PDF importiert (Vorschaubilder unvollständig, Seiten werden live gezeichnet)");
  };

  /* ───── PDF-Export: Leinwand in A4-Kacheln (794×1123 px, 2× Auflösung) ───── */
  const exportPdf = async () => {
    setSaved("Exportiere …");
    const { jsPDF } = await import("jspdf");
    const printableInk = (ink: string) => {
      if (!/^#[0-9a-f]{6}$/i.test(ink)) return ink;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.94 ? "#111827" : ink;
    };
    const S = 2, TH = 1123, bs = blocksRef.current, bmp = new Map<string, HTMLCanvasElement>();
    for (const b of bs) {
      const doc = b.kind === "pdf" ? docs.current.get(b.docId!) : undefined;
      if (!doc) continue;
      const page = await doc.getPage(b.pageNum!), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: (PAGE_W / base.width) * S });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp } as Parameters<typeof page.render>[0]).promise;
      bmp.set(b.id, c);
    }
    let end = TH;
    for (const b of bs) if (b.kind === "pdf") end = Math.max(end, topsRef.current[b.id] + b.height);
    for (const s of strokes.current) end = Math.max(end, (topsRef.current[s.blockId] ?? 0) + bbox(s).y1 + 20);
    for (const t of textFields.current) end = Math.max(end, (topsRef.current[t.blockId] ?? 0) + t.y + t.height + 20);
    const drawTpl = (ctx: CanvasRenderingContext2D, top: number, h: number) => {
      if (tpl === "blank") return;
      if (tpl === "dots") {
        ctx.fillStyle = "#cbd5e1";
        for (let y = top + 12; y <= top + h; y += 24) {
          for (let x = 12; x <= PAGE_W; x += 24) {
            ctx.beginPath(); ctx.arc(x, y, 1.25, 0, Math.PI * 2); ctx.fill();
          }
        }
        return;
      }
      ctx.strokeStyle = tpl === "lined" ? "#cbd5e1" : "#e2e8f0"; ctx.lineWidth = 1; ctx.beginPath();
      for (let y = top + (tpl === "lined" ? 23 : 0); y <= top + h; y += 24) { ctx.moveTo(0, y + 0.5); ctx.lineTo(PAGE_W, y + 0.5); }
      if (tpl === "grid") for (let x = 0; x <= PAGE_W; x += 24) { ctx.moveTo(x + 0.5, top); ctx.lineTo(x + 0.5, top + h); }
      ctx.stroke();
    };
    const pdf = new jsPDF({ unit: "px", format: [PAGE_W, TH], hotfixes: ["px_scaling"] }), pages = Math.ceil(end / TH);
    for (let i = 0; i < pages; i++) {
      const y0 = i * TH, cv = document.createElement("canvas");
      cv.width = PAGE_W * S; cv.height = TH * S;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.scale(S, S); ctx.translate(0, -y0);
      for (const b of bs) {
        const t = topsRef.current[b.id];
        if (t + b.height + b.gap < y0 || t > y0 + TH) continue;
        if (b.kind === "pdf") {
          const img = bmp.get(b.id);
          if (img) ctx.drawImage(img, 0, t, PAGE_W, b.height);
          if (b.gap > 0) drawTpl(ctx, t + b.height, b.gap);
        } else drawTpl(ctx, t, b.height);
      }
      strokes.current.forEach((s) => paint(ctx, s, 0, 0, printableInk(s.color)));
      textFields.current.forEach((t) => {
        const lh = t.fontSize * 1.375;
        let y = (topsRef.current[t.blockId] ?? 0) + t.y + 2;
        ctx.fillStyle = printableInk(t.color); ctx.font = `${t.fontSize}px sans-serif`; ctx.textBaseline = "top";
        for (const para of t.text.split("\n")) {
          let line = "";
          for (const w of para.split(" ")) {
            const test = line ? line + " " + w : w;
            if (line && ctx.measureText(test).width > t.width - 4) { ctx.fillText(line, t.x + 2, y); y += lh; line = w; } else line = test;
          }
          ctx.fillText(line, t.x + 2, y); y += lh;
        }
      });
      pdf.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, PAGE_W, TH);
      if (i < pages - 1) pdf.addPage([PAGE_W, TH]);
    }
    await saveFile(pdf.output("blob"), (title?.split(" › ").pop() || "Notiz") + ".pdf");
    setSaved("Exportiert");
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if ((e.target as HTMLElement)?.closest?.("textarea, input, select")) return; // in Textfeldern gilt das native Undo
      const key = e.key.toLowerCase();
      if (key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (key === "y") { e.preventDefault(); redo(); }
      else if (key === "0") { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  /* ───── Entf, Strg+C, Strg+V für die Lasso-Auswahl (Striche + Textfelder) ───── */
  useEffect(() => { // Auswahl gilt nur im Lasso-Modus
    if (tool !== "lasso") { sel.current = new Set(); bump(); schedule(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);
  const deleteSel = () => {
    if (!sel.current.size) return;
    const b0 = snap();
    strokes.current = strokes.current.filter((x) => !sel.current.has(x.id));
    textFields.current = textFields.current.filter((t) => !sel.current.has(t.id));
    sel.current = new Set(); pushHist(b0); bump(); schedule();
  };
  const copySel = () => { // Auswahl mit absoluten Koordinaten in die globale Zwischenablage
    if (!sel.current.size) return;
    const top = (id: string) => topsRef.current[id] ?? 0;
    sharedClip.noteId = noteId;
    sharedClip.strokes = strokes.current.filter((x) => sel.current.has(x.id)).map((x) => ({ ...cloneStroke(x), blockId: "", pts: x.pts.map((p) => ({ ...p, y: top(x.blockId) + p.y })) }));
    sharedClip.texts = textFields.current.filter((t) => sel.current.has(t.id)).map((t) => ({ ...cloneText(t), blockId: "", y: top(t.blockId) + t.y }));
    persistClip();
    setClipCount(clipSize()); bump();
  };
  const pasteClip = () => {
    if (!sharedClip.strokes.length && !sharedClip.texts.length) return;
    let x0 = 1e9, y0 = 1e9;
    sharedClip.strokes.forEach((x) => x.pts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); }));
    sharedClip.texts.forEach((t) => { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); });
    // gleiche Notiz: +30 px; andere Notiz: oben links im sichtbaren Bereich
    const same = sharedClip.noteId === noteId, dx = same ? 30 : 40 - x0, dy = same ? 30 : scRef.current!.scrollTop / zoomRef.current + 40 - y0;
    const b0 = snap();
    const ps = sharedClip.strokes.map((x) => moved(cloneStroke(x), dx, dy));   // blockId "" → Top 0 → absolut → Mittelpunkt wählt den Block
    const pt = sharedClip.texts.map((t) => movedText(cloneText(t), dx, dy));
    strokes.current = [...strokes.current, ...ps];
    textFields.current = [...textFields.current, ...pt];
    sharedClip.noteId = noteId; // weiteres Einfügen versetzt erneut
    sharedClip.strokes = sharedClip.strokes.map((x) => ({ ...x, pts: x.pts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }));
    sharedClip.texts = sharedClip.texts.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
    persistClip(); setClipCount(clipSize());
    setTool("lasso");
    sel.current = new Set([...ps, ...pt].map((x) => x.id));
    const bb = selBox(); if (bb) growTail(bb.y1);
    pushHist(b0); bump(); schedule();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = (e.target as HTMLElement)?.closest?.("textarea, input, select");
      if (el && !(el instanceof HTMLTextAreaElement && el.readOnly)) return; // echte Texteingabe hat Vorrang
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if ((e.key === "Delete" || e.key === "Backspace") && sel.current.size) { e.preventDefault(); deleteSel(); }
      else if (mod && key === "c" && sel.current.size) { e.preventDefault(); copySel(); }
      else if (mod && key === "v") { e.preventDefault(); pasteClip(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const clipFilled = clipCount > 0;
  const showBar = sel.current.size > 0 || (tool === "lasso" && clipFilled);
  // pointerdown feuert sofort (keine 300-ms-Klickverzögerung) und gilt für Finger, Stift und Maus
  const abtn = (label: string, on: () => void, off: boolean) => (
    <button key={label} disabled={off} style={{ touchAction: "manipulation" }}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); if (!off) on(); }}
      className="min-w-[92px] h-12 px-4 rounded-xl bg-slate-900 text-white text-sm font-medium select-none active:bg-slate-600 disabled:opacity-30">{label}</button>
  );

  /* ───── UI ───── */
  const tplStyle: React.CSSProperties =
    tpl === "lined" ? { backgroundImage: `linear-gradient(${darkMode ? "#334155" : "#cbd5e1"} 1px, transparent 1px)`, backgroundSize: "100% 24px", backgroundPosition: "0 23px" }
    : tpl === "grid" ? { backgroundImage: `linear-gradient(${darkMode ? "#334155" : "#e2e8f0"} 1px, transparent 1px), linear-gradient(90deg, ${darkMode ? "#334155" : "#e2e8f0"} 1px, transparent 1px)`, backgroundSize: "24px 24px" }
    : tpl === "dots" ? { backgroundImage: `radial-gradient(circle, ${darkMode ? "#475569" : "#cbd5e1"} 1px, transparent 1.2px)`, backgroundSize: "24px 24px", backgroundPosition: "12px 12px" }
    : {};
  const btn = (on: boolean) => `px-3 py-2 rounded-lg text-sm transition select-none ${on ? "bg-slate-900 text-white" : "hover:bg-slate-200 text-slate-700"}`;
  const palette = [...COLORS, ...customColors.filter((c) => !COLORS.includes(c))];
  const tools: [Tool, string][] = [["pen", "✒ Stift"], ["highlighter", "▰ Marker"], ["eraser", "Radierer"], ["lasso", "Lasso"], ["shape", "Form"], ["text", "Text"]];
  const toolIcon = (kind: Tool) => {
    const paths: Record<Tool, React.ReactNode> = {
      pen: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14.5 7.5 3 3"/></>,
      highlighter: <><path d="m4 16 9-9 5 5-9 9H4z"/><path d="m12 8 4 4M4 21h16"/></>,
      eraser: <><path d="m7 21-4-4a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-7 7z"/><path d="m7 21 7-7"/></>,
      lasso: <><path d="M9 17c-4 0-6-2-6-5 0-4 4-7 9-7s9 2 9 6-4 7-9 7"/><path d="M9 17c0 2-1 4-3 4-1 0-2-1-2-2s1-2 2-2h3Z"/></>,
      shape: <><rect x="4" y="4" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/><path d="m15 5 5 5"/></>,
      text: <><path d="M4 6V4h16v2M12 4v16M8 20h8"/></>,
    };
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>;
  };
  const Sep = () => <span className="w-px h-6 bg-slate-200" />;

  return (
    <div className="notiz-workspace relative h-full flex-1 min-w-0 flex flex-col bg-slate-100 text-slate-800 select-none overscroll-none" data-theme={darkMode ? "dark" : "light"}>
      <header className="flex items-center gap-1.5 px-3 py-2 bg-white border-b border-slate-200 flex-wrap">
        {onLibrary && <button className={btn(false)} onClick={onLibrary}>Bibliothek</button>}
        <button className={btn(sidebar)} onClick={() => setSidebar(!sidebar)}>Seiten</button>
        <button className={btn(toolbarCollapsed)} onClick={() => setToolbarCollapsed(!toolbarCollapsed)} aria-pressed={toolbarCollapsed} title={toolbarCollapsed ? "Werkzeugleiste ausklappen" : "Werkzeugleiste einklappen"}>
          {toolbarCollapsed ? "Leiste ausklappen" : "Leiste einklappen"}
        </button>
        <Sep />
        {tools.map(([t, l]) => <button key={t} title={l} aria-label={l} aria-pressed={tool === t} className={btn(tool === t) + " inline-flex items-center gap-1.5"} onClick={() => {
          if (t === "pen") { const p = activePen.kind === "marker" ? penProfiles.find((x) => x.kind !== "marker") : activePen; if (p) choosePen(p); else setTool(t); }
          else if (t === "highlighter") { const p = penProfiles.find((x) => x.kind === "marker"); if (p) choosePen(p); else setTool(t); }
          else setTool(t);
        }}>{toolIcon(t)}{!toolbarCollapsed && <span>{l.replace("✒ ", "").replace("▰ ", "")}</span>}</button>)}
        {(tool === "pen" || tool === "highlighter") && (
          <>
            <select aria-label="Stifttyp" title="Strichverhalten" className="px-2 py-2 rounded-lg bg-slate-100 text-sm" value={activePen.kind}
              onChange={(e) => { const kind = e.target.value as PenKind; changePen({ kind }); setTool(kind === "marker" ? "highlighter" : "pen"); }}>
              <option value="ballpoint">Kugelschreiber</option><option value="fountain">Füller</option><option value="pencil">Bleistift</option><option value="marker">Textmarker</option>
            </select>
            {toolbarCollapsed && <select aria-label="Gespeichertes Stiftprofil" title="Meine Stifte" className="max-w-36 px-2 py-2 rounded-lg bg-slate-100 text-sm" value={activePen.id} onChange={(e) => { const p = penProfiles.find((x) => x.id === e.target.value); if (p) choosePen(p); }}>
              {penProfiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.color}</option>)}
            </select>}
            {toolbarCollapsed && <button className={btn(false)} onClick={addPenProfile} title="Eigenen Stift hinzufügen">＋ Stift</button>}
          </>
        )}
        {tool === "eraser" && (
          <select className="px-2 py-2 rounded-lg bg-slate-100 text-sm" value={eraseMode} onChange={(e) => setEraseMode(e.target.value as "pixel" | "stroke")}>
            <option value="pixel">Nur berührter Teil</option>
            <option value="stroke">Ganzer Strich</option>
          </select>
        )}
        {tool === "shape" && (
          <select className="px-2 py-2 rounded-lg bg-slate-100 text-sm" value={shapeKind} onChange={(e) => setShapeKind(e.target.value as Shape)}>
            <option value="rect">Rechteck</option><option value="triangle">Dreieck</option><option value="ellipse">Kreis</option><option value="line">Gerade Linie</option><option value="arrow">Pfeil</option>
          </select>
        )}
        {(tool === "pen" || tool === "shape") && <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5" aria-label="Linienstil">
          {LINE_STYLES.map((s) => <button key={s.id} title={s.title} aria-label={s.title} onClick={() => setLineStyle(s.id)} className={`rounded px-1.5 py-1 text-xs font-mono ${lineStyle === s.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{s.label}</button>)}
        </div>}
        <Sep />
        {palette.map((c) => (
          <button key={c} aria-label={`Farbe ${c}`} onClick={() => { setColor(c); changePen({ color: c }); }} style={{ background: c }} className={`w-7 h-7 rounded-full border border-slate-300 ${color === c ? "ring-2 ring-offset-2 ring-slate-900" : ""}`} />
        ))}
        <label className="relative inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-slate-400 text-slate-500" title="Eigene Stiftfarbe hinzufügen" aria-label="Eigene Stiftfarbe hinzufügen">
          <span aria-hidden="true">＋</span><input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={(e) => addCustomColor(e.target.value)} aria-label="Eigene Stiftfarbe" />
        </label>
        <input type="range" min={1} max={10} step={0.5} value={size} onChange={(e) => { const v = +e.target.value; setSize(v); changePen({ size: v }); }} className="w-24" aria-label="Strichstärke / Radiergröße" />
        {(tool === "pen" || tool === "shape") && <span className="text-[10px] text-slate-500">Am Ende 0,65 s halten = glätten</span>}
        {tool === "lasso" && sel.current.size > 0 && <button className={btn(false)} onClick={perfectSelected} title="Markierte Linien und Grundformen eines Schaltbilds begradigen">Schaltbild glätten</button>}
        <Sep />
        <button className={btn(false)} onClick={undo} title="Strg+Z">Rückgängig</button>
        <button className={btn(false)} onClick={redo} title="Strg+Y">Wiederholen</button>
        <Sep />
        <button className={btn(false)} onClick={() => setZoom(zoomRef.current / 1.25)} aria-label="Verkleinern">−</button>
        <button className={btn(false)} onClick={() => setZoom(1)} title="Strg+0">{Math.round(zoom * 100)} %</button>
        <button className={btn(false)} onClick={() => setZoom(zoomRef.current * 1.25)} aria-label="Vergrößern">+</button>
        <button className={btn(false)} onClick={() => setZoom((scRef.current!.clientWidth - 32) / PAGE_W)}>Breite</button>
        <Sep />
        <button className={btn(false)} onClick={addSpaceAtView}>Platz einfügen</button>
        {title && <span className="text-sm font-medium truncate max-w-[18rem] ml-2">{title}</span>}
        <span className="text-xs text-slate-500 ml-2">{saved}</span>
        <select className="px-2 py-2 rounded-lg bg-slate-100 text-sm" value={tpl} onChange={(e) => setTplState(e.target.value as Tpl)} aria-label="Seitenvorlage">
          <option value="blank">Blanko</option><option value="lined">Liniert</option><option value="grid">Kariert</option><option value="dots">Punktraster</option>
        </select>
        <button className={btn(false)} onClick={exportPdf}>Als PDF exportieren</button>
        <button className={btn(settingsOpen)} onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen} aria-controls="notizraum-settings">⚙ Einstellungen</button>
        <label className={btn(false) + " cursor-pointer ml-auto"}>
          PDF importieren
          <input type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importPdf(f); e.target.value = ""; }} />
        </label>
      </header>

      {(tool === "pen" || tool === "highlighter") && !toolbarCollapsed && <div className="notiz-pen-strip flex items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2" role="group" aria-label="Meine Stiftprofile">
        <span className="shrink-0 text-xs font-semibold text-slate-500">Meine Stifte</span>
        {penProfiles.map((p) => <button key={p.id} type="button" aria-pressed={activePen.id === p.id} onClick={() => choosePen(p)}
          className={`notiz-pen-preset inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-left ${activePen.id === p.id ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
          <span className="h-3 w-3 rounded-full border border-slate-300" style={{ backgroundColor: p.color }} />
          <span className="text-xs font-medium text-slate-700">{p.name}</span>
          <span className="text-[10px] text-slate-500">{p.kind === "marker" ? "Marker" : p.kind === "fountain" ? "Füller" : p.kind === "pencil" ? "Bleistift" : "Kugel"} · {p.size.toFixed(1)}</span>
        </button>)}
        <button className={btn(false) + " shrink-0"} onClick={addPenProfile}>＋ Stift hinzufügen</button>
      </div>}

      <div className="flex flex-1 min-h-0">
        {sidebar && (
          <aside className="w-44 shrink-0 overflow-auto bg-white border-r border-slate-200 p-2 space-y-1">
            {blocks.map((b, i) => (
              <div key={b.id}>
                <button onClick={() => insertEmptyPageAt(i)} title="Leere Seite hier einfügen" aria-label={"Leere Seite vor Seite " + (i + 1) + " einfügen"}
                  className="w-full h-6 rounded text-[11px] text-slate-400 hover:text-blue-600 hover:bg-blue-50 select-none">＋ Seite</button>
                <div className="flex items-center gap-0.5">
                  <button className="flex-1 min-w-0 text-left px-2 py-2 rounded-md text-sm truncate hover:bg-slate-100"
                    onClick={() => scRef.current!.scrollTo({ top: tops[b.id] * zoom - 12, behavior: "smooth" })}>
                    {i + 1}. {b.kind === "pdf" ? `PDF S. ${b.pageNum}` : i === blocks.length - 1 ? "Freier Bereich" : "Leere Seite"}
                  </button>
                  {i < blocks.length - 1 && (
                    <>
                      <button disabled={i === 0} onClick={() => moveBlock(i, i - 1)} aria-label="Seite nach oben"
                        className="w-8 h-9 rounded-md text-xs hover:bg-slate-100 disabled:opacity-25">▲</button>
                      <button disabled={i >= blocks.length - 2} onClick={() => moveBlock(i, i + 1)} aria-label="Seite nach unten"
                        className="w-8 h-9 rounded-md text-xs hover:bg-slate-100 disabled:opacity-25">▼</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </aside>
        )}
        <div ref={scRef} className="flex-1 overflow-auto relative" style={{ touchAction: "none", cursor: tool === "lasso" ? "crosshair" : tool === "eraser" ? "none" : tool === "text" ? "text" : "default" }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onDoubleClick={(e) => {
            if (tool !== "lasso") return;
            if (sel.current.size === 0) {
              const p = toDoc(e.clientX, e.clientY), rx = PAGE_W * 0.45, ry = PAGE_W * 0.3;
              sel.current = new Set(strokes.current.filter((s) => {
                const bb = bbox(s), top = topsRef.current[s.blockId] ?? 0;
                return bb.x1 >= p.x - rx && bb.x0 <= p.x + rx && top + bb.y1 >= p.y - ry && top + bb.y0 <= p.y + ry;
              }).map((s) => s.id));
              bump();
            }
            if (sel.current.size > 0) perfectSelected(); else setSaved("Kein handgezeichnetes Schaltbild in der Nähe erkannt");
          }}>
          <canvas ref={cvRef} className="sticky top-0 left-0 z-10 pointer-events-none block" />
          <div className="relative mx-auto" style={{ width: PAGE_W * zoom, height: (total + 400) * zoom }}>
            <div className="absolute top-0 left-0" style={{ width: PAGE_W, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
              {blocks.map((b) => (
                <div key={b.id}>
                  <div className="absolute left-0 bg-white shadow-md" data-note-paper={b.kind} style={{ top: tops[b.id], width: PAGE_W, height: b.height, backgroundColor: b.kind === "blank" && darkMode ? "#111827" : "#fff", ...(b.kind === "blank" ? tplStyle : {}) }}>
                    {b.kind === "pdf" && docs.current.get(b.docId!) && <PdfPage doc={docs.current.get(b.docId!)!} docId={b.docId!} pageNum={b.pageNum!} height={b.height} zoom={zoom} getRoot={getScroller} />}
                  </div>
                  {b.kind === "pdf" && (
                    <div onPointerDown={(e) => startGapDrag(e, b)} onDoubleClick={() => setGap(b.id, MIN_GAP)}
                      title="Ziehen = Platz einfügen · Doppelklick = zurücksetzen"
                      className="absolute left-0 group cursor-row-resize" style={{ top: tops[b.id] + b.height, width: PAGE_W, height: Math.max(b.gap, 20) }}>
                      <div className={`w-full border-y border-dashed flex items-center justify-center ${b.gap > MIN_GAP ? "border-blue-300" : "border-transparent group-hover:border-blue-300"}`} style={{ height: b.gap, backgroundColor: darkMode ? "#111827" : "#fff", ...tplStyle }}>
                        <span className="text-xs text-blue-600 opacity-0 group-hover:opacity-100">↕ {Math.round(b.gap)} px Platz</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {textFields.current.map((tf0) => { const tf = liveText(tf0); return (
              <div key={tf.id} className="absolute" style={{ left: tf.x * zoom, top: ((topsRef.current[tf.blockId] ?? 0) + tf.y) * zoom, width: tf.width * zoom, pointerEvents: tool === "text" ? "auto" : "none" }}>
                {tool === "text" && <div title="Verschieben" onPointerDown={(e) => startTextDrag(e, tf)} className="absolute -top-4 -left-1 w-6 h-4 rounded-t bg-blue-500/80 cursor-move" />}
                <textarea id={"tf-" + tf.id} value={tf.text} rows={1} spellCheck={false} readOnly={tool !== "text" || sel.current.has(tf.id)} tabIndex={tool === "text" ? 0 : -1} onPointerDown={(e) => e.stopPropagation()}
                  onFocus={(e) => { if (sel.current.has(tf.id)) { e.currentTarget.blur(); return; } if (!creating.current) textBefore.current = snap(); creating.current = false; }}
                  onChange={(e) => { const el = e.target; el.style.height = "auto"; editText(tf.id, { text: el.value, height: el.scrollHeight / zoom }); }}
                  onBlur={finishText}
                  className="w-full bg-transparent outline-none resize-none overflow-hidden border border-dashed border-blue-300/70 rounded-sm leading-snug block"
                  style={{ color: displayInk(tf.color, paperAtY((topsRef.current[tf.blockId] ?? 0) + tf.y)), fontSize: tf.fontSize * zoom, height: textH(tf) * zoom }} />
              </div>
            ); })}
          </div>
        </div>
      </div>
      {settingsOpen && <div className="notiz-settings-backdrop absolute inset-0 z-40 flex justify-end" onPointerDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
        <aside id="notizraum-settings" role="dialog" aria-modal="true" aria-labelledby="notizraum-settings-title" className="notiz-settings-panel h-full w-[min(380px,92vw)] overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div><span className="text-[10px] font-semibold uppercase tracking-[.14em] text-blue-600">Kontrollzentrum</span><h2 id="notizraum-settings-title" className="mt-1 text-xl font-semibold">Einstellungen</h2></div>
            <button className={btn(false)} aria-label="Einstellungen schließen" onClick={() => setSettingsOpen(false)}>✕</button>
          </div>
          <div className="space-y-5 py-4">
            <section className="notiz-settings-section">
              <h3>App-Design</h3><label htmlFor="app-theme">Erscheinungsbild</label>
              <select id="app-theme" value={theme} onChange={(e) => onThemeChange(e.target.value as ThemePreference)} className="notiz-settings-select">
                <option value="system">Wie auf diesem Gerät</option><option value="light">Hell</option><option value="dark">Dunkel</option>
              </select>
              <p>PDFs und Bilder behalten ihre Originalfarben. Striche passen ihren Kontrast beim Übergang zwischen PDF, Raster-Zwischenraum und dunkler Schreibfläche an.</p>
            </section>
            <section className="notiz-settings-section">
              <h3>Zwischenraum</h3><label htmlFor="settings-template">Papierlayout</label>
              <select id="settings-template" value={tpl} onChange={(e) => setTplState(e.target.value as Tpl)} className="notiz-settings-select">
                <option value="blank">Blanko</option><option value="lined">Liniert</option><option value="grid">Kariert</option><option value="dots">Punktraster</option>
              </select><p>Gilt für eingefügte Schreibflächen zwischen PDF-Seiten. Das Raster bleibt an der Seite verankert.</p>
            </section>
            <section className="notiz-settings-section">
              <h3>Linien &amp; Formen</h3><label htmlFor="settings-line-style">Linienstil</label>
              <select id="settings-line-style" value={lineStyle} onChange={(e) => setLineStyle(e.target.value as LineStyle)} className="notiz-settings-select">
                {LINE_STYLES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <label className="notiz-check-row"><input type="checkbox" checked={smartShapesEnabled} onChange={(e) => setSmartShapesEnabled(e.target.checked)} /><span><strong>Smart Shapes</strong><small>Linie, Rechteck, Dreieck und Kreis beim Halten glätten.</small></span></label>
              <label className="notiz-check-row"><input type="checkbox" checked={circuitAssistEnabled} onChange={(e) => setCircuitAssistEnabled(e.target.checked)} /><span><strong>Schaltbild-Hilfe</strong><small>Ausgewählte Leitungen und Grundformen beim Glätten ausrichten.</small></span></label>
              <p>Wähle Linien mit dem Lasso. „Schaltbild glätten“ oder Doppelklicken richtet erkannte Leitungen und Grundformen aus. Bauteilnamen werden dabei nicht automatisch gelesen.</p>
              <label htmlFor="pressure-sensitivity">Stiftdruckempfindlichkeit · {pressureSensitivity.toFixed(2).replace(".", ",")}</label>
              <input id="pressure-sensitivity" type="range" min="0.25" max="2" step="0.05" value={pressureSensitivity} onChange={(e) => setPressureSensitivity(Number(e.target.value))} aria-label="Stiftdruckempfindlichkeit" />
              <p>Wirkt auf unterstützte druckempfindliche Stifte. Maus und Finger verwenden eine gleichmäßige Stärke.</p>
            </section>
            <section className="notiz-settings-section">
              <h3>Werkzeugleiste</h3>
              <label className="notiz-check-row"><input type="checkbox" checked={toolbarCollapsed} onChange={(e) => setToolbarCollapsed(e.target.checked)} /><span><strong>Werkzeugleiste minimieren</strong><small>Die Schnellleiste mit Linienarten, Farben und Stiftstärke bleibt sichtbar.</small></span></label>
            </section>
            <section className="notiz-settings-section">
              <h3>Speicherung &amp; Export</h3><p>Notizen und PDFs werden lokal auf diesem Gerät gespeichert.</p>
              <div className="flex flex-wrap gap-2"><button className={btn(false)} onClick={onBackup}>Backup speichern</button><button className={btn(false)} onClick={onRestore}>Backup laden</button><button className={btn(false)} onClick={exportPdf}>Als PDF exportieren</button></div>
              <p>Notizen, PDFs und Einstellungen bleiben lokal. Cloud-Backup ist nicht eingerichtet. Für ein anderes Gerät kannst du ein vollständiges Backup exportieren und dort wieder laden.</p>
            </section>
          </div>
        </aside>
      </div>}
      {showBar && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-30 flex gap-2 p-2 rounded-2xl bg-white/95 border border-slate-200 shadow-xl select-none"
          style={{ marginBottom: "env(safe-area-inset-bottom, 0px)", touchAction: "manipulation" }}>
          {abtn("Kopieren", copySel, sel.current.size === 0)}
          {abtn("Einfügen", pasteClip, !clipFilled)}
          {abtn("Löschen", deleteSel, sel.current.size === 0)}
        </div>
      )}
    </div>
  );
}
