// Stiftmodell von XNTS: Strichbreite je Stiftart, Eingabe-Stabilisierung, Nachglättung
// und Erkennung eckiger Leitungszüge. Reine Funktionen ohne DOM – separat testbar.

export type InkPoint = { x: number; y: number; p: number };
export type InkKind = "ballpoint" | "fountain" | "pencil" | "marker";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Druckwert mit der eingestellten Empfindlichkeit um die Mitte (0,5) spreizen oder stauchen. */
export const adjustPressure = (p: number, sensitivity: number) => clamp(0.5 + (p - 0.5) * sensitivity, 0.05, 1);

// Federstellung des Füllers: 45° wie bei einer Rechtshänder-Breitfeder.
// Aufstriche (nach rechts oben) werden fein, Abstriche (nach rechts unten) kräftig.
const NIB_X = Math.SQRT1_2, NIB_Y = -Math.SQRT1_2;

/**
 * Strichbreite eines Segments.
 * – Kugelschreiber: fast gleichmäßig, Druck ändert die Breite nur wenig.
 * – Füller: Breite hängt stark vom Druck UND von der Strichrichtung ab (Federstellung).
 * – Bleistift: dünn und gleichmäßig; der Druck steuert stattdessen die Deckkraft (siehe pencilLook).
 * `shaped` = Formen/geglättete Linien: dort bleibt die Breite richtungsunabhängig.
 */
export const inkWidth = (kind: InkKind | undefined, size: number, pressure: number, dx: number, dy: number, shaped: boolean): number => {
  if (kind === "fountain") {
    const len = Math.hypot(dx, dy);
    const cross = shaped || len === 0 ? 0.74 : Math.abs(dx * NIB_Y - dy * NIB_X) / len; // 0 = entlang der Feder, 1 = quer dazu
    return size * (0.25 + pressure * 1.5) * (0.42 + 0.78 * cross);
  }
  if (kind === "pencil") return size * (0.62 + pressure * 0.3);
  return size * (0.85 + pressure * 0.3);
};

/** Bleistift: eine gleichmäßige Breite und eine Deckkraft aus dem mittleren Druck des Strichs. */
export const pencilLook = (size: number, meanPressure: number) => ({
  width: size * (0.62 + meanPressure * 0.3),
  alpha: clamp(0.42 + meanPressure * 0.55, 0.3, 0.95),
});

/** Ein-/Auslauf des Füllers: 0,5 an den Strichenden, 1 in der Mitte. */
export const fountainTaper = (index: number, count: number, taperStart = true, taperEnd = true): number => {
  if (!taperStart && !taperEnd) return 1;
  const fromStart = taperStart ? index - 1 : Infinity;
  const fromFinish = taperEnd ? count - 1 - index : Infinity;
  const fromEnd = Math.min(fromStart, fromFinish);
  return fromEnd >= 3 ? 1 : 0.5 + (fromEnd / 3) * 0.5;
};

/**
 * Live-Stabilisierung: der neue Punkt folgt dem Stift verzögert (Tiefpass).
 * strength 0 = aus (Punkt = Stiftposition), 1 = sehr ruhig.
 */
export const stabilize = (last: { x: number; y: number }, target: { x: number; y: number }, strength: number) => {
  const k = 1 - clamp(strength, 0, 1) * 0.72;
  return { x: last.x + (target.x - last.x) * k, y: last.y + (target.y - last.y) * k };
};

/**
 * Nachglättung beim Absetzen: gewichtetes Mittel (1-2-1) über die Nachbarpunkte.
 * Start, Ende und echte Ecken bleiben stehen, damit Buchstaben und Winkel nicht verrunden.
 * `scale` = Länge von 1 Bildschirm-Pixel in Dokumenteinheiten (1 / Zoom).
 */
export const smoothInk = (pts: InkPoint[], strength: number, scale = 1): InkPoint[] => {
  const n = pts.length, passes = Math.round(clamp(strength, 0, 1) * 4);
  if (n < 4 || passes === 0) return pts;
  const reach = 6 * scale, corner = new Uint8Array(n);
  const cosLimit = Math.cos((62 * Math.PI) / 180);
  for (let i = 1; i < n - 1; i++) {
    let j = i - 1, k = i + 1;
    while (j > 0 && Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < reach) j--;
    while (k < n - 1 && Math.hypot(pts[k].x - pts[i].x, pts[k].y - pts[i].y) < reach) k++;
    const ax = pts[i].x - pts[j].x, ay = pts[i].y - pts[j].y, bx = pts[k].x - pts[i].x, by = pts[k].y - pts[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la >= reach && lb >= reach && (ax * bx + ay * by) / (la * lb) < cosLimit) corner[i] = 1;
  }
  let cur = pts;
  for (let pass = 0; pass < passes; pass++) {
    const next: InkPoint[] = new Array(n);
    next[0] = cur[0]; next[n - 1] = cur[n - 1];
    for (let i = 1; i < n - 1; i++) {
      next[i] = corner[i]
        ? cur[i]
        : { x: (cur[i - 1].x + 2 * cur[i].x + cur[i + 1].x) / 4, y: (cur[i - 1].y + 2 * cur[i].y + cur[i + 1].y) / 4, p: cur[i].p };
    }
    cur = next;
  }
  return cur;
};

/** Entfernt das Zittern am Strichende, das beim Stillhalten des Stifts entsteht. */
export const trimHoldTail = <T extends { x: number; y: number }>(pts: T[], radius: number): T[] => {
  if (pts.length < 3) return pts;
  const last = pts[pts.length - 1];
  let i = pts.length - 2;
  while (i > 0 && Math.hypot(pts[i].x - last.x, pts[i].y - last.y) <= radius) i--;
  return i === pts.length - 2 ? pts : [...pts.slice(0, i + 1), last];
};

