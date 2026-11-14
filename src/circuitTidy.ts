// Schaltbildhilfe: richtet bereits begradigte Leitungen und Grundformen aneinander aus.
// Arbeitet rein geometrisch auf absoluten Koordinaten – es werden keine Bauteile erkannt.

export type TidyPoint = { x: number; y: number };
export type TidyItem = {
  id: string;
  /** line/poly = offene Leitung, rect = geschlossenes Rechteck, circle = Kreis, fixed = bleibt unverändert (nur Ziel). */
  kind: "line" | "poly" | "rect" | "circle" | "fixed";
  pts: TidyPoint[];
};
export type TidyOptions = {
  /** Segmente, die höchstens so viele Grad von waagerecht/senkrecht abweichen, werden ausgerichtet. */
  axisDegrees?: number;
  /** Abstand, in dem parallele Leitungen auf eine gemeinsame Höhe/Spalte gezogen werden. */
  alignDistance?: number;
  /** Abstand, in dem ein Leitungsende an eine querende Leitung oder einen Kreis andockt. */
  attachDistance?: number;
};

const EPS = 0.01;
const isH = (a: TidyPoint, b: TidyPoint) => Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS;
const isV = (a: TidyPoint, b: TidyPoint) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS;

/**
 * Richtet fast waagerechte/senkrechte Segmente exakt aus; schräge Segmente behalten ihren Winkel.
 * Geschlossene Züge (Rechtecke) werden einschließlich des Segments „letzter → erster Punkt“ ausgerichtet
 * und bleiben danach exakt geschlossen.
 */
export const snapSegmentsToAxes = (pts: TidyPoint[], axisDegrees = 10): TidyPoint[] => {
  const closed = pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < EPS;
  const work = (closed ? pts.slice(0, -1) : pts).map((p) => ({ x: p.x, y: p.y }));
  const n = work.length, segments = closed ? n : n - 1;
  const limit = Math.tan((axisDegrees * Math.PI) / 180);
  // kurze Stücke (Anschlussstummel) dürfen etwas schiefer sein: bis 8 px Versatz, höchstens ≈ 19°
  const slack = (len: number) => Math.max(len * limit, Math.min(8, len * 0.35));
  for (let i = 0; i < segments; i++) {
    const a = work[i], b = work[(i + 1) % n], dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    if (dx >= dy && dy <= slack(dx)) { const y = (a.y + b.y) / 2; a.y = y; b.y = y; }
    else if (dy > dx && dx <= slack(dy)) { const x = (a.x + b.x) / 2; a.x = x; b.x = x; }
  }
  return closed ? [...work, { x: work[0].x, y: work[0].y }] : work;
};

type Ref = { value: number; fixed: boolean; apply: (v: number) => void };

const cluster = (refs: Ref[], distance: number) => {
  refs.sort((a, b) => a.value - b.value);
  let i = 0;
  while (i < refs.length) {
    let j = i + 1;
    while (j < refs.length && refs[j].value - refs[i].value <= distance) j++;
    const group = refs.slice(i, j), anchors = group.filter((r) => r.fixed);
    const basis = anchors.length ? anchors : group;
    const target = basis.reduce((sum, r) => sum + r.value, 0) / basis.length;
    for (const r of group) if (!r.fixed) r.apply(target);
    i = j;
  }
};

