// Schaltsymbole aus Handschrift erkennen und sauber neu zeichnen:
// Diode (Dreieck + Strich), Operationsverstärker (großes Dreieck mit Eingängen und +/−), Kondensator, Batterie, Widerstand.
// Rein geometrisch auf absoluten Koordinaten – es gibt keine Texterkennung. Die Ausrichtung (Dreieck nach rechts/links/oben/unten) bleibt erhalten.

export type SP = { x: number; y: number };
export type SymbolInput = { id: string; pts: SP[] };
/** Neuer, sauberer Strich; `from` ist der Strich, dessen Stift (Farbe, Dicke, Seite) übernommen wird. */
export type SymbolStroke = { from: string; pts: SP[]; dot?: boolean };
/** Ein Leitungsende soll auf `to` (Anschlusspunkt des Symbols) gesetzt werden. */
export type LeadSnap = { id: string; end: 0 | 1; to: SP };
export type SymbolResult = {
  remove: Set<string>;
  add: SymbolStroke[];
  leads: LeadSnap[];
  found: { diode: number; opamp: number; capacitor: number; battery: number; resistor: number };
};

const dist = (a: SP, b: SP) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a: SP, b: SP): SP => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: SP, b: SP): SP => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: SP, k: number): SP => ({ x: a.x * k, y: a.y * k });
const dot = (a: SP, b: SP) => a.x * b.x + a.y * b.y;
const unit = (a: SP): SP => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
const mid = (a: SP, b: SP): SP => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lengthOf = (pts: SP[]) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]), 0);
const boxOf = (pts: SP[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, diag: Math.hypot(x1 - x0, y1 - y0), c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } };
};

const rdp = (pts: SP[], eps: number): SP[] => {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!, p = pts[a], q = pts[b], dx = q.x - p.x, dy = q.y - p.y, den = dx * dx + dy * dy;
    let far = eps, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const t = den ? Math.max(0, Math.min(1, ((pts[i].x - p.x) * dx + (pts[i].y - p.y) * dy) / den)) : 0;
      const d = Math.hypot(pts[i].x - p.x - t * dx, pts[i].y - p.y - t * dy);
      if (d > far) { far = d; idx = i; }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
};

/** Ecken einer geschlossenen Handzeichnung. Der Startpunkt darf mitten auf einer Kante liegen. */
const closedCorners = (pts: SP[], diag: number): SP[] => {
  if (pts.length < 4) return [];
  let far = 0, k = 0;
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[0], pts[i]); if (d > far) { far = d; k = i; } }
  const eps = Math.max(3, diag * 0.07);
  const a = rdp(pts.slice(0, k + 1), eps), b = rdp([...pts.slice(k), pts[0]], eps);
  let ring = [...a, ...b.slice(1, -1)];
  // fast gerade Punkte (Startpunkt mitten auf einer Kante) entfernen
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[(i + ring.length - 1) % ring.length], c = ring[i], q = ring[(i + 1) % ring.length];
      const u = unit(sub(p, c)), v = unit(sub(q, c));
      if (dot(u, v) < -Math.cos((22 * Math.PI) / 180)) { ring.splice(i, 1); changed = true; break; } // Winkel > ≈158°
    }
  }
  // sehr nahe Ecken verschmelzen
  ring = ring.filter((p, i) => dist(p, ring[(i + 1) % ring.length]) > diag * 0.12 || ring.length <= 3);
  return ring;
};

const asLine = (pts: SP[]): [SP, SP] | null => {
  if (pts.length < 2) return null;
  const a = pts[0], z = pts[pts.length - 1], direct = dist(a, z), length = lengthOf(pts);
  if (direct < 6 || !length || direct / length < 0.84) return null;
  const dx = z.x - a.x, dy = z.y - a.y;
  let dev = 0; for (const p of pts) dev = Math.max(dev, Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / direct);
  return dev <= Math.max(5, direct * 0.14) ? [a, z] : null;
};

