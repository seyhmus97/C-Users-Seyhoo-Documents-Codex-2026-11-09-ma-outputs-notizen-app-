import { useMemo, useState } from "react";
import { evaluateMathExpression, parseMathExpression, type MathNode } from "./mathExpression";

/** Eine Kurve der Funktionsliste: Name (f, g, h …), Term und je ein Schalter für Ableitung und Stammfunktion. */
export type CurveFlags = { d: boolean; i: boolean };
export type Curve = { name: string; expression: string } & CurveFlags;

const W = 460, H = 240, PAD = { l: 42, r: 14, t: 14, b: 28 };
export const CURVE_COLORS = ["#5738df", "#dc2626", "#16a34a", "#c9952b", "#0891b2", "#db2777"];
const fmt = (n: number) => Number.isFinite(n) ? Number(n.toPrecision(4)).toString().replace(".", ",") : "—";

/** Liest alle Zeilen der Form „f(x) = …“ (oder g, h, …) aus einem Textfeld. */
export const curvesFromText = (text: string, flags: CurveFlags[] = []): Curve[] => {
  const out: Curve[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([a-zA-Z])\s*\(\s*x\s*\)\s*=\s*(.+)$/);
    if (m) out.push({ name: m[1], expression: m[2].trim(), d: !!flags[out.length]?.d, i: !!flags[out.length]?.i });
  }
  return out;
};

type Series = { key: string; label: string; color: string; dash?: string; values: number[] };

/**
 * Mehrere Kurven in einem Koordinatensystem. Pro Kurve lässt sich die Ableitung f′ (numerisch, zentrale Differenz)
 * und die Stammfunktion F(x) = ∫₀ˣ f(t) dt (numerisch, Trapezregel) einzeln zuschalten.
 */
