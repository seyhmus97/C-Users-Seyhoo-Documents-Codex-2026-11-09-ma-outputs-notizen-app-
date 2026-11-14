// Stilisierte, bedienbare Frontplatten der Laborgeräte (SVG).
// Anordnung vereinfacht; Bezeichnungen und Bedienprinzip nach den Handbüchern.
import { useEffect, useId, useRef, type ReactNode } from "react";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Drehregler: ziehen (hoch = mehr), Mausrad, Pfeiltasten oder antippen (rechte Hälfte +, linke −). */
export function Knob({ id, x, y, r = 20, label, value, frac, onStep, hl, disabled, color = "#2b2f36" }: {
  id: string; x: number; y: number; r?: number; label: string; value?: string; frac: number;
  onStep: (ticks: number, fine: boolean) => void; hl?: string | null; disabled?: boolean; color?: string;
}) {
  const ref = useRef<SVGGElement>(null);
  const drag = useRef<{ y: number; moved: boolean; x: number } | null>(null);
  const step = useRef(onStep); step.current = onStep;
  useEffect(() => { // Mausrad nicht-passiv, damit das Panel dabei nicht scrollt
    const el = ref.current; if (!el || disabled) return;
    const w = (e: WheelEvent) => { e.preventDefault(); const d = e.deltaY || e.deltaX; if (d) step.current(d < 0 ? 1 : -1, e.shiftKey); }; // Umschalt+Rad liefert in Chrome deltaX
    el.addEventListener("wheel", w, { passive: false });
    return () => el.removeEventListener("wheel", w);
  }, [disabled]);
  const ang = (-135 + 270 * clamp(frac, 0, 1)) * (Math.PI / 180);
  return <g ref={ref} className="xf-knob" data-id={id} data-hl={hl === id} data-disabled={disabled} tabIndex={disabled ? -1 : 0} role="slider" aria-label={label} aria-valuetext={value}
    onPointerDown={(e) => { if (disabled) return; e.preventDefault(); e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { y: e.clientY, x: e.clientX, moved: false }; }}
    onPointerMove={(e) => { const d = drag.current; if (!d) return; const dy = d.y - e.clientY; const t = Math.trunc(dy / 8); if (t) { d.moved = true; onStep(t, e.shiftKey); d.y -= t * 8; } }}
    onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) { const b = ref.current!.getBoundingClientRect(); onStep(e.clientX >= b.left + b.width / 2 ? 1 : -1, e.shiftKey); } }}
    onKeyDown={(e) => { if (disabled) return; if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); onStep(1, e.shiftKey); } if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); onStep(-1, e.shiftKey); } }}>
    <circle className="xf-hl-ring" cx={x} cy={y} r={r + 7} />
    {Array.from({ length: 11 }, (_, i) => { const a = (-135 + 27 * i) * (Math.PI / 180); return <line key={i} x1={x + Math.sin(a) * (r + 2)} y1={y - Math.cos(a) * (r + 2)} x2={x + Math.sin(a) * (r + 5)} y2={y - Math.cos(a) * (r + 5)} stroke="#55595f" strokeWidth={1} />; })}
    <circle cx={x} cy={y} r={r} fill={color} stroke="#111" strokeWidth={1.5} />
    <circle cx={x} cy={y} r={r * 0.72} fill="#3a3f47" />
    <line x1={x} y1={y} x2={x + Math.sin(ang) * r * 0.85} y2={y - Math.cos(ang) * r * 0.85} stroke="#f8fafc" strokeWidth={3} strokeLinecap="round" />
    <text x={x} y={y + r + 15} className="xf-label" textAnchor="middle">{label}</text>
  </g>;
}

export function Btn({ id, x, y, w = 54, h = 22, label, onClick, active, hl, lamp, tone = "light" }: {
  id: string; x: number; y: number; w?: number; h?: number; label: ReactNode; onClick: () => void; active?: boolean; hl?: string | null; lamp?: boolean; tone?: "light" | "dark" | "accent";
}) {
  return <g className="xf-btn" data-id={id} data-hl={hl === id} data-active={!!active} data-tone={tone} role="button" tabIndex={0} aria-pressed={active}
    onPointerDown={(e) => e.stopPropagation()} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}>
    <rect className="xf-hl-ring" x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx={6} />
    <rect className="xf-btn-face" x={x} y={y} width={w} height={h} rx={3} />
    {lamp && <circle cx={x + w - 7} cy={y + 7} r={3} className="xf-btn-lamp" />}
    <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" className="xf-btn-text">{label}</text>
  </g>;
}

export function Led({ x, y, w, h = 34, text, color = "#ef4444", label, size = 24 }: { x: number; y: number; w: number; h?: number; text: string; color?: string; label?: string; size?: number }) {
  return <g>
    <rect x={x} y={y} width={w} height={h} rx={3} fill="#120d0c" stroke="#000" />
    <text x={x + w - 8} y={y + h / 2 + size * 0.36} textAnchor="end" className="xf-led" style={{ fill: color, fontSize: size }}>{text}</text>
    {label && <text x={x + w / 2} y={y + h + 12} textAnchor="middle" className="xf-label">{label}</text>}
  </g>;
}

export function Lamp({ x, y, on, color, label }: { x: number; y: number; on: boolean; color: string; label: string }) {
  return <g><circle cx={x} cy={y} r={5} fill={on ? color : "#3f3f46"} stroke="#111" style={on ? { filter: `drop-shadow(0 0 4px ${color})` } : undefined} />
    <text x={x + 9} y={y + 4} className="xf-label xf-label--left">{label}</text></g>;
}

