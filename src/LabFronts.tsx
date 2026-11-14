// Frontplatten der fünf Laborgeräte und der Schaltplan des Versuchsaufbaus.
import { type ReactNode } from "react";
import { Btn, Jack, Knob, Lamp, Led, Panel, Rotary } from "./LabPanels";
import { GENERATOR, PSU, SCOPE, type MeterSpec, type PsuMode, type Waveform } from "./labDevices";
import { fmtDiv, psuDisplay, si, type MeterReading, type PsuResult, type PsuSettings, type ScopeResult, type ScopeSettings } from "./labSim";

type Hl = string | null;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const logFrac = (v: number, a: number, b: number) => clamp(Math.log(v / a) / Math.log(b / a), 0, 1);

/* ───────── Netzteil GW Instek GPS-3303 ───────── */
export function PsuFront({ s, r, set, hl }: { s: PsuSettings; r: PsuResult; set: (p: Partial<PsuSettings>) => void; hl: Hl }) {
  const lim = PSU.modes[s.mode];
  const fixed = s.mode === "fixed5";
  // Anzeige je Kanal wie am Gerät: Serie teilt die Spannung, Parallel den Strom
  const ch1 = s.mode === "series" ? { u: r.u / 2, i: r.i } : s.mode === "parallel" ? { u: r.u, i: r.i / 2 } : s.mode === "independent" ? { u: r.u, i: r.i } : { u: 0, i: 0 };
  const ch2 = s.mode === "series" || s.mode === "parallel" ? ch1 : { u: 0, i: 0 };
  const modeBtn = (m: PsuMode, x: number, label: string) => <Btn id={`psu.mode.${m}`} x={x} y={150} w={64} label={label} active={s.mode === m} lamp onClick={() => set({ mode: m })} hl={hl} />;
  // Klemmen in Benutzung (Handbuch: Serie zwischen CH1 + und CH2 −)
  const used = s.mode === "independent" || s.mode === "parallel" ? ["ch1p", "ch1n"] : s.mode === "series" ? ["ch1p", "ch2n"] : ["ch3p", "ch3n"];
  return <Panel w={560} h={250} label="Netzteil GPS-3303" body="#e7e5e4">
    <text x={16} y={22} className="xf-brand">GPS-3303</text><text x={100} y={22} className="xf-sub">Laboratory DC Power Supply · 3 Ausgänge</text>
    <g><rect x={14} y={32} width={262} height={92} rx={6} fill="#d6d3d1" /><text x={22} y={46} className="xf-label xf-label--left">CH1 · MASTER</text>
      <Led x={22} y={52} w={112} text={psuDisplay(ch1.u)} label="V" /><Led x={156} y={52} w={112} text={psuDisplay(ch1.i)} label="A" />
      <Lamp x={30} y={112} on={r.regulation === "CV" && s.mode !== "fixed5"} color="#22c55e" label="C.V." /><Lamp x={86} y={112} on={r.regulation === "CC" && s.mode !== "fixed5"} color="#ef4444" label="C.C." />
    </g>
    <g><rect x={284} y={32} width={262} height={92} rx={6} fill="#d6d3d1" /><text x={292} y={46} className="xf-label xf-label--left">CH2 · SLAVE {s.mode === "series" || s.mode === "parallel" ? "(Tracking)" : ""}</text>
      <Led x={292} y={52} w={112} text={psuDisplay(ch2.u)} label="V" /><Led x={426} y={52} w={112} text={psuDisplay(ch2.i)} label="A" />
      <Lamp x={300} y={112} on={fixed && r.overload} color="#ef4444" label="CH3 Überlast" />
    </g>
    <Knob id="psu.vknob" x={44} y={170} label="VOLTAGE" value={`${si(s.vSet, "V", 3)}`} frac={fixed ? 0.17 : s.vSet / lim.vMax} disabled={fixed} hl={hl}
      onStep={(t, fine) => set({ vSet: Math.round(clamp(s.vSet + t * (fine ? 0.1 : 0.5), 0, lim.vMax) * 10) / 10 })} />
    <Knob id="psu.iknob" x={110} y={170} label="CURRENT" value={`${si(s.iSet, "A", 3)}`} frac={fixed ? 1 : s.iSet / lim.iMax} disabled={fixed} hl={hl}
      onStep={(t, fine) => set({ iSet: Math.round(clamp(s.iSet + t * (fine ? 0.01 : 0.05), 0, lim.iMax) * 100) / 100 })} />
    {modeBtn("independent", 158, "INDEP")}{modeBtn("series", 228, "SERIES")}{modeBtn("parallel", 298, "PARALLEL")}{modeBtn("fixed5", 368, "CH3 5V")}
    <text x={158} y={142} className="xf-label xf-label--left">TRACKING</text>
    <Btn id="psu.out" x={448} y={146} w={96} h={30} label={s.on ? "OUTPUT ON" : "OUTPUT"} active={s.on} lamp tone="accent" onClick={() => set({ on: !s.on })} hl={hl} />
    {([["ch1p", 180, "#dc2626", "CH1 +"], ["ch1n", 214, "#111827", "CH1 −"], ["gnd", 262, "#16a34a", "GND"], ["ch2p", 310, "#dc2626", "CH2 +"], ["ch2n", 344, "#111827", "CH2 −"], ["ch3p", 410, "#dc2626", "CH3 +"], ["ch3n", 444, "#111827", "CH3 −"]] as const).map(([k, x, c, l]) =>
      <Jack key={k} id={`psu.${k}`} x={x} y={212} color={c} label={l} active={used.includes(k)} hl={hl} />)}
    <text x={500} y={216} className="xf-label">{s.mode === "series" ? "Last: CH1+ ↔ CH2−" : s.mode === "fixed5" ? "5 V / 3 A fest" : "Last: CH1"}</text>
  </Panel>;
}

