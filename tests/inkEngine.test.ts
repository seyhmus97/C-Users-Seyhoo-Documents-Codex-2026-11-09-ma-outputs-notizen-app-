// Wiederholbare Prüfungen für src/inkEngine.ts – nur Node-Bordmittel (node:test), keine zusätzlichen Pakete.
// Ausführen: pnpm test
import test from "node:test";
import assert from "node:assert/strict";
import { adjustPressure, fountainTaper, inkWidth, pencilLook, recognizePolyline, smoothInk, stabilize, trimHoldTail, type InkPoint } from "../src/inkEngine.ts";

/** Kleiner, wiederholbarer Zufallsgenerator – gleiche Eingabe bei jedem Lauf. */
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const pt = (x: number, y: number, p = 0.5): InkPoint => ({ x, y, p });
/** Punktreihe entlang eines Linienzugs, alle `step` Einheiten ein Messpunkt, mit Zittern `jitter`. */
const walk = (corners: [number, number][], step = 4, jitter = 0, seed = 1) => {
  const r = rng(seed), out: InkPoint[] = [];
  for (let k = 0; k < corners.length - 1; k++) {
    const [a, b] = [corners[k], corners[k + 1]], n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let i = k ? 1 : 0; i <= n; i++) out.push(pt(a[0] + ((b[0] - a[0]) * i) / n + r() * jitter, a[1] + ((b[1] - a[1]) * i) / n + r() * jitter));
  }
  return out;
};
const angleOf = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
/** Winkelabstand zweier Geraden (ohne Richtung) in Grad, 0–90. */
const lineDiff = (a: number, b: number) => { const d = Math.abs(((a - b) % 180 + 180) % 180); return Math.min(d, 180 - d); };
const roughness = (pts: InkPoint[]) => { let s = 0; for (let i = 1; i < pts.length - 1; i++) s += Math.hypot(pts[i - 1].x - 2 * pts[i].x + pts[i + 1].x, pts[i - 1].y - 2 * pts[i].y + pts[i + 1].y); return s; };

/* ───────── Druck ───────── */
test("adjustPressure: Empfindlichkeit 1 lässt Druck unverändert, Mitte bleibt fix, Ergebnis ist begrenzt", () => {
  for (const p of [0.1, 0.3, 0.5, 0.8, 1]) assert.ok(Math.abs(adjustPressure(p, 1) - p) < 1e-9);
  assert.equal(adjustPressure(0.5, 0.25), 0.5);
  assert.equal(adjustPressure(0.5, 2), 0.5);
  assert.ok(adjustPressure(0.9, 2) > adjustPressure(0.9, 1)); // höhere Empfindlichkeit spreizt
  assert.ok(adjustPressure(0.9, 0.25) < adjustPressure(0.9, 1)); // niedrigere staucht
  assert.equal(adjustPressure(0, 2), 0.05); // Untergrenze
  assert.equal(adjustPressure(1, 2), 1); // Obergrenze
});

/* ───────── Stiftprofile ───────── */
test("Kugelschreiber: fast gleichmäßig über den ganzen Druckbereich und richtungsunabhängig", () => {
  const lo = inkWidth("ballpoint", 2.5, 0.1, 5, 0, false), hi = inkWidth("ballpoint", 2.5, 1, 5, 0, false);
  assert.ok(hi / lo < 1.6, `Verhältnis ${hi / lo}`);
  assert.equal(inkWidth("ballpoint", 2.5, 0.5, 5, 0, false), inkWidth("ballpoint", 2.5, 0.5, 0, 5, false));
  assert.equal(inkWidth(undefined, 2.5, 0.5, 5, 0, false), inkWidth("ballpoint", 2.5, 0.5, 5, 0, false)); // ältere Striche ohne penKind
});

test("Füller: Breite wächst mit dem Druck und hängt von der Strichrichtung ab", () => {
  const lo = inkWidth("fountain", 3.2, 0.1, 1, 1, false), hi = inkWidth("fountain", 3.2, 1, 1, 1, false);
  assert.ok(hi / lo > 3, `Druckspreizung ${hi / lo}`); // deutlich stärker als beim Kugelschreiber
  const along = inkWidth("fountain", 3.2, 0.6, 1, -1, false); // entlang der Feder (Aufstrich) → fein
  const across = inkWidth("fountain", 3.2, 0.6, 1, 1, false); // quer zur Feder (Abstrich) → kräftig
  assert.ok(across > along * 1.8, `quer ${across} vs. längs ${along}`);
  assert.ok(along > 0);
});

test("Füller: geglättete Formen sind richtungsunabhängig (keine Zufallsbreiten in Rechtecken)", () => {
  const a = inkWidth("fountain", 3.2, 0.5, 10, 0, true), b = inkWidth("fountain", 3.2, 0.5, 0, 10, true), c = inkWidth("fountain", 3.2, 0.5, 7, -7, true);
  assert.equal(a, b); assert.equal(b, c);
});

