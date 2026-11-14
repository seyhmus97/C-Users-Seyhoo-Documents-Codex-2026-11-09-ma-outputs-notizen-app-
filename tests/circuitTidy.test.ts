// Wiederholbare Prüfungen für src/circuitTidy.ts – nur Node-Bordmittel (node:test).
// Ausführen: pnpm test
import test from "node:test";
import assert from "node:assert/strict";
import { snapSegmentsToAxes, tidyCircuit, type TidyItem, type TidyPoint } from "../src/circuitTidy.ts";

const P = (x: number, y: number): TidyPoint => ({ x, y });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const angle = (a: TidyPoint, b: TidyPoint) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
const circle = (cx: number, cy: number, r: number): TidyPoint[] => Array.from({ length: 65 }, (_, i) => P(cx + r * Math.cos((i / 64) * 2 * Math.PI), cy + r * Math.sin((i / 64) * 2 * Math.PI)));

/* ───────── Achsenausrichtung ───────── */
test("snapSegmentsToAxes: fast waagerechte und senkrechte Segmente werden exakt ausgerichtet", () => {
  const out = snapSegmentsToAxes([P(0, 0), P(100, 4), P(103, 90)], 10);
  assert.ok(near(out[0].y, out[1].y), "waagerecht");
  assert.ok(near(out[1].x, out[2].x), "senkrecht");
  assert.equal(out[0].x, 0); assert.equal(out[2].y, 90); // Längsrichtung bleibt
});

test("snapSegmentsToAxes: diagonale Linien behalten ihren Winkel (30°, 45°, 60°)", () => {
  for (const deg of [20, 30, 45, 60, 75]) {
    const r = (deg * Math.PI) / 180, a = P(10, 10), b = P(10 + Math.cos(r) * 120, 10 + Math.sin(r) * 120);
    const out = snapSegmentsToAxes([a, b], 10);
    assert.deepEqual(out, [a, b], `${deg}° wurde verändert`);
  }
});

test("snapSegmentsToAxes: Eingabe wird nicht verändert (reine Funktion)", () => {
  const input = [P(0, 0), P(100, 4)], copy = JSON.parse(JSON.stringify(input));
  snapSegmentsToAxes(input, 10);
  assert.deepEqual(input, copy);
});

test("snapSegmentsToAxes: Toleranzwinkel wirkt, kurze Stummel dürfen etwas schiefer sein", () => {
  const long = snapSegmentsToAxes([P(0, 0), P(100, 15)], 10); // ≈ 8,5° → ausgerichtet
  assert.ok(near(long[0].y, long[1].y));
  assert.deepEqual(snapSegmentsToAxes([P(0, 0), P(100, 30)], 10), [P(0, 0), P(100, 30)]); // ≈ 17° → bleibt
  const stub = snapSegmentsToAxes([P(0, 0), P(20, 6)], 10); // kurzer Anschluss: 6 px Versatz erlaubt
  assert.ok(near(stub[0].y, stub[1].y));
});

test("snapSegmentsToAxes: geschlossenes Rechteck bleibt geschlossen", () => {
  const out = snapSegmentsToAxes([P(0, 0), P(100, 3), P(98, 60), P(2, 62), P(0, 0)], 10);
  assert.deepEqual(out[0], out[out.length - 1]);
  assert.ok(near(out[0].y, out[1].y) && near(out[1].x, out[2].x) && near(out[2].y, out[3].y) && near(out[3].x, out[4].x));
});

/* ───────── Fluchten ───────── */
test("tidyCircuit: benachbarte waagerechte Leitungen werden auf eine gemeinsame Höhe gezogen, ferne nicht", () => {
  const items: TidyItem[] = [
    { id: "a", kind: "line", pts: [P(0, 100), P(200, 100)] },
    { id: "b", kind: "line", pts: [P(250, 104), P(450, 104)] },
    { id: "far", kind: "line", pts: [P(0, 300), P(200, 300)] },
  ];
  const r = tidyCircuit(items, { alignDistance: 9 });
  assert.ok(near(r.get("a")![0].y, r.get("b")![0].y), "a und b fluchten");
  assert.equal(r.get("far")![0].y, 300);
});