const asTriangle = (pts: SP[]): SP[] | null => {
  const b = boxOf(pts);
  if (b.diag < 18 || dist(pts[0], pts[pts.length - 1]) > Math.max(10, b.diag * 0.22)) return null;
  const ring = closedCorners(pts, b.diag);
  if (ring.length !== 3) return null;
  const area = Math.abs((ring[1].x - ring[0].x) * (ring[2].y - ring[0].y) - (ring[2].x - ring[0].x) * (ring[1].y - ring[0].y)) / 2;
  return area > b.diag * b.diag * 0.04 ? ring : null;
};

const asRect = (pts: SP[]): { c: SP; w: number; h: number } | null => {
  const b = boxOf(pts);
  if (b.diag < 14 || dist(pts[0], pts[pts.length - 1]) > Math.max(10, b.diag * 0.22)) return null;
  const ring = closedCorners(pts, b.diag);
  if (ring.length !== 4) return null;
  const cx = ring.reduce((s, p) => s + p.x, 0) / 4, cy = ring.reduce((s, p) => s + p.y, 0) / 4;
  // jede Ecke muss ungefähr in einer Ecke des umschließenden Rahmens liegen (also kein Raute/Parallelogramm)
  const near = ring.every((p) => Math.min(Math.abs(p.x - b.x0), Math.abs(p.x - b.x1)) < b.w * 0.3 + 6 && Math.min(Math.abs(p.y - b.y0), Math.abs(p.y - b.y1)) < b.h * 0.3 + 6);
  return near ? { c: { x: cx, y: cy }, w: b.w, h: b.h } : null;
};

const snapAxis = (u: SP, degrees = 24): SP => {
  const lim = Math.tan((degrees * Math.PI) / 180);
  if (Math.abs(u.y) <= Math.abs(u.x) * lim) return { x: Math.sign(u.x) || 1, y: 0 };
  if (Math.abs(u.x) <= Math.abs(u.y) * lim) return { x: 0, y: Math.sign(u.y) || 1 };
  return unit(u);
};

type Wire = { id: string; a: SP; z: SP };

/** Leitungsenden in der Nähe eines Anschlusspunkts (innerhalb `reach`). */
const endsNear = (wires: Wire[], p: SP, reach: number, axis?: SP) => {
  const out: { id: string; end: 0 | 1; at: SP; d: number }[] = [];
  for (const w of wires) {
    if (axis && Math.abs(dot(unit(sub(w.z, w.a)), axis)) < 0.8) continue; // nur Leitungen, die in Richtung des Symbols laufen
    const da = dist(w.a, p), dz = dist(w.z, p);
    if (da <= reach && da <= dz) out.push({ id: w.id, end: 0, at: w.a, d: da });
    else if (dz <= reach) out.push({ id: w.id, end: 1, at: w.z, d: dz });
  }
  return out;
};