test("Bleistift: dünner als Kugelschreiber, Druck steuert vor allem die Deckkraft", () => {
  assert.ok(inkWidth("pencil", 2.2, 0.5, 5, 0, false) < inkWidth("ballpoint", 2.2, 0.5, 5, 0, false));
  const soft = pencilLook(2.2, 0.1), hard = pencilLook(2.2, 1);
  assert.ok(hard.alpha > soft.alpha + 0.3);
  assert.ok(hard.width / soft.width < 1.5); // Breite ändert sich nur mäßig …
  assert.ok(hard.alpha / soft.alpha > hard.width / soft.width * 1.3); // … die Deckkraft deutlich stärker
  for (const m of [0, 0.5, 1, 2]) { const { alpha } = pencilLook(2.2, m); assert.ok(alpha >= 0.3 && alpha <= 0.95); }
});

test("Strichbreiten sind für alle Stiftarten endlich und positiv, auch bei Stillstand (dx = dy = 0)", () => {
  for (const kind of ["ballpoint", "fountain", "pencil", "marker"] as const)
    for (const p of [0.05, 0.5, 1]) for (const shaped of [true, false]) {
      const w = inkWidth(kind, 3, p, 0, 0, shaped);
      assert.ok(Number.isFinite(w) && w > 0, `${kind} p=${p}`);
    }
});

/* ───────── Füllerenden ───────── */
test("fountainTaper: nur an den echten Strichenden dünner, in der Mitte volle Breite", () => {
  const n = 20;
  assert.equal(fountainTaper(1, n), 0.5); // Anfang
  assert.equal(fountainTaper(n - 1, n), 0.5); // Ende
  for (let i = 4; i <= n - 5; i++) assert.equal(fountainTaper(i, n), 1);
  for (let i = 1; i < 4; i++) assert.ok(fountainTaper(i, n) < fountainTaper(i + 1, n) + 1e-9); // gleitend, nie wieder dünner
});

test("fountainTaper: Abschnitte an PDF-/Schreibflächen-Grenzen werden dort NICHT dünner", () => {
  const n = 12;
  assert.equal(fountainTaper(1, n, false, true), 1); // Abschnitt beginnt an der Papiergrenze
  assert.equal(fountainTaper(n - 1, n, true, false), 1); // Abschnitt endet an der Papiergrenze
  assert.equal(fountainTaper(n - 1, n, false, true), 0.5); // das echte Ende bleibt dünn
  assert.equal(fountainTaper(1, n, true, false), 0.5); // der echte Anfang bleibt dünn
  for (let i = 1; i < n; i++) assert.equal(fountainTaper(i, n, false, false), 1);
});

/* ───────── Live-Stabilisierung ───────── */
test("stabilize: Stärke 0 folgt dem Stift exakt, höhere Stärke bleibt zurück, immer in Richtung Ziel", () => {
  const last = { x: 0, y: 0 }, target = { x: 10, y: -20 };
  assert.deepEqual(stabilize(last, target, 0), target);
  let prev = 10;
  for (const s of [0.25, 0.5, 0.75, 1]) {
    const f = stabilize(last, target, s);
    assert.ok(f.x < prev && f.x > 0, `Stärke ${s}: ${f.x}`); // je stärker, desto weniger Weg
    assert.ok(Math.abs(f.y / f.x + 2) < 1e-9); // bleibt auf der Linie zum Ziel
    prev = f.x;
  }
  assert.deepEqual(stabilize(last, target, 5), stabilize(last, target, 1)); // Stärke wird begrenzt
});

/* ───────── Nachglättung ───────── */
test("smoothInk: Stärke 0 und sehr kurze Striche bleiben unverändert (gleiche Referenz)", () => {
  const pts = walk([[0, 0], [100, 0]], 4, 2);
  assert.equal(smoothInk(pts, 0), pts);
  const tiny = pts.slice(0, 3);
  assert.equal(smoothInk(tiny, 1), tiny);
});

test("smoothInk: Start und Ende bleiben exakt stehen, Druck bleibt erhalten, Anzahl bleibt gleich", () => {
  const pts = walk([[0, 0], [200, 30]], 3, 3).map((q, i) => ({ ...q, p: 0.2 + (i % 5) / 10 }));
  const out = smoothInk(pts, 1);
  assert.equal(out.length, pts.length);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[pts.length - 1]);
  out.forEach((q, i) => assert.equal(q.p, pts[i].p));
});