test("tidyCircuit: gleiches gilt für senkrechte Leitungen (Spalten)", () => {
  const r = tidyCircuit([
    { id: "a", kind: "line", pts: [P(100, 0), P(100, 200)] },
    { id: "b", kind: "line", pts: [P(95, 250), P(95, 400)] },
  ], { alignDistance: 9 });
  assert.ok(near(r.get("a")![0].x, r.get("b")![0].x));
});

test("tidyCircuit: feste Linien (bewusst eingestellte Winkel/Pfeile) dienen als Anker und bewegen sich nicht", () => {
  const r = tidyCircuit([
    { id: "anchor", kind: "fixed", pts: [P(0, 100), P(200, 100)] },
    { id: "w", kind: "line", pts: [P(250, 105), P(450, 105)] },
  ], { alignDistance: 9 });
  assert.equal(r.has("anchor"), false); // fixed wird nie zurückgegeben
  assert.equal(r.get("w")![0].y, 100); // zieht auf den Anker, nicht umgekehrt
});

test("tidyCircuit: diagonale Linien bleiben exakt unverändert", () => {
  const diag = [P(0, 0), P(150, 100)];
  const r = tidyCircuit([{ id: "d", kind: "line", pts: diag }, { id: "h", kind: "line", pts: [P(0, 5), P(200, 5)] }]);
  assert.ok(near(angle(r.get("d")![0], r.get("d")![1]), angle(diag[0], diag[1])));
  assert.deepEqual(r.get("d"), diag);
});

/* ───────── Andocken ───────── */
test("tidyCircuit: freies Leitungsende dockt an eine querende senkrechte Leitung an (Kreuzung/Knoten)", () => {
  const r = tidyCircuit([
    { id: "vert", kind: "line", pts: [P(300, 0), P(300, 200)] },
    { id: "h", kind: "line", pts: [P(0, 100), P(292, 100)] }, // endet 8 px vor der senkrechten Leitung
  ], { attachDistance: 14 });
  assert.ok(near(r.get("h")![1].x, 300), `Ende bei ${r.get("h")![1].x}`);
  assert.equal(r.get("h")![0].x, 0); // anderes Ende bleibt
  assert.deepEqual(r.get("vert"), [P(300, 0), P(300, 200)]);
});

test("tidyCircuit: Andocken an eine waagerechte Leitung von oben", () => {
  const r = tidyCircuit([
    { id: "h", kind: "line", pts: [P(0, 200), P(400, 200)] },
    { id: "v", kind: "line", pts: [P(200, 0), P(200, 191)] },
  ], { attachDistance: 14 });
  assert.ok(near(r.get("v")![1].y, 200));
});

test("tidyCircuit: zu weit entfernte Enden docken nicht an", () => {
  const r = tidyCircuit([
    { id: "vert", kind: "line", pts: [P(300, 0), P(300, 200)] },
    { id: "h", kind: "line", pts: [P(0, 100), P(260, 100)] }, // 40 px Abstand
  ], { attachDistance: 14 });
  assert.equal(r.get("h")![1].x, 260);
});

test("tidyCircuit: Leitungsende dockt am Rand eines Kreises (Quelle/Messgerät) an", () => {
  const r = tidyCircuit([
    { id: "src", kind: "circle", pts: circle(200, 100, 30) },
    { id: "w", kind: "line", pts: [P(0, 100), P(162, 100)] }, // Kreis beginnt bei x = 170
  ], { attachDistance: 14 });
  assert.ok(near(r.get("w")![1].x, 170, 0.5), `Ende bei ${r.get("w")![1].x}`);
  assert.equal(r.get("w")![1].y, 100);
});

test("tidyCircuit: senkrechte Leitung dockt von unten an den Kreis an", () => {
  const r = tidyCircuit([
    { id: "src", kind: "circle", pts: circle(200, 100, 30) },
    { id: "w", kind: "line", pts: [P(200, 300), P(200, 140)] }, // Kreis endet bei y = 130
  ], { attachDistance: 14 });
  assert.ok(near(r.get("w")![1].y, 130, 0.5), `Ende bei ${r.get("w")![1].y}`);
});

test("tidyCircuit: Kreis selbst wird nicht verformt; Rechteck bleibt geschlossen und achsenparallel", () => {
  const c = circle(200, 100, 30);
  const rect = [P(0, 0), P(100, 3), P(98, 60), P(2, 62), P(0, 0)];
  const r = tidyCircuit([{ id: "c", kind: "circle", pts: c }, { id: "r", kind: "rect", pts: rect }]);
  assert.deepEqual(r.get("c"), c);
  const out = r.get("r")!;
  assert.deepEqual(out[0], out[4]);
  assert.ok(near(out[0].y, out[1].y) && near(out[1].x, out[2].x));
});

