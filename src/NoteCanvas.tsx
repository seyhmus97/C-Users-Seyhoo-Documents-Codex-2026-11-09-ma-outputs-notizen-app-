// NoteCanvas.tsx v2 – unendliche Leinwand, PDF-Import, Zwischenraum, Teil-Radierer,
// Undo/Redo (Zeichnen, Radieren, Verschieben, Platz), Zoom, dauerhafte Speicherung (IndexedDB)
// npm i react react-dom pdfjs-dist | Tailwind CSS einrichten
import { PenDiagnostic, PenPreview } from "./PenExtras";
import { openTutorial } from "./Tutorial";
import { GROUPS_ENABLED } from "./features";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { RasterIn, RasterOut } from "./pdfRaster.worker";
import { saveFile } from "./saveFile";
import LabBench, { type LabRecord } from "./LabBench";
import FunctionPlot from "./FunctionPlot";
import MultiFunctionPlot, { curvesFromText, type CurveFlags } from "./MultiFunctionPlot";
import PenGlyph from "./PenGlyph";
import { functionExpressionFromText, parseMathExpression } from "./mathExpression";
import { analyzeCircuitStrokes, type CircuitAnalysis } from "./circuitRecognition";
import { junctionPoints, recognizeSymbols, type SymbolInput } from "./circuitSymbols";
import type { PenKind } from "./penTypes";
import { extendCollinearLine, lineAngleDegrees, snapRadians, snapToAngle, straightLineSpan } from "./lineGeometry";
import { adjustPressure, fountainTaper, inkWidth, pencilLook, recognizePolyline, smoothInk, stabilize, trimHoldTail, type PolylineOptions } from "./inkEngine";
import { straightenWire, tidyCircuit, type TidyItem } from "./circuitTidy";
import { scribbleCovers, scribbleCoversRect, scribbleInfo, shouldAttemptScribbleErase } from "./scribble";

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
type Tool = "pen" | "highlighter" | "eraser" | "lasso" | "shape" | "line" | "text";
type Shape = "rect" | "square" | "ellipse" | "circle" | "triangle" | "diamond" | "pentagon" | "star" | "axes" | "line" | "arrow";
type Tpl = "blank" | "lined" | "grid" | "dots";
type LineStyle = "solid" | "dashed" | "dotted" | "arrow" | "dashedArrow" | "dottedArrow";
type ThemePreference = "system" | "light" | "dark";
type Pt = { x: number; y: number; p: number };
// y ist RELATIV zum Block → Notizen wandern mit, wenn davor Platz eingefügt wird
type Stroke = { id: string; blockId: string; tool: "pen" | "highlighter"; color: string; size: number; pts: Pt[]; raw?: boolean; penKind?: PenKind; lineStyle?: LineStyle; auto?: boolean; fill?: boolean }; // raw: Formen (Ecken) nicht glätten · auto: von der Automatik/„Halten“ begradigt, Winkel NICHT von Hand eingestellt → die Schaltbildhilfe darf ihn ausrichten
type PenProfile = { id: string; name: string; kind: PenKind; color: string; size: number };
type Block = { id: string; kind: "pdf" | "blank"; height: number; gap: number; docId?: string; pageNum?: number };
// Textfeld: y ist (wie bei Strichen) RELATIV zur Oberkante des Blocks → wandert beim Platz-Einfügen mit
interface TextField { id: string; blockId: string; text: string; x: number; y: number; width: number; height: number; fontSize: number; color: string; role?: "function"; functionExpression?: string; functionCurves?: CurveFlags[] }
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
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); _db = null; };
      d.onclose = () => { _db = null; };
      res(d);
    };
    r.onerror = () => { _db = null; rej(r.error); };       // nächster Zugriff versucht es erneut
    r.onblocked = () => { _db = null; rej(new Error("IndexedDB blockiert")); };
  }));
/** Wartet auf das Ende einer Transaktion – auch Abbrüche (z. B. QuotaExceededError bei vollem Speicher) werden zum Fehler. */
const txDone = (t: IDBTransaction) => new Promise<void>((res, rej) => {
  t.oncomplete = () => res();
  t.onerror = () => rej(t.error ?? new Error("IndexedDB-Fehler"));
  t.onabort = () => rej(t.error ?? new Error("IndexedDB-Transaktion abgebrochen"));
});
const isQuotaError = (err: unknown) => err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22);
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
  const t = d.transaction("kv", "readwrite"), done = txDone(t);
  t.objectStore("kv").put(v, k);
  return done;
};

export const kvDel = async (k: string) => {
  const d = await db();
  const t = d.transaction("kv", "readwrite"), done = txDone(t);
  t.objectStore("kv").delete(k);
  return done;
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
  const t = d.transaction("kv", "readwrite"), done = txDone(t), s = t.objectStore("kv");
  try { s.clear(); entries.forEach(([k, v]) => s.put(v, k)); }
  catch (err) { try { t.abort(); } catch { /* Transaktion war schon beendet */ } throw err; } // alte Daten bleiben unangetastet
  return done;
};

/** Die gerade geöffnete Notiz: sofort speichern (z. B. vor einem Backup), ohne die 0,6 s Pause abzuwarten. */
let flushActive: (() => Promise<boolean>) | null = null;
let quotaWarned = false;
export const flushNote = async () => flushActive ? flushActive() : true;

/* ───────── Geometrie ───────── */
// Formen sind normale Striche → Radieren, Lasso, Undo und Export funktionieren automatisch
const shapePts = (kind: Shape, a: { x: number; y: number }, b: { x: number; y: number }): Pt[] => {
  const P = (x: number, y: number): Pt => ({ x, y, p: 0.5 });
  if (kind === "line") return [P(a.x, a.y), P(b.x, b.y)];
  if (kind === "square" || kind === "circle") { // gleich lange Seiten: Größe = längere Zugrichtung
    const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    b = { x: a.x + Math.sign(b.x - a.x || 1) * side, y: a.y + Math.sign(b.y - a.y || 1) * side };
    kind = kind === "square" ? "rect" : "ellipse";
  }
  if (kind === "diamond") { const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2; return [P(cx, a.y), P(b.x, cy), P(cx, b.y), P(a.x, cy), P(cx, a.y)]; }
  if (kind === "pentagon" || kind === "star") {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2, n = kind === "star" ? 10 : 5;
    return Array.from({ length: n + 1 }, (_, i) => { const t = -Math.PI / 2 + (i / n) * 2 * Math.PI, k = kind === "star" && i % 2 ? 0.45 : 1; return P(cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t)); });
  }
  if (kind === "axes") { // Koordinatenachsen mit Pfeilspitzen, als ein zusammenhängender Strich
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y), h = Math.min(10, (x1 - x0) / 6, (y1 - y0) / 6);
    return [P(x0 - h * 0.6, y0 + h), P(x0, y0), P(x0 + h * 0.6, y0 + h), P(x0, y0), P(x0, y1), P(x1, y1), P(x1 - h, y1 - h * 0.6), P(x1, y1), P(x1 - h, y1 + h * 0.6)];
  }
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
  if (pts.length < 3) return null;
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

/** Offener, eckiger Linienzug (Leitung mit Knicken): gerade Segmente, Eckpunkte und Winkel bleiben wie gezeichnet. */
const perfectPolyline = (s: Stroke, options?: PolylineOptions): Stroke | null => {
  if (hasArrow(s.lineStyle)) return null;
  // Standard auch für Halten und „Schaltbild glätten“: höchstens 5 Teilstücke, mindestens 24 Einheiten lang –
  // kleine Zickzack-Schrift (mm, ww, nn) wird so nicht zur Leitung. Der Aufrufer kann das verschärfen.
  const corners = recognizePolyline(s.pts, { maxSegments: 5, minSegment: 24, ...options });
  return corners ? { ...s, pts: corners.map((c) => ({ x: c.x, y: c.y, p: 0.5 })), raw: true } : null;
};
const perfectStroke = (s: Stroke): Stroke | null => {
  const kind = recognizeShape(s.pts);
  if (!kind) return perfectPolyline(s);
  if (kind === "line") { const bent = perfectPolyline(s); if (bent) return bent; } // langer Strich mit deutlichem Knick ist eine Leitung, keine Gerade
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (kind === "ellipse") { const d = Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; x0 = cx - d / 2; x1 = cx + d / 2; y0 = cy - d / 2; y1 = cy + d / 2; }
  const geometry = kind === "line" && hasArrow(s.lineStyle) ? "arrow" : kind;
  const a = kind === "line" ? s.pts[0] : { x: x0, y: y0 };
  const b = kind === "line" ? s.pts[s.pts.length - 1] : { x: x1, y: y1 };
  return { ...s, pts: shapePts(geometry, a, b), raw: true };
};
const straightenCircuitWire = (s: Stroke): Stroke | null => {
  const wire = straightenWire(s.pts); // streng: nur wirklich gerade gemeint (siehe circuitTidy.ts)
  if (!wire) return null;
  return { ...s, pts: shapePts(hasArrow(s.lineStyle) ? "arrow" : "line", wire[0], wire[1]), raw: true };
};
/** Endpunkte eines geraden Strichs (geglättete Linie, Pfeil oder fast gerader Freihandstrich), sonst null. */
const lineEnds = (s: Stroke): { a: Pt; b: Pt } | null => {
  const P = s.pts;
  if (P.length === 2) return { a: P[0], b: P[1] };
  if (s.raw && hasArrow(s.lineStyle) && P.length === 5 && P[1].x === P[3].x && P[1].y === P[3].y) return { a: P[0], b: P[1] };
  if (!s.raw && P.length > 2 && straightLineSpan(P, 14)) return { a: P[0], b: P[P.length - 1] };
  return null;
};
/** Von Hand eingestellte Linie/Pfeil (Endpunktgriff, Formwerkzeug): wird von „Schaltbild glätten“ nicht mehr waagerecht/senkrecht gezwungen.
 *  Automatisch oder per Halten begradigte Linien (auto) zählen nicht dazu – sonst bliebe jede leicht schiefe Leitung schief. */