test("smoothInk: verringert Zittern deutlich, ohne den Strich zu verschieben", () => {
  const pts = walk([[0, 0], [300, 60]], 3, 3, 4);
  const out = smoothInk(pts, 1);
  assert.ok(roughness(out) < roughness(pts) * 0.5, `${roughness(out)} vs. ${roughness(pts)}`);
  let maxShift = 0; out.forEach((q, i) => (maxShift = Math.max(maxShift, Math.hypot(q.x - pts[i].x, q.y - pts[i].y))));
  assert.ok(maxShift < 6, `Verschiebung ${maxShift}`);
  assert.ok(roughness(smoothInk(pts, 0.25)) > roughness(out)); // schwächere Stufe glättet weniger
});

test("smoothInk: geschützte Ecken bleiben als Ecken erhalten (Buchstaben/Winkel verrunden nicht)", () => {
  const pts = walk([[0, 0], [120, 0], [120, 120]], 3, 0); // exakter rechter Winkel
  const cornerIdx = pts.findIndex((q) => q.x === 120 && q.y === 0);
  assert.ok(cornerIdx > 0);
  const out = smoothInk(pts, 1);
  assert.deepEqual(out[cornerIdx], pts[cornerIdx]);
  // direkt neben der Ecke weiterhin auf den Schenkeln
  assert.ok(Math.abs(out[cornerIdx - 3].y) < 1e-9);
  assert.ok(Math.abs(out[cornerIdx + 3].x - 120) < 1e-9);
});

test("smoothInk: sanfte Kurve ohne Ecke wird wirklich geglättet, Zoom (scale) verschiebt die Eckenschwelle", () => {
  const curve = Array.from({ length: 60 }, (_, i) => pt(i * 3 + ((i * 7) % 3 - 1), Math.sin(i / 6) * 30 + ((i * 5) % 3 - 1)));
  assert.ok(roughness(smoothInk(curve, 1)) < roughness(curve));
  // bei starkem Zoom (kleiner scale) werden Knicke früher als Ecke geschützt → weniger Glättung als bei scale = 1
  assert.ok(roughness(smoothInk(curve, 1, 0.1)) >= roughness(smoothInk(curve, 1, 1)) - 1e-9);
});

/* ───────── Zittern am Strichende ───────── */
test("trimHoldTail: entfernt Zittern beim Stillhalten, behält den letzten echten Punkt", () => {
  const r = rng(9), line = walk([[0, 0], [100, 0]], 5, 0);
  const tail = Array.from({ length: 12 }, () => pt(100 + r() * 3, r() * 3));
  const out = trimHoldTail([...line, ...tail], 4);
  assert.ok(out.length < line.length + tail.length - 8);
  const all = [...line, ...tail];
  assert.deepEqual(out[out.length - 1], all[all.length - 1]);
  assert.ok(out.length >= line.length - 2);
});

test("trimHoldTail: ein Strich ohne Stillstand und sehr kurze Striche bleiben unverändert", () => {
  const line = walk([[0, 0], [100, 0]], 5, 0);
  assert.equal(trimHoldTail(line, 4), line);
  const two = [pt(0, 0), pt(1, 1)];
  assert.equal(trimHoldTail(two, 4), two);
});

/* ───────── Leitungs- und Kurvenerkennung ───────── */
test("recognizePolyline: L-förmige Leitung → 3 Eckpunkte an den richtigen Stellen", () => {
  const c = recognizePolyline(walk([[0, 0], [200, 0], [200, 150]], 4, 2.5, 3));
  assert.ok(c && c.length === 3, JSON.stringify(c));
  assert.ok(Math.hypot(c[1].x - 200, c[1].y) < 8, `Ecke ${JSON.stringify(c[1])}`);
  assert.ok(Math.hypot(c[0].x, c[0].y) < 8);
  assert.ok(Math.hypot(c[2].x - 200, c[2].y - 150) < 8);
});

test("recognizePolyline: Z-/Treppen-Leitung mit mehreren Knicken → alle Ecken gefunden", () => {
  const c = recognizePolyline(walk([[0, 0], [150, 0], [150, 100], [300, 100]], 4, 2, 5));
  assert.ok(c && c.length === 4, JSON.stringify(c));
  assert.ok(Math.abs(c[1].x - 150) < 8 && Math.abs(c[2].y - 100) < 8);
});

test("recognizePolyline: Verrundete Ecken (Handschrift) landen im Schnittpunkt der Schenkel", () => {
  const pts: InkPoint[] = [];
  for (let x = 0; x <= 180; x += 4) pts.push(pt(x, 0));
  for (let a = 0; a <= 90; a += 15) pts.push(pt(180 + Math.sin((a * Math.PI) / 180) * 14, 14 - Math.cos((a * Math.PI) / 180) * 14)); // runde Ecke
  for (let y = 18; y <= 140; y += 4) pts.push(pt(194, y));
  const c = recognizePolyline(pts);
  assert.ok(c && c.length === 3);
  assert.ok(Math.hypot(c[1].x - 194, c[1].y) < 6, `Ecke ${JSON.stringify(c[1])}`); // echte Ecke statt Abkürzung durch die Rundung
});

