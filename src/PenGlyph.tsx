import { useId } from "react";
import type { PenKind } from "./penTypes";

const OUTLINE = "#191923";
const VIOLET = "#5738df";
const GOLD = "#f2d548";

/** Compact die-cut pen stickers inspired by the selected “Klassisch” reference. */
export default function PenGlyph({ kind, color, className = "" }: { kind: PenKind; color: string; className?: string }) {
  const shadowId = `xnts-pen-sticker-shadow-${useId().replace(/:/g, "")}`;
  const silhouette = kind === "marker"
    ? "M9 5 Q9 3 12 3 H24 Q27 3 27 5 V34 L18 46 L9 34 Z"
    : kind === "fountain"
      ? "M9 5 Q9 3 12 3 H24 Q27 3 27 5 V15 L23 26 L20 35 L18 45 L16 35 L13 26 L9 15 Z"
      : kind === "pencil"
        ? "M11 5 Q11 3 13 3 H23 Q25 3 25 5 V31 L18 46 L11 31 Z"
        : "M10 5 Q10 3 12 3 H24 Q26 3 26 5 V15 L22 30 L18 45 L14 30 L10 15 Z";

  return <svg viewBox="0 0 36 50" className={className} aria-hidden="true" focusable="false">
    <defs>
      <filter id={shadowId} x="-35%" y="-20%" width="170%" height="155%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.1" floodColor="#111827" floodOpacity=".28" />
      </filter>
    </defs>
    <g filter={`url(#${shadowId})`} strokeLinejoin="round" strokeLinecap="round">
      {/* White kiss-cut edge, then the shared dark hand-drawn contour. */}
      <path d={silhouette} fill="#fffdf8" stroke="#fffdf8" strokeWidth="6" />
      <path d={silhouette} fill="#fffdf8" stroke={OUTLINE} strokeWidth="2.25" />

      {kind === "ballpoint" && <>
        <path d="M11 5 H25 V15 H11 Z" fill={VIOLET} stroke={OUTLINE} strokeWidth="1.8" />
        <path d="M11.5 7 H24.5" stroke="#9d8cff" strokeWidth="1" />
        <path d="M12 15 H24 L21 28 H15 Z" fill="#fffdf8" stroke={OUTLINE} strokeWidth="1.8" />
        <path d="M15 28 H21 L18 40 Z" fill={color} stroke={OUTLINE} strokeWidth="1.7" />
        <path d="M16.5 39 L18 45 L19.5 39 Z" fill={OUTLINE} />
        <path d="M14 31 H22" stroke="#d7d5e3" strokeWidth="1" />
      </>}

      {kind === "fountain" && <>
        <path d="M10 5 H26 V12 H10 Z" fill={VIOLET} stroke={OUTLINE} strokeWidth="1.8" />
        <path d="M10 12 H26 V15 H10 Z" fill="#a795ff" stroke={OUTLINE} strokeWidth="1.4" />
        <path d="M11 15 H25 L22.5 25 H13.5 Z" fill="#272633" stroke={OUTLINE} strokeWidth="1.8" />
        <path d="M13.5 25 H22.5 L25 33 L18 44 L11 33 Z" fill={GOLD} stroke={OUTLINE} strokeWidth="1.8" />
        <circle cx="18" cy="32" r="2.2" fill={OUTLINE} />
        <path d="M16.5 38 L18 45 L19.5 38 Z" fill={color} stroke={OUTLINE} strokeWidth="1.3" />
      </>}

      {kind === "pencil" && <>
        <path d="M12 5 H24 V11 H12 Z" fill={VIOLET} stroke={OUTLINE} strokeWidth="1.8" />
        <path d="M12 11 H24 V23 H12 Z" fill="#fffdf8" stroke={OUTLINE} strokeWidth="1.8" />
        <path d="M12 21 L15 24 L18 21 L21 24 L24 21 V28 L21 31 L18 28 L15 31 L12 28 Z" fill={GOLD} stroke={OUTLINE} strokeWidth="1.5" />
        <path d="M12 29 H24 L18 44 Z" fill="#d8d9df" stroke={OUTLINE} strokeWidth="1.7" />
        <path d="M16.3 39.5 L18 45 L19.7 39.5 Z" fill={color} stroke={OUTLINE} strokeWidth="1" />
        <path d="M13.5 13 V19" stroke="#d7d5e3" strokeWidth="1" />
      </>}

      {kind === "marker" && <>
        <path d="M10 5 H26 V12 H10 Z" fill="#252633" stroke={OUTLINE} strokeWidth="1.8" />
        <path d="M10 12 H26 V15 H10 Z" fill={GOLD} stroke={OUTLINE} strokeWidth="1.5" />
        <path d="M10 15 H26 V32 H10 Z" fill="#ffe97b" stroke={OUTLINE} strokeWidth="1.8" />
        <path d="M13 18 V29" stroke="#fff8cc" strokeWidth="1.7" />
        <path d="M10 32 H26 L18 43 Z" fill={color} stroke={OUTLINE} strokeWidth="1.8" />
        <path d="M16.5 41 L18 46 L19.5 41 Z" fill={OUTLINE} />
      </>}
    </g>
  </svg>;
}