/* ───────── Funktionsgenerator Toellner TOE 7402/7404 ───────── */
export const GEN_RANGES = [10, 100, 1e3, 1e4, 1e5, 1e6];
export const genRangeOf = (f: number) => GEN_RANGES.find((r) => f <= 5 * r * 1.0001) ?? GEN_RANGES[GEN_RANGES.length - 1];
export function GenFront({ model, wave, freq, range, vpp, offset, symmetry, atten, counter, set, hl }: {
  model: "7402" | "7404"; wave: Waveform; freq: number; range: number; vpp: number; offset: number; symmetry: number; atten: 0 | 20 | 40; counter: string;
  set: (p: { waveform?: Waveform; freq?: number; range?: number; vpp?: number; offset?: number; symmetry?: number; atten?: 0 | 20 | 40 }) => void; hl: Hl;
}) {
  const fMin = GENERATOR.fMin[model], dial = freq / range;
  const waves: [Waveform, ReactNode][] = [["sine", "∿"], ["triangle", "△"], ["square", "⊓⊔"], ["pulse", "⊓_"], ["dc", "DC"]];
  return <Panel w={560} h={250} label={`Funktionsgenerator TOE ${model}`} body="#cbd5e1">
    <text x={16} y={22} className="xf-brand">TOE {model}</text><text x={100} y={22} className="xf-sub">Function Generator 5 MHz · Frequenzzähler</text>
    <Led x={16} y={32} w={200} h={40} text={counter} color="#4ade80" size={22} label="FREQUENZ (Zähler)" />
    <text x={232} y={44} className="xf-label xf-label--left">BEREICH (Skala ×0,05 … ×5)</text>
    {GEN_RANGES.map((r, i) => <Btn key={r} id={`gen.range.${r}`} x={232 + i * 52} y={50} w={46} label={r >= 1e6 ? "1M" : r >= 1e3 ? `${r / 1e3}k` : String(r)} active={range === r} lamp hl={hl === "gen.range" ? `gen.range.${r}` : hl}
      onClick={() => set({ range: r, freq: clamp(clamp(dial, 0.05, 5) * r, fMin, GENERATOR.fMax) })} />)}
    <text x={232} y={98} className="xf-label xf-label--left">FUNKTION</text>
    {waves.map(([w, l], i) => <Btn key={w} id={`gen.wave.${w}`} x={232 + i * 52} y={104} w={46} label={l} active={wave === w} lamp hl={hl === "gen.wave" ? `gen.wave.${w}` : hl} onClick={() => set({ waveform: w })} />)}
    <Knob id="gen.freq" x={48} y={124} r={24} label="FREQUENZ" value={si(freq, "Hz", 4)} frac={logFrac(dial, 0.05, 5)} disabled={wave === "dc"} hl={hl}
      onStep={(t, fine) => set({ freq: clamp(freq * Math.pow(10, t / (fine ? 120 : 30)), Math.max(fMin, range * 0.05), Math.min(GENERATOR.fMax, range * 5)) })} />
    <Knob id="gen.amp" x={120} y={124} r={20} label="AMPLITUDE" value={si(vpp, "V", 3)} frac={logFrac(vpp, 0.3, 30)} disabled={wave === "dc"} hl={hl}
      onStep={(t, fine) => set({ vpp: clamp(vpp * Math.pow(10, t / (fine ? 80 : 20)), 0.3, wave === "pulse" ? GENERATOR.vppMaxPulse : GENERATOR.vppMax) })} />
    <Knob id="gen.offset" x={184} y={124} r={18} label="OFFSET" value={si(offset, "V", 3)} frac={(offset + 10) / 20} hl={hl}
      onStep={(t, fine) => set({ offset: Math.round(clamp(offset + t * (fine ? 0.05 : 0.25), -10, 10) * 100) / 100 })} />
    {model === "7404" && <Knob id="gen.sym" x={252} y={194} r={16} label="SYMMETRIE" value={`${Math.round(symmetry * 100)} %`} frac={(symmetry - 0.1) / 0.8} disabled={wave === "sine" || wave === "dc"} hl={hl}
      onStep={(t) => set({ symmetry: Math.round(clamp(symmetry + t * 0.02, 0.1, 0.9) * 100) / 100 })} />}
    <text x={300} y={160} className="xf-label xf-label--left">ABSCHWÄCHER</text>
    <Btn id="gen.att20" x={300} y={166} w={52} label="−20 dB" active={atten === 20} lamp hl={hl} onClick={() => set({ atten: atten === 20 ? 0 : 20 })} />
    <Btn id="gen.att40" x={358} y={166} w={52} label="−40 dB" active={atten === 40} lamp hl={hl} onClick={() => set({ atten: atten === 40 ? 0 : 40 })} />
    <Jack id="gen.sync" x={440} y={196} color="#9ca3af" label="SYNC (TTL)" />
    <Jack id="gen.out" x={510} y={196} r={11} color="#d4a017" label="OUTPUT 50 Ω" active />
    <text x={16} y={236} className="xf-sub">Ausgangsamplitude {si(vpp * Math.pow(10, -atten / 20), "V", 3)}ss (Leerlauf) · max. 30 Vss</text>
  </Panel>;
}

