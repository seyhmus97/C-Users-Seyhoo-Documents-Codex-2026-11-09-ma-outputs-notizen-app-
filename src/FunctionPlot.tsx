import { useId, useMemo, useRef, useState } from "react";
import { evaluateMathExpression, integrateMathNode, parseMathExpression, type MathNode } from "./mathExpression";

type Range = { min: number; max: number };
type Limits = { a: number; b: number };
type LimitKey = keyof Limits;
const W = 460, H = 220, PAD = { l: 42, r: 14, t: 14, b: 28 };
const fmt = (n: number) => Number.isFinite(n) ? Number(n.toPrecision(4)).toString().replace(".", ",") : "—";

export default function FunctionPlot({ expression }: { expression: string }) {
  const [range, setRange] = useState<Range>({ min: -10, max: 10 });
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [integralOn, setIntegralOn] = useState(false);
  const [limits, setLimits] = useState<Limits>({ a: -2, b: 2 });
  const [showAntiderivative, setShowAntiderivative] = useState(false);
  const draggingLimit = useRef<LimitKey | null>(null);
  const clipId = `xnts-function-clip-${useId().replace(/:/g, "")}`;
  const plot = useMemo(() => {
    try {
      const tree = parseMathExpression(expression);
      const sampleCount = 420, xs = Array.from({ length: sampleCount + 1 }, (_, i) => range.min + (range.max - range.min) * i / sampleCount);
      const values = xs.map((x) => evaluateMathExpression(tree, x));
      const finite = values.filter((y) => Number.isFinite(y) && Math.abs(y) < 1e7).sort((a, b) => a - b);
      if (finite.length < 2) throw new Error("Im sichtbaren Bereich gibt es keine endlichen Funktionswerte.");
      const quantile = (p: number) => finite[Math.floor((finite.length - 1) * p)];
      let yMin = quantile(0.04), yMax = quantile(0.96);
      if (yMax - yMin < 1e-8) { yMin -= 1; yMax += 1; }
      const margin = (yMax - yMin) * 0.12; yMin = Math.min(0, yMin - margin); yMax = Math.max(0, yMax + margin);
      if (yMin < 0 && yMax > 0) { const span = Math.max(-yMin, yMax); yMin = -span; yMax = span; }
      const x0 = PAD.l, x1 = W - PAD.r, y0 = PAD.t, y1 = H - PAD.b;
      const px = (x: number) => x0 + (x - range.min) / (range.max - range.min) * (x1 - x0);
      const py = (y: number) => y1 - (y - yMin) / (yMax - yMin) * (y1 - y0);
      let path = "", drawing = false;
      values.forEach((y, i) => {
        const valid = Number.isFinite(y) && Math.abs(y) < 1e7 && y >= yMin - (yMax - yMin) && y <= yMax + (yMax - yMin);
        if (!valid) { drawing = false; return; }
        path += `${drawing ? "L" : "M"}${px(xs[i]).toFixed(2)} ${py(y).toFixed(2)} `; drawing = true;
      });
      const gridX = Array.from({ length: 11 }, (_, i) => range.min + (range.max - range.min) * i / 10);
      const gridY = Array.from({ length: 7 }, (_, i) => yMin + (yMax - yMin) * i / 6);
      const absTree: MathNode = { kind: "function", name: "abs", value: tree };
      return {
        path, gridX, gridY, yMin, yMax, px, py,
        evaluate: (x: number) => evaluateMathExpression(tree, x),
        integrate: (a: number, b: number, steps = 240) => integrateMathNode(tree, a, b, steps),
        integrateAbsolute: (a: number, b: number, steps = 240) => integrateMathNode(absTree, a, b, steps),
        error: "",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Funktion nicht erkannt.";
      return { path: "", gridX: [], gridY: [], yMin: -1, yMax: 1, px: (x: number) => x, py: (y: number) => y, evaluate: (_x: number) => NaN, integrate: () => NaN, integrateAbsolute: () => NaN, error: message };
    }
  }, [expression, range]);

  const integral = useMemo(() => ({ signed: plot.integrate(limits.a, limits.b), area: Math.abs(plot.integrateAbsolute(limits.a, limits.b)) }), [plot, limits]);
  const areaPath = useMemo(() => {
    if (!integralOn || plot.error) return "";
    const lo = Math.max(range.min, Math.min(limits.a, limits.b)), hi = Math.min(range.max, Math.max(limits.a, limits.b));
    if (hi <= lo) return "";
    const n = 120, pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const x = lo + (hi - lo) * i / n, y = plot.evaluate(x);
      if (!Number.isFinite(y) || Math.abs(y) > 1e7) return "";
      pts.push({ x, y });
    }
    return `M${plot.px(lo)} ${plot.py(0)} ` + pts.map((p) => `L${plot.px(p.x)} ${plot.py(p.y)}`).join(" ") + ` L${plot.px(hi)} ${plot.py(0)} Z`;
  }, [integralOn, plot, range, limits]);
  const primitive = useMemo(() => {
    if (!showAntiderivative || plot.error) return null;
    const n = 240, pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const x = range.min + (range.max - range.min) * i / n, y = plot.integrate(limits.a, x, 100);
      if (Number.isFinite(y) && Math.abs(y) < 1e8) pts.push({ x, y });
    }
    if (pts.length < 2) return null;
    let min = Math.min(...pts.map((p) => p.y)), max = Math.max(...pts.map((p) => p.y));
    if (max - min < 1e-9) { min -= 1; max += 1; }
    const margin = (max - min) * 0.1; min -= margin; max += margin;
    const y = (v: number) => H - PAD.b - (v - min) / (max - min) * (H - PAD.t - PAD.b);
    let path = "";
    pts.forEach((p, i) => { path += `${i ? "L" : "M"}${plot.px(p.x).toFixed(2)} ${y(p.y).toFixed(2)} `; });
    return { path, zero: y(0), min, max, y };
  }, [showAntiderivative, plot, range, limits.a]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect(), x = (e.clientX - rect.left) / rect.width * W;
    const value = range.min + (x - PAD.l) / (W - PAD.l - PAD.r) * (range.max - range.min);
    const clamped = Math.max(range.min, Math.min(range.max, value));
    if (draggingLimit.current) setLimits((old) => ({ ...old, [draggingLimit.current!]: clamped }));
    setHoverX(clamped);
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const key = (e.target as Element).closest("[data-integral-boundary]")?.getAttribute("data-integral-boundary") as LimitKey | null;
    if (!key) return;
    e.preventDefault(); e.stopPropagation(); draggingLimit.current = key;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    draggingLimit.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const zoom = (factor: number) => setRange((r) => { const center = (r.min + r.max) / 2, half = Math.min(1e5, Math.max(1e-3, (r.max - r.min) * factor / 2)); return { min: center - half, max: center + half }; });
  const yAt = hoverX === null ? NaN : plot.evaluate(hoverX);
  const hx = hoverX === null ? null : plot.px(hoverX), hy = Number.isFinite(yAt) ? plot.py(yAt) : null;
  const aOnScreen = limits.a >= range.min && limits.a <= range.max, bOnScreen = limits.b >= range.min && limits.b <= range.max;
  return <section className="xnts-function-plot" role="group" aria-label={`Interaktiver Funktionsgraph f(x) = ${expression}`} onPointerDown={stop}>
      <header><strong>f(x) = {expression}</strong><span className="xnts-function-plot__readout">{hoverX === null ? "Kurve antippen oder darüberfahren" : `x = ${fmt(hoverX)}  ·  f(x) = ${fmt(yAt)}${showAntiderivative ? `  ·  F(x) ≈ ${fmt(plot.integrate(limits.a, hoverX, 120))}` : ""}`}</span>
      <div className="xnts-function-plot__controls"><button type="button" onClick={() => zoom(.65)} aria-label="Graph vergrößern">＋</button><button type="button" onClick={() => zoom(1.55)} aria-label="Graph verkleinern">−</button><button type="button" onClick={() => { setRange({ min: -10, max: 10 }); setHoverX(null); }} aria-label="Graph zurücksetzen">↺</button><button type="button" className={integralOn ? "is-on" : ""} onClick={() => setIntegralOn((v) => !v)} aria-label="Integralfläche anzeigen oder ausblenden" aria-pressed={integralOn}>∫</button></div>
    </header>
    {plot.error ? <p className="xnts-function-plot__error">Funktion noch nicht darstellbar: {plot.error}</p> : <>
      <svg viewBox={`0 0 ${W} ${H}`} className="xnts-function-plot__svg" onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { if (!draggingLimit.current) setHoverX(null); }} role="img" aria-label="Graph mit verstellbarem Ausschnitt, Funktionswerten und Integral">
        <defs><clipPath id={clipId}><rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} /></clipPath></defs>
        {plot.gridX.map((x, i) => <line key={`gx${i}`} x1={plot.px(x)} x2={plot.px(x)} y1={PAD.t} y2={H - PAD.b} className="xnts-function-plot__grid" />)}
        {plot.gridY.map((y, i) => <line key={`gy${i}`} x1={PAD.l} x2={W - PAD.r} y1={plot.py(y)} y2={plot.py(y)} className="xnts-function-plot__grid" />)}
        <line x1={PAD.l} x2={W - PAD.r} y1={plot.py(0)} y2={plot.py(0)} className="xnts-function-plot__axis" />
        {range.min < 0 && range.max > 0 && <line x1={plot.px(0)} x2={plot.px(0)} y1={PAD.t} y2={H - PAD.b} className="xnts-function-plot__axis" />}
        <g clipPath={`url(#${clipId})`}>
          {areaPath && <path d={areaPath} className="xnts-function-plot__area" />}
          <path d={plot.path} className="xnts-function-plot__curve" />
          {integralOn && aOnScreen && <g data-integral-boundary="a" className="xnts-function-plot__bound" style={{ cursor: "ew-resize", touchAction: "none" }}><line x1={plot.px(limits.a)} x2={plot.px(limits.a)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" strokeWidth="8" opacity="0" /><line x1={plot.px(limits.a)} x2={plot.px(limits.a)} y1={PAD.t} y2={H - PAD.b} pointerEvents="none" className="xnts-function-plot__bound" /><text x={plot.px(limits.a) + 3} y={PAD.t + 11} className="xnts-function-plot__boundlabel" pointerEvents="none">a</text></g>}
          {integralOn && bOnScreen && <g data-integral-boundary="b" className="xnts-function-plot__bound" style={{ cursor: "ew-resize", touchAction: "none" }}><line x1={plot.px(limits.b)} x2={plot.px(limits.b)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" strokeWidth="8" opacity="0" /><line x1={plot.px(limits.b)} x2={plot.px(limits.b)} y1={PAD.t} y2={H - PAD.b} pointerEvents="none" className="xnts-function-plot__bound" /><text x={plot.px(limits.b) + 3} y={PAD.t + 11} className="xnts-function-plot__boundlabel" pointerEvents="none">b</text></g>}
          {hx !== null && <><line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} className="xnts-function-plot__cursor" />{hy !== null && <circle cx={hx} cy={hy} r="4" className="xnts-function-plot__point" />}</>}
        </g>
        <text x={PAD.l} y={H - 7}>x: {fmt(range.min)}</text><text x={W - PAD.r} y={H - 7} textAnchor="end">{fmt(range.max)}</text>
      </svg>
      {integralOn && <div className="xnts-function-plot__integral">
        <label>∫ von <input type="number" step="any" value={limits.a} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setLimits((v) => ({ ...v, a: n })); }} aria-label="Untere Integralgrenze a" /></label>
        <label>bis <input type="number" step="any" value={limits.b} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setLimits((v) => ({ ...v, b: n })); }} aria-label="Obere Integralgrenze b" /></label>
        <label><input type="checkbox" checked={showAntiderivative} onChange={(e) => setShowAntiderivative(e.target.checked)} /> F(x) numerisch zeigen</label>
        <p className="xnts-function-plot__result">∫ f(x) dx ≈ {fmt(integral.signed)} · Fläche ≈ {fmt(integral.area)}</p>
        {showAntiderivative && <small>F(x) = ∫ₐˣ f(t) dt (numerische Näherung, F(a) = 0)</small>}
      </div>}
      {primitive && <svg viewBox={`0 0 ${W} ${H}`} className="xnts-function-plot__svg xnts-function-plot__primitive" role="img" aria-label="Numerische Stammfunktion F(x)">
        {primitive.zero >= PAD.t && primitive.zero <= H - PAD.b && <line x1={PAD.l} x2={W - PAD.r} y1={primitive.zero} y2={primitive.zero} className="xnts-function-plot__axis" />}
        <path d={primitive.path} className="xnts-function-plot__antiderivative" />
        <text x={PAD.l} y={PAD.t + 10}>F(x), numerisch · Skala {fmt(primitive.min)} bis {fmt(primitive.max)}</text>
        <text x={PAD.l} y={H - 7}>x: {fmt(range.min)}</text><text x={W - PAD.r} y={H - 7} textAnchor="end">{fmt(range.max)}</text>
      </svg>}
    </>}
  </section>;
}
