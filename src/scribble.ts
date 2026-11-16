// Kritzelradierer: erkennt, ob ein Strich „durchgekritzelt“ wurde (Knäuel oder Zickzack),
// und welche vorhandenen Elemente er überdeckt. Reine Geometrie, ohne React – dadurch testbar.
export type P = { x: number; y: number };

/** Kritzel-Löschen funktioniert mit beiden Zeichenwerkzeugen, aber nie mit Auswahl- oder Radierwerkzeugen. */
export function shouldAttemptScribbleErase(enabled: boolean, activeTool: string, strokeTool: string): boolean {
  const drawing = (tool: string) => tool === "pen" || tool === "highlighter";
  return enabled && drawing(activeTool) && drawing(strokeTool);
}

export type ScribbleInfo = { bounds: { x0: number; y0: number; x1: number; y1: number }; overdraw: number; fill: number; zigzag: boolean };

/** Prüft, ob der Strich ein Kritzel ist. `unit` = Länge eines Bildschirmpixels in Dokumentkoordinaten (1/Zoom). */
export function scribbleInfo(pts: P[], unit = 1): ScribbleInfo | null {
  if (pts.length < 12) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, length = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    if (i) length += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
  }
  const w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h);
  if (diag < 12 * unit || length / diag < 3) return null;

  // Übermalung: Pfad auf ein Raster legen. Handschrift besucht fast jede Zelle nur einmal,
  // ein Kritzel fährt dieselben Zellen immer wieder ab.
  const cell = Math.max(3 * unit, Math.min(14 * unit, diag / 9));
  const seen = new Set<number>();
  const key = (x: number, y: number) => Math.floor((x - x0) / cell) * 100003 + Math.floor((y - y0) / cell);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cell / 2)));
    for (let k = 0; k <= n; k++) seen.add(key(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  const overdraw = length / (seen.size * cell);
  const fill = (seen.size * cell * cell) / ((w + cell) * (h + cell));

  // Klassischer Zickzack (wie bisher), aber auf den ungeglätteten Punkten
  let sharp = 0, alternating = 0, prevSign = 0;
  for (let i = 2; i < pts.length; i++) {
    const ax = pts[i - 1].x - pts[i - 2].x, ay = pts[i - 1].y - pts[i - 2].y, bx = pts[i].x - pts[i - 1].x, by = pts[i].y - pts[i - 1].y;
    const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
    if (al < 1.5 * unit || bl < 1.5 * unit) continue;
    if ((ax * bx + ay * by) / (al * bl) < 0.2) {
      sharp++;
      const s = Math.sign(ax * by - ay * bx);
      if (s && prevSign && s !== prevSign) alternating++;
      if (s) prevSign = s;
    }
  }
  const zigzag = length / diag > 3.8 && sharp >= 6 && alternating >= 3 && overdraw >= 1.35;
  const knot = overdraw >= 1.9 && fill >= 0.22 && length / diag >= 4;
  return zigzag || knot ? { bounds: { x0, y0, x1, y1 }, overdraw, fill, zigzag } : null;
}

const segDist = (p: P, a: P, b: P) => {
  const dx = b.x - a.x, dy = b.y - a.y, den = dx * dx + dy * dy;
  const t = den ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/** Wird ein vorhandener Strich vom Kritzel überdeckt? Er muss berührt werden UND größtenteils im Kritzelbereich liegen –
 *  so löscht ein Kritzel über einem Wort nicht gleich eine lange Linie, die den Bereich nur kreuzt. */
export function scribbleCovers(scratch: P[], info: ScribbleInfo, target: P[], radius: number): boolean {
  if (!target.length) return false;
  const { x0, y0, x1, y1 } = info.bounds, m = radius;
  let inside = 0;
  for (const p of target) if (p.x >= x0 - m && p.x <= x1 + m && p.y >= y0 - m && p.y <= y1 + m) inside++;
  if (inside / target.length < 0.5) return false;
  const step = Math.max(1, Math.ceil(scratch.length / 220)), tStep = Math.max(1, Math.ceil(target.length / 120));
  for (let j = 0; j < target.length; j += tStep) {
    const q = target[j];
    for (let i = step; i < scratch.length; i += step) if (segDist(q, scratch[i - step], scratch[i]) <= radius) return true;
  }
  return false;
}

/** Textfeld gilt als überdeckt, wenn der Kritzelbereich mindestens 30 % seiner Fläche abdeckt. */
export function scribbleCoversRect(info: ScribbleInfo, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const b = info.bounds;
  const ix = Math.max(0, Math.min(b.x1, r.x1) - Math.max(b.x0, r.x0)), iy = Math.max(0, Math.min(b.y1, r.y1) - Math.max(b.y0, r.y0));
  const area = Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
  return (ix * iy) / area >= 0.3;
}
