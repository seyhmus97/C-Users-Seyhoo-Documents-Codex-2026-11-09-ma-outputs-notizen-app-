export type TutorialArtKey = "welcome" | "library" | "writing" | "lines" | "circuits" | "groups" | "focus" | "gestures" | "backup";

const LABELS: Record<TutorialArtKey, string> = {
  welcome: "Kunstinspirierte Notizfläche mit gelbem Papier und violetten Formen",
  library: "Ordner und Notizen in einer klar gegliederten Bibliothek",
  writing: "Stift und handgezeichnete farbige Linien auf Papier",
  lines: "Eine Linie mit verschiebbarem Winkelgriff",
  circuits: "Geometrische Schaltung mit verbundenen Leitungen",
  groups: "Gemeinsame Lerngruppe mit Notiz, Chat und Mitgliedern",
  focus: "Notizfläche im Fokusmodus mit kleiner Werkzeugleiste",
  gestures: "Stift und Fingerbewegungen auf einem Tablet",
  backup: "Notiz wird sicher in einem lokalen Backup aufbewahrt",
};

export default function TutorialArt({ kind, compact = false }: { kind: TutorialArtKey; compact?: boolean }) {
  return (
    <svg className={`xnts-tutorial-art${compact ? " xnts-tutorial-art--compact" : ""}`} viewBox="0 0 640 260" role="img" aria-label={LABELS[kind]}>
      <rect x="0" y="0" width="640" height="260" rx="8" fill="#eee9ff" />
      <path d="M0 0h176v54H0z" fill="#f3df35" />
      <path d="M474 0h166v35H474z" fill="#7653ed" opacity=".78" />
      <circle cx="570" cy="214" r="65" fill="#f3df35" />
      <path d="M23 219h138" stroke="#7653ed" strokeWidth="2" opacity=".35" />
      <g className="xnts-tutorial-art__drawing">
        {kind === "welcome" && <>
          <rect x="178" y="39" width="280" height="186" rx="3" fill="#fffdf4" stroke="#191620" strokeWidth="3" />
          <path d="M205 78h175M205 103h220M205 128h145" stroke="#aaa2b8" strokeWidth="3" />
          <path d="M221 177c20-41 31 28 51-6s35-29 52 3 30-40 49-15" fill="none" stroke="#6843ef" strokeWidth="7" strokeLinecap="round" />
          <path d="M478 74l32-26 20 26-32 26z" fill="#191620" />
          <circle cx="517" cy="169" r="26" fill="#7653ed" /><path d="M507 169l8 8 15-18" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>}
        {kind === "library" && <>
          <rect x="154" y="34" width="338" height="192" rx="5" fill="#fffdf4" stroke="#191620" strokeWidth="3" />
          <rect x="154" y="34" width="88" height="192" rx="5" fill="#f3df35" />
          <path d="M172 62h52M172 78h43M172 99h52M172 115h42M172 138h50" stroke="#191620" strokeWidth="5" strokeLinecap="round" opacity=".55" />
          <path d="M267 74h184M267 111h146M267 149h184" stroke="#191620" strokeWidth="2" opacity=".3" />
          <path d="M268 56h106l13 13h91v24H268z" fill="#7653ed" />
          <rect x="267" y="105" width="186" height="25" rx="3" fill="#eee9ff" /><rect x="267" y="142" width="151" height="25" rx="3" fill="#eee9ff" />
          <circle cx="469" cy="117" r="9" fill="#f3df35" /><circle cx="434" cy="154" r="9" fill="#f3df35" />
        </>}
        {kind === "writing" && <>
          <rect x="186" y="31" width="245" height="193" rx="4" fill="#fffdf4" stroke="#191620" strokeWidth="3" transform="rotate(-4 186 31)" />
          <path d="M220 83c26-32 39 34 69 0s48 31 76-3 42 31 63-4" fill="none" stroke="#6843ef" strokeWidth="7" strokeLinecap="round" />
          <path d="M223 126c38 0 30 43 69 23 31-16 41 7 68-2 20-7 33-21 65-9" fill="none" stroke="#f1d624" strokeWidth="12" strokeLinecap="round" />
          <path d="M469 48l28-17 57 99-28 17z" fill="#191620" /><path d="M526 147l-7 31 24-22z" fill="#f2c7a1" />
          <circle cx="495" cy="191" r="18" fill="#7653ed" opacity=".9" />
        </>}
        {kind === "lines" && <>
          <rect x="157" y="34" width="331" height="192" rx="4" fill="#fffdf4" stroke="#191620" strokeWidth="3" />
          <path d="M209 179L431 86" stroke="#6843ef" strokeWidth="9" strokeLinecap="round" />
          <circle cx="209" cy="179" r="11" fill="#f3df35" stroke="#191620" strokeWidth="3" /><circle cx="431" cy="86" r="11" fill="#f3df35" stroke="#191620" strokeWidth="3" />
          <path d="M209 179v-54h88" fill="none" stroke="#191620" strokeWidth="2" strokeDasharray="5 6" opacity=".45" />
          <path d="M367 67a69 69 0 0 1 46 11" fill="none" stroke="#7653ed" strokeWidth="3" /><path d="M407 68l10 11-15 2" fill="#7653ed" />
          <text x="357" y="57" fill="#191620" fontSize="17" fontWeight="700">freier Winkel</text>
        </>}
        {kind === "circuits" && <>
          <rect x="161" y="34" width="320" height="192" rx="4" fill="#fffdf4" stroke="#191620" strokeWidth="3" />
          <path d="M206 92h73v67h86V92h67" fill="none" stroke="#6843ef" strokeWidth="7" strokeLinejoin="round" />
          <circle cx="279" cy="92" r="19" fill="#f3df35" stroke="#191620" strokeWidth="3" />
          <rect x="344" y="143" width="42" height="32" rx="3" fill="#eee9ff" stroke="#191620" strokeWidth="3" />
          <path d="M277 92h39m70 0h43" stroke="#191620" strokeWidth="2" strokeDasharray="4 5" />
          <path d="M217 190h152" stroke="#191620" strokeWidth="2" opacity=".35" />
          <path d="M227 182l-9 8 9 8m132-16 9 8-9 8" fill="none" stroke="#7653ed" strokeWidth="3" />
        </>}
        {kind === "groups" && <>
          <rect x="161" y="39" width="276" height="177" rx="5" fill="#fffdf4" stroke="#191620" strokeWidth="3" />
          <rect x="161" y="39" width="276" height="32" fill="#f3df35" />
          <path d="M185 100h155m-155 27h130m-130 27h97" stroke="#6843ef" strokeWidth="5" strokeLinecap="round" />
          <rect x="366" y="84" width="51" height="116" rx="5" fill="#191620" />
          <path d="M376 101h30m-30 13h23m-23 47h30" stroke="#fffdf4" strokeWidth="4" strokeLinecap="round" />
          <circle cx="484" cy="95" r="25" fill="#7653ed" /><circle cx="535" cy="125" r="22" fill="#f3df35" stroke="#191620" strokeWidth="3" />
          <circle cx="480" cy="94" r="8" fill="#fffdf4" /><path d="M465 112q15-19 30 0" fill="#fffdf4" />
          <circle cx="535" cy="119" r="7" fill="#191620" /><path d="M522 136q13-17 26 0" fill="#191620" />
        </>}
        {kind === "focus" && <>
          <rect x="139" y="30" width="362" height="200" rx="8" fill="#191620" />
          <rect x="160" y="48" width="320" height="164" rx="3" fill="#fffdf4" />
          <path d="M191 86h202M191 111h240" stroke="#aaa2b8" strokeWidth="3" />
          <path d="M198 169c21-35 41 19 65-5 22-23 35-34 61 0s32-31 60-18" fill="none" stroke="#6843ef" strokeWidth="7" strokeLinecap="round" />
          <rect x="238" y="218" width="165" height="25" rx="12" fill="#f3df35" stroke="#191620" strokeWidth="2" />
          <circle cx="258" cy="230" r="6" fill="#6843ef" /><path d="M282 230h35m22 0h39" stroke="#191620" strokeWidth="4" strokeLinecap="round" />
        </>}
        {kind === "gestures" && <>
          <rect x="162" y="44" width="296" height="174" rx="11" fill="#191620" />
          <rect x="176" y="57" width="268" height="146" rx="4" fill="#fffdf4" />
          <path d="M213 156c20-32 36 14 57-8s32-19 48 0 26-26 54-11" fill="none" stroke="#6843ef" strokeWidth="6" strokeLinecap="round" />
          <path d="M508 58v90m-18-73 18-17 18 17m-72 87h112m-95-15-17 15 17 16m78-16 17 16-17 15" fill="none" stroke="#191620" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="532" cy="185" r="13" fill="#7653ed" /><circle cx="569" cy="185" r="13" fill="#f3df35" stroke="#191620" strokeWidth="2" />
          <path d="M550 184h-8" stroke="#191620" strokeWidth="3" />
        </>}
        {kind === "backup" && <>
          <rect x="176" y="47" width="192" height="167" rx="4" fill="#fffdf4" stroke="#191620" strokeWidth="3" />
          <path d="M206 83h130M206 107h100M206 131h119" stroke="#aaa2b8" strokeWidth="4" strokeLinecap="round" />
          <path d="M370 131h48v51h80v-51h39" fill="none" stroke="#6843ef" strokeWidth="6" strokeLinejoin="round" />
          <path d="M456 66c-24 0-43 19-43 43 0 9 3 17 8 24l-13 19h36v-9c4 2 8 2 12 2 24 0 43-19 43-43s-19-36-43-36z" fill="#f3df35" stroke="#191620" strokeWidth="3" />
          <path d="M436 110l14 14 25-29" fill="none" stroke="#191620" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M260 223h225" stroke="#191620" strokeWidth="2" strokeDasharray="4 6" opacity=".4" />
        </>}
      </g>
    </svg>
  );
}