/* ───────── Oszilloskop Tektronix TDS1000/2000 ───────── */
export type ScopeMenu = "ch0" | "ch1" | "trig" | "measure" | null;
export type SoftKey = { title: string; value: string; onPress?: () => void };
export function ScopeFront({ st, res, menu, softkeys, measureSlots, set, setCh, onMenu, onAutoset, onDefault, onProbe, probeLabels, colors, hl }: {
  st: ScopeSettings; res: ScopeResult | null; menu: ScopeMenu; softkeys: SoftKey[]; measureSlots: { title: string; value: string }[];
  set: (p: Partial<ScopeSettings>) => void; setCh: (i: number, p: Partial<ScopeSettings["ch"][number]>) => void;
  onMenu: (m: ScopeMenu) => void; onAutoset: () => void; onDefault: () => void; onProbe: (i: number) => void; probeLabels: string[]; colors: string[]; hl: Hl;
}) {
  const X = 16, Y = 30, W = 400, H = 320, dx = W / SCOPE.divX, dy = H / SCOPE.divY;
  const path = (pts: number[]) => { const n = pts.length, step = Math.max(1, Math.floor(n / 500)); let d = ""; for (let i = 0; i < n; i += step) { const x = X + (i / (n - 1)) * W, y = Y + H / 2 - clamp(pts[i], -4.1, 4.1) * dy; d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); } return d; };
  const vIdx = (c: ScopeSettings["ch"][number]) => SCOPE.vDiv.map((v) => v * c.probe).findIndex((v) => Math.abs(v - c.vDiv) < v * 1e-6);
  const stepV = (i: number, t: number) => { const c = st.ch[i], list = SCOPE.vDiv.map((v) => v * c.probe), k = clamp((vIdx(c) < 0 ? 6 : vIdx(c)) - t, 0, list.length - 1); setCh(i, { vDiv: list[k] }); };
  const sIdx = SCOPE.sDiv.findIndex((v) => Math.abs(v - st.sDiv) < v * 1e-6);
  const tc = st.ch[st.triggerSource];
  const menuOpen = menu !== null && softkeys.length > 0;
  return <Panel w={820} h={430} label={`Oszilloskop ${st.model}`} body="#d1d5db">
    <text x={16} y={22} className="xf-brand">{st.model}</text><text x={110} y={22} className="xf-sub">Digital Storage Oscilloscope · {st.model.startsWith("TDS1") ? "monochrom" : "Farbe"}</text>
    <rect x={X - 6} y={Y - 6} width={W + 12} height={H + 34} rx={4} fill="#111827" />
    <rect x={X} y={Y} width={W} height={H} fill="#0b1020" />
    {Array.from({ length: 9 }, (_, i) => <line key={`v${i}`} x1={X + (i + 1) * dx} y1={Y} x2={X + (i + 1) * dx} y2={Y + H} stroke="rgba(255,255,255,.16)" strokeDasharray={i === 4 ? undefined : "2 4"} />)}
    {Array.from({ length: 7 }, (_, j) => <line key={`h${j}`} x1={X} y1={Y + (j + 1) * dy} x2={X + W} y2={Y + (j + 1) * dy} stroke="rgba(255,255,255,.16)" strokeDasharray={j === 3 ? undefined : "2 4"} />)}
    <svg x={X} y={Y} width={W} height={H} overflow="hidden"><g transform={`translate(${-X} ${-Y})`}>
      {res?.traces.map((t, i) => t && <path key={i} d={path(t.points)} fill="none" stroke={colors[i]} strokeWidth={1.6} />)}
    </g></svg>
    {st.ch.map((c, i) => c.source && <text key={i} x={X + 3} y={Y + H / 2 - clamp(c.position, -3.9, 3.9) * dy + 4} className="xf-scope-text" style={{ fill: colors[i] }}>{i + 1}→</text>)}
    {tc?.source && <path d={`M${X + W} ${Y + H / 2 - clamp(st.triggerLevel / tc.vDiv + tc.position, -4, 4) * dy} l-8 -5 v10z`} fill={colors[st.triggerSource]} />}
    <text x={X + W / 2} y={Y + 12} textAnchor="middle" className="xf-scope-text" style={{ fill: res?.triggered ? "#86efac" : "#fca5a5" }}>{res?.triggered ? "Trig'd" : "Trig?"}</text>
    {menuOpen && <g><rect x={X + W - 98} y={Y} width={98} height={H} fill="rgba(17,24,39,.92)" />
      {softkeys.map((k, i) => <g key={i}><line x1={X + W - 98} x2={X + W} y1={Y + (i + 1) * 64} y2={Y + (i + 1) * 64} stroke="#374151" />
        <text x={X + W - 92} y={Y + i * 64 + 24} className="xf-scope-text">{k.title}</text>
        <text x={X + W - 92} y={Y + i * 64 + 42} className="xf-scope-text xf-scope-text--value">{k.value}</text></g>)}</g>}
    {menu === "measure" && <g>{measureSlots.map((m, i) => <g key={i}><text x={X + W - 92} y={Y + i * 64 + 24} className="xf-scope-text">{m.title}</text><text x={X + W - 92} y={Y + i * 64 + 42} className="xf-scope-text xf-scope-text--value">{m.value}</text></g>)}</g>}
    <text x={X + 4} y={Y + H + 18} className="xf-scope-text">
      {st.ch.map((c, i) => c.source ? <tspan key={i} style={{ fill: colors[i] }}>CH{i + 1} {fmtDiv(c.vDiv, "V")}{c.coupling === "AC" ? "~" : c.coupling === "GND" ? "⏚" : ""}{c.bwLimit ? " BW" : ""}{"   "}</tspan> : null)}
      <tspan>M {fmtDiv(st.sDiv, "s")}   CH{st.triggerSource + 1} {st.triggerSlope === "rise" ? "↗" : "↘"} {si(st.triggerLevel, "V", 3)}</tspan>
    </text>
    {[0, 1, 2, 3, 4].map((i) => <Btn key={i} id={`scope.soft${i}`} x={X + W + 14} y={Y + i * 64 + 18} w={26} h={26} label="" hl={hl} onClick={() => softkeys[i]?.onPress?.()} />)}
    {/* Bedienfeld */}
    <Btn id="scope.measure" x={480} y={34} w={70} label="MEASURE" active={menu === "measure"} hl={hl} onClick={() => onMenu(menu === "measure" ? null : "measure")} />
    <Btn id="scope.trigmenu" x={556} y={34} w={70} label="TRIG MENU" active={menu === "trig"} hl={hl} onClick={() => onMenu(menu === "trig" ? null : "trig")} />
    <Btn id="scope.default" x={632} y={34} w={84} label="DEFAULT SETUP" hl={hl} onClick={onDefault} />
    <Btn id="scope.autoset" x={722} y={34} w={84} h={26} label="AUTOSET" tone="accent" hl={hl} onClick={onAutoset} />
    <text x={480} y={80} className="xf-label xf-label--left">VERTICAL</text>
    <Knob id="scope.pos0" x={500} y={108} r={14} label="POS 1" frac={(st.ch[0].position + 4) / 8} color="#a16207" hl={hl} onStep={(t) => setCh(0, { position: Math.round(clamp(st.ch[0].position + t * 0.2, -4, 4) * 10) / 10 })} />
    <Knob id="scope.pos1" x={574} y={108} r={14} label="POS 2" frac={(st.ch[1].position + 4) / 8} color="#0e7490" hl={hl} onStep={(t) => setCh(1, { position: Math.round(clamp(st.ch[1].position + t * 0.2, -4, 4) * 10) / 10 })} />
    <Btn id="scope.ch0menu" x={480} y={146} w={44} label="CH1" active={menu === "ch0"} lamp hl={hl} onClick={() => onMenu(menu === "ch0" ? null : "ch0")} />
    <Btn id="scope.ch1menu" x={552} y={146} w={44} label="CH2" active={menu === "ch1"} lamp hl={hl} onClick={() => onMenu(menu === "ch1" ? null : "ch1")} />
    <text x={480} y={182} className="xf-label xf-label--left">MENU</text>
    <Knob id="scope.vdiv0" x={502} y={222} r={22} label="VOLTS/DIV 1" value={fmtDiv(st.ch[0].vDiv, "V")} frac={vIdx(st.ch[0]) / (SCOPE.vDiv.length - 1)} color="#a16207" hl={hl} onStep={(t) => stepV(0, t)} />
    <Knob id="scope.vdiv1" x={576} y={222} r={22} label="VOLTS/DIV 2" value={fmtDiv(st.ch[1].vDiv, "V")} frac={vIdx(st.ch[1]) / (SCOPE.vDiv.length - 1)} color="#0e7490" hl={hl} onStep={(t) => stepV(1, t)} />
    <text x={640} y={80} className="xf-label xf-label--left">HORIZONTAL</text>
    <Knob id="scope.sdiv" x={668} y={146} r={26} label="SEC/DIV" value={fmtDiv(st.sDiv, "s")} frac={sIdx / (SCOPE.sDiv.length - 1)} hl={hl}
      onStep={(t) => set({ sDiv: SCOPE.sDiv[clamp(sIdx - t, 0, SCOPE.sDiv.length - 1)] })} />
    <text x={730} y={80} className="xf-label xf-label--left">TRIGGER</text>
    <Knob id="scope.level" x={766} y={146} r={20} label="LEVEL" value={si(st.triggerLevel, "V", 3)} frac={tc ? clamp((st.triggerLevel / tc.vDiv + tc.position + 4) / 8, 0, 1) : 0.5} hl={hl}
      onStep={(t, fine) => { const c = st.ch[st.triggerSource]; set({ triggerLevel: st.triggerLevel + t * (c.vDiv / (fine ? 25 : 5)) }); }} />
    <Jack id="scope.bnc0" x={510} y={330} r={14} color="#d4a017" label="CH1" active={!!st.ch[0].source} onClick={() => onProbe(0)} hl={hl} />
    <Jack id="scope.bnc1" x={584} y={330} r={14} color="#d4a017" label="CH2" active={!!st.ch[1].source} onClick={() => onProbe(1)} hl={hl} />
    <Jack id="scope.ext" x={658} y={330} r={10} color="#9ca3af" label="EXT TRIG" />
    <text x={480} y={378} className="xf-sub">BNC antippen = Tastkopf an nächsten Messpunkt</text>
    <text x={480} y={396} className="xf-sub" style={{ fill: "#a16207" }}>CH1 → {probeLabels[0]}</text>
    <text x={480} y={412} className="xf-sub" style={{ fill: "#0e7490" }}>CH2 → {probeLabels[1]}</text>
  </Panel>;
}

