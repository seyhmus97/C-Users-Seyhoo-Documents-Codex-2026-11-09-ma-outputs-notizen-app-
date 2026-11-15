// Prüfungen für src/mathExpression.ts – handschriftliche Schreibweisen (x², √x, sin x, |x| …).
import test from "node:test"; import assert from "node:assert/strict";
import { parseMathExpression as P, evaluateMathExpression as E, functionExpressionFromText as F, integrateMathNode as I } from "../src/mathExpression.ts";
const v = (s: string, x: number) => E(P(s), x);
test("Schreibweisen", () => {
  assert.equal(v("x²", 3), 9); assert.equal(v("x³-2x", 2), 4); assert.equal(v("√x", 16), 4); assert.equal(v("√(x+1)", 8), 3);
  assert.ok(Math.abs(v("sin x", Math.PI / 2) - 1) < 1e-9); assert.ok(Math.abs(v("xsin(x)", Math.PI / 2) - Math.PI / 2) < 1e-9);
  assert.equal(v("|x-3|", 1), 2); assert.equal(v("2x+1", 3), 7); assert.ok(Math.abs(v("e^x", 1) - Math.E) < 1e-9);
  assert.equal(v("1/x", 4), 0.25); assert.equal(v("x^-1", 2), 0.5); assert.equal(v("-x²", 3), -9); assert.equal(v("2(x-3)^2-4", 5), 4);
  assert.equal(v("ln x", Math.E), 1); assert.ok(Math.abs(v("3sin(2x)", Math.PI / 4) - 3) < 1e-9);
  assert.equal(F("f(x) = x²"), "x²");
});
test("Fehler", () => { assert.throws(() => P("x +")); assert.throws(() => P("foo(x)")); });
test("numerische Integralgrenzen", () => {
  const x2 = P("x²"), sin = P("sin(x)");
  assert.ok(Math.abs(I(x2, -1, 1) - 2 / 3) < 0.001);
  assert.ok(Math.abs(I(x2, 1, -1) + 2 / 3) < 0.001, "Grenzen vertauschen das Vorzeichen");
  assert.ok(Math.abs(I(sin, 0, Math.PI) - 2) < 0.001);
  assert.equal(I(P("1/x"), -1, 1), NaN);
});