/** Buchse/Klemme; `active` = Messleitung steckt hier. */
export function Jack({ id, x, y, color, label, active, onClick, hl, r = 9 }: { id: string; x: number; y: number; color: string; label: string; active?: boolean; onClick?: () => void; hl?: string | null; r?: number }) {
  return <g className="xf-jack" data-id={id} data-hl={hl === id} data-active={!!active} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : -1} aria-pressed={onClick ? active : undefined} aria-label={label}
    onPointerDown={(e) => e.stopPropagation()} onClick={onClick} onKeyDown={(e) => { if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}>
    <circle className="xf-hl-ring" cx={x} cy={y} r={r + 7} />
    <circle cx={x} cy={y} r={r} fill={color} stroke="#111" strokeWidth={1.5} />
    <circle cx={x} cy={y} r={r * 0.42} fill="#111" />
    {active && <circle cx={x} cy={y} r={r * 0.62} fill={color === "#111827" || color === "#1f2937" ? "#9ca3af" : color} stroke="#fff" strokeWidth={1.5} />}
    <text x={x} y={y + r + 13} textAnchor="middle" className="xf-label">{label}</text>
  </g>;
}

/** Drehschalter mit beschrifteten Stellungen (Stellung antippen oder Knopf drehen). */
export function Rotary({ id, cx, cy, r, positions, index, onSelect, hl }: { id: string; cx: number; cy: number; r: number; positions: { label: string; key: string }[]; index: number; onSelect: (i: number) => void; hl?: string | null }) {
  const n = positions.length, span = 300, start = -150;
  const angOf = (i: number) => ((start + (span * i) / Math.max(1, n - 1)) * Math.PI) / 180;
  const a = angOf(index);
  return <g className="xf-rotary" data-id={id} data-hl={hl === id}>
    <circle className="xf-hl-ring" cx={cx} cy={cy} r={r + 34} />
    {positions.map((p, i) => { const b = angOf(i); return <g key={p.key} className="xf-rotary-pos" data-active={i === index} role="button" tabIndex={0} aria-label={`Drehschalter ${p.label}`} aria-pressed={i === index}
      onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } }}>
      <circle cx={cx + Math.sin(b) * (r + 20)} cy={cy - Math.cos(b) * (r + 20)} r={13} className="xf-rotary-hit" />
      <text x={cx + Math.sin(b) * (r + 20)} y={cy - Math.cos(b) * (r + 20) + 4} textAnchor="middle" className="xf-rotary-text">{p.label}</text>
    </g>; })}
    <circle cx={cx} cy={cy} r={r} fill="#1f2937" stroke="#0b0f14" strokeWidth={2} />
    <g role="slider" tabIndex={0} aria-label="Drehschalter" aria-valuetext={positions[index]?.label}
      onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect((index + 1) % n)}
      onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowUp") onSelect(Math.min(n - 1, index + 1)); if (e.key === "ArrowLeft" || e.key === "ArrowDown") onSelect(Math.max(0, index - 1)); }}>
      <rect x={cx - 7} y={cy - r + 4} width={14} height={2 * r - 8} rx={6} fill="#4b5563" transform={`rotate(${(a * 180) / Math.PI} ${cx} ${cy})`} />
      <line x1={cx} y1={cy} x2={cx + Math.sin(a) * (r - 6)} y2={cy - Math.cos(a) * (r - 6)} stroke="#f97316" strokeWidth={4} strokeLinecap="round" />
    </g>
  </g>;
}

/** Gerätegehäuse: Rahmen mit Schattenkante, Frontplatte mit Lichtverlauf, Schrauben und Standfüße – damit die Bedienelemente als Gerät erkennbar sind. */
export function Panel({ w, h, children, label, body = "#d4d4d8" }: { w: number; h: number; children: ReactNode; label: string; body?: string }) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, ""), foot = 9;
  const screw = (x: number, y: number) => <g key={`${x}-${y}`} aria-hidden="true"><circle cx={x} cy={y} r={3.2} fill="#9ca3af" stroke="#4b5563" strokeWidth={0.8} /><line x1={x - 2} y1={y - 2} x2={x + 2} y2={y + 2} stroke="#374151" strokeWidth={1} /></g>;
  return <svg className="xf-panel" viewBox={`0 0 ${w} ${h + foot}`} role="group" aria-label={label}>
    <defs>
      <linearGradient id={`${gid}-sheen`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.38" /><stop offset="0.12" stopColor="#fff" stopOpacity="0.06" /><stop offset="0.85" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.16" />
      </linearGradient>
    </defs>
    <g aria-hidden="true">
      <rect x={34} y={h - 4} width={46} height={foot + 3} rx={3} fill="#111827" /><rect x={w - 80} y={h - 4} width={46} height={foot + 3} rx={3} fill="#111827" />
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={12} fill="#1f2937" stroke="#0b0f14" strokeWidth={2} />
      <rect x={5} y={5} width={w - 10} height={h - 10} rx={8} fill={body} stroke="#111827" strokeWidth={1} />
      <rect x={5} y={5} width={w - 10} height={h - 10} rx={8} fill={`url(#${gid}-sheen)`} pointerEvents="none" />
      {[[w - 12, 12], [12, h - 12], [w - 12, h - 12]].map(([x, y]) => screw(x, y))}
    </g>
    {children}
  </svg>;
}