/* ───────── Handmultimeter ───────── */
export type MeterPos = { key: string; label: string };
export function MeterFront({ spec, positions, pos, reading, jack, jacks, ac, hz, rangeAuto, canAc, onPos, onJack, onRange, onAc, onHz, hl, prefix, body }: {
  spec: MeterSpec; positions: MeterPos[]; pos: string; reading: MeterReading | null; jack: string; jacks: { key: string; label: string; color: string }[];
  ac: boolean; hz: boolean; rangeAuto: boolean; canAc: boolean; onPos: (k: string) => void; onJack: (k: string) => void; onRange: () => void; onAc?: () => void; onHz?: () => void; hl: Hl; prefix: string; body: string;
}) {
  const idx = Math.max(0, positions.findIndex((p) => p.key === pos));
  const off = pos === "OFF";
  return <Panel w={300} h={470} label={spec.name} body={body}>
    <text x={150} y={24} textAnchor="middle" className="xf-brand xf-brand--light">{spec.short}</text>
    <rect x={26} y={34} width={248} height={92} rx={8} fill="#1f2937" />
    <rect x={34} y={42} width={232} height={76} rx={4} fill={off ? "#6b7a63" : "#c9d3b6"} />
    {!off && reading && <>
      <text x={232} y={92} textAnchor="end" className="xf-lcd" data-ol={reading.overload}>{reading.text}</text>
      <text x={240} y={92} className="xf-lcd-unit">{reading.text === "----" ? "" : reading.unit}</text>
      <text x={40} y={58} className="xf-lcd-small">{rangeAuto ? "AUTO" : "MANU"}{ac ? "  AC" : "  DC"}{hz ? "  Hz" : ""}</text>
      <text x={40} y={112} className="xf-lcd-small">{reading.rangeLabel.replace("Auto · ", "")}</text>
    </>}
    <Btn id={`${prefix}.range`} x={30} y={140} w={70} label="RANGE" tone="dark" hl={hl} onClick={onRange} />
    {onAc && <Btn id={`${prefix}.ac`} x={115} y={140} w={70} label="AC/DC" tone="dark" active={ac} hl={hl} onClick={onAc} />}
    {onHz && <Btn id={`${prefix}.hz`} x={200} y={140} w={70} label="Hz" tone="dark" active={hz} hl={hl} onClick={onHz} />}
    {!canAc && onAc && <text x={150} y={176} textAnchor="middle" className="xf-sub xf-sub--light">AC/DC nur bei V und A</text>}
    <Rotary id={`${prefix}.switch`} cx={150} cy={278} r={48} positions={positions} index={idx} onSelect={(i) => onPos(positions[i].key)} hl={hl} />
    {jacks.map((j, i) => <Jack key={j.key} id={`${prefix}.jack.${j.key}`} x={45 + i * 70} y={420} r={13} color={j.color} label={j.label} active={j.key === "COM" || j.key === jack} onClick={j.key === "COM" ? undefined : () => onJack(j.key)} hl={hl === `${prefix}.jack` ? `${prefix}.jack.${j.key}` : hl} />)}
  </Panel>;
}