test("recognizePolyline: diagonale Schenkel behalten ihren Winkel", () => {
  const c = recognizePolyline(walk([[0, 0], [150, 150], [300, 90]], 4, 2, 8)); // 45° und ca. –22°
  assert.ok(c && c.length === 3, JSON.stringify(c));
  assert.ok(lineDiff(angleOf(c[0], c[1]), 45) < 3, `1. Schenkel ${angleOf(c[0], c[1])}`);
  assert.ok(lineDiff(angleOf(c[1], c[2]), angleOf({ x: 150, y: 150 }, { x: 300, y: 90 })) < 3);
});

test("recognizePolyline: kleine Haken beim Auf-/Absetzen werden verworfen", () => {
  const pts = [pt(0, 8), pt(3, 3), ...walk([[6, 0], [200, 0], [200, 160]], 4, 1, 2), pt(203, 164), pt(199, 163)];
  const c = recognizePolyline(pts);
  assert.ok(c && c.length === 3, JSON.stringify(c));
});

test("recognizePolyline: gerade Linie, Bogen, Sinuswelle, Spirale, Kreis, Schrift → keine Leitung (null)", () => {
  assert.equal(recognizePolyline(walk([[0, 0], [300, 20]], 4, 1.5)), null); // gerade → Sache der Linienerkennung
  const arc = Array.from({ length: 50 }, (_, i) => pt(100 + Math.cos(i / 49 * 3) * 100, Math.sin(i / 49 * 3) * 100));
  assert.equal(recognizePolyline(arc), null);
  const wave = Array.from({ length: 140 }, (_, i) => pt(i * 3, Math.sin(i / 9) * 18));
  assert.equal(recognizePolyline(wave), null);
  const spiral = Array.from({ length: 120 }, (_, i) => pt(Math.cos(i / 8) * (10 + i), Math.sin(i / 8) * (10 + i)));
  assert.equal(recognizePolyline(spiral), null);
  const circle = Array.from({ length: 60 }, (_, i) => pt(Math.cos(i / 59 * 6.28) * 50, Math.sin(i / 59 * 6.28) * 50));
  assert.equal(recognizePolyline(circle), null);
  // „e“, „S“ und kleine Buchstaben (klein genug oder rund genug)
  const smallLetter = Array.from({ length: 30 }, (_, i) => pt(Math.cos(i / 4) * 8 + i * 0.5, Math.sin(i / 4) * 8));
  assert.equal(recognizePolyline(smallLetter), null);
});

test("recognizePolyline: Zickzack mit sehr spitzen Knicken (Schrift-Kritzel) und Kehrtwendungen → null", () => {
  const zig = walk([[0, 0], [100, 10], [0, 20], [100, 30], [0, 40]], 4, 0);
  assert.equal(recognizePolyline(zig), null); // Wendewinkel > 150°
});

test("recognizePolyline: zu wenige Punkte oder zu kleiner Strich → null", () => {
  assert.equal(recognizePolyline([pt(0, 0), pt(10, 0), pt(10, 10)]), null);
  assert.equal(recognizePolyline(walk([[0, 0], [12, 0], [12, 10]], 2)), null);
});

/* ───────── Strenge Bedingungen für das automatische Begradigen ───────── */
test("recognizePolyline mit Optionen: Schaltbild-Leitung (wenige lange, achsenparallele Stücke) wird erkannt", () => {
  const opt = { maxSegments: 4, minSegment: 40, axisDegrees: 14 };
  assert.ok(recognizePolyline(walk([[0, 0], [200, 6], [204, 150]], 4, 2, 21), opt));
  assert.ok(recognizePolyline(walk([[0, 0], [150, 0], [150, 100], [300, 100]], 4, 2, 5), opt));
});

test("recognizePolyline mit Optionen: kleiner Zickzack (mm/ww), große Z/N und schräge Züge werden NICHT erkannt", () => {
  const opt = { maxSegments: 4, minSegment: 40, axisDegrees: 14 };
  const mmmm = walk([[0, 20], [12, 0], [24, 20], [36, 0], [48, 20], [60, 0], [72, 20], [84, 0], [96, 20]], 2, 0.6, 7);
  assert.equal(recognizePolyline(mmmm, opt), null); // viele kurze Stücke
  assert.equal(recognizePolyline(walk([[0, 0], [120, 0], [0, 120], [120, 120]], 4, 1.5, 3), opt), null); // großes Z (Diagonale)
  assert.equal(recognizePolyline(walk([[0, 120], [0, 0], [120, 120], [120, 0]], 4, 1.5, 3), opt), null); // großes N
  assert.equal(recognizePolyline(walk([[0, 0], [150, 150], [300, 90]], 4, 2, 8), opt), null); // schräge Leitung
});
