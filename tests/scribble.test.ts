// Prüfungen für src/scribble.ts – Kritzelradierer: Knäuel und Zickzack löschen, Handschrift bleibt.
import test from "node:test"; import assert from "node:assert/strict";
import { scribbleCovers, scribbleCoversRect, scribbleInfo, shouldAttemptScribbleErase, type P } from "../src/scribble.ts";
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const sample = (f: (t: number) => P, n: number) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
const jitter = (pts: P[], a: number) => pts.map((p) => ({ x: p.x + (rnd() - 0.5) * a, y: p.y + (rnd() - 0.5) * a }));
const knot = jitter(sample((t) => { const a = t * Math.PI * 24; const r = 22 + 10 * Math.sin(t * 23); return { x: 45 + 18 * Math.sin(t * 9) + r * Math.cos(a), y: 40 + 14 * Math.cos(t * 7) + 0.85 * r * Math.sin(a) }; }, 700), 1.2);
const smallKnot = jitter(sample((t) => { const a = t * Math.PI * 14; const r = 9 + 4 * Math.sin(t * 17); return { x: 20 + 5 * Math.sin(t * 5) + r * Math.cos(a), y: 15 + 4 * Math.cos(t * 6) + r * Math.sin(a) }; }, 300), 0.6);
const zigzag = jitter(sample((t) => { const k = t * 14, fr = k - Math.floor(k), tri = Math.floor(k) % 2 ? 1 - fr : fr; return { x: 10 + tri * 80 + t * 25, y: 10 + t * 30 }; }, 400), 0.5);

test("Kritzel werden erkannt", () => {
  assert.ok(scribbleInfo(knot), "runder Knäuel");
  assert.ok(scribbleInfo(smallKnot), "kleiner Knäuel über einem Buchstaben");
  assert.ok(scribbleInfo(zigzag), "Zickzack");
  assert.ok(scribbleInfo(knot.map((p) => ({ x: p.x / 2, y: p.y / 2 })), 0.5), "gezoomt (200 %)");
});

test("Kritzelradierer reagiert mit Stift und Marker, nicht mit Radierer oder Lasso", () => {
  assert.ok(shouldAttemptScribbleErase(true, "pen", "pen"));
  assert.ok(shouldAttemptScribbleErase(true, "highlighter", "highlighter"));
  assert.ok(shouldAttemptScribbleErase(true, "pen", "highlighter"));
  assert.equal(shouldAttemptScribbleErase(false, "pen", "pen"), false);
  assert.equal(shouldAttemptScribbleErase(true, "eraser", "eraser"), false);
  assert.equal(shouldAttemptScribbleErase(true, "lasso", "pen"), false);
});

test("Handschrift und Formen sind keine Kritzel", () => {
  const cases: [string, P[]][] = [
    ["llllll", sample((t) => { const u = t * Math.PI * 12; return { x: 10 + u * 6 - 9 * Math.sin(u), y: 30 - 14 * Math.cos(u) }; }, 500)],
    ["mmmmmmm", sample((t) => { const u = t * 7; return { x: 10 + u * 14, y: 30 - 18 * Math.abs(Math.sin(u * Math.PI)) }; }, 400)],
    ["eeeee", sample((t) => { const u = t * Math.PI * 10; return { x: 10 + u * 4.5 + 7 * Math.cos(u + 1.2), y: 22 + 7 * Math.sin(u + 1.2) }; }, 400)],
    ["Kreis", sample((t) => ({ x: 50 + 30 * Math.cos(t * 6.4), y: 50 + 30 * Math.sin(t * 6.4) }), 200)],
    ["Ziffer 8", sample((t) => { const u = t * Math.PI * 2; return { x: 30 + 12 * Math.sin(2 * u), y: 30 + 26 * Math.sin(u) }; }, 200)],
    ["Spirale", sample((t) => ({ x: 60 + t * 50 * Math.cos(t * 20), y: 60 + t * 50 * Math.sin(t * 20) }), 400)],
    ["weite Schraffur", sample((t) => { const k = t * 10, fr = k - Math.floor(k); return { x: 10 + (Math.floor(k) % 2 ? 1 - fr : fr) * 80, y: 10 + t * 80 }; }, 400)],
  ];
  for (const [name, pts] of cases) assert.equal(scribbleInfo(pts), null, name);
});

test("nur Überdecktes wird gelöscht", () => {
  const info = scribbleInfo(knot)!;
  assert.ok(scribbleCovers(knot, info, sample((t) => ({ x: 15 + t * 50, y: 35 + 6 * Math.sin(t * 20) }), 60), 4), "Wort unter dem Knäuel");
  assert.ok(!scribbleCovers(knot, info, sample((t) => ({ x: -200 + t * 500, y: 40 }), 100), 4), "lange Linie, die nur hindurchläuft");
  assert.ok(!scribbleCovers(knot, info, sample((t) => ({ x: 300 + t * 40, y: 300 }), 20), 4), "weit entfernter Strich");
  assert.ok(scribbleCoversRect(info, { x0: 20, y0: 25, x1: 70, y1: 50 }), "Textfeld unter dem Knäuel");
  assert.ok(!scribbleCoversRect(info, { x0: 200, y0: 25, x1: 400, y1: 50 }), "Textfeld daneben");
});