test("tidyCircuit: Leitung mit Knick (poly) wird ausgerichtet und an die Nachbarleitung angedockt", () => {
  const r = tidyCircuit([
    { id: "bus", kind: "line", pts: [P(0, 200), P(400, 200)] },
    { id: "wire", kind: "poly", pts: [P(50, 0), P(52, 100), P(120, 98), P(121, 194)] },
  ], { attachDistance: 14, axisDegrees: 10 });
  const w = r.get("wire")!;
  assert.ok(near(w[0].x, w[1].x) && near(w[1].y, w[2].y) && near(w[2].x, w[3].x), "Segmente ausgerichtet");
  assert.ok(near(w[3].y, 200), `Ende an der Sammelleitung: ${w[3].y}`);
});

test("tidyCircuit: Eingabeelemente werden nicht verändert, nur neue Punktlisten zurückgegeben", () => {
  const items: TidyItem[] = [{ id: "a", kind: "line", pts: [P(0, 100), P(200, 103)] }];
  const copy = JSON.parse(JSON.stringify(items));
  tidyCircuit(items);
  assert.deepEqual(items, copy);
});

test("tidyCircuit: leere Eingabe und einzelne Linie ohne Nachbarn bleiben stabil", () => {
  assert.equal(tidyCircuit([]).size, 0);
  const r = tidyCircuit([{ id: "x", kind: "line", pts: [P(0, 0), P(100, 0)] }]);
  assert.deepEqual(r.get("x"), [P(0, 0), P(100, 0)]);
});

/* ───────── Einzelne Leitung begradigen (und Handschrift verschonen) ───────── */
import { straightenWire } from "../src/circuitTidy.ts";
const wobble = (a: TidyPoint, b: TidyPoint, n = 40, j = 2) => { let s = 13; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5; return Array.from({ length: n + 1 }, (_, i) => P(a.x + ((b.x - a.x) * i) / n + r() * j, a.y + ((b.y - a.y) * i) / n + r() * j)); };

test("straightenWire: zittrige, fast waagerechte und senkrechte Leitungen werden exakt ausgerichtet", () => {
  const h = straightenWire(wobble(P(0, 100), P(300, 112)))!;
  assert.ok(h && near(h[0].y, h[1].y), "waagerecht");
  const v = straightenWire(wobble(P(100, 0), P(108, 250)))!;
  assert.ok(v && near(v[0].x, v[1].x), "senkrecht");
});

test("straightenWire: schräge Leitungen behalten ihren Winkel (Start und Ende bleiben)", () => {
  for (const [a, b] of [[P(0, 0), P(300, 170)], [P(0, 200), P(250, 40)], [P(20, 20), P(200, 230)]]) {
    const pts = wobble(a, b), out = straightenWire(pts)!;
    assert.ok(out);
    assert.deepEqual(out, [pts[0], pts[pts.length - 1]]);
  }
});

test("straightenWire: Wellen, Schleifenschrift und Bögen sind Handschrift und werden NICHT begradigt", () => {
  const sine = Array.from({ length: 120 }, (_, i) => P(100 + i * 3.2, 60 + Math.sin(i / 7) * 20));
  assert.equal(straightenWire(sine), null);
  const loops = Array.from({ length: 160 }, (_, i) => { const t = i / 8; return P(100 + 15.2 * t - 14 * Math.sin(t), 140 - 14 * Math.cos(t)); });
  assert.equal(straightenWire(loops), null);
  const arc = Array.from({ length: 50 }, (_, i) => P(100 + Math.cos((i / 49) * 3) * 100, Math.sin((i / 49) * 3) * 100));
  assert.equal(straightenWire(arc), null);
  const hump = Array.from({ length: 60 }, (_, i) => P(i * 5, Math.sin((i / 59) * Math.PI) * 25)); // sanfter Bogen, Luftlinie waagerecht
  assert.equal(straightenWire(hump), null);
});

test("straightenWire: zu kurze Striche und Striche mit zu wenigen Punkten bleiben unverändert", () => {
  assert.equal(straightenWire([P(0, 0), P(10, 0), P(20, 1)]), null);
  assert.equal(straightenWire([P(0, 0), P(100, 0)]), null);
});