export const tidyCircuit = (items: TidyItem[], options: TidyOptions = {}): Map<string, TidyPoint[]> => {
  const axisDegrees = options.axisDegrees ?? 10, alignDistance = options.alignDistance ?? 7, attachDistance = options.attachDistance ?? 14;
  const work = items.map((it) => ({
    ...it,
    pts: it.kind === "line" || it.kind === "poly" || it.kind === "rect" ? snapSegmentsToAxes(it.pts, axisDegrees) : it.pts.map((p) => ({ x: p.x, y: p.y })),
  }));

  // 1) Parallele Leitungen und Rechteckkanten auf gemeinsame Höhen (y) und Spalten (x) ziehen
  const ys: Ref[] = [], xs: Ref[] = [];
  for (const it of work) {
    if (it.kind === "circle") continue;
    const fixed = it.kind === "fixed";
    for (let i = 0; i < it.pts.length - 1; i++) {
      const a = it.pts[i], b = it.pts[i + 1];
      if (isH(a, b)) ys.push({ value: a.y, fixed, apply: (v) => { a.y = v; b.y = v; } });
      else if (isV(a, b)) xs.push({ value: a.x, fixed, apply: (v) => { a.x = v; b.x = v; } });
    }
  }
  cluster(ys, alignDistance); cluster(xs, alignDistance);
  for (const it of work) if (it.kind === "rect" && it.pts.length > 2) { // Rechteck wieder schließen
    it.pts[it.pts.length - 1].x = it.pts[0].x; it.pts[it.pts.length - 1].y = it.pts[0].y;
  }

  // 2) Freie Leitungsenden an querende Leitungen, Rechteckkanten oder Kreise andocken
  const circles = work.filter((it) => it.kind === "circle").map((it) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of it.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: (x1 - x0 + (y1 - y0)) / 4 };
  });
  for (const it of work) {
    if (it.kind !== "line" && it.kind !== "poly") continue;
    const n = it.pts.length;
    for (const [end, inner] of [[it.pts[0], it.pts[1]], [it.pts[n - 1], it.pts[n - 2]]] as const) {
      const horizontal = isH(end, inner), vertical = isV(end, inner);
      if (!horizontal && !vertical) continue;
      let best = attachDistance + EPS, target: number | null = null;
      for (const other of work) {
        if (other.kind === "circle") continue;
        for (let i = 0; i < other.pts.length - 1; i++) {
          const a = other.pts[i], b = other.pts[i + 1];
          if (a === end || b === end || a === inner || b === inner) continue;
          if (horizontal && isV(a, b)) { // waagerechtes Ende trifft senkrechte Leitung
            const d = Math.abs(end.x - a.x), lo = Math.min(a.y, b.y) - attachDistance, hi = Math.max(a.y, b.y) + attachDistance;
            if (d < best && end.y >= lo && end.y <= hi && Math.abs(a.x - inner.x) > attachDistance) { best = d; target = a.x; }
          } else if (vertical && isH(a, b)) {
            const d = Math.abs(end.y - a.y), lo = Math.min(a.x, b.x) - attachDistance, hi = Math.max(a.x, b.x) + attachDistance;
            if (d < best && end.x >= lo && end.x <= hi && Math.abs(a.y - inner.y) > attachDistance) { best = d; target = a.y; }
          }
        }
      }
      for (const c of circles) { // Ende auf den Kreisrand setzen (z. B. Spannungsquelle)
        const off = horizontal ? end.y - c.cy : end.x - c.cx;
        if (Math.abs(off) > c.r) continue;
        const half = Math.sqrt(c.r * c.r - off * off), center = horizontal ? c.cx : c.cy, pos = horizontal ? end.x : end.y;
        for (const candidate of [center - half, center + half]) {
          const d = Math.abs(pos - candidate), innerPos = horizontal ? inner.x : inner.y;
          if (d < best && Math.abs(candidate - innerPos) > attachDistance / 2) { best = d; target = candidate; }
        }
      }
      if (target !== null) { if (horizontal) end.x = target; else end.y = target; }
    }
  }

  const result = new Map<string, TidyPoint[]>();
  for (const it of work) if (it.kind !== "fixed") result.set(it.id, it.pts);
  return result;
};

/**
 * Begradigt eine einzelne, von Hand gezogene Leitung zu einer Geraden (Anfang → Ende).
 * Nur Striche, die tatsächlich gerade gemeint sind: kaum länger als die Luftlinie und höchstens
 * wenige Pixel neben der Verbindung. Wellen, Schleifenschrift und Bögen ergeben null – sie sind Handschrift.
 * Fast waagerechte/senkrechte Leitungen (≈ 8°) werden exakt ausgerichtet, schräge behalten ihren Winkel.
 */
export const straightenWire = (pts: TidyPoint[]): [TidyPoint, TidyPoint] | null => {
  if (pts.length < 3) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y, direct = Math.hypot(dx, dy);
  if (direct < 24) return null;
  let length = 0, deviation = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  for (const p of pts) deviation = Math.max(deviation, Math.abs((p.x - first.x) * dy - (p.y - first.y) * dx) / direct);
  if (!length || direct / length < 0.88 || deviation > Math.max(5, direct * 0.07)) return null;
  let a = { x: first.x, y: first.y }, b = { x: last.x, y: last.y };
  const horizontal = Math.abs(dx) >= Math.abs(dy), tolerance = Math.max(6, direct * 0.14);
  if (horizontal && Math.abs(dy) <= tolerance) {
    const y = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    a = { x: first.x, y }; b = { x: last.x, y };
  } else if (!horizontal && Math.abs(dx) <= tolerance) {
    const x = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    a = { x, y: first.y }; b = { x, y: last.y };
  }
  return [a, b];
};