export default function MultiFunctionPlot({ curves, onFlags }: { curves: Curve[]; onFlags?: (flags: CurveFlags[]) => void }) {
  const [range, setRange] = useState({ min: -10, max: 10 });
  const [hoverX, setHoverX] = useState<number | null>(null);
  const plot = useMemo(() => {
    const N = 420, xs = Array.from({ length: N + 1 }, (_, k) => range.min + ((range.max - range.min) * k) / N);
    const series: Series[] = [], errors: string[] = [];
    curves.forEach((c, idx) => {
      let tree: MathNode;
      try { tree = parseMathExpression(c.expression); } catch (e) { errors.push(`${c.name}(x): ${e instanceof Error ? e.message : "nicht lesbar"}`); return; }
      const color = CURVE_COLORS[idx % CURVE_COLORS.length], f = (x: number) => evaluateMathExpression(tree, x);
      const values = xs.map(f);
      series.push({ key: c.name, label: `${c.name}(x)`, color, values });
      if (c.d) {
        const h = Math.max(1e-5, (range.max - range.min) * 1e-4);
        series.push({ key: c.name + "'", label: `${c.name}′(x)`, color, dash: "7 4", values: xs.map((x) => (f(x + h) - f(x - h)) / (2 * h)) });
      }
      if (c.i) {
        // F(x) = ∫₀ˣ f(t) dt: vom Nullpunkt aus in beide Richtungen aufsummieren
        const F = new Array<number>(xs.length).fill(NaN), steps = 24;
        const seg = (a: number, b: number) => { let s = 0; const dx = (b - a) / steps; for (let k = 0; k < steps; k++) { const y0 = f(a + k * dx), y1 = f(a + (k + 1) * dx); if (!Number.isFinite(y0) || !Number.isFinite(y1)) return NaN; s += ((y0 + y1) / 2) * dx; } return s; };
        let k0 = xs.findIndex((x) => x >= 0); if (k0 < 0) k0 = xs.length - 1;
        let acc = seg(0, xs[k0]); F[k0] = acc;
        for (let k = k0 + 1; k < xs.length; k++) { acc += seg(xs[k - 1], xs[k]); F[k] = acc; }
        acc = F[k0];
        for (let k = k0 - 1; k >= 0; k--) { acc -= seg(xs[k], xs[k + 1]); F[k] = acc; }
        series.push({ key: c.name + "I", label: `${c.name.toUpperCase()}(x) = ∫₀ˣ ${c.name}`, color, dash: "1.5 5", values: F });
      }
    });
    const finite = series.flatMap((s) => s.values).filter((y) => Number.isFinite(y) && Math.abs(y) < 1e7).sort((a, b) => a - b);
    let yMin = -1, yMax = 1;
    if (finite.length > 1) { const q = (p: number) => finite[Math.floor((finite.length - 1) * p)]; yMin = q(0.03); yMax = q(0.97); }
    if (yMax - yMin < 1e-8) { yMin -= 1; yMax += 1; }
    const m = (yMax - yMin) * 0.12; yMin = Math.min(0, yMin - m); yMax = Math.max(0, yMax + m);
    const px = (x: number) => PAD.l + ((x - range.min) / (range.max - range.min)) * (W - PAD.l - PAD.r);
    const py = (y: number) => H - PAD.b - ((y - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
    const paths = series.map((s) => {
      let d = "", on = false;
      s.values.forEach((y, k) => {
        const ok = Number.isFinite(y) && Math.abs(y) < 1e7 && y >= yMin - (yMax - yMin) && y <= yMax + (yMax - yMin);
        if (!ok) { on = false; return; }
        d += `${on ? "L" : "M"}${px(xs[k]).toFixed(2)} ${py(y).toFixed(2)} `; on = true;
      });
      return { ...s, d };
    });
    return { xs, paths, errors, px, py, yMin, yMax };
  }, [curves, range]);

  const setFlag = (idx: number, key: "d" | "i") => onFlags?.(curves.map((c, j) => ({ d: j === idx && key === "d" ? !c.d : c.d, i: j === idx && key === "i" ? !c.i : c.i })));
  const zoom = (k: number) => setRange((r) => { const c = (r.min + r.max) / 2, h = Math.min(1e5, Math.max(1e-3, ((r.max - r.min) * k) / 2)); return { min: c - h, max: c + h }; });
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect(), x = ((e.clientX - rect.left) / rect.width) * W;
    setHoverX(Math.max(range.min, Math.min(range.max, range.min + ((x - PAD.l) / (W - PAD.l - PAD.r)) * (range.max - range.min))));
  };
  const hk = hoverX === null ? -1 : Math.round(((hoverX - range.min) / (range.max - range.min)) * (plot.xs.length - 1));
  return <section className="xnts-function-plot xnts-multi-plot" role="group" aria-label="Interaktiver Graph mehrerer Funktionen" onPointerDown={(e) => e.stopPropagation()}>
    <header>
      <strong>{curves.map((c) => c.name + "(x)").join(", ")}</strong>
      <span className="xnts-function-plot__readout">{hk < 0 ? "Kurve antippen oder darüberfahren" : `x = ${fmt(hoverX!)} · ` + plot.paths.map((s) => `${s.label.split(" =")[0]} = ${fmt(s.values[hk])}`).join(" · ")}</span>
      <div className="xnts-function-plot__controls"><button type="button" onClick={() => zoom(0.65)} aria-label="Graph vergrößern">＋</button><button type="button" onClick={() => zoom(1.55)} aria-label="Graph verkleinern">−</button><button type="button" onClick={() => setRange({ min: -10, max: 10 })} aria-label="Bereich zurücksetzen">⟲</button></div>
    </header>
    <svg viewBox={`0 0 ${W} ${H}`} className="xnts-function-plot__svg xnts-multi-plot__svg" onPointerMove={onMove} onPointerLeave={() => setHoverX(null)} role="img" aria-label="Graph">
      {Array.from({ length: 11 }, (_, k) => range.min + ((range.max - range.min) * k) / 10).map((x, k) => <line key={`gx${k}`} x1={plot.px(x)} x2={plot.px(x)} y1={PAD.t} y2={H - PAD.b} className="xnts-function-plot__grid" />)}
      <line x1={PAD.l} x2={W - PAD.r} y1={plot.py(0)} y2={plot.py(0)} className="xnts-function-plot__axis" />
      {range.min < 0 && range.max > 0 && <line x1={plot.px(0)} x2={plot.px(0)} y1={PAD.t} y2={H - PAD.b} className="xnts-function-plot__axis" />}
      {plot.paths.map((s) => <path key={s.key} d={s.d} fill="none" stroke={s.color} strokeWidth={s.dash ? 2 : 2.6} strokeDasharray={s.dash} strokeLinecap="round" strokeLinejoin="round" />)}
      {hoverX !== null && <line x1={plot.px(hoverX)} x2={plot.px(hoverX)} y1={PAD.t} y2={H - PAD.b} className="xnts-function-plot__cursor" />}
      <text x={PAD.l} y={H - 7}>x: {fmt(range.min)}</text><text x={W - PAD.r} y={H - 7} textAnchor="end">{fmt(range.max)}</text>
    </svg>
    <div className="xnts-multi-plot__legend">
      {curves.map((c, idx) => { const color = CURVE_COLORS[idx % CURVE_COLORS.length]; return <div key={idx} className="xnts-multi-plot__row">
        <span className="xnts-multi-plot__dot" style={{ background: color }} />
        <b>{c.name}(x) = {c.expression}</b>
        {onFlags && <>
          <button type="button" aria-pressed={c.d} onClick={() => setFlag(idx, "d")} title={`Ableitung ${c.name}′(x) zeigen (gestrichelt)`}>{c.name}′ ableiten</button>
          <button type="button" aria-pressed={c.i} onClick={() => setFlag(idx, "i")} title={`Stammfunktion ${c.name.toUpperCase()}(x) = ∫₀ˣ ${c.name}(t) dt zeigen (gepunktet)`}>∫ integrieren</button>
        </>}
      </div>; })}
      {plot.errors.map((e) => <p key={e} className="xnts-function-plot__error">{e}</p>)}
      <small>Durchgezogen: Funktion · gestrichelt: Ableitung · gepunktet: Stammfunktion ab 0 (numerische Näherung)</small>
    </div>
  </section>;
}