export const recognizeSymbols = (strokes: SymbolInput[]): SymbolResult => {
  const res: SymbolResult = { remove: new Set(), add: [], leads: [], found: { diode: 0, opamp: 0, capacitor: 0, battery: 0, resistor: 0 } };
  const used = new Set<string>();
  const wires: Wire[] = [], lines = new Map<string, [SP, SP]>(), tris: { id: string; v: SP[] }[] = [], rects: { id: string; c: SP; w: number; h: number }[] = [];
  for (const s of strokes) {
    if (s.pts.length < 2) continue;
    const tri = asTriangle(s.pts);
    if (tri) { tris.push({ id: s.id, v: tri }); continue; }
    const rect = asRect(s.pts);
    if (rect) { rects.push({ id: s.id, ...rect }); continue; }
    const line = asLine(s.pts);
    if (line) { lines.set(s.id, line); if (dist(line[0], line[1]) >= 40) wires.push({ id: s.id, a: line[0], z: line[1] }); } // kurze Striche (Platten, Zeichen, Schrift) sind keine Anschlussleitungen
  }
  const take = (id: string) => { used.add(id); res.remove.add(id); };
  const leadTo = (hits: { id: string; end: 0 | 1 }[], to: SP) => { for (const h of hits) if (!used.has(h.id)) res.leads.push({ id: h.id, end: h.end, to }); };

  /* ── Dreiecke: Diode oder Operationsverstärker ── */
  for (const t of tris) {
    const edges = t.v.map((v, i) => ({ i, a: v, b: t.v[(i + 1) % 3] }));
    const size = Math.max(...edges.map((e) => dist(e.a, e.b)));
    if (size < 18 || size > 400) continue;
    const bbox = boxOf(t.v), pad = size * 0.06;
    const inside = (p: SP) => p.x >= bbox.x0 - pad && p.x <= bbox.x1 + pad && p.y >= bbox.y0 - pad && p.y <= bbox.y1 + pad;
    // kleine Striche im Dreieck = +/−-Zeichen
    const marks = strokes.filter((s) => !used.has(s.id) && s.id !== t.id && s.pts.length >= 2 && boxOf(s.pts).diag < size * 0.34 && inside(boxOf(s.pts).c) && !tris.some((x) => x.id === s.id) && !rects.some((x) => x.id === s.id));
    // Kandidat für die Spitze: Ecke i, gegenüberliegende Kante = Basis
    let best: { apex: SP; base: [SP, SP]; bar: string | null; score: number } | null = null;
    for (let i = 0; i < 3; i++) {
      const apex = t.v[i], base: [SP, SP] = [t.v[(i + 1) % 3], t.v[(i + 2) % 3]], bw = dist(base[0], base[1]), baseDir = unit(sub(base[1], base[0]));
      let bar: string | null = null, barScore = 0;
      for (const [id, [p, q]] of lines) {
        if (used.has(id)) continue;
        const L = dist(p, q);
        if (L < bw * 0.5 || L > bw * 2.2) continue;
        if (Math.abs(dot(unit(sub(q, p)), baseDir)) < 0.9) continue;
        const d = dist(mid(p, q), apex);
        if (d > size * 0.4) continue;
        if (!bar || d < barScore) { bar = id; barScore = d; }
      }
      const score = bar ? 100 - barScore : 0;
      if (!best || score > best.score) best = { apex, base, bar, score };
    }
    if (!best) continue;
    if (best.bar) { // Diode
      const { apex, base } = best, C = mid(base[0], base[1]);
      const u = snapAxis(sub(apex, C)), n = { x: -u.y, y: u.x };
      const bw = Math.max(16, Math.min(90, (dist(base[0], base[1]) + dist(...lines.get(best.bar)!)) / 2)), h = bw * 0.9;
      let center = mid(C, apex);
      const L1 = endsNear(wires, add(center, mul(u, -h / 2 - bw * 0.2)), bw * 0.75, u).filter((e) => e.id !== best!.bar);
      const L2 = endsNear(wires, add(center, mul(u, h / 2 + bw * 0.2)), bw * 0.75, u).filter((e) => e.id !== best!.bar);
      const hint = [...L1, ...L2].map((e) => dot(sub(e.at, center), n));
      if (hint.length) center = add(center, mul(n, hint.reduce((s, v) => s + v, 0) / hint.length));
      const c0 = add(center, mul(u, -h / 2)), a0 = add(center, mul(u, h / 2));
      res.add.push({ from: t.id, pts: [add(c0, mul(n, bw / 2)), add(c0, mul(n, -bw / 2)), a0, add(c0, mul(n, bw / 2))] });
      res.add.push({ from: best.bar, pts: [add(a0, mul(n, bw * 0.58)), add(a0, mul(n, -bw * 0.58))] });
      take(t.id); take(best.bar);
      leadTo(L1, c0); leadTo(L2, a0);
      res.found.diode++;
      continue;
    }
    // Operationsverstärker: großes Dreieck, mindestens ein Zeichen innen oder zwei Eingangsleitungen
    if (size < 56) continue;
    let pick: { apex: SP; base: [SP, SP]; ins: ReturnType<typeof endsNear> } | null = null;
    let pickScore = -1e9;
    for (let i = 0; i < 3; i++) {
      const apex = t.v[i], base: [SP, SP] = [t.v[(i + 1) % 3], t.v[(i + 2) % 3]], C = mid(base[0], base[1]), bw = dist(base[0], base[1]);
      const u = unit(sub(apex, C)), n = { x: -u.y, y: u.x };
      const tilt = Math.min(Math.abs(Math.atan2(u.y, u.x)) % (Math.PI / 2), Math.PI / 2 - (Math.abs(Math.atan2(u.y, u.x)) % (Math.PI / 2))) * 180 / Math.PI;
      if (tilt > 28) continue; // Spitze zeigt nicht in eine Achsenrichtung: kein Operationsverstärker-Kandidat
      const markIds = new Set(marks.map((m) => m.id));
      const ins = wires.filter((w) => !used.has(w.id) && !markIds.has(w.id) && Math.abs(dot(unit(sub(w.z, w.a)), u)) > 0.8).flatMap((w) => [{ id: w.id, end: 0 as const, at: w.a }, { id: w.id, end: 1 as const, at: w.z }])
        .filter((e) => { const along = dot(sub(e.at, C), u), off = dot(sub(e.at, C), n); return along < size * 0.3 && along > -size * 0.45 && Math.abs(off) < bw * 0.75; })
        .map((e) => ({ ...e, d: Math.abs(dot(sub(e.at, C), n)) }));
      const upper = ins.filter((e) => dot(sub(e.at, C), n) < 0), lower = ins.filter((e) => dot(sub(e.at, C), n) > 0);
      if (upper.length > 0 && lower.length > 0) { const score = ins.length * 10 - tilt; if (score > pickScore) { pickScore = score; pick = { apex, base, ins }; } }
    }
    if (!pick && marks.length) { // keine Eingangsleitungen, aber Zeichen im Dreieck: Basis = Kante mit den meisten Zeichen in der Nähe
      let bestEdge = -1, bestCount = 0;
      for (let i = 0; i < 3; i++) {
        const base: [SP, SP] = [t.v[(i + 1) % 3], t.v[(i + 2) % 3]], C = mid(base[0], base[1]), u = unit(sub(t.v[i], C));
        const tiltM = Math.min(Math.abs(Math.atan2(u.y, u.x)) % (Math.PI / 2), Math.PI / 2 - (Math.abs(Math.atan2(u.y, u.x)) % (Math.PI / 2))) * 180 / Math.PI;
        if (tiltM > 28) continue;
        const count = marks.filter((m) => dot(sub(boxOf(m.pts).c, C), u) < size * 0.45).length;
        if (count > bestCount) { bestCount = count; bestEdge = i; }
      }
      if (bestEdge >= 0) pick = { apex: t.v[bestEdge], base: [t.v[(bestEdge + 1) % 3], t.v[(bestEdge + 2) % 3]], ins: [] };
    }
    if (!pick) continue;
    const C = mid(pick.base[0], pick.base[1]);
    const u = snapAxis(sub(pick.apex, C)), n = { x: -u.y, y: u.x };
    let H = dist(pick.base[0], pick.base[1]), center = C;
    const upper = pick.ins.filter((e) => dot(sub(e.at, C), n) < 0).sort((p, q) => p.d - q.d), lower = pick.ins.filter((e) => dot(sub(e.at, C), n) > 0).sort((p, q) => p.d - q.d);
    if (upper.length && lower.length) { // Höhe und Lage aus den Eingangsleitungen: die Eingänge sitzen bei ±¼ der Höhe
      const nu = dot(sub(upper[0].at, C), n), nl = dot(sub(lower[0].at, C), n);
      const h2 = 2 * (nl - nu);
      if (h2 > H * 0.6 && h2 < H * 1.9) { H = h2; center = add(C, mul(n, (nu + nl) / 2)); }
    }
    const W = H * 0.87, apexAt = add(center, mul(u, W));
    const markSet = new Set(marks.map((m) => m.id));
    const out = endsNear(wires.filter((w) => !markSet.has(w.id)), add(center, mul(u, W)), size * 0.35, u).filter((e) => !pick!.ins.some((i) => i.id === e.id && i.end === e.end));
    const p1 = add(center, mul(n, -H / 2)), p2 = add(center, mul(n, H / 2));
    res.add.push({ from: t.id, pts: [p1, p2, apexAt, p1] });
    take(t.id);
    const inUpper = add(center, mul(n, -H / 4)), inLower = add(center, mul(n, H / 4));
    for (const e of upper.slice(0, 1)) leadTo([e], inUpper);
    for (const e of lower.slice(0, 1)) leadTo([e], inLower);
    leadTo(out, apexAt);
    // Vorzeichen: so wie gezeichnet (Strich = −, Kreuz = +), sauber an den Eingängen
    const clusters: { c: SP; items: SymbolInput[] }[] = [];
    for (const m of marks) { const c = boxOf(m.pts).c, cl = clusters.find((k) => dist(k.c, c) < size * 0.13); if (cl) { cl.items.push(m); cl.c = mid(cl.c, c); } else clusters.push({ c, items: [m] }); }
    const sgn = Math.max(3.5, H * 0.07);
    for (const cl of clusters.slice(0, 2)) {
      const side = dot(sub(cl.c, center), n) < 0 ? -1 : 1, at = add(add(center, mul(n, side * H / 4)), mul(u, W * 0.22));
      const plus = cl.items.length >= 2;
      res.add.push({ from: cl.items[0].id, pts: [add(at, mul(u, -sgn)), add(at, mul(u, sgn))] });
      if (plus) res.add.push({ from: cl.items[0].id, pts: [add(at, mul(n, -sgn)), add(at, mul(n, sgn))] });
      for (const m of cl.items) take(m.id);
    }
    res.found.opamp++;
  }

  /* ── Platten: Kondensator (gleich lang) oder Batterie (lang/kurz) ── */
  const plates = [...lines.entries()].filter(([id, [p, q]]) => !used.has(id) && dist(p, q) >= 12 && dist(p, q) <= 90).map(([id, [p, q]]) => ({ id, p, q, L: dist(p, q), m: mid(p, q), u: unit(sub(q, p)) }));
  const doneP = new Set<string>();
  for (let i = 0; i < plates.length; i++) for (let j = i + 1; j < plates.length; j++) {
    const A = plates[i], B = plates[j];
    if (doneP.has(A.id) || doneP.has(B.id)) continue;
    if (Math.abs(dot(A.u, B.u)) < 0.97) continue;
    const ratio = Math.max(A.L, B.L) / Math.min(A.L, B.L);
    if (ratio > 3.2) continue;
    const n = { x: -A.u.y, y: A.u.x }, d = sub(B.m, A.m), sep = Math.abs(dot(d, n)), along = Math.abs(dot(d, A.u));
    if (sep < 3 || sep > Math.min(34, Math.max(A.L, B.L) * 0.6) || along > Math.min(A.L, B.L) * 0.35) continue;
    // keine Platte, wenn eine Leitung durch die Mitte beider läuft (dann sind es Leitungen)
    const axis = snapAxis(n, 24), ax = axis, pl = { x: -ax.y, y: ax.x };
    const battery = ratio > 1.4, long = Math.max(A.L, B.L), short = battery ? long * 0.55 : long;
    const lenFix = battery ? [long, short] : [Math.max(14, (A.L + B.L) / 2), Math.max(14, (A.L + B.L) / 2)];
    const first = dot(sub(A.m, B.m), ax) < 0 ? A : B, second = first === A ? B : A; // first liegt vor second entlang der Achse
    const center = mid(A.m, B.m), gap = Math.max(6, Math.min(sep, lenFix[0] * 0.4));
    const L1 = endsNear(wires, add(center, mul(ax, -gap / 2 - 10)), 26, ax).filter((e) => e.id !== A.id && e.id !== B.id);
    const L2 = endsNear(wires, add(center, mul(ax, gap / 2 + 10)), 26, ax).filter((e) => e.id !== A.id && e.id !== B.id);
    if (!L1.length && !L2.length) continue; // ohne Anschlussleitung ist es nur ein „=“ oder zwei Striche, kein Kondensator
    const hint = [...L1, ...L2].map((e) => dot(sub(e.at, center), pl));
    const c2 = hint.length ? add(center, mul(pl, hint.reduce((s, v) => s + v, 0) / hint.length)) : center;
    const pFirst = add(c2, mul(ax, -gap / 2)), pSecond = add(c2, mul(ax, gap / 2));
    const lf = first.L >= second.L || !battery ? [lenFix[0], lenFix[1]] : [lenFix[1], lenFix[0]];
    res.add.push({ from: first.id, pts: [add(pFirst, mul(pl, -lf[0] / 2)), add(pFirst, mul(pl, lf[0] / 2))] });
    res.add.push({ from: second.id, pts: [add(pSecond, mul(pl, -lf[1] / 2)), add(pSecond, mul(pl, lf[1] / 2))] });
    take(A.id); take(B.id); doneP.add(A.id); doneP.add(B.id);
    leadTo(L1, pFirst); leadTo(L2, pSecond);
    battery ? res.found.battery++ : res.found.capacitor++;
  }

  /* ── Widerstand: Rechteck mit Leitungen an den kurzen Seiten ── */
  for (const r of rects) {
    if (used.has(r.id)) continue;
    const longH = r.w >= r.h, len = Math.max(r.w, r.h), thick = Math.min(r.w, r.h);
    if (len < 18 || len > 160 || len / Math.max(1, thick) < 1.15) continue;
    const ax: SP = longH ? { x: 1, y: 0 } : { x: 0, y: 1 }, pl: SP = { x: -ax.y, y: ax.x };
    const faceA = add(r.c, mul(ax, -len / 2)), faceB = add(r.c, mul(ax, len / 2));
    const A = endsNear(wires, faceA, len * 0.5 + 8, ax).filter((e) => !res.remove.has(e.id)), B = endsNear(wires, faceB, len * 0.5 + 8, ax).filter((e) => !res.remove.has(e.id));
    if (!A.length && !B.length) continue;
    const hint = [...A, ...B].map((e) => dot(sub(e.at, r.c), pl));
    const c2 = add(r.c, mul(pl, hint.reduce((s, v) => s + v, 0) / hint.length));
    const a = add(c2, mul(ax, -len / 2)), b = add(c2, mul(ax, len / 2));
    const hp = thick / 2, p = (s: number, t: number) => add(add(c2, mul(ax, s * len / 2)), mul(pl, t * hp));
    res.add.push({ from: r.id, pts: [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), p(-1, -1)] });
    take(r.id); leadTo(A, a); leadTo(B, b);
    res.found.resistor++;
  }
  return res;
};

/** T-Verbindungen: das Ende einer Leitung liegt mitten auf einer anderen Leitung → Lötpunkt (Parallelschaltung). */
export const junctionPoints = (wires: SP[][]): SP[] => {
  const out: SP[] = [];
  const onSegment = (p: SP, a: SP, b: SP) => {
    const dx = b.x - a.x, dy = b.y - a.y, den = dx * dx + dy * dy;
    if (!den) return false;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / den;
    return t > 0.08 && t < 0.92 && Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 3.5;
  };
  wires.forEach((w, i) => {
    for (const e of [w[0], w[w.length - 1]]) {
      const hit = wires.some((o, j) => j !== i && o.slice(1).some((q, k) => onSegment(e, o[k], q)));
      if (hit && !out.some((q) => dist(q, e) < 10)) out.push({ x: e.x, y: e.y });
    }
  });
  return out;
};
