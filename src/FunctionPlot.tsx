import { useId, useMemo, useState } from "react";
import { evaluateMathExpression, parseMathExpression } from "./mathExpression";

type Range = { min: number; max: number };
const W = 460, H = 220, PAD = { l: 42, r: 14, t: 14, b: 28 };
const fmt = (n: number) => Number.isFinite(n) ? Number(n.toPrecision(4)).toString().replace(".", ",") : "—";

export default function FunctionPlot({ expression }: { expression: string }) {
  const [range, setRange] = useState<Range>({ min: -10, max: 10 });
  const [hoverX, setHoverX] = useState<number | null>(null);
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
      const margin = (yMax - yMin) * 0.12; yMin -= margin; yMax += margin;
      if (yMin < 0 && yMax > 0) { const span = Math.max(-yMin, yMax); yMin = -span; yMax = span; }
      const x0 = PAD.l, x1 = W - PAD.r, y0 = PAD.t, y1 = H - PAD.b;
      const px = (x: number) => x0 + (x - range.min) / (range.max - range.min) * (x1 - x0);
      const py = (y: number) => y1 - (y - yMin) / (yMax - yMin) * (y1 - y0);
      let path = "", drawing = false;
      values.forEach((y, i) => {
        const valid = Number.isFinite(y) && Math.abs(y) < 1e7 && y >= yMin - (yMax - yMin) && y <= yMax + (yMax - yMin);
        if (!valid) { drawing = false; return; }
        const x = px(xs[i]), screenY = py(y);
        path += `${drawing ? "L" : "M"}${x.toFixed(2)} ${screenY.toFixed(2)} `; drawing = true;
      });
      const gridX = Array.from({ length: 11 }, (_, i) => range.min + (range.max - range.min) * i / 10);
      const gridY = Array.from({ length: 7 }, (_, i) => yMin + (yMax - yMin) * i / 6);
      return { path, gridX, gridY, yMin, yMax, px, py, evaluate: (x: number) => evaluateMathExpression(tree, x), error: "" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Funktion nicht erkannt.";
      return { path: "", gridX: [], gridY: [], yMin: -1, yMax: 1, px: (x: number) => x, py: (y: number) => y, evaluate: (_x: number) => NaN, error: message };
    }
  }, [expression, range]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect(), x = (e.clientX - rect.left) / rect.width * W;
    const value = range.min + (x - PAD.l) / (W - PAD.l - PAD.r) * (range.max - range.min);
    setHoverX(Math.max(range.min, Math.min(range.max, value)));
  };
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const zoom = (factor: number) => setRange((r) => { const center = (r.min + r.max) / 2, half = (r.max - r.min) * factor / 2; return { min: center - half, max: center + half }; });
  const yAt = hoverX === null ? NaN : plot.evaluate(hoverX);
  const hx = hoverX === null ? null : plot.px(hoverX), hy = Number.isFinite(yAt) ? plot.py(yAt) : null;
  return <section className="xnts-function-plot" role="group" aria-label={`Interaktiver Funktionsgraph f(x) = ${expression}`} onPointerDown={stop}>
    <header><strong>f(x) = {expression}</strong><span className="xnts-function-plot__readout">{hoverX === null ? "Kurve antippen oder darüberfahren" : `x = ${fmt(hoverX)}  ·  f(x) = ${fmt(yAt)}`}</span>
      <div className="xnts-function-plot__controls"><button type="button" onClick={() => zoom(.65)} aria-label="Graph vergrößern">+</button><button type="button" onClick={() => zoom(1.55)} aria-label="Graph verkleinern">−</button><button type="button" onClick={() => { setRange({ min: -10, max: 10 }); setHoverX(null); }} aria-label="Graph zurücksetzen">↺</button></div>
    </header>
    {plot.error ? <p className="xnts-function-plot__error">Funktion noch nicht darstellbar: {plot.error}</p> : <svg viewBox={`0 0 ${W} ${H}`} className="xnts-function-plot__svg" onPointerMove={onMove} onPointerLeave={() => setHoverX(null)} role="img" aria-label="Graph mit verstellbarem Ausschnitt und Funktionswertanzeige">
      <defs><clipPath id={clipId}><rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} /></clipPath></defs>
      {plot.gridX.map((x, i) => <line key={`gx${i}`} x1={plot.px(x)} x2={plot.px(x)} y1={PAD.t} y2={H - PAD.b} className="xnts-function-plot__grid" />)}
      {plot.gridY.map((y, i) => <line key={`gy${i}`} x1={PAD.l} x2={W - PAD.r} y1={plot.py(y)} y2={plot.py(y)} className="xnts-function-plot__grid" />)}
      {plot.yMin < 0 && plot.yMax > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={plot.py(0)} y2={plot.py(0)} className="xnts-function-plot__axis" />}
      {range.min < 0 && range.max > 0 && <line x1={plot.px(0)} x2={plot.px(0)} y1={PAD.t} y2={H - PAD.b} className="xnts-function-plot__axis" />}
      <g clipPath={`url(#${clipId})`}><path d={plot.path} className="xnts-function-plot__curve" />{hx !== null && <><line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} className="xnts-function-plot__cursor" />{hy !== null && <circle cx={hx} cy={hy} r="4" className="xnts-function-plot__point" />}</>}</g>
      <text x={PAD.l} y={H - 7}>x: {fmt(range.min)}</text><text x={W - PAD.r} y={H - 7} textAnchor="end">{fmt(range.max)}</text>
    </svg>}
  </section>;
}
