export type CircuitPoint = { x: number; y: number };
export type CircuitStrokeInput = { id: string; color: string; pts: CircuitPoint[] };
export type CircuitPath = { id: string; color: string; points: CircuitPoint[] };
export type CircuitAnalysis = {
  paths: CircuitPath[];
  bounds: { x: number; y: number; width: number; height: number };
  wires: number;
  rectangles: number;
  circles: number;
  triangles: number;
  capacitorPairs: number;
  junctions: number;
  other: number;
  supportsRc: boolean;
  summary: string;
};

const dist = (a: CircuitPoint, b: CircuitPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const boundsOf = (pts: CircuitPoint[]) => {
  const b = pts.reduce((out, p) => ({ x0: Math.min(out.x0, p.x), x1: Math.max(out.x1, p.x), y0: Math.min(out.y0, p.y), y1: Math.max(out.y1, p.y) }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
  return { x: b.x0, y: b.y0, width: Math.max(1, b.x1 - b.x0), height: Math.max(1, b.y1 - b.y0) };
};
const simplify = (pts: CircuitPoint[], epsilon: number): CircuitPoint[] => {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!, p = pts[a], q = pts[b], dx = q.x - p.x, dy = q.y - p.y, den = dx * dx + dy * dy;
    let far = epsilon, index = -1;
    for (let i = a + 1; i < b; i++) {
      const t = den ? Math.max(0, Math.min(1, ((pts[i].x - p.x) * dx + (pts[i].y - p.y) * dy) / den)) : 0;
      const d = Math.hypot(pts[i].x - p.x - t * dx, pts[i].y - p.y - t * dy);
      if (d > far) { far = d; index = i; }
    }
    if (index >= 0) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return pts.filter((_, i) => keep[i]);
};
const classify = (pts: CircuitPoint[]) => {
  if (pts.length < 2) return "other";
  const b = boundsOf(pts), diagonal = Math.hypot(b.width, b.height), closed = dist(pts[0], pts[pts.length - 1]) < Math.max(10, diagonal * .14);
  if (diagonal < 12) return "other";
  if (closed) {
    const open = pts.slice(0, -1), corners = simplify([...open, open[0]], Math.max(2.5, diagonal * .06));
    const n = dist(corners[0], corners[corners.length - 1]) < diagonal * .1 ? corners.length - 1 : corners.length;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const radii = pts.map((p) => dist(p, { x: cx, y: cy })), avg = radii.reduce((s, r) => s + r, 0) / radii.length;
    const variance = Math.sqrt(radii.reduce((s, r) => s + (r - avg) ** 2, 0) / radii.length) / Math.max(1, avg);
    if (variance < .22 && b.width / b.height > .62 && b.width / b.height < 1.62) return "circle";
    if (n === 3) return "triangle";
    if (n === 4 || n === 5) return "rectangle";
    return "other";
  }
  const length = pts.slice(1).reduce((sum, p, i) => sum + dist(p, pts[i]), 0);
  let deviation = 0; const a = pts[0], z = pts[pts.length - 1], dx = z.x - a.x, dy = z.y - a.y, direct = Math.hypot(dx, dy) || 1;
  for (const p of pts) deviation = Math.max(deviation, Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / direct);
  if (direct / Math.max(1, length) > .88 && deviation < Math.max(6, direct * .1)) return "wire";
  const corners = simplify(pts, Math.max(2.5, diagonal * .04));
  if (corners.length >= 2 && corners.length <= 7) return "wire";
  return "other";
};
const lineEnds = (pts: CircuitPoint[]): [CircuitPoint, CircuitPoint] | null => {
  if (pts.length < 2) return null;
  const direct = dist(pts[0], pts[pts.length - 1]), total = pts.slice(1).reduce((sum, p, i) => sum + dist(p, pts[i]), 0);
  return direct >= 8 && direct / Math.max(1, total) > .86 ? [pts[0], pts[pts.length - 1]] : null;
};
const intersection = (a: CircuitPoint, b: CircuitPoint, c: CircuitPoint, d: CircuitPoint): CircuitPoint | null => {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-6) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (t < .04 || t > .96 || u < .04 || u > .96) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
};

/** Conservative local geometry pass. It describes vector strokes; it does not OCR labels or scan PDF pixels. */
export const analyzeCircuitStrokes = (strokes: CircuitStrokeInput[]): CircuitAnalysis | null => {
  const input = strokes.filter((s) => s.pts.length >= 2);
  if (input.length < 3) return null;
  const flat = input.flatMap((s) => s.pts), bounds = boundsOf(flat), diagonal = Math.hypot(bounds.width, bounds.height);
  if (diagonal < 45) return null;
  let wires = 0, rectangles = 0, circles = 0, triangles = 0, other = 0;
  for (const s of input) {
    const type = classify(s.pts);
    if (type === "wire") wires++;
    else if (type === "rectangle") rectangles++;
    else if (type === "circle") circles++;
    else if (type === "triangle") triangles++;
    else other++;
  }
  const lines = input.flatMap((s) => { const ends = lineEnds(s.pts); return ends ? [{ id: s.id, ends }] : []; });
  let capacitorPairs = 0;
  const paired = new Set<string>();
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i].ends, b = lines[j].ends;
    const av = { x: a[1].x - a[0].x, y: a[1].y - a[0].y }, bv = { x: b[1].x - b[0].x, y: b[1].y - b[0].y };
    const la = Math.hypot(av.x, av.y), lb = Math.hypot(bv.x, bv.y), cos = Math.abs((av.x * bv.x + av.y * bv.y) / Math.max(1, la * lb));
    if (Math.min(la, lb) < 12 || Math.max(la, lb) > 90 || cos < .985 || Math.max(la, lb) / Math.max(1, Math.min(la, lb)) > 1.45) continue;
    const ux = av.x / la, uy = av.y / la, nx = -uy, ny = ux;
    const ma = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }, mb = { x: (b[0].x + b[1].x) / 2, y: (b[0].y + b[1].y) / 2 };
    const separation = Math.abs((mb.x - ma.x) * nx + (mb.y - ma.y) * ny), along = Math.abs((mb.x - ma.x) * ux + (mb.y - ma.y) * uy);
    const overlap = along < Math.min(la, lb) * .28;
    if (separation >= 3 && separation <= Math.min(28, Math.min(la, lb) * .55) && overlap) {
      const key = [lines[i].id, lines[j].id].sort().join(":");
      if (!paired.has(key)) { paired.add(key); capacitorPairs++; }
    }
  }
  const hits: CircuitPoint[] = [];
  const segments = lines.map((l) => l.ends);
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const p = intersection(...segments[i], ...segments[j]);
    if (p && !hits.some((q) => dist(p, q) < 10)) hits.push(p);
  }
  const names = [wires && `${wires} Leitungen`, rectangles && `${rectangles} Rechtecke`, circles && `${circles} Kreise`, triangles && `${triangles} Dreiecke`, capacitorPairs && `${capacitorPairs} mögliche Kondensatoren`, hits.length && `${hits.length} Kreuzungen`].filter(Boolean);
  const paths = input.map((s) => {
    const pts = s.pts.length > 240 ? s.pts.filter((_, i) => i % Math.ceil(s.pts.length / 240) === 0).concat(s.pts[s.pts.length - 1]) : s.pts;
    return { id: s.id, color: s.color, points: pts };
  });
  return { paths, bounds, wires, rectangles, circles, triangles, capacitorPairs, junctions: hits.length, other, supportsRc: wires >= 3 && rectangles >= 1 && circles >= 1 && capacitorPairs >= 1, summary: names.join(" · ") || `${input.length} Striche` };
};