/* ───────── Schaltplan des Aufbaus ───────── */
type Tag = { label: string; color: string };
export function Schematic({ psu, gen }: {
  psu: null | { r: number; on: boolean; tags: Record<"u" | "i" | "r", Tag[]> };
  gen: null | { load: "open" | "50ohm" | "rc"; r: number; c: number; tags: Record<"out" | "c" | "r" | "i", Tag[]> };
}) {
  const badge = (x: number, y: number, tags: Tag[]) => tags.map((t, i) => <g key={i}><circle cx={x} cy={y + i * 26} r={11} fill="#fff" stroke={t.color} strokeWidth={2.5} /><text x={x} y={y + i * 26 + 4} textAnchor="middle" className="xs-badge" style={{ fill: t.color }}>{t.label}</text></g>);
  return <div className="xnts-lab-schematics">
    {psu && <svg viewBox="0 0 380 150" className="xs-svg" role="img" aria-label="Schaltplan Gleichstromkreis">
      <text x={8} y={14} className="xs-title">Gleichstromkreis</text>
      <circle cx={50} cy={80} r={20} className="xs-part" /><text x={50} y={74} textAnchor="middle" className="xs-sym">+</text><text x={50} y={96} textAnchor="middle" className="xs-sym">−</text>
      <text x={50} y={118} textAnchor="middle" className="xs-label">Netzteil</text>
      <path d="M50 60 V30 H300 V60 M300 100 V130 H50 V100" className="xs-wire" />
      {!psu.on && psu.tags.r.length > 0 && <text x={130} y={24} className="xs-label">Netzteil abgeklemmt</text>}
      {psu.tags.i.length > 0 ? <>{badge(170, 30, psu.tags.i)}<text x={170} y={14} textAnchor="middle" className="xs-label">in Reihe</text></> : null}
      <rect x={290} y={60} width={20} height={40} className="xs-part" /><text x={318} y={84} className="xs-label">R = {si(psu.r, "Ω", 3)}</text>
      {psu.tags.u.length > 0 && <><path d="M300 45 H350 M300 115 H350 M350 45 V68 M350 115 V92" className="xs-wire xs-wire--meter" />{badge(350, 80, psu.tags.u)}</>}
      {psu.tags.r.length > 0 && <><path d="M300 45 H350 M300 115 H350" className="xs-wire xs-wire--meter" />{badge(350, 80, psu.tags.r)}</>}
    </svg>}
    {gen && <svg viewBox="0 0 380 150" className="xs-svg" role="img" aria-label="Schaltplan Signalkreis">
      <text x={8} y={14} className="xs-title">Signalkreis</text>
      <circle cx={40} cy={80} r={18} className="xs-part" /><text x={40} y={86} textAnchor="middle" className="xs-sym">~</text>
      <text x={40} y={118} textAnchor="middle" className="xs-label">Generator</text>
      <path d="M40 62 V30 H70 M110 30 H160 M40 98 V130 H330" className="xs-wire" />
      <rect x={70} y={22} width={40} height={16} className="xs-part xs-part--int" /><text x={90} y={50} textAnchor="middle" className="xs-label">Ri 50 Ω</text>
      <circle cx={160} cy={30} r={3.5} className="xs-node" /><text x={160} y={52} textAnchor="middle" className="xs-label">Ausgang</text>
      {gen.load === "50ohm" && <><path d="M160 30 H230 V60 M230 100 V130" className="xs-wire" /><rect x={220} y={60} width={20} height={40} className="xs-part" /><text x={246} y={84} className="xs-label">50 Ω</text></>}
      {gen.load === "rc" && <><path d="M160 30 H200 M240 30 H290 V68 M290 92 V130" className="xs-wire" /><rect x={200} y={22} width={40} height={16} className="xs-part" /><text x={220} y={54} textAnchor="middle" className="xs-label">R {si(gen.r, "Ω", 3)}</text>
        <path d="M276 68 H304 M276 92 H304" className="xs-wire" strokeWidth={3} /><text x={310} y={84} className="xs-label">C {si(gen.c, "F", 3)}</text><circle cx={290} cy={30} r={3.5} className="xs-node" /></>}
      {gen.load === "open" && <text x={180} y={34} className="xs-label">offen</text>}
      {badge(160, 76, gen.tags.out)}
      {gen.load === "rc" && badge(340, 30, gen.tags.c)}
      {gen.load === "rc" && badge(220, 76, gen.tags.r)}
      {gen.tags.i.length > 0 && badge(130, 76 + gen.tags.out.length * 26, gen.tags.i)}
    </svg>}
  </div>;
}