/** Douglas-Peucker: liefert die INDIZES der Stützpunkte, die innerhalb der Toleranz die Form beschreiben. */
const rdpIndices = (pts: { x: number; y: number }[], tolerance: number): number[] => {
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
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(i);
  return out;
};

type FitLine = { x: number; y: number; ux: number; uy: number };
/** Ausgleichsgerade durch den mittleren Teil eines Segments (die verrundeten Ecken zählen nicht mit). */
const fitSegment = (pts: { x: number; y: number }[], from: number, to: number): FitLine => {
  const trim = Math.floor((to - from) * 0.2), a = from + trim, b = to - trim;
  const chord = () => { const dx = pts[to].x - pts[from].x, dy = pts[to].y - pts[from].y, l = Math.hypot(dx, dy) || 1; return { x: pts[from].x, y: pts[from].y, ux: dx / l, uy: dy / l }; };
  if (b - a < 3) return chord();
  let mx = 0, my = 0; const n = b - a + 1;
  for (let i = a; i <= b; i++) { mx += pts[i].x; my += pts[i].y; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = a; i <= b; i++) { const dx = pts[i].x - mx, dy = pts[i].y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy); // Hauptachse der Punktwolke
  return { x: mx, y: my, ux: Math.cos(angle), uy: Math.sin(angle) };
};

/**
 * Erkennt einen offenen, eckigen Linienzug (typisch: Leitung mit ein bis sieben Knicken)
 * und liefert dessen Eckpunkte. Bögen und Handschrift mit flachen Richtungswechseln
 * werden abgelehnt (null), damit Buchstaben nicht versehentlich begradigt werden.
 */
export type PolylineOptions = {
  /** Höchstzahl gerader Teilstücke (Leitung mit n−1 Knicken). */
  maxSegments?: number;
  /** Kürzestes erlaubtes Teilstück in Dokumenteinheiten; kürzere Züge (typisch Handschrift) werden abgelehnt. */
  minSegment?: number;
  /** Nur Züge, deren Teilstücke höchstens so viele Grad von waagerecht/senkrecht abweichen (typische Schaltbild-Leitung). */
  axisDegrees?: number;
};
export const recognizePolyline = <T extends { x: number; y: number }>(pts: T[], options: PolylineOptions = {}): { x: number; y: number }[] | null => {
  if (pts.length < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 28) return null;
  let idx = rdpIndices(pts, Math.max(4, diag * 0.04));
  // kleine Haken am Anfang/Ende (Aufsetzen und Absetzen des Stifts) verwerfen
  const minSeg = Math.max(12, diag * 0.07);
  const segLen = (i: number) => Math.hypot(pts[idx[i + 1]].x - pts[idx[i]].x, pts[idx[i + 1]].y - pts[idx[i]].y);
  while (idx.length > 3 && segLen(0) < minSeg) idx = [idx[0], ...idx.slice(2)];
  while (idx.length > 3 && segLen(idx.length - 2) < minSeg) idx = [...idx.slice(0, -2), idx[idx.length - 1]];
  if (idx.length < 3 || idx.length > 9) return null;
  for (let i = 0; i < idx.length - 1; i++) if (segLen(i) < minSeg) return null;
  for (let i = 1; i < idx.length - 1; i++) {
    const p = pts[idx[i - 1]], c = pts[idx[i]], q = pts[idx[i + 1]];
    const ax = c.x - p.x, ay = c.y - p.y, bx = q.x - c.x, by = q.y - c.y;
    const turn = (Math.acos(clamp((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)), -1, 1)) * 180) / Math.PI;
    if (turn < 48 || turn > 150) return null;
  }
  // Ecken dort setzen, wo sich die Ausgleichsgeraden benachbarter Segmente schneiden – so bleiben
  // verrundet gezeichnete Knicke nicht als schiefe Stücke stehen.
  const lines = idx.slice(0, -1).map((from, i) => fitSegment(pts, from, idx[i + 1]));
  const project = (p: { x: number; y: number }, l: FitLine) => { const t = (p.x - l.x) * l.ux + (p.y - l.y) * l.uy; return { x: l.x + l.ux * t, y: l.y + l.uy * t }; };
  const corners: { x: number; y: number }[] = [project(pts[0], lines[0])];
  for (let i = 1; i < idx.length - 1; i++) {
    const a = lines[i - 1], b = lines[i], den = a.ux * b.uy - a.uy * b.ux, raw = pts[idx[i]];
    let corner = { x: raw.x, y: raw.y };
    if (Math.abs(den) > 0.2) {
      const t = ((b.x - a.x) * b.uy - (b.y - a.y) * b.ux) / den, hit = { x: a.x + a.ux * t, y: a.y + a.uy * t };
      if (Math.hypot(hit.x - raw.x, hit.y - raw.y) <= Math.max(minSeg, 16)) corner = hit;
    }
    corners.push(corner);
  }
  corners.push(project(pts[pts.length - 1], lines[lines.length - 1]));
  // Strengere Bedingungen für automatisches Begradigen: nur wenige, lange, achsenparallele Teilstücke
  const segments = corners.length - 1;
  if (options.maxSegments !== undefined && segments > options.maxSegments) return null;
  for (let i = 0; i < segments; i++) {
    const dx = corners[i + 1].x - corners[i].x, dy = corners[i + 1].y - corners[i].y, len = Math.hypot(dx, dy);
    if (options.minSegment !== undefined && len < options.minSegment) return null;
    if (options.axisDegrees !== undefined) {
      const off = (Math.min(Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2), Math.PI / 2 - (Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2))) * 180) / Math.PI;
      if (off > options.axisDegrees) return null;
    }
  }
  return corners;
};
