// Prüfungen für src/circuitSymbols.ts – Dioden, Operationsverstärker, Kondensator, Batterie, Widerstand, Lötpunkte.
import test from "node:test"; import assert from "node:assert/strict";
import { recognizeSymbols, junctionPoints } from "../src/circuitSymbols.ts";
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
const seg = (a: number[], b: number[], n = 12) => Array.from({ length: n + 1 }, (_, i) => ({ x: a[0] + (b[0] - a[0]) * i / n + rnd() * 2.5, y: a[1] + (b[1] - a[1]) * i / n + rnd() * 2.5 }));
const poly = (...v: number[][]) => v.slice(1).flatMap((q, i) => seg(v[i], q).slice(i ? 1 : 0));
const S = (id: string, pts: any) => ({ id, pts });
test("Diode nach rechts mit Strich", () => {
  const r = recognizeSymbols([S("t", poly([100, 60], [100, 120], [150, 90], [100, 60])), S("bar", poly([152, 58], [152, 124])), S("w1", poly([40, 92], [96, 92])), S("w2", poly([156, 91], [220, 91]))]);
  assert.equal(r.found.diode, 1); assert.ok(r.remove.has("t") && r.remove.has("bar"));
  const tri = r.add[0].pts; assert.ok(tri[2].x > tri[0].x, "Spitze zeigt nach rechts");
  assert.equal(r.leads.length, 2);
});
test("Diode nach unten", () => {
  const r = recognizeSymbols([S("t", poly([60, 100], [120, 100], [90, 150], [60, 100])), S("bar", poly([56, 154], [124, 154])), S("w1", poly([90, 40], [90, 96])), S("w2", poly([90, 158], [90, 230]))]);
  assert.equal(r.found.diode, 1); const tri = r.add[0].pts; assert.ok(tri[2].y > tri[0].y);
});
test("Operationsverstärker mit +/−", () => {
  const r = recognizeSymbols([S("t", poly([100, 40], [100, 200], [250, 120], [100, 40])),
    S("in1", poly([30, 80], [98, 80])), S("in2", poly([30, 160], [98, 160])), S("out", poly([252, 120], [330, 120])),
    S("m1", poly([114, 82], [128, 82])), S("p1", poly([114, 160], [130, 160])), S("p2", poly([122, 152], [122, 168]))]);
  assert.equal(r.found.opamp, 1); assert.equal(r.leads.length, 3);
  const tri = r.add.find((a) => a.from === "t")!.pts; assert.ok(tri[2].x > tri[0].x);
  assert.equal(r.add.length, 4, "Dreieck + minus + plus(2)");
});
test("Kondensator und Batterie", () => {
  const c = recognizeSymbols([S("a", poly([275, 95], [325, 95])), S("b", poly([275, 112], [326, 113])), S("w1", poly([300, 0], [300, 92])), S("w2", poly([300, 118], [300, 220]))]);
  assert.equal(c.found.capacitor, 1); assert.equal(c.leads.length, 2);
  const b = recognizeSymbols([S("a", poly([-20, 100], [20, 100])), S("b", poly([-10, 118], [10, 118])), S("w1", poly([0, 30], [0, 98])), S("w2", poly([0, 122], [0, 200]))]);
  assert.equal(b.found.battery, 1);
});
test("Widerstand zentriert Leitungen", () => {
  const r = recognizeSymbols([S("r", poly([180, 80], [220, 80], [220, 140], [180, 140], [180, 80])), S("w1", poly([203, 0], [203, 78])), S("w2", poly([199, 142], [199, 220]))]);
  assert.equal(r.found.resistor, 1); assert.equal(r.leads.length, 2);
});
test("Lötpunkt an T-Verbindung", () => {
  assert.equal(junctionPoints([[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 50, y: 0 }, { x: 50, y: 80 }]]).length, 1);
  assert.equal(junctionPoints([[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 10 }, { x: 100, y: 10 }]]).length, 0);
});
test("Dreieck allein und Schrift bleiben unberührt", () => {
  const r = recognizeSymbols([S("t", poly([10, 10], [60, 10], [35, 50], [10, 10]))]);
  assert.equal(r.remove.size, 0);
});
test("Gleichheitszeichen ist kein Kondensator", () => {
  const r = recognizeSymbols([S("a", poly([30, 94], [52, 95])), S("b", poly([30, 104], [52, 105])), S("x1", poly([0, 80], [16, 104])), S("x2", poly([16, 80], [0, 104]))]);
  assert.equal(r.remove.size, 0);
});