const isCleanLine = (s: Stroke) => !!s.raw && !s.auto && (s.pts.length === 2 || (hasArrow(s.lineStyle) && s.pts.length === 5));
/** Kleines Winkel-Etikett auf der Zeichenfläche (skaliert gegen den Zoom). */
const angleTag = (ctx: CanvasRenderingContext2D, x: number, y: number, text: string, z: number) => {
  ctx.save(); ctx.setLineDash([]);
  ctx.font = `600 ${12 / z}px Inter, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 12 / z, h = 20 / z;
  ctx.fillStyle = "#191620"; ctx.beginPath(); ctx.roundRect?.(x - w / 2, y - h / 2, w, h, 4 / z); if (!ctx.roundRect) ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.fillText(text, x, y + 0.5 / z);
  ctx.restore();
};
const IDENT: XF = { px: 0, py: 0, s: 1, rot: 0 };
// Bleistift-Körnung: kleine Rauschkachel in der Tintenfarbe, je Farbe einmal erzeugt
const grainCache = new Map<string, CanvasPattern | null>();
const pencilGrain = (ctx: CanvasRenderingContext2D, ink: string): CanvasPattern | string => {
  let pattern = grainCache.get(ink);
  if (pattern === undefined) {
    pattern = null;
    try {
      const size = 48, tile = document.createElement("canvas"); tile.width = tile.height = size;
      const tctx = tile.getContext("2d")!;
      tctx.fillStyle = ink; tctx.fillRect(0, 0, size, size);
      const img = tctx.getImageData(0, 0, size, size);
      let seed = 1234567;
      for (let i = 3; i < img.data.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; img.data[i] = 120 + ((seed >> 16) % 136); } // feste Folge → ruhiges, nicht flimmerndes Korn
      tctx.putImageData(img, 0, 0);
      pattern = ctx.createPattern(tile, "repeat");
      pattern?.setTransform?.(new DOMMatrix().scale(0.5)); // feines Korn, wächst beim Zoomen mit
    } catch { pattern = null; }
    if (grainCache.size > 64) grainCache.clear();
    grainCache.set(ink, pattern);
  }
  return pattern ?? ink;
};
const PRESSURE_LERP = 0.2; // Tiefpass: Anteil des neuen Druckwerts pro Punkt
const MIN_DIST = 0.8;      // Punkte näher als 0,8 Bildschirm-px werden verworfen (Zittern, weniger Punkte)
const PALM_MAX = 25;       // Touch-Kontaktfläche (CSS-px), ab der ein Finger als Handballen gilt
const PALM_AREA = 380;     // … oder Kontaktfläche Breite×Höhe (manche Treiber melden flache, breite Ballen)
const PALM_REVERT_MS = 180;// nur eine direkt folgende Stiftberührung nimmt versehentliches Ballen-Scrollen zurück
const TOUCH_SLOP = 3;      // Fingerbewegung startet fast sofort das Verschieben
const PINCH_LOCK = 0.07;   // Zwei-Finger-Geste: erst ab 7 % Abstandsänderung zoomen, darunter nur verschieben
const A4_H = 1123;         // A4-Höhe bei Seitenbreite 794 px (identisch mit den Seiten des PDF-Exports)
const isPalm = (e: PointerEvent): boolean => e.pointerType === "touch" && (Math.max(e.width, e.height) > PALM_MAX || e.width * e.height > PALM_AREA); // Stift/Maus: immer false
type TouchPt = { x: number; y: number; sx: number; sy: number };
type TouchGesture = {
  mode: "idle" | "pending" | "pan" | "pinch" | "blocked";
  t0: number; scrollLeft: number; scrollTop: number; zoom: number; // Zustand beim Beginn – zum Zurücknehmen, falls es der Handballen war
  pinch?: { d0: number; z0: number; docX: number; docY: number; locked: boolean };
};
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
      if (dx * dx + dy * dy < rr * rr) { if (run.length > 1) out.push({ ...s, fill: undefined, id: uid(), pts: run }); run = []; }
      else run.push({ x: cvX, y: cvY, p: cvP });
    }
  }
  if (run.length > 1) out.push({ ...s, fill: undefined, id: uid(), pts: run });
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
    let ok = true, wd: ReturnType<typeof setTimeout>;
    const finish = () => { clearTimeout(wd); chain.then(() => { w.terminate(); resolve(ok); }); };
    const kick = () => { clearTimeout(wd); wd = setTimeout(() => { ok = false; finish(); }, 90_000); }; // Worker meldet sich 90 s nicht → abbrechen, Seiten werden live gezeichnet
    kick();
    w.onmessage = (e: MessageEvent<RasterOut | undefined>) => {
      const m = e.data;
      if (!m || typeof m !== "object") return; // pdf.js im Worker sendet eigene Nachrichten: ignorieren
      kick();
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
/** Schmale eigene Bildlaufleiste für die Notizfläche. Sie reagiert nur auf die Maus: Die native Leiste am rechten Rand
 *  wurde von aufliegenden Handballen „gegriffen“ und ließ die Seite springen (vor allem nahe am rechten Tabletrand). */
function MouseScrollbar({ getEl, contentKey }: { getEl: () => HTMLDivElement | null; contentKey: string }) {
  const [m, setM] = useState({ top: 0, size: 0, show: false });
  useEffect(() => {
    const el = getEl();
    if (!el) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = el.clientHeight, sh = el.scrollHeight;
        if (sh <= h + 1) { setM((o) => (o.show ? { top: 0, size: 0, show: false } : o)); return; }
        const size = Math.max(40, (h * h) / sh);
        setM({ top: (el.scrollTop / (sh - h)) * (h - size), size, show: true });
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update); ro.observe(el);
    return () => { cancelAnimationFrame(raf); el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [getEl, contentKey]);
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.pointerType !== "mouse" || e.button !== 0) return; // Finger, Handballen und Stift greifen die Leiste nicht
    e.preventDefault();
    const el = getEl();
    if (!el) return;
    const t = e.currentTarget, y0 = e.clientY, s0 = el.scrollTop, h = el.clientHeight, sh = el.scrollHeight;
    const ratio = (sh - h) / Math.max(1, h - Math.max(40, (h * h) / sh));
    t.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => { el.scrollTop = s0 + (ev.clientY - y0) * ratio; };
    const up = () => { t.removeEventListener("pointermove", mv); t.removeEventListener("pointerup", up); t.removeEventListener("pointercancel", up); };
    t.addEventListener("pointermove", mv); t.addEventListener("pointerup", up); t.addEventListener("pointercancel", up);
  };
  if (!m.show) return null;
  return <div className="xnts-scrollbar" aria-hidden="true"><div className="xnts-scrollbar__thumb" style={{ top: m.top, height: m.size }} onPointerDown={startDrag} /></div>;
}

export default function NoteCanvas({ noteId, title, onLibrary, libraryOpen = false, darkMode, theme, onThemeChange, onBackup, onRestore, compact, readOnly, onFocusChange }: { noteId: string; title?: string; onLibrary?: (show: boolean) => void; libraryOpen?: boolean; darkMode: boolean; theme: ThemePreference; onThemeChange: (theme: ThemePreference) => void; onBackup: () => void; onRestore: () => void; /** Lernraum: ohne Kunstbanner, damit die Notizfläche mehr Platz bekommt */ compact?: boolean; /** Nur ansehen (z. B. Gruppenmitglied ohne Schreibrecht): scrollen, zoomen, Seiten wechseln – aber nichts verändern */ readOnly?: boolean; /** meldet den Fokusmodus nach außen, damit Bibliothek bzw. Gruppenleisten mit ausgeblendet werden */ onFocusChange?: (on: boolean) => void }) {
  const toolbarId = useId();
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
  // Glättung der Handschrift (0 = aus … 1 = stark): beruhigt die Eingabe live und glättet beim Absetzen nach
  const [inkSmoothing, setInkSmoothing] = useState(() => {
    try { const raw = localStorage.getItem("notizraum-ink-smoothing"), saved = Number(raw); return raw !== null && Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.5; }
    catch { return 0.5; }
  });
  const inkSmoothingRef = useRef(inkSmoothing); inkSmoothingRef.current = inkSmoothing;
  // Seitentaste des Stifts (z. B. Surface Pen / Slim Pen 2): Lasso wie in OneNote, Radierer oder ohne Funktion
  const [barrelAction, setBarrelAction] = useState<"lasso" | "eraser" | "none">(() => {
    try { const saved = localStorage.getItem("notizraum-pen-barrel"); return saved === "eraser" || saved === "none" ? saved : "lasso"; }
    catch { return "lasso"; }
  });
  // Gerade gezogene Linien und Leitungen beim Absetzen automatisch begradigen (ohne Lasso, ohne Halten)
  const [autoStraighten, setAutoStraighten] = useState(() => { try { return localStorage.getItem("notizraum-auto-straighten") !== "false"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("notizraum-auto-straighten", String(autoStraighten)); } catch { /* preference still works for this session */ } }, [autoStraighten]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [smartShapesEnabled, setSmartShapesEnabled] = useState(() => { try { return localStorage.getItem("notizraum-smart-shapes") !== "false"; } catch { return true; } });
  const [circuitAssistEnabled, setCircuitAssistEnabled] = useState(() => { try { return localStorage.getItem("notizraum-circuit-assist") !== "false"; } catch { return true; } });
  const [scribbleEraseEnabled, setScribbleEraseEnabled] = useState(() => { try { return localStorage.getItem("notizraum-scribble-erase") !== "false"; } catch { return true; } });
  const [circuitAnalysis, setCircuitAnalysis] = useState<CircuitAnalysis | null>(null);
  const [functionDialog, setFunctionDialog] = useState(false);
  const [functionRows, setFunctionRows] = useState<{ expr: string; d: boolean; i: boolean }[]>([{ expr: "x^2", d: false, i: false }]);
  const [functionAnchor, setFunctionAnchor] = useState<{ x: number; y: number } | null>(null);
  const [functionMenuOpen, setFunctionMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const functionMenuTriggerRef = useRef<HTMLDivElement>(null);
  const viewMenuTriggerRef = useRef<HTMLDivElement>(null);
  const functionMenuPanelRef = useRef<HTMLDivElement>(null);
  const viewMenuPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!functionMenuOpen && !viewMenuOpen) return;
    const closeOutside = (e: PointerEvent) => {
      const target = e.target;
      const inFunction = functionMenuOpen && (functionMenuTriggerRef.current?.contains(target as Node) || functionMenuPanelRef.current?.contains(target as Node));
      const inView = viewMenuOpen && (viewMenuTriggerRef.current?.contains(target as Node) || viewMenuPanelRef.current?.contains(target as Node));
      if (!inFunction && !inView) { setFunctionMenuOpen(false); setViewMenuOpen(false); }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [functionMenuOpen, viewMenuOpen]);
  const collapseKey = compact ? "xnts-study-toolbar-collapsed" : "notizraum-toolbar-collapsed";
  const [toolbarCollapsed, setToolbarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(collapseKey);
      return saved === null ? compact || window.matchMedia("(max-width: 1279px)").matches : saved === "true"; // Lernraum: standardmäßig schmale Leiste
    } catch { return !!compact || window.matchMedia("(max-width: 1279px)").matches; }
  });
  // Fokusmodus: Werkzeugleiste und Banner verschwinden, eine kleine schwebende Leiste bleibt → maximale Notizfläche
  const focusKey = compact ? "xnts-study-focus" : "xnts-focus";
  const [focus, setFocus] = useState(() => { try { return localStorage.getItem(focusKey) === "true"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem(focusKey, String(focus)); } catch { /* gilt dann nur für diese Sitzung */ } }, [focus, focusKey]);
  const [focusMini, setFocusMini] = useState(false);
  const focusCb = useRef(onFocusChange); focusCb.current = onFocusChange;
  useEffect(() => { focusCb.current?.(focus); }, [focus]);
  const canEdit = !readOnly;
  const readOnlyRef = useRef(!!readOnly); readOnlyRef.current = !!readOnly;
  const viewPan = useRef<{ id: number; x: number; y: number } | null>(null); // Nur-ansehen: Stift/Maus ziehen verschiebt die Ansicht
  const [sidebar, setSidebar] = useState(() => !compact && window.matchMedia("(min-width: 1280px)").matches); // Lernraum: Seitenliste erst auf Wunsch
  const [zoom, setZoomState] = useState(() => {
    const desktopSidebars = window.matchMedia("(min-width: 1280px)").matches ? 480 : 0;
    return Math.max(MIN_Z, Math.min(1, (window.innerWidth - desktopSidebars - 16) / PAGE_W));
  });
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
  const rejected = useRef(new Set<number>());
  const [clipCount, setClipCount] = useState(clipSize); // löst die UI-Aktualisierung der Action-Bar aus
  const [, bump1] = useState(0);
  const bump = () => bump1((n) => n + 1);
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const touches = useRef(new Map<number, TouchPt>());
  const gesture = useRef<TouchGesture>({ mode: "idle", t0: 0, scrollLeft: 0, scrollTop: 0, zoom: 1 });
  const gestureRaf = useRef(0);
  const restoreScroll = useRef<{ left: number; top: number } | null>(null);
  const [oneFingerScroll, setOneFingerScroll] = useState(() => { try { return localStorage.getItem("xnts-one-finger-scroll") !== "false"; } catch { return true; } });
  const oneFingerRef = useRef(oneFingerScroll); oneFingerRef.current = oneFingerScroll;
  const [pageMarkers, setPageMarkers] = useState(() => { try { return localStorage.getItem("xnts-page-markers") !== "false"; } catch { return true; } });
  const [pdfDeleteMode, setPdfDeleteMode] = useState(false); // bewusst NICHT gespeichert: beim Öffnen einer Notiz ist Löschen immer aus
  const zoomRef = useRef(zoom);
  const anchor = useRef<{ dx: number; dy: number; cx: number; cy: number } | null>(null);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadWarn = useRef(""); // Hinweis vom Laden (z. B. unlesbare PDF) bleibt sichtbar statt sofort von „Gespeichert“ überschrieben zu werden
  const smartHoldTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rawBeforeSmartSnap = useRef<Stroke | null>(null);
  const gestureOn = useRef(false);                 // Stift/Maus berührt gerade die Fläche
  const gTool = useRef<Tool>("pen");               // Werkzeug DIESER Geste (Stiftrückseite → Radierer, Seitentaste → Lasso/Radierer)
  const eraserHover = useRef(false);               // Radierkreis zeigen, auch wenn das Stift-Werkzeug gewählt ist
  const eraseLast = useRef<{ x: number; y: number } | null>(null);  // letzte Radierposition (schnelle Bewegungen lückenlos radieren)
  const holdAnchor = useRef<{ x: number; y: number } | null>(null); // Bildschirmposition, an der der Stift gerade ruht
  const snapInfo = useRef<{ line: boolean; x: number; y: number; base?: Pt[]; cx?: number; cy?: number; d0?: number; scale?: number } | null>(null); // Form wurde durch Halten geglättet; base/cx/cy/d0: Größe per Stiftabstand zur Formmitte
  const endDrag = useRef<{ id: string; which: 0 | 1; orig: Stroke; fixed: { x: number; y: number }; snapped: boolean } | null>(null);
  const [angleSnap, setAngleSnap] = useState(() => { try { return localStorage.getItem("notizraum-angle-snap") === "true"; } catch { return false; } });
  const angleSnapRef = useRef(angleSnap); angleSnapRef.current = angleSnap;
  /* ───── Werkzeugleiste (Vorlage „XNTS Werkzeugleiste“): Kontextleiste, Farbplätze, eigene Werte für Radierer und Linie ───── */
  const readJson = <T,>(key: string, ok: (v: unknown) => boolean, fallback: T): T => { try { const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null"); return ok(v) ? (v as T) : fallback; } catch { return fallback; } };
  const isHexList = (n: number) => (v: unknown) => Array.isArray(v) && v.length === n && v.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c));
  const isNum = (lo: number, hi: number) => (v: unknown) => typeof v === "number" && v >= lo && v <= hi;
  const [ctxOpen, setCtxOpen] = useState(true); // aktives Werkzeug nochmals antippen blendet die Kontextleiste aus/ein
  const [colorSlots, setColorSlots] = useState<string[]>(() => readJson("xnts-color-slots", isHexList(4), ["#1f2937", "#2563eb", "#dc2626", "#16a34a"]));
  const [activeSlot, setActiveSlot] = useState(() => readJson("xnts-color-slot", isNum(0, 3), 0));
  const [focusSlots, setFocusSlots] = useState<string[]>(() => readJson("xnts-focus-color-slots", isHexList(3), ["#1f2937", "#2563eb", "#dc2626"]));
  const [eraserSize, setEraserSize] = useState(() => readJson("xnts-eraser-size", isNum(0.5, 12), 2.5));
  const [lineColor, setLineColor] = useState(() => readJson("xnts-line-color", (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v), "#dc2626"));
  const [lineSize, setLineSize] = useState(() => readJson("xnts-line-size", isNum(0.5, 12), 2.5));
  const [lineToolStyle, setLineToolStyle] = useState<LineStyle>(() => readJson("xnts-line-style", (v) => LINE_STYLES.some((l) => l.id === v), "arrow" as LineStyle));
  const [shapeFill, setShapeFill] = useState(() => readJson("xnts-shape-fill", (v) => typeof v === "boolean", false));
  const [colorMenu, setColorMenu] = useState<string | null>(null); // offenes Farbfenster: "slot0".."slot3", "line", "focus0".."focus2"
  const [focusMenu, setFocusMenu] = useState<"lib" | "pen" | "line" | null>(null);
  useEffect(() => { try {
    localStorage.setItem("xnts-color-slots", JSON.stringify(colorSlots)); localStorage.setItem("xnts-color-slot", JSON.stringify(activeSlot));
    localStorage.setItem("xnts-focus-color-slots", JSON.stringify(focusSlots)); localStorage.setItem("xnts-eraser-size", JSON.stringify(eraserSize));
    localStorage.setItem("xnts-line-color", JSON.stringify(lineColor)); localStorage.setItem("xnts-line-size", JSON.stringify(lineSize));
    localStorage.setItem("xnts-line-style", JSON.stringify(lineToolStyle)); localStorage.setItem("xnts-shape-fill", JSON.stringify(shapeFill));
  } catch { /* Einstellungen gelten dann nur für diese Sitzung */ } }, [colorSlots, activeSlot, focusSlots, eraserSize, lineColor, lineSize, lineToolStyle, shapeFill]);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flash = (text: string) => { setNotice(text); clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(""), 3800); };
  const raf = useRef(0);
  const activePen = penProfiles.find((p) => p.id === activePenId) ?? penProfiles[0] ?? DEFAULT_PENS[0];
  const updatePenProfiles = (next: PenProfile[]) => { setPenProfiles(next); try { localStorage.setItem("notizraum-pen-profiles", JSON.stringify(next)); } catch { /* profiles still work for this session */ } };
  const choosePen = (p: PenProfile) => { setActivePenId(p.id); setColor(p.color); setSize(p.size); setTool(p.kind === "marker" ? "highlighter" : "pen"); };
  const changePen = (patch: Partial<PenProfile>) => updatePenProfiles(penProfiles.map((p) => p.id === activePen.id ? { ...p, ...patch } : p));
  useEffect(() => { try { localStorage.setItem("notizraum-smart-shapes", String(smartShapesEnabled)); } catch { /* preference still works for this session */ } }, [smartShapesEnabled]);
  useEffect(() => { try { localStorage.setItem("notizraum-ink-smoothing", String(inkSmoothing)); } catch { /* preference still works for this session */ } }, [inkSmoothing]);
  useEffect(() => { try { localStorage.setItem("notizraum-pen-barrel", barrelAction); } catch { /* preference still works for this session */ } }, [barrelAction]);
  useEffect(() => { try { localStorage.setItem("notizraum-angle-snap", String(angleSnap)); } catch { /* preference still works for this session */ } }, [angleSnap]);
  useEffect(() => { try { localStorage.setItem("xnts-one-finger-scroll", String(oneFingerScroll)); } catch { /* preference still works for this session */ } }, [oneFingerScroll]);
  useEffect(() => { try { localStorage.setItem("xnts-page-markers", String(pageMarkers)); } catch { /* preference still works for this session */ } }, [pageMarkers]);
  useEffect(() => { try { localStorage.setItem("notizraum-circuit-assist", String(circuitAssistEnabled)); } catch { /* preference still works for this session */ } }, [circuitAssistEnabled]);
  useEffect(() => { try { localStorage.setItem("notizraum-scribble-erase", String(scribbleEraseEnabled)); } catch { /* preference still works for this session */ } }, [scribbleEraseEnabled]);
  useEffect(() => { try { localStorage.setItem(collapseKey, String(toolbarCollapsed)); } catch { /* preference still works for this session */ } }, [toolbarCollapsed, collapseKey]);
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
  const FUNCTION_NAMES = "fghpqruvw";
  const addFunctionField = () => {
    const rows = functionRows.map((r) => ({ ...r, expr: r.expr.trim() })).filter((r) => r.expr);
    if (!rows.length) { flash("Bitte mindestens eine Funktion eingeben."); return; }
    for (const [k, r] of rows.entries()) {
      try { parseMathExpression(r.expr); }
      catch (error) { flash(`${FUNCTION_NAMES[k]}(x): ` + (error instanceof Error ? error.message : "Diese Funktion kann ich noch nicht lesen.")); return; }
    }
    const expression = rows[0].expr;
    const sc = scRef.current;
    if (!sc) return;
    const r = sc.getBoundingClientRect(), view = toDoc(r.left + r.width / 2, r.top + r.height / 2);
    const d = functionAnchor ?? { x: view.x - 180, y: view.y - 30 };
    const block = blockAt(d.y), top = topsRef.current[block.id] ?? 0;
    const text = rows.map((r, k) => `${FUNCTION_NAMES[k]}(x) = ${r.expr}`).join("\n");
    const field: TextField = { id: uid(), blockId: block.id, text, x: Math.max(24, Math.min(PAGE_W - 384, d.x)), y: Math.max(24, d.y - top), width: 360, height: 34 * rows.length, fontSize: 20, color, role: "function", functionExpression: expression, functionCurves: rows.map((r) => ({ d: r.d, i: r.i })) };
    const beforeFunction = snap();
    textFields.current = [...textFields.current, field];
    pushHist(beforeFunction); bump(); schedule(); markDirty();
    setFunctionDialog(false); setFunctionAnchor(null); setTool("text"); flash("Funktion und interaktiver Graph eingefügt");
  };
  const openFunctionForSelection = () => {
    const selected = strokes.current.filter((s) => sel.current.has(s.id) && s.tool === "pen");
    if (selected.length) {
      let x0 = Infinity, y1 = -Infinity;
      for (const s of selected) {
        const top = topsRef.current[s.blockId] ?? 0;
        for (const p of s.pts) { x0 = Math.min(x0, p.x); y1 = Math.max(y1, p.y + top); }
      }
      setFunctionAnchor(Number.isFinite(x0) && Number.isFinite(y1) ? { x: x0, y: y1 + 20 } : null);
    } else setFunctionAnchor(null);
    setFunctionDialog(true); setFunctionMenuOpen(false);
  };
  const analyzeSelection = () => analyzeCircuitStrokes(strokes.current.filter((s) => sel.current.has(s.id) && s.tool === "pen").map((s) => {
    const top = topsRef.current[s.blockId] ?? 0;
    return { id: s.id, color: s.color, pts: s.pts.map((p) => ({ x: p.x, y: p.y + top })) };
  }));
  const perfectSelected = () => {
    const beforeSelection = snap(); let changed = 0;
    const selected = strokes.current.filter((s) => sel.current.has(s.id) && s.tool === "pen");
    const selectedInput: SymbolInput[] = selected.map((s) => {
      const top = topsRef.current[s.blockId] ?? 0;
      return { id: s.id, pts: s.pts.map((p) => ({ x: p.x, y: p.y + top })) };
    });
    const symbols = circuitAssistEnabled ? recognizeSymbols(selectedInput) : null;
    const foundCount = symbols ? Object.values(symbols.found).reduce((sum, n) => sum + n, 0) : 0;
    const symbolSources = new Map(selected.map((s) => [s.id, s]));
    const removed = foundCount ? symbols!.remove : new Set<string>();
    const generated: Stroke[] = [], leadUpdates = new Map<string, Stroke>();
    // Bauteile werden auf dem Gerät geometrisch erkannt und neu gezeichnet. Jedes
    // Ersatzteil übernimmt Farbe und Stiftart seiner handgezeichneten Vorlage.
    if (foundCount && symbols) {
      for (const lead of symbols.leads) {
        const source = symbolSources.get(lead.id);
        if (!source || removed.has(lead.id)) continue;
        const top = topsRef.current[source.blockId] ?? 0, pts = source.pts.map((p) => ({ ...p }));
        const index = lead.end === 0 ? 0 : pts.length - 1;
        pts[index] = { ...pts[index], x: lead.to.x, y: lead.to.y - top };
        leadUpdates.set(lead.id, { ...source, pts, raw: true, auto: undefined });
        changed++;
      }
      for (const replacement of symbols.add) {
        const source = symbolSources.get(replacement.from);
        if (!source) continue;
        const top = topsRef.current[source.blockId] ?? 0;
        generated.push({ ...source, id: uid(), pts: replacement.pts.map((p) => ({ x: p.x, y: p.y - top, p: 0.5 })), raw: true, auto: undefined, lineStyle: "solid" });
        changed++;
      }
    }
    // 1) Jeden markierten Strich einzeln begradigen: Linie, Leitung mit Knicken, Rechteck, Dreieck, Kreis
    const cleaned = new Map<string, Stroke>(leadUpdates), items: TidyItem[] = [];
    for (const s of strokes.current) {
      if (!sel.current.has(s.id) || s.tool !== "pen" || removed.has(s.id)) continue;
      const top = topsRef.current[s.blockId] ?? 0, abs = (st: Stroke) => st.pts.map((p) => ({ x: p.x, y: p.y + top }));
      if (isCleanLine(s)) { items.push({ id: s.id, kind: "fixed", pts: abs(s) }); continue; } // bewusst eingestellte Winkel bleiben erhalten
      if (s.raw) { // bereits geglättete Formen: nicht erneut umformen, nur aneinander ausrichten
        const first = s.pts[0], last = s.pts[s.pts.length - 1], closed = first.x === last.x && first.y === last.y;
        const shape = s.pts.length === 65 ? "circle" : closed && s.pts.length === 5 ? "rect" : closed || hasArrow(s.lineStyle) ? "fixed" : "poly";
        items.push({ id: s.id, kind: shape, pts: abs(s) });
        continue;
      }
      const shape = recognizeShape(s.pts);
      const clean = perfectStroke(s) ?? (circuitAssistEnabled ? straightenCircuitWire(s) : null);
      if (!clean) continue;
      cleaned.set(s.id, clean); changed++;
      const arrow = hasArrow(clean.lineStyle);
      items.push({ id: s.id, kind: arrow || shape === "triangle" ? "fixed" : shape === "ellipse" ? "circle" : shape === "rect" ? "rect" : clean.pts.length === 2 ? "line" : "poly", pts: abs(clean) });
    }
    // 2) Schaltbildhilfe: fast waagerechte/senkrechte Leitungen ausrichten, auf gemeinsame Fluchten ziehen, Enden andocken
    if (circuitAssistEnabled && items.length) {
      const z = zoomRef.current;
      const tidy = tidyCircuit(items, { axisDegrees: 10, alignDistance: Math.max(6, 9 / z), attachDistance: Math.max(9, 14 / z) });
      for (const s of strokes.current) {
        const pts = tidy.get(s.id); if (!pts) continue;
        const base = cleaned.get(s.id) ?? s, top = topsRef.current[s.blockId] ?? 0;
        if (pts.length !== base.pts.length) continue;
        const shifted = pts.some((p, i) => Math.abs(p.x - base.pts[i].x) > 0.01 || Math.abs(p.y - top - base.pts[i].y) > 0.01);
        if (!shifted) continue;
        cleaned.set(s.id, { ...base, pts: pts.map((p, i) => ({ x: p.x, y: p.y - top, p: base.pts[i].p })), raw: true }); changed++;
      }
    }
    // T-Verbindungen werden als gefüllte Lötpunkte ergänzt. Nur lange, nahezu
    // gerade Striche zählen als Leitungen; kurze Handschrift bleibt unangetastet.
    if (circuitAssistEnabled && selectedInput.length > 1) {
      const wirePaths = selectedInput.filter((s) => !removed.has(s.id) && s.pts.length >= 2).flatMap((s) => {
        const a = s.pts[0], z = s.pts[s.pts.length - 1], direct = Math.hypot(z.x - a.x, z.y - a.y);
        if (direct < 40) return [];
        const deviation = Math.max(...s.pts.map((p) => Math.abs((p.x - a.x) * (z.y - a.y) - (p.y - a.y) * (z.x - a.x)) / direct));
        return deviation <= Math.max(5, direct * 0.12) ? [[a, z]] : [];
      });
      const dotColor = selected[0]?.color ?? color, dotSource = selected[0], junctions = junctionPoints(wirePaths);
      if (dotSource) for (const p of junctions) generated.push({
        ...dotSource, id: uid(), color: dotColor, size: Math.max(5, dotSource.size * 1.8),
        pts: [{ x: p.x, y: p.y - (topsRef.current[dotSource.blockId] ?? 0), p: 0.5 }], raw: true, auto: undefined, lineStyle: "solid",
      });
      changed += junctions.length;
    }
    if (changed) {
      strokes.current = strokes.current.flatMap((s) => removed.has(s.id) ? [] : [cleaned.get(s.id) ?? s]).concat(generated);
      sel.current = new Set([...sel.current].filter((id) => !removed.has(id)).concat(generated.map((s) => s.id)));
      pushHist(beforeSelection); schedule(); markDirty();
      const analysis = analyzeSelection(); setCircuitAnalysis(analysis);
      const recognized = foundCount ? ` · ${foundCount} Bauteile neu gezeichnet` : "";
      flash(`Schaltbild geprüft: ${analysis?.summary ?? `${cleaned.size} Striche`}${recognized} · Rückgängig mit Strg+Z`);
      setSaved("Schaltbild und Grundformen geglättet");
    } else {
      const analysis = analyzeSelection(); setCircuitAnalysis(analysis);
      setSaved(analysis ? "Schaltbild erkannt · keine Glättung nötig" : "Keine passende Form erkannt");
      flash(analysis ? `Schaltbild erkannt: ${analysis.summary}` : "Keine Leitung oder Grundform in der Auswahl erkannt");
    }
  };
  const HOLD_MS = 500;   // Haltezeit bis zum Glätten
  const HOLD_RADIUS = 6; // Bildschirm-px: so weit darf der Stift beim „Halten“ zittern
  const cancelSmartHold = () => { if (smartHoldTimer.current) clearTimeout(smartHoldTimer.current); smartHoldTimer.current = undefined; };
  const armSmartHold = () => {
    if (!smartShapesEnabled) return;
    cancelSmartHold();
    smartHoldTimer.current = setTimeout(() => {
      const current = cur.current;
      if (!current || current.tool !== "pen" || snapInfo.current) return;
      // Zittern am Strichende (Stift ruht) zählt nicht zur Form
      const steady = { ...current, pts: trimHoldTail(current.pts, (HOLD_RADIUS + 2) / zoomRef.current) };
      if (steady.pts.length < 3) return;
      const clean = perfectStroke(steady);
      if (!clean) return;
      const isLine = clean.pts.length === 2 || (hasArrow(clean.lineStyle) && clean.pts.length === 5);
      rawBeforeSmartSnap.current = current; cur.current = isLine ? { ...clean, auto: true } : clean;
      const anchor = holdAnchor.current ?? { x: 0, y: 0 };
      if (isLine) snapInfo.current = { line: true, x: anchor.x, y: anchor.y };
      else { // Form: Größe folgt danach dem Abstand des Stifts zur Formmitte
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const q of clean.pts) { bx0 = Math.min(bx0, q.x); bx1 = Math.max(bx1, q.x); by0 = Math.min(by0, q.y); by1 = Math.max(by1, q.y); }
        const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, pen = toDoc(anchor.x, anchor.y), top = topsRef.current[clean.blockId] ?? 0;
        const d0 = Math.max(Math.hypot(pen.x - cx, pen.y - top - cy), 8 / zoomRef.current);
        snapInfo.current = { line: false, x: anchor.x, y: anchor.y, base: clean.pts, cx, cy, d0, scale: 1 };
      }
      flash(isLine ? "Linie geglättet · Stift weiterziehen ändert Winkel und Länge" : "Form geglättet · Stift zur Mitte oder nach außen bewegen ändert die Größe");
      schedule();
    }, HOLD_MS);
  };
  /** Der Halte-Timer läuft nur neu an, wenn sich der Stift wirklich wegbewegt – Zittern beim Stillhalten setzt ihn nicht zurück. */
  const noteHoldPosition = (cx: number, cy: number) => {
    const a = holdAnchor.current;
    if (a && Math.hypot(cx - a.x, cy - a.y) <= HOLD_RADIUS) return;
    holdAnchor.current = { x: cx, y: cy };
    armSmartHold();
  };

  const { tops, total } = useMemo(() => {
    const t: Record<string, number> = {};
    let y = 0;
    for (const b of blocks) { t[b.id] = y; y += b.height + b.gap; }
    return { tops: t, total: y };
  }, [blocks]);
  const topsRef = useRef(tops); topsRef.current = tops;
  const hasPdf = blocks.some((b) => b.kind === "pdf");
  useEffect(() => { if (!hasPdf) setPdfDeleteMode(false); }, [hasPdf]); // letzte PDF-Seite gelöscht → Modus aus
  // A4-Seitengrenzen (alle 1123 px, wie die Seiten des PDF-Exports) – nur auf Schreibflächen, nicht über PDF-Seiten
  const pageBreaks = useMemo(() => {
    const out: number[] = [];
    for (const b of blocks) {
      const top = tops[b.id];
      const y0 = b.kind === "blank" ? top : top + b.height, y1 = top + b.height + (b.kind === "blank" ? 0 : b.gap);
      if (b.kind === "pdf" && b.gap <= MIN_GAP) continue;
      for (let k = Math.max(1, Math.floor(y0 / A4_H) + 1); k * A4_H < y1; k++) out.push(k * A4_H);
    }
    return out;
  }, [blocks, tops]);
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
    try { if ((window as unknown as { restoring?: boolean }).restoring) return true; await kvSet("note:" + noteId, { blocks: blocksRef.current, strokes: strokes.current, texts: textFields.current, tpl: tplRef.current }); setSaved(loadWarn.current || "Gespeichert"); return true; }
    catch (err) {
      if (isQuotaError(err)) {
        setSaved("Speicher voll – NICHT gespeichert!");
        if (!quotaWarned) { quotaWarned = true; alert("Der Gerätespeicher ist voll. Diese Notiz konnte nicht gespeichert werden.\n\nBitte erst Platz schaffen (zum Beispiel ein Backup speichern und Dateien löschen)."); }
      } else setSaved("Speichern fehlgeschlagen");
      return false;
    }
  }, [noteId]);
  const markDirty = useCallback(() => { setSaved("Speichert …"); clearTimeout(timer.current); timer.current = setTimeout(save, 600); }, [save]);
  useEffect(() => { if (loaded.current) markDirty(); }, [blocks, tpl, markDirty]);
  useEffect(() => {
    let loadNote = "";
    (async () => {
      navigator.storage?.persist?.(); // verhindert, dass iPadOS/Browser die Daten selbständig löscht
      try {
        const st = await kvGet<{ blocks: Block[]; strokes: Stroke[]; texts?: TextField[]; tpl?: Tpl }>("note:" + noteId);
        if (st?.blocks?.length) {
          let unreadable = 0;
          for (const id of new Set(st.blocks.map((b) => b.docId).filter(Boolean) as string[])) {
            try { // eine unlesbare PDF darf die Notiz nicht blockieren: Striche und andere PDFs bleiben erhalten
              const stored = await kvGet<ArrayBuffer | Blob>("pdf:" + id);
              const bytes = stored instanceof Blob ? await stored.arrayBuffer() : stored?.slice(0);
              if (!bytes) throw new Error("PDF fehlt");
              docs.current.set(id, await (await loadPdfJs()).getDocument({ data: bytes }).promise);
            } catch { unreadable++; }
          }
          if (unreadable) loadNote = unreadable === 1 ? "1 PDF konnte nicht gelesen werden – Notiz ohne diese PDF geladen" : `${unreadable} PDFs konnten nicht gelesen werden – Notiz ohne sie geladen`;
          strokes.current = st.strokes; textFields.current = st.texts ?? []; setBlocks(st.blocks); if (st.tpl) setTplState(st.tpl);
        }
        await clipWrite; // laufende Schreibvorgänge zuerst abwarten
        if (clipSize() === 0) { // nur nach einem Neustart aus der DB laden; im Speicher ist sonst alles aktueller
          const c = await kvGet<typeof sharedClip>("clip");
          if (c && Array.isArray(c.strokes) && Array.isArray(c.texts)) { sharedClip.noteId = c.noteId ?? ""; sharedClip.strokes = c.strokes; sharedClip.texts = c.texts; }
        }
        setClipCount(clipSize());
        loaded.current = true; setReady((n) => n + 1); loadWarn.current = loadNote; setSaved(loadNote || "Gespeichert");
      } catch {
        // Lesen nicht möglich: loaded bleibt false, damit nichts Leeres über die gespeicherte Notiz geschrieben wird
        setSaved("Notiz konnte nicht geladen werden – bitte App neu starten");
      }
    })();
    const flush = () => { if (document.visibilityState === "hidden") { clearTimeout(timer.current); if (loaded.current) save(); } };
    const flushNow = () => { clearTimeout(timer.current); if (loaded.current) save(); };
    const myFlush = async () => { clearTimeout(timer.current); return loaded.current ? save() : true; };
    flushActive = myFlush;
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flushNow);    // Fenster schließen (Windows/Tauri), Tab schließen
    window.addEventListener("beforeunload", flushNow);
    return () => {
      document.removeEventListener("visibilitychange", flush); window.removeEventListener("pagehide", flushNow); window.removeEventListener("beforeunload", flushNow);
      if (flushActive === myFlush) flushActive = null;
      clearTimeout(timer.current); if (loaded.current) save();
    };
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
    const a = anchor.current, sc = scRef.current, rs = restoreScroll.current;
    if (rs && sc) { sc.scrollLeft = rs.left; sc.scrollTop = rs.top; restoreScroll.current = null; anchor.current = null; } // Handballen-Geste zurückgenommen
    else if (a && sc) { sc.scrollLeft = a.dx * zoom + offX() - a.cx; sc.scrollTop = a.dy * zoom - a.cy; anchor.current = null; }
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
  const paint = (ctx: CanvasRenderingContext2D, s: Stroke, ox = 0, oy = 0, ink = s.color, taperStart = true, taperEnd = true) => {
    const top = (topsRef.current[s.blockId] ?? 0) + oy, hl = s.tool === "highlighter", P = s.pts, n = P.length;
    const dash = dashFor(s.lineStyle);
    const kind = s.penKind, shaped = !!s.raw || n < 3;
    // Breite je Stiftart: Kugelschreiber fast gleichmäßig, Füller nach Druck und Strichrichtung, Bleistift dünn
    const widthAt = (i: number, dx: number, dy: number) => {
      const w = inkWidth(kind, s.size, adjustPressure(P[i].p, pressureSensitivity), dx, dy, shaped);
      return kind === "fountain" && !shaped ? w * fountainTaper(i, n, taperStart, taperEnd) : w;
    };
    ctx.save();
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = ctx.fillStyle = ink;
    if (dash.length) ctx.setLineDash(dash);
    if (hl) { ctx.globalAlpha = 0.35; ctx.lineWidth = s.size * 5; ctx.lineCap = "butt"; }
    const centerline = () => { // sichtbare Mittellinie als EIN Pfad (identisch zur Radierer-Geometrie curveAt)
      ctx.beginPath(); ctx.moveTo(P[0].x + ox, top + P[0].y);
      if (shaped) { for (let i = 1; i < n; i++) ctx.lineTo(P[i].x + ox, top + P[i].y); }
      else {
        for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(P[i].x + ox, top + P[i].y, (P[i].x + P[i + 1].x) / 2 + ox, top + (P[i].y + P[i + 1].y) / 2);
        ctx.lineTo(P[n - 1].x + ox, top + P[n - 1].y);
      }
    };
    if (s.fill && s.raw && n > 2) { // gefüllte Form: zarte Fläche in der Stiftfarbe unter dem Umriss
      ctx.save(); ctx.setLineDash([]); ctx.globalAlpha *= 0.22; ctx.beginPath(); ctx.moveTo(P[0].x + ox, top + P[0].y);
      for (let i = 1; i < n; i++) ctx.lineTo(P[i].x + ox, top + P[i].y);
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    if (kind === "pencil" && !hl) {
      // Bleistift: ein einziger Pfad mit Körnung. Früher wurde jedes Segment einzeln halbtransparent gezeichnet –
      // die überlappenden runden Enden ergaben die dunkle „Perlenkette“ entlang des Strichs.
      let sum = 0; for (let i = 0; i < n; i++) sum += adjustPressure(P[i].p, pressureSensitivity);
      const look = pencilLook(s.size, sum / n);
      ctx.globalAlpha = look.alpha; ctx.lineWidth = look.width;
      ctx.strokeStyle = ctx.fillStyle = pencilGrain(ctx, ink);
      if (n === 1) { ctx.beginPath(); ctx.arc(P[0].x + ox, top + P[0].y, look.width / 2, 0, 7); ctx.fill(); }
      else { centerline(); ctx.stroke(); }
    } else if (n === 1) {
      ctx.beginPath(); ctx.arc(P[0].x + ox, top + P[0].y, (hl ? s.size * 2.5 : widthAt(0, 0, 0)) / 2, 0, 7); ctx.fill();
    } else if (hl) { // Textmarker: ein einziger Pfad, Kurve durch die Mittelpunkte (Kontrollpunkt = Messpunkt)
      // Beim Aufsetzen und Abheben zittert der Stift oft ein paar Pixel zurück. Bei der breiten Markerlinie erzeugte
      // diese Richtungsumkehr mit runder Verbindung eine sichtbare Halbkugel am Anfang. Deshalb die Punkte in einer
      // kleinen Ruhezone um Start und Ende überspringen: Der Strich beginnt flach und in der echten Zugrichtung.
      const dz0 = s.size * 2.5, sdx = P[n - 1].x - P[0].x, sdy = P[n - 1].y - P[0].y;
      if (shaped || (n < 6 && sdx * sdx + sdy * sdy < dz0 * dz0)) { centerline(); ctx.stroke(); }
      else {
        const dz = s.size * 2.5, dz2 = dz * dz;
        const far = (i: number, j: number) => { const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y; return dx * dx + dy * dy >= dz2; };
        let a = 1; while (a < n - 1 && !far(a, 0)) a++;
        let b = n - 2; while (b >= a && !far(b, n - 1)) b--;
        ctx.beginPath(); ctx.moveTo(P[0].x + ox, top + P[0].y);
        for (let i = a; i <= b; i++) {
          const nx = i < b ? P[i + 1].x : P[n - 1].x, ny = i < b ? P[i + 1].y : P[n - 1].y;
          ctx.quadraticCurveTo(P[i].x + ox, top + P[i].y, (P[i].x + nx) / 2 + ox, top + (P[i].y + ny) / 2);
        }
        ctx.lineTo(P[n - 1].x + ox, top + P[n - 1].y); ctx.stroke();
      }
    } else if (dash.length) { // gestrichelt/gepunktet: ein Pfad mit gleichmäßiger Breite, damit das Muster ruhig bleibt
      ctx.lineWidth = inkWidth(kind, s.size, 0.5, 0, 0, true);
      centerline(); ctx.stroke();
    } else if (shaped) { // Formen und sehr kurze Striche: gerade Segmente, Ecken bleiben scharf
      for (let i = 1; i < n; i++) {
        ctx.lineWidth = widthAt(i, 0, 0);
        ctx.beginPath(); ctx.moveTo(P[i - 1].x + ox, top + P[i - 1].y); ctx.lineTo(P[i].x + ox, top + P[i].y); ctx.stroke();
      }
    } else { // Kugelschreiber/Füller: je Segment eine quadratische Kurve von Mitte zu Mitte, Breite gleitend angepasst
      let sx = P[0].x + ox, sy = top + P[0].y, w = widthAt(1, P[1].x - P[0].x, P[1].y - P[0].y);
      for (let i = 1; i < n; i++) {
        const last = i === n - 1;
        const ex = last ? P[i].x + ox : (P[i].x + P[i + 1].x) / 2 + ox;
        const ey = last ? top + P[i].y : top + (P[i].y + P[i + 1].y) / 2;
        w += (widthAt(i, ex - sx, ey - sy) - w) * 0.45; // keine sprunghaften Breitenwechsel zwischen Segmenten
        ctx.lineWidth = w;
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
    let run: Pt[] = [], runStart = 0, runEnd = 0, region: "pdf" | "blank" | "gap" | null = null;
    const flush = () => {
      if (!run.length || !region) return;
      paint(ctx, { ...s, pts: run }, ox, oy, displayInk(s.color, region), runStart === 0, runEnd === s.pts.length - 1);
    };
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i], nextRegion = paperAtY(top + oy + p.y);
      if (region !== nextRegion) {
        if (run.length) {
          const last = run[run.length - 1];
          flush();
          run = [{ ...last }]; runStart = i - 1; runEnd = i - 1; // keep joins clean without treating the boundary as a stroke end
        }
        region = nextRegion;
      }
      run.push(p); runEnd = i;
    }
    flush();
  };
  const eraseR = () => 6 + eraserSize * 3; // eigene Radierergröße, unabhängig von der Stiftbreite
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
      const el = !xf.current && !drag.current ? editableLine() : null;
      if (!el) hp.corners.forEach((c) => { ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs); ctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs); }); // bei einer Linie ersetzen die Endpunkte die Eckgriffe
      ctx.beginPath(); ctx.arc(hp.rot.x, hp.rot.y, hs * 0.85, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(hp.rot.x, hp.rot.y, hs * 0.42, -2.4, 1.6); ctx.stroke(); // Drehsymbol ↻
      if (xf.current?.mode === "rotate") {
        let deg = Math.round((-xf.current.rot * 180) / Math.PI) % 360; if (deg > 180) deg -= 360; if (deg <= -180) deg += 360;
        angleTag(ctx, hp.rot.x, hp.rot.y - 20 / z, `${deg > 0 ? "+" : ""}${deg}°`, z);
      }
      if (el) { // Endpunktgriffe: Ziehen ändert Winkel und Länge der Linie
        ctx.save(); ctx.setLineDash([]);
        for (const p of [el.a, el.b]) {
          ctx.beginPath(); ctx.arc(p.x, p.y, 9 / z, 0, 7); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 2.5 / z; ctx.strokeStyle = "#5738df"; ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 / z, 0, 7); ctx.fillStyle = "#5738df"; ctx.fill();
        }
        const label = `${lineAngleDegrees(el.a, el.b)}°${endDrag.current?.snapped ? " · Raster" : ""}`;
        angleTag(ctx, (el.a.x + el.b.x) / 2, (el.a.y + el.b.y) / 2 - 18 / z, label, z);
        ctx.restore();
      }
    }
    if ((tool === "eraser" || eraserHover.current) && hover.current) { ctx.setLineDash([]); ctx.strokeStyle = "#64748b"; ctx.beginPath(); ctx.arc(hover.current.x, hover.current.y, eraseR(), 0, 7); ctx.stroke(); }
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
  /** Genau eine gerade Linie ausgewählt (keine Textfelder)? Dann gibt es Endpunktgriffe. */
  const editableLine = () => {
    if (sel.current.size !== 1) return null;
    const s = strokes.current.find((x) => sel.current.has(x.id));
    const ends = s ? lineEnds(s) : null;
    if (!s || !ends) return null;
    const top = topsRef.current[s.blockId] ?? 0, o = dragOff.current;
    return { stroke: s, a: { x: ends.a.x + o.x, y: ends.a.y + top + o.y }, b: { x: ends.b.x + o.x, y: ends.b.y + top + o.y } };
  };
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

  const buildShape = (d: { x: number; y: number }, snapAngle = false) => {
    const a = shapeA.current!, b = blockAt(a.y), top = topsRef.current[b.id];
    // Werkzeug „Linie/Pfeil“: eigene Art, Breite und Farbe – unabhängig vom Stift
    const lineTool = gTool.current === "line";
    const base: Shape = lineTool ? "line" : shapeKind, style = lineTool ? lineToolStyle : lineStyle;
    if (snapAngle && (base === "line" || base === "arrow")) d = snapToAngle(a, d, 15);
    const kind = base === "line" && hasArrow(style) ? "arrow" : base;
    const fill = !lineTool && shapeFill && kind !== "line" && kind !== "arrow" && kind !== "axes";
    cur.current = { id: cur.current?.id ?? uid(), blockId: b.id, tool: !lineTool && activePen.kind === "marker" ? "highlighter" : "pen", color: lineTool ? lineColor : color, size: lineTool ? lineSize : size, penKind: lineTool ? "ballpoint" : activePen.kind, lineStyle: style, pts: shapePts(kind, a, d).map((p) => ({ ...p, y: p.y - top })), raw: true, ...(fill ? { fill: true } : {}) };
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

  const connectLineExtension = (incoming: Stroke): Stroke | null => {
    if (!smartShapesEnabled || incoming.tool !== "pen" || hasArrow(incoming.lineStyle)) return incoming;
    const z = zoomRef.current;
    // Nur fluchtende Linien (≤ 2,5°, ≤ 4 px neben der Achse) verbinden – sonst bleibt der gezeichnete Winkel unverändert.
    const options = { maxGap: 16 / z, alignmentTolerance: 4 / z, minExtension: 6 / z, minLength: 14 / z };
    let match: { stroke: Stroke; extension: NonNullable<ReturnType<typeof extendCollinearLine>> } | null = null;
    for (const existing of strokes.current) {
      if (existing.id === incoming.id || existing.blockId !== incoming.blockId || existing.tool !== "pen" || hasArrow(existing.lineStyle)) continue;
      if ((existing.lineStyle ?? "solid") !== (incoming.lineStyle ?? "solid")) continue;
      const extension = extendCollinearLine(existing.pts, incoming.pts, options);
      if (extension && (!match || extension.gap < match.extension.gap)) match = { stroke: existing, extension };
    }
    if (!match) return incoming;

    const { stroke: existing, extension } = match;
    const pressure = (point: { x: number; y: number }, fallback: number) => ({ ...point, p: fallback });
    const oldStartPressure = existing.pts[0]?.p ?? 0.5;
    const oldEndPressure = existing.pts[existing.pts.length - 1]?.p ?? 0.5;
    const sameAppearance = existing.color === incoming.color
      && existing.size === incoming.size
      && (existing.penKind ?? "ballpoint") === (incoming.penKind ?? "ballpoint");
    if (sameAppearance) {
      const merged: Stroke = {
        ...existing,
        pts: [pressure(extension.joinedStart, oldStartPressure), pressure(extension.joinedEnd, oldEndPressure)],
        raw: true,
      };
      strokes.current = strokes.current.map((stroke) => stroke.id === existing.id ? merged : stroke);
      flash("Linie verlängert · Rückgängig mit Strg+Z");
      return null;
    }

    const nearPressure = extension.incomingNearAtStart
      ? incoming.pts[0]?.p ?? 0.5
      : incoming.pts[incoming.pts.length - 1]?.p ?? 0.5;
    const outerPressure = extension.incomingNearAtStart
      ? incoming.pts[incoming.pts.length - 1]?.p ?? 0.5
      : incoming.pts[0]?.p ?? 0.5;
    const points = extension.incomingNearAtStart
      ? [pressure(extension.join, nearPressure), pressure(extension.outer, outerPressure)]
      : [pressure(extension.outer, outerPressure), pressure(extension.join, nearPressure)];
    flash("An vorhandene Linie angesetzt · Rückgängig mit Strg+Z");
    return { ...incoming, pts: points, raw: true };
  };

  /* ───── Finger: sofortiges Ein-Finger-Verschieben, zwei Finger verschieben + zoomen, große Ballenkontakte ignorieren ───── */
  const stopGestureFrame = () => { cancelAnimationFrame(gestureRaf.current); gestureRaf.current = 0; };
  // Scrollen/Zoomen der laufenden Finger-Geste zurücknehmen (wenn sich herausstellt, dass es der Handballen war)
  const revertGesture = () => {
    const g = gesture.current, sc = scRef.current;
    if (!sc || g.mode === "idle" || performance.now() - g.t0 > PALM_REVERT_MS) return;
    stopGestureFrame();
    if (Math.abs(zoomRef.current - g.zoom) > 1e-4) { restoreScroll.current = { left: g.scrollLeft, top: g.scrollTop }; zoomRef.current = g.zoom; setZoomState(g.zoom); }
    else { sc.scrollLeft = g.scrollLeft; sc.scrollTop = g.scrollTop; schedule(); }
  };
  // Alle laufenden Finger verwerfen (Stift setzt auf)
  const endTouches = () => {
    revertGesture();
    touches.current.forEach((_, id) => rejected.current.add(id)); touches.current.clear();
    stopGestureFrame();
    gesture.current = { ...gesture.current, mode: "idle", pinch: undefined };
  };
  const beginPinch = () => {
    const sc = scRef.current!, r = sc.getBoundingClientRect(), [a, b] = [...touches.current.values()], z = zoomRef.current;
    const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
    gesture.current.mode = "pinch";
    gesture.current.pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z0: z, docX: (sc.scrollLeft + cx - offX()) / z, docY: (sc.scrollTop + cy) / z, locked: true };
  };
  // Höchstens einmal pro Bild: Der Dokumentpunkt, der beim Aufsetzen unter der Fingermitte lag, bleibt unter der Fingermitte.
  // Dadurch verschieben und zoomen zwei Finger gleichzeitig, ohne zu springen oder zu zittern.
  const applyPinch = () => {
    gestureRaf.current = 0;
    const g = gesture.current, p = g.pinch, sc = scRef.current;
    if (g.mode !== "pinch" || !p || !sc || touches.current.size < 2) return;
    const [a, b] = [...touches.current.values()], r = sc.getBoundingClientRect(), d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
    if (p.locked && Math.abs(d / p.d0 - 1) > PINCH_LOCK) { p.locked = false; p.d0 = d; p.z0 = zoomRef.current; } // ab jetzt zoomen – ohne Sprung
    const z = p.locked ? zoomRef.current : clamp((p.z0 * d) / p.d0, MIN_Z, MAX_Z);
    if (Math.abs(z - zoomRef.current) > 1e-4) { anchor.current = { dx: p.docX, dy: p.docY, cx, cy }; zoomRef.current = z; setZoomState(z); }
    else { sc.scrollLeft = p.docX * z + offX() - cx; sc.scrollTop = p.docY * z - cy; schedule(); }
  };
  const touchDown = (e: React.PointerEvent) => {
    const now = performance.now(), g = gesture.current, x = e.clientX, y = e.clientY;
    const palm = isPalm(e.nativeEvent) || penActive.current;
    if (palm || g.mode === "blocked" || touches.current.size >= 2) {
      rejected.current.add(e.pointerId);
      // Dritter Kontakt oder Ballen neben einem laufenden Finger: Geste stoppen (und zurücknehmen, falls sie gerade erst begann)
      if (touches.current.size > 0 && g.mode !== "blocked") { revertGesture(); stopGestureFrame(); g.mode = "blocked"; g.pinch = undefined; }
      return;
    }
    touches.current.set(e.pointerId, { x, y, sx: x, sy: y });
    if (touches.current.size === 1) { const sc = scRef.current!; gesture.current = { mode: "pending", t0: now, scrollLeft: sc.scrollLeft, scrollTop: sc.scrollTop, zoom: zoomRef.current }; }
    else beginPinch();
  };
  const touchMove = (e: React.PointerEvent) => {
    if (rejected.current.has(e.pointerId)) return;
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    const g = gesture.current;
    if (isPalm(e.nativeEvent) || penActive.current) { // Kontakt wächst zum Ballen oder der Stift schreibt: Geste beenden
      rejected.current.add(e.pointerId); touches.current.delete(e.pointerId);
      revertGesture(); stopGestureFrame();
      g.mode = touches.current.size ? "blocked" : "idle"; g.pinch = undefined;
      return;
    }
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (g.mode === "pending" && touches.current.size === 1) {
      if (oneFingerRef.current && Math.hypot(t.x - t.sx, t.y - t.sy) > TOUCH_SLOP) {
        g.mode = "pan";
        const sc = scRef.current!; sc.scrollTop -= t.y - t.sy; sc.scrollLeft -= t.x - t.sx; schedule(); // aufgelaufene Strecke nachholen
      }
    } else if (g.mode === "pan") { const sc = scRef.current!; sc.scrollTop -= dy; sc.scrollLeft -= dx; schedule(); }
    else if (g.mode === "pinch" && !gestureRaf.current) gestureRaf.current = requestAnimationFrame(applyPinch);
  };
  const touchUp = (e: React.PointerEvent) => {
    rejected.current.delete(e.pointerId);
    if (!touches.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (touches.current.size === 0) { stopGestureFrame(); g.mode = "idle"; g.pinch = undefined; }
    else if (g.mode === "pinch") { stopGestureFrame(); g.mode = "blocked"; g.pinch = undefined; } // ein Finger bleibt liegen: nicht plötzlich losscrollen
  };

  /* ───── Pointer-Events: Stift/Maus zeichnen, Finger navigieren ───── */
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") { touchDown(e); return; }
    if (e.pointerType === "pen") { // Stift setzt auf: laufende Finger-Gesten abbrechen (und zurücknehmen, falls der Ballen kurz vorher gescrollt hat)
      endTouches();
      penActive.current = true;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return; // nur die linke Maustaste zeichnet
    if (readOnlyRef.current) { // Nur ansehen: nichts zeichnen, Ziehen verschiebt die Ansicht
      viewPan.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ohne Capture geht es auch */ }
      return;
    }
    // Stiftrückseite (Radierer-Ende) und Seitentaste erkennen: Pointer Events melden button 5 / buttons 32 bzw. button 2 / buttons 2
    const penTail = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) !== 0);
    const penBarrel = e.pointerType === "pen" && !penTail && (e.button === 2 || (e.buttons & 2) !== 0);
    const useTool: Tool = penTail ? "eraser" : penBarrel && barrelAction !== "none" ? barrelAction : tool;
    gTool.current = useTool; gestureOn.current = true; eraserHover.current = useTool === "eraser" && tool !== "eraser";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d = toDoc(e.clientX, e.clientY);
    if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur(); // laufende Texteingabe abschließen
    before.current = snap();
    growTail(d.y);
    if (useTool === "pen" || useTool === "highlighter") {
      cancelSmartHold(); rawBeforeSmartSnap.current = null; snapInfo.current = null;
      holdAnchor.current = { x: e.clientX, y: e.clientY };
      const b = blockAt(d.y);
      const strokeTool = activePen.kind === "marker" ? "highlighter" : useTool;
      cur.current = { id: uid(), blockId: b.id, tool: strokeTool, color, size, penKind: activePen.kind, lineStyle, pts: [{ x: d.x, y: d.y - topsRef.current[b.id], p: e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5 }] };
    } else if (useTool === "text") {
      const b = blockAt(d.y), id = uid();
      textBefore.current = snap(); creating.current = true; focusId.current = id;
      textFields.current = [...textFields.current, { id, blockId: b.id, text: "", x: d.x, y: d.y - topsRef.current[b.id], width: Math.max(80, Math.min(260, PAGE_W - d.x - 8)), height: 28, fontSize: Math.round(10 + size * 3), color }];
      bump();
    } else if (useTool === "shape" || useTool === "line") { shapeA.current = d; buildShape(d); }
    else if (useTool === "eraser") { erase(d); eraseLast.current = d; }
    else {
      const bb = selBox();
      const el = editableLine();
      const endHit = el ? [el.a, el.b].findIndex((p) => Math.hypot(d.x - p.x, d.y - p.y) < 18 / zoomRef.current) : -1;
      const h0 = bb && endHit < 0 ? handleAt(bb, d) : null;
      const h = h0 && (!el || h0.kind === "rotate") ? h0 : null; // einzelne Linie: nur Drehgriff, Länge/Winkel über die Endpunkte
      if (el && endHit >= 0) { // Endpunkt greifen: der andere Endpunkt bleibt fest
        endDrag.current = { id: el.stroke.id, which: endHit as 0 | 1, orig: el.stroke, fixed: endHit === 0 ? el.b : el.a, snapped: false };
      } else if (bb && h) { // Anfasser gegriffen: Skalieren relativ zur gegenüberliegenden Ecke, Drehen um die Mitte
        const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
        if (h.kind === "rotate") xf.current = { mode: "rotate", px: cx, py: cy, s: 1, rot: 0, d0: 1, a0: Math.atan2(d.y - cy, d.x - cx) };
        else { const o = h.corners[(h.i + 2) % 4], c = h.corners[h.i]; xf.current = { mode: "scale", px: o.x, py: o.y, s: 1, rot: 0, d0: Math.max(1, Math.hypot(c.x - o.x, c.y - o.y)), a0: 0 }; }
      } else if (bb && d.x > bb.x0 && d.x < bb.x1 && d.y > bb.y0 && d.y < bb.y1) drag.current = d;
      else { sel.current = new Set(); lasso.current = [d]; }
    }
    schedule();
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") { touchMove(e); return; }
    if (viewPan.current) {
      const v = viewPan.current, sc = scRef.current!;
      if (v.id === e.pointerId) { sc.scrollLeft -= e.clientX - v.x; sc.scrollTop -= e.clientY - v.y; v.x = e.clientX; v.y = e.clientY; }
      return;
    }
    // „Gedrückt“ über das eigene Flag statt über buttons & 1: das Radierer-Ende meldet buttons 32, die Seitentaste buttons 2
    const pressed = gestureOn.current && (e.pointerType !== "mouse" || (e.buttons & 1) !== 0);
    if (e.pointerType === "pen") { // auch schwebend: merkt sich, wo die Schreibhand gerade ist (Handballen-Zone)
      if (!pressed) penActive.current = false;
    }
    hover.current = toDoc(e.clientX, e.clientY);
    if (!pressed) {
      const tailNear = e.pointerType === "pen" && (e.buttons & 32) !== 0; // umgedrehter Stift schwebt über der Fläche
      if (tool === "eraser" || tailNear || eraserHover.current) { eraserHover.current = tailNear; schedule(); }
      return;
    }
    const activeTool = gTool.current;
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const evs = coalesced && coalesced.length ? coalesced : [e.nativeEvent]; // manche WebViews liefern eine leere Liste
    for (const ev of evs) {
      const d = toDoc(ev.clientX, ev.clientY);
      if (shapeA.current) buildShape(d, ev.shiftKey || angleSnapRef.current);
      else if (cur.current) {
        const si = snapInfo.current;
        if (si) { // durch Halten geglättet
          const far = Math.hypot(ev.clientX - si.x, ev.clientY - si.y);
          if (si.line) { // Linie: der Endpunkt folgt dem Stift – Winkel und Länge frei wählbar, 15°-Raster nur mit Umschalt/Schalter
            if (far > HOLD_RADIUS) {
              const c = cur.current, a = c.pts[0], free = { x: d.x, y: d.y - topsRef.current[c.blockId] };
              const b = ev.shiftKey || angleSnapRef.current ? snapToAngle(a, free, 15) : free;
              if (Math.hypot(b.x - a.x, b.y - a.y) >= 6 / zoomRef.current) cur.current = { ...c, pts: shapePts(hasArrow(c.lineStyle) ? "arrow" : "line", a, b), auto: undefined }; // Winkel jetzt bewusst gewählt
              growTail(d.y);
            }
            continue;
          }
          // Form: solange der Stift unten bleibt, skaliert sie um ihre Mitte – näher zur Mitte = kleiner, weiter weg = größer
          if (far > HOLD_RADIUS && si.base && si.d0 && si.cx !== undefined && si.cy !== undefined) {
            const c = cur.current, top = topsRef.current[c.blockId] ?? 0;
            const k = clamp(Math.hypot(d.x - si.cx, d.y - top - si.cy) / si.d0, 0.15, 8);
            si.scale = k;
            const scaled = si.base.map((q) => ({ ...q, x: si.cx! + (q.x - si.cx!) * k, y: si.cy! + (q.y - si.cy!) * k }));
            cur.current = { ...c, pts: scaled };
            growTail(top + Math.max(...scaled.map((q) => q.y)));
          }
          continue;
        }
        const pts = cur.current.pts, last = pts[pts.length - 1], ly = d.y - topsRef.current[cur.current.blockId], md = MIN_DIST / zoomRef.current;
        // Stabilisierung: der Punkt folgt dem Stift leicht verzögert und nimmt Zittern heraus
        const f = inkSmoothingRef.current > 0 ? stabilize(last, { x: d.x, y: ly }, inkSmoothingRef.current) : { x: d.x, y: ly };
        const ddx = f.x - last.x, ddy = f.y - last.y;
        if (ddx * ddx + ddy * ddy >= md * md) { // Mikro-Zittern überspringen
          const rawP = e.pointerType === "pen" ? (ev.pressure > 0 ? ev.pressure : last.p) : 0.5;
          pts.push({ x: f.x, y: f.y, p: last.p + (rawP - last.p) * PRESSURE_LERP }); // Tiefpass: p = lerp(letzter, neuer, 0,2)
        }
        noteHoldPosition(ev.clientX, ev.clientY);
        growTail(d.y);
      } else if (endDrag.current) {
        const ed = endDrag.current, snapIt = ev.shiftKey || angleSnapRef.current;
        const free = snapIt ? snapToAngle(ed.fixed, d, 15) : d;
        if (Math.hypot(free.x - ed.fixed.x, free.y - ed.fixed.y) >= 6 / zoomRef.current) {
          const top = topsRef.current[ed.orig.blockId] ?? 0, a = ed.which === 0 ? free : ed.fixed, b = ed.which === 0 ? ed.fixed : free;
          const pts = shapePts(hasArrow(ed.orig.lineStyle) ? "arrow" : "line", { x: a.x, y: a.y - top }, { x: b.x, y: b.y - top });
          pts[0] = { ...pts[0], p: ed.orig.pts[0]?.p ?? 0.5 }; pts[1] = { ...pts[1], p: ed.orig.pts[ed.orig.pts.length - 1]?.p ?? 0.5 };
          strokes.current = strokes.current.map((s) => (s.id === ed.id ? { ...ed.orig, pts, raw: true, auto: undefined } : s)); // Winkel von Hand eingestellt
          ed.snapped = snapIt; growTail(d.y);
        }
      } else if (activeTool === "eraser") { // zwischen zwei Ereignissen in kleinen Schritten radieren, damit schnelle Züge nichts überspringen
        const from = eraseLast.current ?? d, dist = Math.hypot(d.x - from.x, d.y - from.y), steps = Math.max(1, Math.ceil(dist / Math.max(2, eraseR() * 0.6)));
        for (let k = 1; k <= steps; k++) erase({ x: from.x + ((d.x - from.x) * k) / steps, y: from.y + ((d.y - from.y) * k) / steps });
        eraseLast.current = d;
      }
      else if (lasso.current) lasso.current.push(d);
      else if (xf.current) {
        const t = xf.current;
        if (t.mode === "scale") t.s = clamp(Math.hypot(d.x - t.px, d.y - t.py) / t.d0, 0.1, 10);
        else { const r = Math.atan2(d.y - t.py, d.x - t.px) - t.a0; t.rot = ev.shiftKey || angleSnapRef.current ? snapRadians(r, 15) : r; }
      }
      else if (drag.current) { dragOff.current = { x: dragOff.current.x + d.x - drag.current.x, y: dragOff.current.y + d.y - drag.current.y }; drag.current = d; }
    }
    if ((xf.current || drag.current) && textFields.current.some((t) => sel.current.has(t.id))) bump(); // Textfeld-Vorschau
    schedule();
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") { touchUp(e); return; }
    if (viewPan.current) { if (viewPan.current.id === e.pointerId) viewPan.current = null; return; }
    cancelSmartHold();
    if (!gestureOn.current) return; // z. B. rechte Maustaste: es lief keine Geste
    const usedTool = gTool.current;
    gestureOn.current = false; eraserHover.current = false; holdAnchor.current = null; eraseLast.current = null;
    if (e.pointerType === "pen") penActive.current = false;
    if (cur.current) {
      let stroke = cur.current;
      const rawPts = stroke.pts, snappedRaw = snapInfo.current && !snapInfo.current.line ? rawBeforeSmartSnap.current?.pts ?? null : null;
      if (!stroke.raw && !snapInfo.current && stroke.pts.length > 1) {
        // Die Stabilisierung hinkt dem Stift minimal hinterher: beim Absetzen den echten Endpunkt ergänzen …
        const d = toDoc(e.clientX, e.clientY), last = stroke.pts[stroke.pts.length - 1], ly = d.y - (topsRef.current[stroke.blockId] ?? 0);
        const gap = Math.hypot(d.x - last.x, ly - last.y);
        if (e.type !== "pointercancel" && gap >= MIN_DIST / zoomRef.current && gap < 40 / zoomRef.current) stroke.pts.push({ x: d.x, y: ly, p: last.p });
        // … und den fertigen Strich nachglätten (Start, Ende und Ecken bleiben erhalten)
        if (inkSmoothingRef.current > 0) stroke = { ...stroke, pts: smoothInk(stroke.pts, inkSmoothingRef.current, 1 / zoomRef.current) };
      }
      snapInfo.current = null;
      const finalStroke = !stroke.raw && hasArrow(stroke.lineStyle) && stroke.pts.length > 1
        ? { ...stroke, pts: shapePts("arrow", stroke.pts[0], stroke.pts[stroke.pts.length - 1]), raw: true }
        : stroke;
      // Kritzelradierer: Erkennung auf den ungeglätteten Punkten (Glätten rundet Zickzack-Ecken ab); bei durch Halten
      // geglätteter Form zählt der ursprüngliche Freihandstrich. Trifft das Kritzel nichts, bleibt es ein normaler Strich.
      const scribblePts = (snappedRaw ?? rawPts) as Pt[];
      const scribble = shouldAttemptScribbleErase(scribbleEraseEnabled, usedTool, finalStroke.tool) ? scribbleInfo(scribblePts, 1 / zoomRef.current) : null;
      if (scribble) {
        const top = topsRef.current[finalStroke.blockId] ?? 0;
        const scratch = scribblePts.map((p) => ({ x: p.x, y: p.y + top }));
        const absInfo = { ...scribble, bounds: { x0: scribble.bounds.x0, x1: scribble.bounds.x1, y0: scribble.bounds.y0 + top, y1: scribble.bounds.y1 + top } };
        const tolerance = Math.max(4, 9 / zoomRef.current);
        const hitStrokes = new Set(strokes.current.filter((target) => {
          if (target.id === finalStroke.id || (target.tool !== "pen" && target.tool !== "highlighter")) return false;
          const targetTop = topsRef.current[target.blockId] ?? 0, box = bbox(target), B = absInfo.bounds;
          if (targetTop + box.y1 < B.y0 - tolerance || targetTop + box.y0 > B.y1 + tolerance || box.x1 < B.x0 - tolerance || box.x0 > B.x1 + tolerance) return false;
          return scribbleCovers(scratch, absInfo, target.pts.map((p) => ({ x: p.x, y: p.y + targetTop })), tolerance + target.size / 2);
        }).map((target) => target.id));
        const hitTexts = new Set(textFields.current.filter((target) => scribbleCoversRect(absInfo, textRect(target))).map((target) => target.id));
        if (hitStrokes.size || hitTexts.size) {
          strokes.current = strokes.current.filter((target) => !hitStrokes.has(target.id));
          textFields.current = textFields.current.filter((target) => !hitTexts.has(target.id));
          sel.current = new Set([...sel.current].filter((id) => !hitStrokes.has(id) && !hitTexts.has(id)));
          pushHist(before.current);
          flash(`Durchgekritzelt: ${hitStrokes.size + hitTexts.size} ${hitStrokes.size + hitTexts.size === 1 ? "Element gelöscht" : "Elemente gelöscht"} · Rückgängig mit Strg+Z`);
          cur.current = null; snapInfo.current = null; rawBeforeSmartSnap.current = null;
          bump(); schedule(); return;
        }
      }
      // Automatisch begradigen: nur eindeutig gerade, ausreichend lange Striche (Handschrift bleibt unberührt).
      // Start, Ende und Winkel bleiben wie gezeichnet. Der Freihandstrich wird als eigener Undo-Schritt abgelegt.
      let auto: Stroke | null = null;
      if (autoStraighten && smartShapesEnabled && finalStroke.tool === "pen" && !finalStroke.raw && finalStroke.pts.length > 2) {
        const z = zoomRef.current, P = finalStroke.pts;
        if (straightLineSpan(P, 45 / z)) auto = { ...finalStroke, pts: shapePts("line", P[0], P[P.length - 1]).map((q, i) => ({ ...q, p: i ? P[P.length - 1].p : P[0].p })), raw: true, auto: true };
        else {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const q of P) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
          // Leitung mit Knicken – automatisch nur bei klarem Schaltbild-Charakter: höchstens 4 lange, waagerechte/senkrechte Stücke.
          // Kleine Zickzack-Schrift (mm, ww, nn), große Z/N und Kurven bleiben unberührt; Halten und „Schaltbild glätten“ sind großzügiger.
          if (Math.hypot(x1 - x0, y1 - y0) >= 90 / z) auto = perfectPolyline(finalStroke, { maxSegments: 4, minSegment: 40 / z, axisDegrees: 14 });
          if (auto) auto = { ...auto, auto: true };
        }
      }
      if (auto) {
        strokes.current = [...strokes.current, finalStroke];
        pushHist(before.current); before.current = snap(); // 1. Rückgängig = zurück zum Freihandstrich
        strokes.current = strokes.current.filter((x) => x.id !== finalStroke.id);
        flash(auto.pts.length === 2 ? "Linie begradigt · Strg+Z stellt den Freihandstrich wieder her" : "Leitung begradigt · Strg+Z stellt den Freihandstrich wieder her");
      }
      const connectedStroke = connectLineExtension(auto ?? finalStroke);
      if (connectedStroke) strokes.current = [...strokes.current, connectedStroke];
      cur.current = null; rawBeforeSmartSnap.current = null;
    }
    shapeA.current = null;
    if (focusId.current) { document.getElementById("tf-" + focusId.current)?.focus(); focusId.current = null; }
    if (endDrag.current) { // Linie im passenden Block verankern; der Undo-Schritt entsteht unten über pushHist
      const ed = endDrag.current, edited = strokes.current.find((s) => s.id === ed.id);
      if (edited && edited !== ed.orig) {
        strokes.current = strokes.current.map((s) => (s.id === ed.id ? moved(s, 0, 0) : s));
        const ends = lineEnds(edited); if (ends) flash(`Winkel ${lineAngleDegrees(ends.a, ends.b)}° gespeichert · Rückgängig mit Strg+Z`);
      }
      endDrag.current = null;
    }
    const tapSpan = lasso.current ? Math.max(...lasso.current.map((p) => Math.hypot(p.x - lasso.current![0].x, p.y - lasso.current![0].y))) : 0;
    if (lasso.current && (lasso.current.length <= 2 || tapSpan < 8 / zoomRef.current)) { // Antippen wählt den obersten Strich direkt aus
      const p = lasso.current[0], r = 10 / zoomRef.current;
      const hit = [...strokes.current].reverse().find((s) => strokeHit(s, topsRef.current[s.blockId] ?? 0, p.x, p.y, r, 1.5));
      sel.current = hit ? new Set([hit.id]) : new Set();
      if (hit && lineEnds(hit)) flash("Linie ausgewählt · Endpunkt ziehen ändert den Winkel");
    } else if (lasso.current && lasso.current.length > 2) {
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
    if (usedTool === "lasso") setCircuitAnalysis(analyzeSelection());
    if (usedTool === "lasso" && tool !== "lasso" && sel.current.size > 0) { // Seitentaste: Auswahl sofort bearbeitbar (Griffe, Kopieren, Löschen)
      setTool("lasso"); flash("Auswahl mit der Stift-Seitentaste · Lasso ist jetzt aktiv");
    }
    if (strokes.current !== before.current.strokes || (usedTool !== "text" && textFields.current !== before.current.texts)) pushHist(before.current);
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

  /** Löscht eine einzelne PDF-Seite samt Strichen und Texten darauf. Nur im Löschmodus erreichbar; Rückgängig stellt alles wieder her. */
  const deletePdfPage = (blockId: string) => {
    const bs = blocksRef.current, b = bs.find((x) => x.id === blockId);
    if (!pdfDeleteMode || !b || b.kind !== "pdf") return;
    const s0 = snap();
    strokes.current = strokes.current.filter((s) => s.blockId !== blockId);
    textFields.current = textFields.current.filter((t) => t.blockId !== blockId);
    sel.current = new Set();
    setBlocks(bs.filter((x) => x.id !== blockId));
    pushHist(s0); bump(); schedule();
    flash(`PDF-Seite ${b.pageNum} gelöscht · Rückgängig mit Strg+Z`);
  };
  const togglePdfDeleteMode = () => {
    const next = !pdfDeleteMode;
    setPdfDeleteMode(next);
    flash(next ? "Löschmodus AN: ✕ an einer PDF-Seite löscht sie" : "Löschmodus AUS: PDF-Seiten sind geschützt");
  };

  /* ───── Zwischenraum ───── */
  const setGap = (id: string, gap: number) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, gap: Math.max(MIN_GAP, gap) } : b)));
  /** Messprotokoll aus dem Labor einfügen: Textfeld + Oszillogramm als normale Striche (Lasso, Radierer, Undo, Export funktionieren). */
  const insertLabRecord = (rec: LabRecord) => {
    const sc = scRef.current!, z = zoomRef.current, s0 = snap();
    const viewTop = sc.scrollTop / z + 24, b = blockAt(viewTop), top = topsRef.current[b.id] ?? 0;
    const x0 = 40, fontSize = 13, width = Math.min(PAGE_W - 2 * x0, 700);
    const lines = [rec.title, ...rec.lines];
    const estRows = lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * fontSize * 0.55) / (width - 16))), 0);
    const textHeight = Math.ceil(estRows * fontSize * 1.5 + 18);
    let y = viewTop - top;
    const newTexts: TextField[] = [{ id: uid(), blockId: b.id, text: lines.join("\n"), x: x0, y, width, height: textHeight, fontSize, color: "#1f2937" }];
    const newStrokes: Stroke[] = [];
    y += textHeight + 14;
    if (rec.scope) {
      const W = 400, H = 320, dx = W / 10, dy = H / 8, P = (x: number, yy: number): Pt => ({ x, y: yy, p: 0.5 });
      const line = (pts: Pt[], color: string, sz: number, lineStyle: LineStyle = "solid"): Stroke => ({ id: uid(), blockId: b.id, tool: "pen", color, size: sz, penKind: "ballpoint", lineStyle, pts, raw: true });
      for (let i = 1; i < 10; i++) newStrokes.push(line([P(x0 + i * dx, y), P(x0 + i * dx, y + H)], "#cbd5e1", 0.8, i === 5 ? "solid" : "dotted"));
      for (let j = 1; j < 8; j++) newStrokes.push(line([P(x0, y + j * dy), P(x0 + W, y + j * dy)], "#cbd5e1", 0.8, j === 4 ? "solid" : "dotted"));
      newStrokes.push(line([P(x0, y), P(x0 + W, y), P(x0 + W, y + H), P(x0, y + H), P(x0, y)], "#475569", 1.4));
      for (const t of rec.scope.traces) {
        const step = Math.max(1, Math.floor(t.points.length / 600)), pts: Pt[] = [];
        for (let i = 0; i < t.points.length; i += step) pts.push(P(x0 + (i / (t.points.length - 1)) * W, y + H / 2 - clamp(t.points[i], -4, 4) * dy));
        newStrokes.push(line(pts, t.color, 1.8));
      }
      newTexts.push({ id: uid(), blockId: b.id, text: `${rec.scope.caption} · ${rec.scope.traces.map((t) => `${t.label} ${t.color === "#b45309" ? "braun" : "blau"}`).join(", ")}`, x: x0, y: y + H + 6, width: W + 160, height: 24, fontSize: 11, color: "#475569" });
      y += H + 36;
    }
    growTail(top + y + 200);
    strokes.current = [...strokes.current, ...newStrokes];
    textFields.current = [...textFields.current, ...newTexts];
    pushHist(s0); bump(); schedule();
    flash("Messprotokoll eingefügt · Rückgängig mit Strg+Z");
  };
  const addSpaceAtView = () => {
    const sc = scRef.current!, b = blockAt((sc.scrollTop + sc.clientHeight / 2) / zoomRef.current), s0 = snap();
    setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, gap: Math.max(x.gap, MIN_GAP) + SPACE_STEP } : x)));
    pushHist(s0);
  };
  const startGapDrag = (e: React.PointerEvent, b: Block) => {
    if (e.pointerType === "touch" || readOnlyRef.current) return; // Finger/Handballen: nicht den Zwischenraum ziehen, sondern normal scrollen (Zeichenfläche entscheidet)
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
    const docId = uid();
    setSaved("PDF wird geprüft …");
    let doc: PDFDocumentProxy;
    try {
      const pdfjs = await loadPdfJs();
      doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise; // zuerst prüfen: kaputte Dateien landen nicht in der Datenbank
      if (!doc.numPages) throw new Error("leer");
      await kvSet("pdf:" + docId, new Blob([file], { type: "application/pdf" })); // Original als Blob offline sichern (ohne weitere Kopie im Speicher)
    } catch (err) {
      try { await kvDel("pdf:" + docId); } catch { /* war nie gespeichert */ }
      const name = err instanceof Error ? err.name : "";
      const msg = name === "PasswordException" ? "Diese PDF ist passwortgeschützt und kann nicht importiert werden."
        : isQuotaError(err) ? "Der Gerätespeicher ist voll – die PDF konnte nicht importiert werden."
        : "Diese Datei ist keine lesbare PDF und wurde nicht importiert.";
      setSaved("PDF nicht importiert"); alert(msg); return;
    }
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
    const ok = await rasterizeInWorker(await file.arrayBuffer(), async (n, total, blob) => {
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
    try { await exportPdfInner(); }
    catch (err) { setSaved(isQuotaError(err) ? "Export fehlgeschlagen: Speicher voll" : "Export fehlgeschlagen – bitte erneut versuchen"); }
  };
  const exportPdfInner = async () => {
    const { jsPDF } = await import("jspdf");
    const printableInk = (ink: string) => {
      if (!/^#[0-9a-f]{6}$/i.test(ink)) return ink;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.94 ? "#111827" : ink;
    };
    const S = 2, TH = 1123, bs = blocksRef.current, bmp = new Map<string, HTMLCanvasElement>();
    // PDF-Seiten werden erst für die Kachel gerendert, die sie braucht, und danach wieder freigegeben (spart Speicher bei langen PDFs)
    const ensureBitmaps = async (y0: number) => {
      const needed = bs.filter((b) => b.kind === "pdf" && !(topsRef.current[b.id] + b.height + b.gap < y0 || topsRef.current[b.id] > y0 + TH));
      for (const [id, c] of bmp) if (!needed.some((b) => b.id === id)) { c.width = 0; c.height = 0; bmp.delete(id); }
      for (const b of needed) {
        if (bmp.has(b.id)) continue;
        const doc = docs.current.get(b.docId!);
        if (!doc) continue;
        const page = await doc.getPage(b.pageNum!), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: (PAGE_W / base.width) * S });
        const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
        await page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp } as Parameters<typeof page.render>[0]).promise;
        bmp.set(b.id, c);
      }
    };
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
      await ensureBitmaps(y0);
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
      strokes.current.forEach((s) => {
        const st = topsRef.current[s.blockId] ?? 0, bb = bbox(s);
        if (st + bb.y1 < y0 - 40 || st + bb.y0 > y0 + TH + 40) return; // liegt nicht auf dieser Seite
        paint(ctx, s, 0, 0, printableInk(s.color));
      });
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
      cv.width = 0; cv.height = 0; // Kachel sofort freigeben
      if (i < pages - 1) pdf.addPage([PAGE_W, TH]);
    }
    for (const c of bmp.values()) { c.width = 0; c.height = 0; }
    await saveFile(pdf.output("blob"), (title?.split(" › ").pop() || "Notiz") + ".pdf");
    setSaved("Exportiert");
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (functionMenuOpen || viewMenuOpen) { setFunctionMenuOpen(false); setViewMenuOpen(false); return; }
        if (!(e.target as HTMLElement)?.closest?.("textarea, input, select")) { setFocus(false); return; }
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if ((e.target as HTMLElement)?.closest?.("textarea, input, select")) return; // in Textfeldern gilt das native Undo
      const key = e.key.toLowerCase();
      if (readOnlyRef.current) { if (key === "0") { e.preventDefault(); setZoom(1); } return; }
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
      if (readOnlyRef.current) return;
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if ((e.key === "Delete" || e.key === "Backspace") && sel.current.size) { e.preventDefault(); deleteSel(); }
      else if (mod && key === "c" && sel.current.size) { e.preventDefault(); copySel(); }
      else if (mod && key === "v") { e.preventDefault(); pasteClip(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const clipFilled = clipCount > 0;
  const showBar = !readOnly && (sel.current.size > 0 || (tool === "lasso" && clipFilled));
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
  const btn = (on: boolean) => `px-2.5 py-1.5 rounded-lg text-sm transition select-none ${on ? "bg-slate-900 text-white" : "hover:bg-slate-200 text-slate-700"}`;
  const palette = [...COLORS, ...customColors.filter((c) => !COLORS.includes(c))];
  // Obere Leiste zeigt nur, WAS gewählt ist; die Optionen stehen in der Kontextleiste darunter (Vorlage „XNTS Werkzeugleiste“)
  type TopTool = Tool | "lab" | "func";
  const TOP_TOOLS: { id: TopTool; label: string }[] = [
    { id: "pen", label: "Stift" }, { id: "eraser", label: "Radierer" }, { id: "lasso", label: "Lasso" }, { id: "shape", label: "Form" },
    { id: "line", label: "Linie/Pfeil" }, { id: "text", label: "Text" }, { id: "lab", label: "Labor" }, { id: "func", label: "Funktion f(x)" },
  ];
  const topActive = (id: TopTool) => id === "pen" ? tool === "pen" || tool === "highlighter" : id === "lab" ? labOpen : id === "func" ? functionDialog : tool === id;
  const functionActive = false;
  const toolIcon = (kind: Tool) => {
    const paths: Record<Tool, React.ReactNode> = {
      pen: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14.5 7.5 3 3"/></>,
      highlighter: <><path d="m4 16 9-9 5 5-9 9H4z"/><path d="m12 8 4 4M4 21h16"/></>,
      eraser: <><path d="m7 21-4-4a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-7 7z"/><path d="m7 21 7-7"/></>,
      lasso: <><path d="M9 17c-4 0-6-2-6-5 0-4 4-7 9-7s9 2 9 6-4 7-9 7"/><path d="M9 17c0 2-1 4-3 4-1 0-2-1-2-2s1-2 2-2h3Z"/></>,
      shape: <><rect x="4" y="4" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/><path d="m15 5 5 5"/></>,
      text: <><path d="M4 6V4h16v2M12 4v16M8 20h8"/></>,
      line: <><path d="M4 20 19 5"/><path d="M12 5h7v7"/></>,
    };
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>;
  };
  const topIcon = (id: TopTool) => id === "lab"
    ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6M10 3v6l-5.2 9.1A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-2.9L14 9V3M7.4 15h9.2"/></svg>
    : id === "func" ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16M4 20V4M6 17c3-9 5-9 7-4s4 4 6-6"/></svg>
    : toolIcon(id);
  const pickTop = (id: TopTool) => {
    setColorMenu(null);
    if (id === "lab") { setLabOpen((v) => !v); return; }
    if (id === "func") { openFunctionForSelection(); return; }
    if (topActive(id)) { setCtxOpen((v) => !v); return; } // gewähltes Werkzeug erneut antippen = Kontextleiste ein/aus
    setCtxOpen(true); pickTool(id);
  };
  const SHAPES: { id: Shape; label: string; d: string }[] = [
    { id: "rect", label: "Rechteck", d: "M3 6h18v12H3z" }, { id: "square", label: "Quadrat", d: "M5 5h14v14H5z" },
    { id: "circle", label: "Kreis", d: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0" }, { id: "ellipse", label: "Ellipse", d: "M2 12a10 6 0 1 0 20 0a10 6 0 1 0-20 0" },
    { id: "triangle", label: "Dreieck", d: "M12 3l9 17H3z" }, { id: "diamond", label: "Raute", d: "M12 2l9 10-9 10-9-10z" },
    { id: "pentagon", label: "Fünfeck", d: "M12 2l9.5 7-3.6 11H6.1L2.5 9z" }, { id: "star", label: "Stern", d: "M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z" },
    { id: "axes", label: "Achsen", d: "M4 20h17M4 20V3M18 17l3 3-3 3M1 6l3-3 3 3" },
  ];
  const sizeDot = (v: number, on: boolean, label: string, pick: () => void, hollow = false) => (
    <button key={label} type="button" className="xnts-ctx__size" aria-pressed={on} title={label} aria-label={label} onClick={pick}>
      <span style={{ width: Math.min(22, 3 + v * 2.4), height: Math.min(22, 3 + v * 2.4), background: hollow ? "#fff" : "currentColor", border: hollow ? "2px solid currentColor" : 0 }} />
    </button>
  );
  const lineIcon = (id: LineStyle, ink = "currentColor") => {
    const dash = id.startsWith("dashed") ? "6 5" : id.startsWith("dotted") ? "0.1 6" : undefined, arrow = id === "arrow" || id.endsWith("Arrow");
    return <svg aria-hidden="true" width="40" height="18" viewBox="0 0 44 20"><line x1="3" y1="10" x2={arrow ? 38 : 41} y2="10" stroke={ink} strokeWidth="2.6" strokeDasharray={dash} strokeLinecap="round" />{arrow && <path d="M33 4l8 6-8 6" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />}</svg>;
  };
  // Farbfenster unter einem Farbknopf: Grundfarben, eigene Farben und freie Mischung
  const colorPop = (current: string, pickHex: (hex: string) => void, title: string) => (
    <div className="xnts-pop xnts-pop--colors" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
      <strong>{title}</strong>
      <div className="xnts-pop__swatches">{palette.map((c) => <button key={c} type="button" aria-label={`Farbe ${c}`} aria-pressed={c === current} style={{ background: c }} onClick={() => pickHex(c)} />)}</div>
      <label className="xnts-pop__mix">＋ Eigene Farbe mischen<input type="color" value={current} onChange={(e) => { const v = e.target.value.toLowerCase(); setCustomColors((old) => old.includes(v) ? old : [...old, v].slice(-12)); pickHex(v); }} /></label>
    </div>
  );
  // Vier Farbplätze, unabhängig voneinander: antippen = wählen, gewählten Platz nochmal antippen = Farbe dieses Platzes ändern
  const colorSlotsUi = (
    <div className="xnts-ctx__group" role="group" aria-label="Farbplätze">
      {colorSlots.map((c, i) => { const on = activeSlot === i && color === c, key = `slot${i}`;
        return <div key={i} className="xnts-ctx__slotwrap">
          <button type="button" className="xnts-ctx__slot" aria-pressed={on} aria-label={`Farbplatz ${i + 1}: ${c}`} title={on ? "Nochmal antippen: Farbe dieses Platzes ändern" : "Farbe wählen"} style={{ background: c }}
            onClick={() => { if (on) setColorMenu(colorMenu === key ? null : key); else { setActiveSlot(i); setColor(c); changePen({ color: c }); setColorMenu(null); } }} />
          {colorMenu === key && colorPop(c, (hex) => { setColorSlots((sl) => sl.map((x, j) => (j === i ? hex : x))); setActiveSlot(i); setColor(hex); changePen({ color: hex }); setColorMenu(null); }, `Farbplatz ${i + 1} festlegen`)}
        </div>; })}
    </div>
  );
  const slider = (value: number, set: (v: number) => void, label: string) => (
    <label className="xnts-ctx__slider" title={label}>
      <input type="range" min={0.5} max={12} step={0.5} value={value} onChange={(e) => set(+e.target.value)} aria-label={label} />
      <span>{value.toFixed(1).replace(".", ",")} px</span>
    </label>
  );
  const CtxSep = () => <span className="xnts-ctx__sep" aria-hidden="true" />;
  const ctxContent = (): React.ReactNode => {
    if (tool === "pen" || tool === "highlighter") {
      const setPenSize = (v: number) => { setSize(v); changePen({ size: v }); };
      const marker = activePen.kind === "marker";
      return <>
        <div className="xnts-ctx__group" role="group" aria-label="Meine Stifte">
          {penProfiles.map((p) => <button key={p.id} type="button" className="xnts-ctx__pen" aria-pressed={activePen.id === p.id} onClick={() => choosePen(p)} title={`${p.name} · ${p.size.toFixed(1)} px`}>
            <PenGlyph kind={p.kind} color={p.id === activePen.id ? color : p.color} className="xnts-ctx__pen-glyph" /><span>{p.name.split(" ")[0].replace("Kugelschreiber", "Kugel").replace("Textmarker", "Marker").replace("Bleistift", "Blei")}</span>
          </button>)}
          <button type="button" className="xnts-ctx__add" onClick={addPenProfile} title="Eigenen Stift hinzufügen" aria-label="Eigenen Stift hinzufügen">＋</button>
        </div>
        <CtxSep />
        <div className="xnts-ctx__group" role="group" aria-label="Strichgröße">
          {([["dünn", 1.5], ["mittel", 2.5], ["dick", 4]] as const).map(([l, v]) => sizeDot(v, Math.abs(size - v) < 0.01, `Strichgröße ${l}`, () => setPenSize(v)))}
          {slider(size, setPenSize, "Strichgröße frei einstellen")}
          <svg className="xnts-ctx__preview" aria-hidden="true" width="58" height="30" viewBox="0 0 58 30"><path d="M6 20c8-12 14-12 20-2s12 10 26-6" fill="none" stroke={color} strokeWidth={marker ? size * 5 : size} strokeOpacity={marker ? 0.35 : 1} strokeLinecap={marker ? "butt" : "round"} strokeLinejoin="round" /></svg>
        </div>
        <CtxSep />
        {colorSlotsUi}
        <button type="button" className="xnts-ctx__btn xnts-ctx__info" onClick={() => flash(penHint)} title={penHint} aria-label="Hinweis zu Linien und Formen">ⓘ</button>
      </>;
    }
    if (tool === "eraser") return <>
      <div className="xnts-ctx__seg" role="group" aria-label="Radiermodus">
        <button type="button" aria-pressed={eraseMode === "stroke"} onClick={() => setEraseMode("stroke")} title="Berührte Striche werden komplett gelöscht">Ganzer Strich</button>
        <button type="button" aria-pressed={eraseMode === "pixel"} onClick={() => setEraseMode("pixel")} title="Nur die Stelle unter dem Radierer wird entfernt">Nur Berührtes</button>
      </div>
      <CtxSep />
      <div className="xnts-ctx__group" role="group" aria-label="Radierergröße">
        {([["klein", 1.5], ["mittel", 2.5], ["groß", 5]] as const).map(([l, v]) => sizeDot(v, Math.abs(eraserSize - v) < 0.01, `Radierergröße ${l}`, () => setEraserSize(v), true))}
        {slider(eraserSize, setEraserSize, "Radierergröße frei einstellen")}
      </div>
      <CtxSep />
      <button type="button" role="switch" aria-checked={scribbleEraseEnabled} className="xnts-ctx__switch" onClick={() => setScribbleEraseEnabled(!scribbleEraseEnabled)} title="Wenn an: Mit Stift oder Marker über etwas kritzeln löscht es">
        <span aria-hidden="true" />Kritzelradierer {scribbleEraseEnabled ? "an" : "aus"}
      </button>
    </>;
    if (tool === "lasso") return <>
      <span className="xnts-ctx__hint">Antippen oder umfahren · Endpunkte ziehen ändert den Winkel · ↻ dreht</span>
      <button type="button" className="xnts-ctx__btn" aria-pressed={angleSnap} onClick={() => setAngleSnap(!angleSnap)} title="Winkel beim Ziehen, Drehen und Linienzeichnen auf 15°-Schritte einrasten. Ohne Raster ist jeder Winkel möglich; Umschalttaste rastet vorübergehend ein.">15°-Raster</button>
      {sel.current.size > 0 && <button type="button" className="xnts-ctx__btn" onClick={perfectSelected} title="Auswahl als Schaltbild prüfen und klare Leitungen und Grundformen glätten">Schaltbild erkennen &amp; glätten</button>}
      <button type="button" className="xnts-ctx__btn xnts-ctx__info" onClick={() => flash(lassoHint)} title={lassoHint} aria-label="Hinweis zum Lasso">ⓘ</button>
    </>;
    if (tool === "shape") return <>
      <div className="xnts-ctx__group" role="group" aria-label="Formart">
        {SHAPES.map((f) => <button key={f.id} type="button" className="xnts-ctx__shape" aria-pressed={shapeKind === f.id} title={f.label} onClick={() => setShapeKind(f.id)}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={f.d} /></svg><span>{f.label}</span>
        </button>)}
      </div>
      <CtxSep />
      <button type="button" className="xnts-ctx__btn" aria-pressed={shapeFill} onClick={() => setShapeFill(!shapeFill)} title="Formen mit einer zarten Fläche in der gewählten Farbe füllen">Gefüllt</button>
      <CtxSep />
      {colorSlotsUi}
    </>;
    if (tool === "line") return <>
      <div className="xnts-ctx__group" role="group" aria-label="Linien- und Pfeilart">
        {LINE_STYLES.map((l) => <button key={l.id} type="button" className="xnts-ctx__line" aria-pressed={lineToolStyle === l.id} title={l.title} aria-label={l.title} onClick={() => setLineToolStyle(l.id)}>{lineIcon(l.id, lineColor)}</button>)}
      </div>
      <CtxSep />
      <div className="xnts-ctx__group" role="group" aria-label="Linienbreite">
        {([["dünn", 1.5], ["mittel", 2.5], ["dick", 4]] as const).map(([l, v]) => sizeDot(v, Math.abs(lineSize - v) < 0.01, `Linienbreite ${l}`, () => setLineSize(v)))}
        {slider(lineSize, setLineSize, "Linienbreite frei einstellen")}
      </div>
      <CtxSep />
      <div className="xnts-ctx__slotwrap">
        <button type="button" className="xnts-ctx__slot" aria-label={`Linienfarbe ${lineColor} – eigene Farbe, unabhängig vom Stift`} title="Linienfarbe (unabhängig vom Stift)" style={{ background: lineColor }} aria-pressed={colorMenu === "line"} onClick={() => setColorMenu(colorMenu === "line" ? null : "line")} />
        {colorMenu === "line" && colorPop(lineColor, (hex) => { setLineColor(hex); setColorMenu(null); }, "Linienfarbe (eigene, unabhängig vom Stift)")}
      </div>
      <button type="button" className="xnts-ctx__btn" aria-pressed={angleSnap} onClick={() => setAngleSnap(!angleSnap)} title="Linien beim Zeichnen auf 15°-Schritte einrasten. Ohne Raster ist jeder Winkel möglich; Umschalttaste rastet vorübergehend ein.">15°-Raster</button>
    </>;
    if (tool === "text") return <>
      <span className="xnts-ctx__hint">Auf die Seite tippen, um ein Textfeld zu setzen</span>
      <CtxSep />
      {colorSlotsUi}
    </>;
    return null;
  };
  const pickTool = (t: Tool) => {
    if (t === "pen") { const p = activePen.kind === "marker" ? penProfiles.find((x) => x.kind !== "marker") : activePen; if (p) choosePen(p); else setTool(t); }
    else if (t === "highlighter") { const p = penProfiles.find((x) => x.kind === "marker"); if (p) choosePen(p); else setTool(t); }
    else setTool(t);
  };
  const focusIcon = <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>;
  const penHint = smartShapesEnabled ? "Gerade Linien werden beim Absetzen begradigt · Strich-Ende 0,5 s halten = Form glätten / Winkel ändern" : "Automatisches Glätten und Verbinden deaktiviert";
  const lassoHint = "Linie antippen · Endpunkt ziehen = Winkel ändern · ↻ dreht die Auswahl";

  return (
    <div className="notiz-workspace relative h-full flex-1 min-w-0 flex flex-col bg-slate-100 text-slate-800 select-none overscroll-none" data-theme={darkMode ? "dark" : "light"}>
      {/* Einheitliche dunkle Ockerleiste; die Kunstcollage sitzt dauerhaft in der Bibliothek. */}
      <div className={(compact ? "xnts-topbar xnts-topbar--plain" : "xnts-topbar") + (focus ? " xnts-hidden" : "")}>
      {!compact && <div className="xnts-art-banner__lockup xnts-topbar__lockup" aria-hidden="true"><strong>XNTS</strong><span>NOTES · STUDY · ART</span></div>}
      <header className="notiz-toolbar flex items-center gap-1.5 px-3 py-1.5 bg-white border-b border-slate-200 flex-wrap" data-collapsed={toolbarCollapsed} data-menu-open={functionMenuOpen || viewMenuOpen}>
        <div className="notiz-toolbar__row notiz-toolbar__primary">
          {onLibrary && <button type="button" className="xnts-tools__btn xnts-tools__lib" aria-pressed={libraryOpen} onClick={() => onLibrary(!libraryOpen)} title={libraryOpen ? "Bibliothek ausblenden" : "Bibliothek anzeigen"} aria-label={libraryOpen ? "Bibliothek ausblenden" : "Bibliothek anzeigen"}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.5-.9 3 15.6-3.5.9z" /></svg>
          </button>}
          <div ref={viewMenuTriggerRef} className="notiz-toolbar__menu-trigger">
            <button className={btn(viewMenuOpen) + " notiz-toolbar__menu-button"} onClick={() => { setViewMenuOpen((v) => !v); setFunctionMenuOpen(false); }} aria-haspopup="true" aria-expanded={viewMenuOpen} aria-controls={`${toolbarId}-view`}>
              Ansicht <span aria-hidden="true">⌄</span>
            </button>
          </div>
          {readOnly && <span className="xnts-chip" title="Du kannst diese Notiz ansehen, scrollen und zoomen. Zum Mitschreiben „Meine privat“ wählen oder einen Admin um das Schreibrecht bitten.">👁 Nur ansehen</span>}
          {canEdit && <div className="xnts-tools" role="toolbar" aria-label="Werkzeuge">
            {TOP_TOOLS.map((t) => <button key={t.id} type="button" title={t.label + (topActive(t.id) && t.id !== "lab" && t.id !== "func" ? " – nochmal antippen blendet die Optionen ein/aus" : "")} aria-label={t.label} aria-pressed={topActive(t.id)} className="xnts-tools__btn" onClick={() => pickTop(t.id)}>{topIcon(t.id)}</button>)}
          </div>}
          <div ref={functionMenuTriggerRef} className="notiz-toolbar__menu-trigger">
            <button className={btn(functionMenuOpen || functionActive) + " notiz-toolbar__menu-button"} onClick={() => { setFunctionMenuOpen((v) => !v); setViewMenuOpen(false); }} aria-haspopup="true" aria-expanded={functionMenuOpen} aria-controls={`${toolbarId}-function`} aria-pressed={functionActive}>
              Mehr <span aria-hidden="true">⌄</span>
            </button>
          </div>
        </div>
        {viewMenuOpen && <div id={`${toolbarId}-view`} ref={viewMenuPanelRef} className="notiz-toolbar__panel" role="group" aria-label="Ansicht einstellen">
          <div className="notiz-toolbar__panel-group">
            <span className="notiz-toolbar__panel-label">Bereiche</span>
            <button className={btn(sidebar)} aria-pressed={sidebar} onClick={() => setSidebar((v) => !v)}>{sidebar ? "Seitenliste ausblenden" : "Seitenliste anzeigen"}</button>
            <button className={btn(toolbarCollapsed)} aria-pressed={toolbarCollapsed} onClick={() => setToolbarCollapsed((v) => !v)}>{toolbarCollapsed ? "Leiste erweitern" : "Leiste verkleinern"}</button>
            <button className={btn(false) + " inline-flex items-center gap-1.5"} onClick={() => { setViewMenuOpen(false); setFocus(true); }} title="Alle Leisten ausblenden – Esc beendet den Fokusmodus">{focusIcon} Fokusmodus</button>
          </div>
          {canEdit && <div className="notiz-toolbar__panel-group">
            <span className="notiz-toolbar__panel-label">Verlauf</span>
            <button className={btn(false)} onClick={undo} title="Rückgängig (Strg+Z)" aria-label="Rückgängig">↶ Rückgängig</button>
            <button className={btn(false)} onClick={redo} title="Wiederholen (Strg+Y)" aria-label="Wiederholen">↷ Wiederholen</button>
          </div>}
          <div className="notiz-toolbar__panel-group notiz-toolbar__zoom-group">
            <span className="notiz-toolbar__panel-label">Zoom</span>
            <button className={btn(false)} onClick={() => setZoom(zoomRef.current / 1.25)} aria-label="Verkleinern">−</button>
            <button className={btn(false)} onClick={() => setZoom(1)} title="Auf 100 Prozent setzen (Strg+0)">{Math.round(zoom * 100)}%</button>
            <button className={btn(false)} onClick={() => setZoom(zoomRef.current * 1.25)} aria-label="Vergrößern">+</button>
            <input type="range" min={MIN_Z} max={MAX_Z} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} aria-label="Zoomstufe" />
            <button className={btn(false)} onClick={() => setZoom((scRef.current!.clientWidth - 32) / PAGE_W)}>Breite</button>
          </div>
        </div>}
        {functionMenuOpen && <div id={`${toolbarId}-function`} ref={functionMenuPanelRef} className="notiz-toolbar__panel" role="group" aria-label="Mehr">
          {canEdit && <>
            <div className="notiz-toolbar__panel-group">
              <span className="notiz-toolbar__panel-label">Seite</span>
              <select value={tpl} onChange={(e) => setTplState(e.target.value as Tpl)} aria-label="Seitenvorlage">
                <option value="blank">Blanko</option><option value="lined">Liniert</option><option value="grid">Kariert</option><option value="dots">Punktraster</option>
              </select>
              <label className="notiz-toolbar__panel-file cursor-pointer">
                PDF importieren
                <input type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importPdf(f); e.target.value = ""; }} />
              </label>
            </div>
          </>}
          <div className="notiz-toolbar__panel-group">
            <span className="notiz-toolbar__panel-label">PDF</span>
            <button className={btn(false)} onClick={exportPdf}>Als PDF exportieren</button>
          </div>
        </div>}
        <div className="notiz-toolbar__row notiz-toolbar__document">
          {canEdit && <button className={btn(false)} onClick={addSpaceAtView}>Platz einfügen</button>}
          {canEdit && hasPdf && <button className={btn(pdfDeleteMode) + " notiz-toolbar__pdf-delete"} aria-pressed={pdfDeleteMode} onClick={togglePdfDeleteMode}
            title={pdfDeleteMode ? "Löschmodus beenden – PDF-Seiten können dann nicht mehr gelöscht werden" : "Löschmodus einschalten: an jeder PDF-Seite erscheint ein Löschknopf"}>
            {pdfDeleteMode ? "🗑 Löschen AN – beenden" : "🗑 PDF-Seiten löschen"}
          </button>}
          <button className={btn(settingsOpen)} onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen} aria-controls="notizraum-settings">⚙ Einstellungen</button>
          {title && <span className="notiz-toolbar__title text-sm font-medium truncate max-w-[18rem] ml-auto">{title}</span>}
          <span className="notiz-toolbar__saved text-xs text-slate-500">{saved}</span>
        </div>
      </header>
      </div>


      <div className="relative flex flex-1 min-h-0">
        {labOpen && <LabBench onClose={() => setLabOpen(false)} onInsert={insertLabRecord} noteCircuit={circuitAnalysis} />}
        {sidebar && !focus && (
          <aside className="notiz-page-sidebar w-44 shrink-0 overflow-auto bg-white border-r border-slate-200 p-2 space-y-1">
            {blocks.map((b, i) => (
              <div key={b.id}>
                {canEdit && <button onClick={() => insertEmptyPageAt(i)} title="Leere Seite hier einfügen" aria-label={"Leere Seite vor Seite " + (i + 1) + " einfügen"}
                  className="w-full h-6 rounded text-[11px] text-slate-400 hover:text-blue-600 hover:bg-blue-50 select-none">＋ Seite</button>}
                <div className="flex items-center gap-0.5">
                  <button className="flex-1 min-w-0 text-left px-2 py-2 rounded-md text-sm truncate hover:bg-slate-100"
                    onClick={() => scRef.current!.scrollTo({ top: tops[b.id] * zoom - 12, behavior: "smooth" })}>
                    {i + 1}. {b.kind === "pdf" ? `PDF S. ${b.pageNum}` : i === blocks.length - 1 ? "Freier Bereich" : "Leere Seite"}
                  </button>
                  {pdfDeleteMode && b.kind === "pdf" && <button onClick={() => deletePdfPage(b.id)} aria-label={`PDF-Seite ${b.pageNum} löschen`} title="Diese PDF-Seite löschen"
                    className="w-8 h-9 rounded-md text-xs text-red-600 hover:bg-red-50">🗑</button>}
                  {canEdit && i < blocks.length - 1 && !(pdfDeleteMode && b.kind === "pdf") && (
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
        <div className="relative flex flex-1 min-w-0">
        {canEdit && !focus && ctxOpen && ctxContent() && <div className="xnts-ctx" role="toolbar" aria-label="Optionen des Werkzeugs" onPointerDown={(e) => e.stopPropagation()}>
          <div className="xnts-ctx__inner">{ctxContent()}</div>
        </div>}
        {focus && <div className={"xnts-focusbar" + (focusMini ? " is-mini" : "") + (focusMenu || colorMenu?.startsWith("focus") ? " has-pop" : "")} role="toolbar" aria-label="Fokus-Leiste">
          {!focusMini && onLibrary && <span className="xnts-focusbar__wrap">
            <button type="button" aria-expanded={focusMenu === "lib"} title="Bibliothek – Ansicht wählen" aria-label="Bibliothek – Ansicht wählen" onClick={() => setFocusMenu(focusMenu === "lib" ? null : "lib")}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.5-.9 3 15.6-3.5.9z" /></svg>
            </button>
            {focusMenu === "lib" && <div className="xnts-pop" role="menu" aria-label="Bibliothek · Ansicht">
              <strong>Bibliothek · Ansicht</strong>
              {([["tree", "Ordner", "Nach Jahren, Fächern und Themen"], ["list", "Liste", "Kompakt mit Pfad"], ["grid", "Raster", "Kacheln"], ["recent", "Zuletzt", "Zuletzt geöffnete zuerst"]] as const).map(([id, l, h]) =>
                <button key={id} type="button" role="menuitem" className="xnts-pop__row" onClick={() => { setFocusMenu(null); setFocus(false); window.dispatchEvent(new CustomEvent("xnts-open-library", { detail: id })); }}><b>{l}</b><small>{h}</small></button>)}
            </div>}
          </span>}
          {canEdit && !focusMini && <span className="xnts-focusbar__wrap">
            <button type="button" aria-expanded={focusMenu === "pen"} aria-pressed={tool === "pen" || tool === "highlighter"} title={`Stift wählen: ${activePen.name}`} aria-label={`Stift wählen: ${activePen.name}`} className="xnts-focusbar__pen" onClick={() => { if (tool !== "pen" && tool !== "highlighter") pickTool("pen"); setFocusMenu(focusMenu === "pen" ? null : "pen"); }}>
              <PenGlyph kind={activePen.kind} color={color} className="xnts-focusbar__pen-glyph" />
            </button>
            {focusMenu === "pen" && <div className="xnts-pop" role="menu" aria-label="Meine Stifte">
              <strong>Meine Stifte</strong>
              {penProfiles.map((p) => <button key={p.id} type="button" role="menuitemradio" aria-checked={activePen.id === p.id} className="xnts-pop__row xnts-pop__pen" onClick={() => { choosePen(p); setFocusMenu(null); }}><PenGlyph kind={p.kind} color={p.color} className="xnts-pop__pen-glyph" /><b>{p.name}</b></button>)}
            </div>}
          </span>}
          {canEdit && !focusMini && (["eraser", "lasso"] as Tool[]).map((t) => <button key={t} type="button" title={t === "eraser" ? "Radierer" : "Lasso"} aria-label={t === "eraser" ? "Radierer" : "Lasso"} aria-pressed={tool === t} onClick={() => { setFocusMenu(null); pickTool(t); }}>{toolIcon(t)}</button>)}
          {canEdit && !focusMini && <span className="xnts-focusbar__wrap">
            <button type="button" aria-expanded={focusMenu === "line"} aria-pressed={tool === "line"} title="Linie/Pfeil" aria-label="Linie/Pfeil" onClick={() => setFocusMenu(focusMenu === "line" ? null : "line")}>{lineIcon(lineToolStyle)}</button>
            {focusMenu === "line" && <div className="xnts-pop" role="menu" aria-label="Linien- und Pfeilart">
              <strong>Linien- und Pfeilart</strong>
              <div className="xnts-pop__lines">{LINE_STYLES.map((l) => <button key={l.id} type="button" aria-pressed={tool === "line" && lineToolStyle === l.id} title={l.title} aria-label={l.title} onClick={() => { setLineToolStyle(l.id); setTool("line"); setFocusMenu(null); }}>{lineIcon(l.id, "#191620")}</button>)}</div>
            </div>}
          </span>}
          {canEdit && !focusMini && <i aria-hidden="true" />}
          {canEdit && !focusMini && focusSlots.map((c, i) => { const on = color === c, key = `focus${i}`;
            return <span key={i} className="xnts-focusbar__wrap">
              <button type="button" aria-label={`Farbplatz ${i + 1}: ${c}`} aria-pressed={on} className="xnts-focusbar__swatch" style={{ background: c }} title={on ? "Nochmal antippen: Farbe dieses Platzes ändern" : "Farbe wählen"}
                onClick={() => { if (on) setColorMenu(colorMenu === key ? null : key); else { setColor(c); changePen({ color: c }); setColorMenu(null); } }} />
              {colorMenu === key && colorPop(c, (hex) => { setFocusSlots((sl) => sl.map((x, j) => (j === i ? hex : x))); setColor(hex); changePen({ color: hex }); setColorMenu(null); }, `Farbplatz ${i + 1} festlegen`)}
            </span>; })}
          {canEdit && !focusMini && <i aria-hidden="true" />}
          {canEdit && !focusMini && <button type="button" onClick={undo} title="Rückgängig" aria-label="Rückgängig">↶</button>}
          {canEdit && !focusMini && <button type="button" onClick={redo} title="Wiederholen" aria-label="Wiederholen">↷</button>}
          {!focusMini && <button type="button" onClick={() => setZoom(zoomRef.current / 1.25)} aria-label="Verkleinern">−</button>}
          {!focusMini && <button type="button" onClick={() => setZoom((scRef.current!.clientWidth - 32) / PAGE_W)} title="Auf Breite einpassen" className="xnts-focusbar__zoom">{Math.round(zoom * 100)} %</button>}
          {!focusMini && <button type="button" onClick={() => setZoom(zoomRef.current * 1.25)} aria-label="Vergrößern">+</button>}
          <button type="button" onClick={() => { setFocusMenu(null); setFocusMini(!focusMini); }} title={focusMini ? "Werkzeuge einblenden" : "Fokus-Leiste verkleinern"} aria-label={focusMini ? "Werkzeuge einblenden" : "Fokus-Leiste verkleinern"}>{focusMini ? (canEdit ? toolIcon(tool) : "＋") : "›"}</button>
          <button type="button" className="xnts-focusbar__exit" onClick={() => { setFocusMenu(null); setFocus(false); }} title="Fokus beenden – Leisten wieder zeigen (Esc)">✕ Leisten</button>
        </div>}
        {pdfDeleteMode && <div className="xnts-delete-banner" role="status">
          <span><strong>Löschmodus aktiv:</strong> ✕ an einer PDF-Seite tippen. Rückgängig mit Strg+Z.</span>
          <button type="button" onClick={togglePdfDeleteMode}>Beenden</button>
        </div>}
        <div ref={scRef} className="xnts-canvas-scroll flex-1 min-w-0 overflow-auto relative" style={{ touchAction: "none", cursor: readOnly ? "grab" : tool === "lasso" ? "crosshair" : tool === "eraser" ? "none" : tool === "text" ? "text" : "default" }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault() /* Stift-Seitentaste und „Gedrückt halten“ unter Windows öffnen sonst das Kontextmenü und brechen den Strich ab */}
          onDoubleClick={(e) => {
            if (tool !== "lasso" || readOnly) return;
            if (editableLine()) { flash("Winkel bleibt erhalten · Endpunkte ziehen oder 15°-Raster nutzen"); return; }
            if (sel.current.size === 0) {
              const p = toDoc(e.clientX, e.clientY), rx = PAGE_W * 0.45, ry = PAGE_W * 0.3;
              sel.current = new Set(strokes.current.filter((s) => {
                const bb = bbox(s), top = topsRef.current[s.blockId] ?? 0;
                return bb.x1 >= p.x - rx && bb.x0 <= p.x + rx && top + bb.y1 >= p.y - ry && top + bb.y0 <= p.y + ry;
              }).map((s) => s.id));
              bump();
            }
            if (sel.current.size > 0) {
              const analysis = analyzeSelection(), input = strokes.current.filter((s) => sel.current.has(s.id) && s.tool === "pen").map((s) => {
                const top = topsRef.current[s.blockId] ?? 0;
                return { id: s.id, pts: s.pts.map((p) => ({ x: p.x, y: p.y + top })) };
              });
              const symbols = circuitAssistEnabled ? recognizeSymbols(input) : null;
              const hasSymbols = !!symbols && Object.values(symbols.found).some((n) => n > 0);
              if (analysis?.supportsRc || hasSymbols) perfectSelected(); else openFunctionForSelection();
            } else setSaved("Kein Inhalt in der Nähe erkannt");
          }}>
          <canvas ref={cvRef} className="sticky top-0 left-0 z-10 pointer-events-none block" />
          <div className="xnts-canvas-notice" role="status" aria-live="polite">{notice && <span>{notice}</span>}</div>
          <div className="relative mx-auto" style={{ width: PAGE_W * zoom, height: (total + 400) * zoom }}>
            <div className="absolute top-0 left-0" style={{ width: PAGE_W, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
              {blocks.map((b) => (
                <div key={b.id}>
                  <div className={`absolute left-0 bg-white shadow-md${pdfDeleteMode && b.kind === "pdf" ? " xnts-pdf-deletable" : ""}`} data-note-paper={b.kind} style={{ top: tops[b.id], width: PAGE_W, height: b.height, backgroundColor: b.kind === "blank" && darkMode ? "#111827" : "#fff", ...(b.kind === "blank" ? tplStyle : {}) }}>
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
              {pageMarkers && pageBreaks.map((y) => (
                <div key={"a4-" + y} className="xnts-a4-break" aria-hidden="true" style={{ top: y, "--a4-line": `${Math.max(1, 1.5 / zoom)}px`, "--a4-s": `${1 / Math.min(1, zoom)}` } as React.CSSProperties}>
                  <span>Seite {Math.round(y / A4_H) + 1}</span>
                </div>
              ))}
            </div>
            {textFields.current.map((tf0) => { const tf = liveText(tf0), expression = functionExpressionFromText(tf.text); return (
              <div key={tf.id} className="absolute" style={{ left: tf.x * zoom, top: ((topsRef.current[tf.blockId] ?? 0) + tf.y) * zoom, width: tf.width * zoom, pointerEvents: tool === "text" && !readOnly ? "auto" : "none" }}>
                {tool === "text" && <div title="Verschieben" onPointerDown={(e) => startTextDrag(e, tf)} className="absolute -top-4 -left-1 w-6 h-4 rounded-t bg-blue-500/80 cursor-move" />}
                <textarea id={"tf-" + tf.id} value={tf.text} rows={1} spellCheck={false} readOnly={readOnly || tool !== "text" || sel.current.has(tf.id)} tabIndex={tool === "text" ? 0 : -1} onPointerDown={(e) => e.stopPropagation()}
                  onFocus={(e) => { if (sel.current.has(tf.id)) { e.currentTarget.blur(); return; } if (!creating.current) textBefore.current = snap(); creating.current = false; }}
                  onChange={(e) => { const el = e.target; el.style.height = "auto"; editText(tf.id, { text: el.value, height: el.scrollHeight / zoom }); }}
                  onBlur={finishText}
                  className={`w-full bg-transparent outline-none resize-none overflow-hidden border border-dashed rounded-sm leading-snug block ${readOnly || focus ? "border-transparent" : "border-blue-300/70"}`}
                  style={{ color: displayInk(tf.color, paperAtY((topsRef.current[tf.blockId] ?? 0) + tf.y)), fontSize: tf.fontSize * zoom, height: textH(tf) * zoom }} />
                {(() => { // mehrere Kurven bzw. Ableiten/Integrieren je Kurve → gemeinsamer Graph; ältere Einzelfunktionen behalten ihren bisherigen Graphen
                  const curves = curvesFromText(tf.text, tf.functionCurves), multi = curves.length > 1 || (!!tf.functionCurves && curves.length > 0);
                  if (!multi && !expression) return null;
                  return <div className="absolute left-0" style={{ top: (textH(tf) + 8) * zoom, width: Math.min(460, Math.max(300, PAGE_W - tf.x - 18)) * zoom, pointerEvents: "auto" }}>
                    {multi ? <MultiFunctionPlot curves={curves} onFlags={readOnly ? undefined : (flags) => { const before = snap(); editText(tf.id, { functionCurves: flags }); pushHist(before); schedule(); }} /> : <FunctionPlot expression={expression!} />}
                  </div>; })()}
              </div>
            ); })}
            {pdfDeleteMode && blocks.map((b) => b.kind === "pdf" ? (
              <button key={"del-" + b.id} type="button" className="xnts-pdf-delete" style={{ top: tops[b.id] * zoom + 10, right: 10 }}
                aria-label={`PDF-Seite ${b.pageNum} löschen`} title={`PDF-Seite ${b.pageNum} löschen (Rückgängig mit Strg+Z)`}
                onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); deletePdfPage(b.id); }}>✕ Seite {b.pageNum} löschen</button>
            ) : null)}
          </div>
        </div>
        <MouseScrollbar getEl={getScroller} contentKey={`${zoom}:${total}`} />
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
              <select id="settings-template" disabled={readOnly} value={tpl} onChange={(e) => setTplState(e.target.value as Tpl)} className="notiz-settings-select">
                <option value="blank">Blanko</option><option value="lined">Liniert</option><option value="grid">Kariert</option><option value="dots">Punktraster</option>
              </select><p>Gilt für eingefügte Schreibflächen zwischen PDF-Seiten. Das Raster bleibt an der Seite verankert.</p>
              <label className="notiz-check-row"><input type="checkbox" checked={pageMarkers} onChange={(e) => setPageMarkers(e.target.checked)} /><span><strong>A4-Seitengrenzen anzeigen</strong><small>Ein sanfter Schimmer und eine fein auslaufende Linie markieren alle 1123 px den Beginn der nächsten PDF-Seite. Über PDF-Seiten wird nichts eingezeichnet.</small></span></label>
            </section>
            <section className="notiz-settings-section">
              <h3>Linien &amp; Formen</h3><label htmlFor="settings-line-style">Linienstil</label>
              <select id="settings-line-style" value={lineStyle} onChange={(e) => setLineStyle(e.target.value as LineStyle)} className="notiz-settings-select">
                {LINE_STYLES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <label className="notiz-check-row"><input type="checkbox" checked={smartShapesEnabled} onChange={(e) => setSmartShapesEnabled(e.target.checked)} /><span><strong>Smart Shapes</strong><small>Linien, Rechtecke, Dreiecke und Kreise beim Halten (0,5 s) glätten – Start, Ende und Winkel bleiben erhalten. Nur exakt fluchtende Linien (≤ 2,5°) werden automatisch verlängert; ein Hinweis zeigt das an.</small></span></label>
              <label className="notiz-check-row"><input type="checkbox" checked={autoStraighten} disabled={!smartShapesEnabled} onChange={(e) => setAutoStraighten(e.target.checked)} /><span><strong>Linien automatisch begradigen</strong><small>Gerade gezogene Linien und Leitungen mit Knicken werden beim Absetzen sofort begradigt – ohne Lasso und ohne Halten. Winkel, Start und Ende bleiben erhalten; kurze Striche und Handschrift bleiben unverändert. „Rückgängig“ stellt den Freihandstrich wieder her.</small></span></label>
              <label className="notiz-check-row"><input type="checkbox" checked={circuitAssistEnabled} onChange={(e) => setCircuitAssistEnabled(e.target.checked)} /><span><strong>Schaltbild-Hilfe</strong><small>Mit dem Lasso eine Skizze auswählen und „Schaltbild erkennen &amp; glätten“ wählen. Gerade Leitungen, Knoten und einfache Grundformen werden lokal ausgerichtet; Beschriftungen aus PDF-Bildern werden nicht gelesen.</small></span></label>
              <label className="notiz-check-row"><input type="checkbox" checked={angleSnap} onChange={(e) => setAngleSnap(e.target.checked)} /><span><strong>15°-Raster</strong><small>Nur wenn eingeschaltet (oder mit gedrückter Umschalttaste) rasten Linien, Endpunkte und Drehungen in 15°-Schritten ein.</small></span></label>
              <p>Winkel ändern: Lasso wählen, Linie antippen und einen der violetten Endpunkte ziehen. Für eine Skizze mehrere Striche mit dem Lasso umfahren. Gedruckte PDF-Schaltbilder und handschriftliche Bauteilwerte brauchen noch Bild- und Texterkennung.</p>
              <label htmlFor="pressure-sensitivity">Stiftdruckempfindlichkeit · {pressureSensitivity.toFixed(2).replace(".", ",")}</label>
              <input id="pressure-sensitivity" type="range" min="0.25" max="2" step="0.05" value={pressureSensitivity} onChange={(e) => setPressureSensitivity(Number(e.target.value))} aria-label="Stiftdruckempfindlichkeit" />
              <p>Wirkt auf unterstützte druckempfindliche Stifte. Maus und Finger verwenden eine gleichmäßige Stärke.</p>
            </section>
            <section className="notiz-settings-section">
              <h3>Stift &amp; Handschrift</h3>
              <label htmlFor="ink-smoothing">Strichglättung · {inkSmoothing === 0 ? "aus" : `${Math.round(inkSmoothing * 100)} %`}</label>
              <input id="ink-smoothing" type="range" min="0" max="1" step="0.05" value={inkSmoothing} onChange={(e) => setInkSmoothing(Number(e.target.value))} aria-label="Strichglättung" />
              <p>Beruhigt zittrige Striche schon beim Schreiben und glättet sie beim Absetzen nach. Start, Ende und Ecken bleiben erhalten. Gilt für neue Striche.</p>
              <label htmlFor="pen-barrel">Seitentaste des Stifts</label>
              <select id="pen-barrel" value={barrelAction} onChange={(e) => setBarrelAction(e.target.value as "lasso" | "eraser" | "none")} className="notiz-settings-select">
                <option value="lasso">Lasso-Auswahl (wie OneNote)</option><option value="eraser">Radierer</option><option value="none">Keine Funktion</option>
              </select>
              <p>Die Rückseite des Stifts (Radierer-Ende, z. B. Surface Pen oder Slim Pen 2) radiert immer – unabhängig vom gewählten Werkzeug. Kugelschreiber schreibt gleichmäßig, Füller reagiert auf Druck und Strichrichtung, Bleistift ist körnig und wird mit Druck dunkler. Voraussetzung: Das Gerät meldet Stiftrückseite, Seitentaste und Druck an die App (Windows Ink).</p>
              <label className="notiz-check-row"><input type="checkbox" checked={scribbleEraseEnabled} onChange={(e) => setScribbleEraseEnabled(e.target.checked)} /><span><strong>Kritzelradierer</strong><small>Standardmäßig an: Kritzele mit Stift oder Marker über einen Strich oder ein Textfeld, um es zu löschen. Hier abschalten, wenn du die Geste nicht möchtest.</small></span></label>
            <PenPreview kind={activePen.kind} size={size} color={color} smoothing={inkSmoothing} sensitivity={pressureSensitivity} />
              <details className="xnts-diag-details"><summary>Stift testen (Diagnose)</summary><PenDiagnostic /></details>
            </section>
            <section className="notiz-settings-section">
              <h3>Handballen &amp; Finger</h3>
              <p>Finger zeichnen nicht. Während der Stift aufliegt, werden Touchkontakte ignoriert; nach dem Abheben startet das Scrollen sofort. Große Touchflächen werden als Handballen verworfen.</p>
              <label className="notiz-check-row"><input type="checkbox" checked={oneFingerScroll} onChange={(e) => setOneFingerScroll(e.target.checked)} /><span><strong>Mit einem Finger scrollen</strong><small>Aus: Mit zwei Fingern verschieben und zoomen.</small></span></label>
              <p>Zwei Finger: gleichzeitig verschieben und zoomen. Kleine Abstandsänderungen verschieben nur, damit die Ansicht beim Scrollen nicht ungewollt zoomt.</p>
            </section>
            <section className="notiz-settings-section">
              <h3>Hilfe</h3><button className={btn(false)} onClick={() => { setSettingsOpen(false); openTutorial("overview"); }}>Visuelle Anleitungen ansehen</button>
              <p>Öffne jederzeit kurze Anleitungen zu Bibliothek, Stift, Linien, Gesten{GROUPS_ENABLED ? " und Lerngruppen (Prototyp)" : ""} sowie Datensicherung.</p>
            </section>
            <section className="notiz-settings-section">
              <h3>Werkzeugleiste</h3>
              <label className="notiz-check-row"><input type="checkbox" checked={toolbarCollapsed} onChange={(e) => setToolbarCollapsed(e.target.checked)} /><span><strong>Werkzeugleiste minimieren</strong><small>Die Schnellleiste mit Linienarten, Farben und Stiftstärke bleibt sichtbar.</small></span></label>
            </section>
            <section className="notiz-settings-section">
              <h3>Speicherung &amp; Export</h3><p><span className="xnts-status xnts-status--local">lokal gespeichert</span> Notizen und PDFs werden lokal auf diesem Gerät gespeichert (IndexedDB).</p>
              <div className="flex flex-wrap gap-2"><button className={btn(false)} onClick={onBackup}>Backup speichern</button><button className={btn(false)} onClick={onRestore}>Backup laden</button><button className={btn(false)} onClick={exportPdf}>Als PDF exportieren</button></div>
              <p>Notizen, PDFs und Einstellungen bleiben lokal. Cloud-Backup ist nicht eingerichtet. Für ein anderes Gerät kannst du ein vollständiges Backup exportieren und dort wieder laden.</p>
            </section>
          </div>
        </aside>
      </div>}
      {functionDialog && <div className="notiz-function-backdrop" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) setFunctionDialog(false); }}>
        <form className="notiz-function-dialog" role="dialog" aria-modal="true" aria-labelledby="function-dialog-title" onSubmit={(e) => { e.preventDefault(); addFunctionField(); }} onPointerDown={(e) => e.stopPropagation()}>
          <h2 id="function-dialog-title">Funktion darstellen</h2>
          <span className="notiz-function-dialog__label">Funktionen – pro Kurve ableiten, integrieren oder beides</span>
          <div className="notiz-function-rows">
            {functionRows.map((r, k) => <div key={k} className="notiz-function-row">
              <label htmlFor={`function-expression-${k}`}>{FUNCTION_NAMES[k]}(x) =</label>
              <input id={`function-expression-${k}`} autoFocus={k === 0} value={r.expr} onChange={(e) => setFunctionRows((rs) => rs.map((x, j) => (j === k ? { ...x, expr: e.target.value } : x)))} placeholder="z. B. 2(x - 3)^2 - 4" />
              <button type="button" aria-pressed={r.d} onClick={() => setFunctionRows((rs) => rs.map((x, j) => (j === k ? { ...x, d: !x.d } : x)))} title="Ableitung zeigen">{FUNCTION_NAMES[k]}′ ableiten</button>
              <button type="button" aria-pressed={r.i} onClick={() => setFunctionRows((rs) => rs.map((x, j) => (j === k ? { ...x, i: !x.i } : x)))} title="Stammfunktion zeigen">∫ integrieren</button>
              {functionRows.length > 1 && <button type="button" className="notiz-function-row__remove" aria-label={`Kurve ${FUNCTION_NAMES[k]} entfernen`} onClick={() => setFunctionRows((rs) => rs.filter((_, j) => j !== k))}>✕</button>}
            </div>)}
            {functionRows.length < FUNCTION_NAMES.length && <button type="button" className="notiz-function-rows__add" onClick={() => setFunctionRows((rs) => [...rs, { expr: "", d: false, i: false }])}>＋ Kurve hinzufügen</button>}
          </div>
          <p>{functionAnchor ? "Handschrift wird lokal nicht automatisch gelesen. Tippe die Formel hier kurz ab; der interaktive Graph erscheint direkt darunter." : "Gib den Ausdruck rechts von f(x) = ein."} Unterstützt werden unter anderem x², √x, |x|, sin x, xsin(x), Rechenzeichen und Klammern. Im Graphen kannst du Werte ablesen, zoomen und ein Integral untersuchen.</p>
          <div className="notiz-function-dialog__actions"><button type="button" onClick={() => setFunctionDialog(false)}>Abbrechen</button><button type="submit">Graph einfügen</button></div>
        </form>
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
