// PenExtras.tsx – Vorschau für Stifttyp/Glättung und lokale Stift-Diagnose (Einstellungen).
// Die Diagnose liest nur Pointer-Ereignisse im eigenen Feld aus; es wird nichts gespeichert oder übertragen.
import { useMemo, useState } from "react";
import { inkWidth, smoothInk, type InkKind, type InkPoint } from "./inkEngine";

// feste, absichtlich zittrige „Handschrift“ als Testschwung (kein Zufall → Vorschau flackert nicht)
const SAMPLE: InkPoint[] = Array.from({ length: 70 }, (_, i) => {
  const t = i / 69;
  return { x: 10 + t * 260, y: 34 + Math.sin(t * Math.PI * 3) * 15 + Math.sin(i * 2.7) * 2.2, p: 0.25 + 0.6 * Math.sin(t * Math.PI) };
});

export function PenPreview({ kind, size, color, smoothing, sensitivity }: { kind: InkKind; size: number; color: string; smoothing: number; sensitivity: number }) {
  const segs = useMemo(() => {
    const pts = smoothing > 0 ? smoothInk(SAMPLE, smoothing, 1) : SAMPLE;
    return pts.slice(1).map((b, i) => {
      const a = pts[i], p = Math.min(1, Math.max(0.05, 0.5 + (b.p - 0.5) * sensitivity));
      return { a, b, w: inkWidth(kind, size, p, b.x - a.x, b.y - a.y, false) };
    });
  }, [kind, size, smoothing, sensitivity]);
  return (
    <figure className="xnts-pen-preview" aria-label="Vorschau des Strichs">
      <svg viewBox="0 0 280 68" role="img" aria-label={`Beispielstrich mit ${kind}`}>
        {segs.map((s, i) => <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke={color} strokeWidth={s.w} strokeLinecap="round" opacity={kind === "pencil" ? 0.78 : kind === "marker" ? 0.45 : 1} />)}
      </svg>
      <figcaption>Vorschau: gleicher Schwung mit wechselndem Druck – so wirken Stifttyp, Druck und Glättung.</figcaption>
    </figure>
  );
}

type Reading = { type: string; pressure: number; button: number; buttons: number; tilt: string };
const label = (r: Reading | null) => {
  if (!r) return null;
  const tail = r.type === "pen" && (r.button === 5 || (r.buttons & 32) !== 0);
  const barrel = r.type === "pen" && !tail && (r.button === 2 || (r.buttons & 2) !== 0);
  return { tail, barrel };
};

export function PenDiagnostic() {
  const [r, setR] = useState<Reading | null>(null);
  const [maxP, setMaxP] = useState(0);
  const [seen, setSeen] = useState({ pen: false, pressure: false, tail: false, barrel: false });
  const read = (e: React.PointerEvent) => {
    const n: Reading = { type: e.pointerType, pressure: e.pressure, button: e.button, buttons: e.buttons, tilt: `${Math.round(e.tiltX)}°/${Math.round(e.tiltY)}°` };
    setR(n);
    const l = label(n);
    setMaxP((m) => Math.max(m, e.pressure));
    setSeen((s) => ({ pen: s.pen || e.pointerType === "pen", pressure: s.pressure || (e.pointerType === "pen" && e.pressure > 0 && e.pressure !== 0.5), tail: s.tail || !!l?.tail, barrel: s.barrel || !!l?.barrel }));
  };
  const ok = (v: boolean) => (v ? "✔ erkannt" : "– noch nicht gesehen");
  return (
    <div className="xnts-diag">
      <div className="xnts-diag__pad" onPointerDown={read} onPointerMove={read} onPointerUp={read} onContextMenu={(e) => e.preventDefault()} style={{ touchAction: "none" }} tabIndex={0} aria-label="Testfeld für den Stift">
        Mit dem Stift hier schreiben, drücken, Seitentaste halten und das Radierer-Ende aufsetzen.
      </div>
      <dl>
        <dt>Zeigergerät</dt><dd>{r ? (r.type === "pen" ? "Stift" : r.type === "touch" ? "Finger" : "Maus") : "–"}</dd>
        <dt>Druck jetzt / max.</dt><dd>{r ? r.pressure.toFixed(2) : "–"} / {maxP.toFixed(2)}</dd>
        <dt>Neigung</dt><dd>{r?.tilt ?? "–"}</dd>
        <dt>Stift erkannt</dt><dd>{ok(seen.pen)}</dd>
        <dt>Druck erkannt</dt><dd>{ok(seen.pressure)}</dd>
        <dt>Rückseite (Radierer)</dt><dd>{ok(seen.tail)}</dd>
        <dt>Seitentaste</dt><dd>{ok(seen.barrel)}</dd>
      </dl>
      <p>Nur lokale Anzeige: Es werden keine Eingabedaten gespeichert oder gesendet. Ob Windows Ink Tasten und Druck wirklich meldet, zeigt erst ein Test auf dem echten Gerät (z. B. Surface Pen).</p>
    </div>
  );
}
