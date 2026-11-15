import { useId } from "react";
import type { PenKind } from "./penTypes";

const INK = "#191923";
const VIOLET = "#5738df";
const GOLD = "#f2d548";

/** The four compact, cutout “Klassisch” pen-head stickers from the XNTS reference. */
export default function PenGlyph({ kind, color, className = "" }: { kind: PenKind; color: string; className?: string }) {
  const shadowId = `xnts-pen-cutout-${useId().replace(/:/g, "")}`;
  const outerShape = kind === "ballpoint"
    ? "M10 5 H40 V26 H36 L32 44 L28 62 L27 75 Q32 78 31 85 Q30 92 25 92 Q20 92 19 85 Q18 78 23 75 L22 62 L18 44 L14 26 H10 Z"
    : kind === "fountain"
      ? "M9 5 Q9 2 12 2 H38 Q41 2 41 5 V24 H38 V35 L34 50 L30 61 L27 77 L25 91 L23 77 L20 61 L16 50 L12 35 V24 H9 Z"
      : kind === "pencil"
        ? "M10 5 Q10 2 13 2 H37 Q40 2 40 5 V53 L25 91 L10 53 Z"
        : "M6 5 Q6 2 10 2 H40 Q44 2 44 5 V27 L40 48 L35 62 L30 72 V84 L25 91 L18 84 V72 L13 62 L8 48 L6 27 Z";

  return <svg viewBox="0 0 50 96" className={className} aria-hidden="true" focusable="false">
    <defs>
      <filter id={shadowId} x="-30%" y="-15%" width="160%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#111827" floodOpacity=".25" />
      </filter>
    </defs>
    <g filter={`url(#${shadowId})`} strokeLinejoin="round" strokeLinecap="round">
      {/* White sticker edge, transparent outside it, and the original dark contour. */}
      <path d={outerShape} fill="#fffdf8" stroke="#fffdf8" strokeWidth="7" />
      <path d={outerShape} fill="#fffdf8" stroke={INK} strokeWidth="2.7" />

      {kind === "ballpoint" && <>
        <path d="M11 6 H39 V25 H11 Z" fill={VIOLET} stroke={INK} strokeWidth="2.3" />
        <path d="M11 24 H39 V29 H11 Z" fill={GOLD} stroke={INK} strokeWidth="1.8" />
        <path d="M15 29 H35 L31 45 L27 63 L26 77 H24 L23 63 L19 45 Z" fill="#fffdf8" stroke={INK} strokeWidth="2.3" />
        <path d="M20 61 H30 L28 68 H22 Z" fill="#d8d9df" stroke={INK} strokeWidth="1.8" />
        <circle cx="25" cy="84" r="4" fill={color} stroke={INK} strokeWidth="1.8" />
      </>}

      {kind === "fountain" && <>
        <path d="M10 5 Q10 3 12 3 H38 Q40 3 40 5 V20 H10 Z" fill={VIOLET} stroke={INK} strokeWidth="2.3" />
        <path d="M11 19 H39 V25 H11 Z" fill="#a795ff" stroke={INK} strokeWidth="1.8" />
        <path d="M13 25 H37 V36 L34 48 H16 L13 36 Z" fill="#25242d" stroke={INK} strokeWidth="2.1" />
        <path d="M16 47 H34 L31 58 L25 82 L19 58 Z" fill={GOLD} stroke={INK} strokeWidth="2.1" />
        <circle cx="25" cy="59" r="3" fill={INK} />
        <path d="M23 78 L25 88 L27 78 Z" fill={color} stroke={INK} strokeWidth="1.4" />
      </>}

      {kind === "pencil" && <>
        <path d="M11 5 Q11 3 13 3 H37 Q39 3 39 5 V17 H11 Z" fill={VIOLET} stroke={INK} strokeWidth="2.2" />
        <path d="M11 17 H39 V25 H11 Z" fill="#a795ff" stroke={INK} strokeWidth="1.8" />
        <path d="M12 25 H38 V51 L34 56 L30 51 L26 56 L22 51 L18 56 L12 51 Z" fill="#fffdf8" stroke={INK} strokeWidth="2.1" />
        <path d="M12 51 L17 56 L21 51 L25 56 L29 51 L33 56 L38 51 V62 H12 Z" fill={GOLD} stroke={INK} strokeWidth="1.8" />
        <path d="M13 62 H37 L25 86 Z" fill="#d8d9df" stroke={INK} strokeWidth="2" />
        <path d="M22.5 81 L25 90 L27.5 81 Z" fill={color} stroke={INK} strokeWidth="1.3" />
      </>}

      {kind === "marker" && <>
        <path d="M7 5 Q7 3 10 3 H40 Q43 3 43 5 V25 H7 Z" fill="#25242d" stroke={INK} strokeWidth="2.2" />
        <path d="M8 23 H42 V29 H8 Z" fill={GOLD} stroke={INK} strokeWidth="1.8" />
        <path d="M9 29 H41 L37 49 L32 63 L27 73 V82 L20 88 L17 81 V72 L13 63 L9 49 Z" fill="#ffe97b" stroke={INK} strokeWidth="2.2" />
        <path d="M13 34 V56" stroke="#fff8cc" strokeWidth="2" />
        <path d="M18 73 H32 V82 L25 89 L18 82 Z" fill={color} stroke={INK} strokeWidth="1.7" />
      </>}
    </g>
  </svg>;
}
