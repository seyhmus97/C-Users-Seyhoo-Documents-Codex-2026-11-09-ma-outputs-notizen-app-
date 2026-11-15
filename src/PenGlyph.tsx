import { useId } from "react";
import type { PenKind } from "./penTypes";

const BODY: Record<PenKind, [string, string, string]> = {
  ballpoint: ["#d8e1ed", "#5b6b7f", "#2e3a4c"],
  fountain: ["#d9bd6a", "#31313d", "#171923"],
  pencil: ["#ffe28a", "#c28a34", "#8c5c27"],
  marker: ["#fff1a8", "#d2ae32", "#9b791e"],
};

export default function PenGlyph({ kind, color, className = "" }: { kind: PenKind; color: string; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const [light, mid, dark] = BODY[kind];
  const gradient = `xnts-pen-${uid}`;
  return <svg viewBox="0 0 36 48" className={className} aria-hidden="true" focusable="false">
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0"><stop stopColor={light} /><stop offset=".34" stopColor={mid} /><stop offset=".68" stopColor={dark} /><stop offset="1" stopColor={light} /></linearGradient></defs>
    <g transform="rotate(34 18 24)" strokeLinejoin="round">
      {kind === "pencil" ? <>
        <path d="M13 8 18 4l5 4v26l-5 11-5-11Z" fill={`url(#${gradient})`} stroke={light} strokeWidth="1.2" />
        <path d="M14 11v20" stroke="#fff7d5" strokeOpacity=".7" strokeWidth="1" />
        <path d="m13 33 5-2 5 2-5 11Z" fill="#ead1a0" stroke="#f4e0bb" strokeWidth="1" />
        <path d="m16.4 39 1.6 5 1.6-5" fill="#34313a" />
        <path d="M13 8h10" stroke={color} strokeWidth="2.2" />
      </> : kind === "marker" ? <>
        <path d="M11 8q0-3 3-3h8q3 0 3 3v6H11Z" fill={color} stroke="#fff3be" strokeWidth="1.3" />
        <path d="M11 14h14v17l-3 7h-8l-3-7Z" fill={`url(#${gradient})`} stroke={light} strokeWidth="1.3" />
        <path d="M14 17v12" stroke="#fffbe4" strokeOpacity=".72" strokeWidth="1.4" />
        <path d="M14 38h8l-4 7Z" fill={mid} stroke="#fff1ae" strokeWidth="1" />
        <path d="M11 14h14" stroke={color} strokeWidth="2" />
      </> : <>
        <path d="M13 9q0-4 4-4h2q4 0 4 4v6H13Z" fill={kind === "fountain" ? dark : mid} stroke={light} strokeWidth="1.2" />
        <path d="M13 15h10v17l-5 11-5-11Z" fill={`url(#${gradient})`} stroke={light} strokeWidth="1.2" />
        <path d="M14 18v12" stroke="#fff" strokeOpacity=".68" strokeWidth="1" />
        <path d="M13 15h10" stroke={color} strokeWidth="2.4" />
        {kind === "fountain" ? <>
          <path d="M13 8h10" stroke="#f4dc8a" strokeWidth="1.5" />
          <path d="M18 32 13.8 35l4.2 8 4.2-8Z" fill="#e5d18c" stroke="#fff1bd" strokeWidth="1" />
          <circle cx="18" cy="36" r=".9" fill="#443b22" />
        </> : <path d="m16 38 2-6 2 6-2 5Z" fill="#c5d4e4" stroke="#fff" strokeWidth=".9" />}
      </>}
      <path d="M17 5v-2q1-2 2 0v2" fill="none" stroke={light} strokeWidth="1" />
    </g>
  </svg>;
}
