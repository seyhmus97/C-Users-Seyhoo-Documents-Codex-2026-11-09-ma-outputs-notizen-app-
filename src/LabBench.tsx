// XNTS-Labor: virtuelle Laborgeräte als bedienbare Frontplatten mit geführten Übungen.
// Simulation nach Handbuch-Kenndaten – keine Verbindung zu echten Geräten.
import { useEffect, useMemo, useState } from "react";
import { AGILENT_U1241, GENERATOR, METERS, PEAKTECH_3340, PSU, SCOPE, SCOPE_MODELS, type GenModel, type MeterFn, type MeterSpec, type PsuMode, type ScopeModelId, type Waveform } from "./labDevices";
import {
  autoset, burdenOf, dc, fmtDiv, isDc, maxOf, mean, meterNeeds, minOf, psuDisplay, readMeter, rmsAc, runScope, si, solveGenerator, solvePsu,
  type Coupling, type GenLoad, type GenSettings, type MeterReading, type PsuSettings, type Quantity, type ScopeResult, type ScopeSettings, type Signal,
} from "./labSim";
import { GenFront, MeterFront, PsuFront, Schematic, ScopeFront, genRangeOf, type MeterPos, type ScopeMenu, type SoftKey } from "./LabFronts";
import type { CircuitAnalysis } from "./circuitRecognition";

export type LabRecord = { title: string; lines: string[]; scope: { traces: { color: string; label: string; points: number[] }[]; caption: string } | null };

type DeviceKey = "psu" | "gen" | "scope" | "u1241" | "pt3340";
type MeterKey = "u1241" | "pt3340";
type Jack = "V" | "mA" | "A";
type MeterState = { pos: string; ac: boolean; hz: boolean; range: number | "auto"; jack: Jack; point: string };
type LabState = {
  devices: Record<DeviceKey, boolean>;
  psu: PsuSettings; rLoad: number; pRating: number;
  gen: GenSettings; genRange: number; atten: 0 | 20 | 40; load: "open" | "50ohm" | "rc"; rcR: number; rcC: number;
  scope: ScopeSettings; scopeMenu: ScopeMenu;
  meters: Record<MeterKey, MeterState>;
};
type Point = { id: string; label: string; short: string; kind: Quantity["kind"] };

const DEVICE_LABEL: Record<DeviceKey, string> = { psu: "Netzteil GPS-3303", gen: "Funktionsgenerator TOE 7402/04", scope: "Oszilloskop TDS1000/2000", u1241: "Multimeter U1241A/42A", pt3340: "Multimeter PeakTech 3340" };
const METER_SPEC: Record<MeterKey, MeterSpec> = { u1241: AGILENT_U1241, pt3340: PEAKTECH_3340 };
const CH_COLORS = ["#facc15", "#22d3ee"];
const PAPER_COLORS = ["#b45309", "#2563eb"];
const STORAGE_KEY = "xnts-lab-state-v2";

/* ───── Drehschalter und Buchsen der Multimeter (vereinfacht nach Handbuch) ───── */
const POSITIONS: Record<MeterKey, MeterPos[]> = {
  u1241: [{ key: "OFF", label: "OFF" }, { key: "V", label: "V" }, { key: "OHM", label: "Ω" }, { key: "CAP", label: "⊣⊢" }, { key: "mA", label: "mA" }, { key: "A", label: "A" }],
  pt3340: [{ key: "OFF", label: "OFF" }, { key: "VDC", label: "V⎓" }, { key: "VAC", label: "V~" }, { key: "OHM", label: "Ω" }, { key: "HZ", label: "Hz" }, { key: "CAP", label: "⊣⊢" }, { key: "mADC", label: "mA⎓" }, { key: "mAAC", label: "mA~" }, { key: "ADC", label: "A⎓" }, { key: "AAC", label: "A~" }],
};
const JACKS: Record<MeterKey, { key: string; label: string; color: string }[]> = {
  u1241: [{ key: "A", label: "A", color: "#dc2626" }, { key: "mA", label: "µA mA", color: "#dc2626" }, { key: "COM", label: "COM", color: "#111827" }, { key: "V", label: "V Ω", color: "#dc2626" }],
  pt3340: [{ key: "A", label: "20A", color: "#dc2626" }, { key: "mA", label: "mA", color: "#dc2626" }, { key: "COM", label: "COM", color: "#111827" }, { key: "V", label: "VΩHz", color: "#dc2626" }],
};
const MA_LIMIT: Record<MeterKey, number> = { u1241: 0.44, pt3340: 0.4 };
function fnOf(k: MeterKey, m: MeterState): MeterFn | null {
  const p = m.pos;
  if (p === "OFF") return null;
  if (k === "u1241") {
    if (p === "V") return m.hz ? "HZ" : m.ac ? "VAC" : "VDC";
    if (p === "OHM") return "OHM";
    if (p === "CAP") return "CAP";
    return m.ac ? "AAC" : "ADC";
  }
  return ({ VDC: "VDC", VAC: "VAC", OHM: "OHM", HZ: "HZ", CAP: "CAP", mADC: "ADC", mAAC: "AAC", ADC: "ADC", AAC: "AAC" } as Record<string, MeterFn>)[p] ?? null;
}
const needJack = (k: MeterKey, m: MeterState): Jack => (/^mA/.test(m.pos) ? "mA" : (k === "u1241" ? m.pos === "A" : /^A/.test(m.pos)) ? "A" : "V");
function rangeSubset(k: MeterKey, m: MeterState, fn: MeterFn): number[] {
  const ranges = METER_SPEC[k].functions[fn]!.ranges.map((r, i) => ({ r, i }));
  if (fn !== "ADC" && fn !== "AAC") return ranges.map((x) => x.i);
  const j = needJack(k, m);
  return ranges.filter(({ r }) => (j === "mA" ? r.max <= 0.44 : r.max > 0.44)).map((x) => x.i);
}

const defaultScope = (): ScopeSettings => ({
  model: "TDS2012", sDiv: 500e-6, triggerSource: 0, triggerLevel: 0, triggerSlope: "rise",
  ch: [{ source: null, vDiv: 1, probe: 10, coupling: "DC", position: 0, bwLimit: false }, { source: null, vDiv: 1, probe: 10, coupling: "DC", position: 0, bwLimit: false }],
});
const meterOff = (): MeterState => ({ pos: "OFF", ac: false, hz: false, range: "auto", jack: "V", point: "" });
const defaultState = (): LabState => ({
  devices: { psu: false, gen: false, scope: false, u1241: false, pt3340: false },
  psu: { mode: "independent", vSet: 0, iSet: 0.2, on: false }, rLoad: 220, pRating: 0.5,
  gen: { model: "7404", waveform: "sine", freq: 1000, vpp: 4, offset: 0, symmetry: 0.5 }, genRange: 1000, atten: 0, load: "open", rcR: 1000, rcC: 100e-9,
  scope: defaultScope(), scopeMenu: null,
  meters: { u1241: meterOff(), pt3340: meterOff() },
});
const loadState = (): LabState => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && raw.devices && raw.psu && raw.gen && raw.scope?.ch?.length === 2 && raw.meters?.u1241?.pos) return { ...defaultState(), ...raw, genRange: typeof raw.genRange === "number" ? raw.genRange : genRangeOf(raw.gen.freq) };
  } catch { /* Standardwerte */ }
  return defaultState();
};

/* ───── Simulation des gesamten Aufbaus ───── */
type MeterOut = { fn: MeterFn | null; reading: MeterReading | null; warnings: string[]; auto: boolean };
function simulate(st: LabState) {
  const on = st.devices;
  const points: Point[] = [];
  if (on.psu) points.push({ id: "psu.u", label: "Netzteil · Spannung an R", short: "U an R", kind: "voltage" }, { id: "psu.i", label: "Netzteil · Strom durch R (in Reihe)", short: "I durch R", kind: "current" }, { id: "psu.r", label: "Lastwiderstand R (stromlos)", short: "R", kind: "resistance" });
  if (on.gen) {
    points.push({ id: "gen.out", label: "Generator · Ausgangsklemmen", short: "Gen.-Ausgang", kind: "voltage" });
    if (st.load === "rc") points.push({ id: "gen.c", label: "RC · Spannung an C", short: "U an C", kind: "voltage" }, { id: "gen.r", label: "RC · Spannung an R", short: "U an R", kind: "voltage" }, { id: "gen.i", label: "RC · Strom (in Reihe)", short: "I im RC", kind: "current" }, { id: "gen.R", label: "RC · Widerstand R (ausgebaut)", short: "R", kind: "resistance" }, { id: "gen.C", label: "RC · Kondensator C (ausgebaut)", short: "C", kind: "capacitance" });
    if (st.load === "50ohm") points.push({ id: "gen.i", label: "50-Ω-Last · Strom (in Reihe)", short: "I", kind: "current" });
  }
  const genEff: GenSettings = { ...st.gen, vpp: st.gen.vpp * Math.pow(10, -st.atten / 20) };
  const genLoad: GenLoad = st.load === "rc" ? { kind: "rc", r: st.rcR, c: st.rcC } : { kind: st.load };
  const solve = (ep: number, eg: number) => ({ psu: solvePsu(st.psu, st.rLoad, ep), gen: solveGenerator(genEff, genLoad, eg) });
  const keys = (Object.keys(METER_SPEC) as MeterKey[]).filter((k) => on[k]);
  const pickRange = (k: MeterKey, m: MeterState, fn: MeterFn, mag: number) => {
    const sub = rangeSubset(k, m, fn), rs = METER_SPEC[k].functions[fn]!.ranges;
    if (m.range !== "auto" && sub.includes(m.range)) return { idx: m.range, auto: false };
    return { idx: sub.find((i) => mag <= rs[i].max) ?? sub[sub.length - 1], auto: true };
  };
  const ideal = solve(0, 0);
  let ep = 0, eg = 0;
  for (const k of keys) {
    const m = st.meters[k], fn = fnOf(k, m);
    if (!fn || meterNeeds(fn) !== "current" || m.jack !== needJack(k, m)) continue;
    const sig = m.point === "psu.i" ? dc(ideal.psu.i) : m.point === "gen.i" ? ideal.gen.current : null;
    if (!sig) continue;
    const b = burdenOf(METER_SPEC[k], fn, pickRange(k, m, fn, fn === "ADC" ? Math.abs(mean(sig)) : rmsAc(sig)).idx);
    if (m.point === "psu.i") ep += b; else eg += b;
  }
  const real = solve(ep, eg);
  const q = (id: string): Quantity | null => {
    if (id === "psu.u" && on.psu) return { kind: "voltage", signal: dc(real.psu.uLoad) };
    if (id === "psu.i" && on.psu) return { kind: "current", signal: dc(real.psu.i) };
    if (id === "psu.r" && on.psu) return { kind: "resistance", value: st.rLoad };
    if (!on.gen) return null;
    const g = real.gen;
    if (id === "gen.out") return { kind: "voltage", signal: g.out };
    if (id === "gen.c" && g.cap) return { kind: "voltage", signal: g.cap };
    if (id === "gen.r" && g.res) return { kind: "voltage", signal: g.res };
    if (id === "gen.i" && st.load !== "open") return { kind: "current", signal: g.current };
    if (id === "gen.R" && st.load === "rc") return { kind: "resistance", value: st.rcR };
    if (id === "gen.C" && st.load === "rc") return { kind: "capacitance", value: st.rcC };
    return null;
  };
  const voltageSources: Record<string, Signal> = {};
  for (const p of points) if (p.kind === "voltage") { const x = q(p.id); if (x?.kind === "voltage") voltageSources[p.id] = x.signal; }
  const meters = {} as Record<MeterKey, MeterOut>;
  for (const k of keys) {
    const m = st.meters[k], fn = fnOf(k, m), w: string[] = [];
    if (!fn) { meters[k] = { fn: null, reading: null, warnings: [], auto: true }; continue; }
    let quantity = q(m.point);
    if (quantity && quantity.kind !== meterNeeds(fn)) quantity = null;
    const need = needJack(k, m);
    const zero: Quantity = meterNeeds(fn) === "resistance" ? { kind: "resistance", value: Infinity } : meterNeeds(fn) === "capacitance" ? { kind: "capacitance", value: 0 } : { kind: meterNeeds(fn) as "voltage" | "current", signal: dc(0) };
    if (m.jack !== need) {
      if (need === "V" && m.jack !== "V") w.push(`Rote Messleitung steckt in der ${m.jack}-Buchse! An einer Spannungsquelle wäre das ein Kurzschluss über den Strommesspfad – Sicherung würde auslösen. Leitung in „V“ stecken.`);
      else if (need !== "V" && m.jack === "V") w.push(`Für Strommessung muss die rote Leitung in die ${need === "mA" ? "mA" : "A"}-Buchse – in der V-Buchse fließt kein Strom durchs Messgerät.`);
      else w.push(`Falsche Strombuchse: Drehschalter steht auf ${need}, Leitung steckt in ${m.jack}.`);
      quantity = quantity ? zero : null;
    }
    if (!m.point) w.push("Messleitungen noch nicht angeschlossen");
    if (quantity?.kind === "resistance" && m.point === "psu.r" && st.psu.on) { w.push("Widerstand nur spannungsfrei messen: OUTPUT am Netzteil ausschalten"); quantity = null; }
    if (quantity?.kind === "current" && m.jack === "mA") {
      const mag = fn === "ADC" ? Math.abs(mean(quantity.signal)) : rmsAc(quantity.signal);
      if (mag > MA_LIMIT[k]) { w.push(`Strom ${si(mag, "A", 3)} über ${si(MA_LIMIT[k], "A", 3)}: Die Sicherung im mA-Eingang würde auslösen – A-Buchse und Stellung A benutzen.`); quantity = null; }
    }
    if (meterNeeds(fn) === "current" && quantity && k === "pt3340") w.push("Bürdenwiderstand im Handbuch nicht angegeben – ideal gerechnet");
    const mag = !quantity ? 0 : quantity.kind === "resistance" || quantity.kind === "capacitance" ? Math.abs(quantity.value) : fn === "VDC" || fn === "ADC" ? Math.abs(mean(quantity.signal)) : rmsAc(quantity.signal);
    const { idx, auto } = pickRange(k, m, fn, Number.isFinite(mag) ? mag : 1e12);
    const reading = readMeter(METER_SPEC[k], fn, quantity, idx);
    if (auto) reading.rangeLabel = `Auto · ${reading.rangeLabel}`;
    if (meterNeeds(fn) === "current" && quantity && k === "u1241") { const b = burdenOf(METER_SPEC[k], fn, idx); if (b) w.push(`Strommesser liegt mit ca. ${si(b, "Ω", 2)} Bürde im Stromkreis`); }
    meters[k] = { fn, reading, warnings: [...reading.warnings.filter((x) => !x.startsWith("Messgerät nicht passend")), ...w], auto };
  }
  const scope: ScopeResult | null = on.scope ? runScope(st.scope, voltageSources, CH_COLORS) : null;
  return { ...real, points, meters, voltageSources, scope, ep, eg, genEff };
}
type Sim = ReturnType<typeof simulate>;

/* ───── Geführte Übungen ───── */
type Step = { text: string; target: string | null; done?: (st: LabState, sim: Sim) => boolean };
type Tutorial = { id: string; title: string; goal: string; setup: () => LabState; finish: () => LabState; steps: Step[] };
const base = defaultState;
const cyclesOnScreen = (st: LabState, sim: Sim) => { const s = sim.voltageSources["gen.out"]; return s?.period ? (st.scope.sDiv * 10) / s.period : 0; };
const divHeight = (st: LabState, sim: Sim, ch: number) => { const t = sim.scope?.traces[ch]?.measure; return t ? t.pkpk / st.scope.ch[ch].vDiv : 0; };
const TUTORIALS: Tutorial[] = [
  {
    id: "ohm", title: "Ohmsches Gesetz", goal: "U und I an einem 220-Ω-Widerstand messen und R = U / I bestätigen.",
    setup: () => ({ ...base(), devices: { ...base().devices, psu: true, u1241: true, pt3340: true }, psu: { mode: "independent", vSet: 0, iSet: 0, on: false }, rLoad: 220 }),
    finish: () => ({ ...base(), devices: { ...base().devices, psu: true, u1241: true, pt3340: true }, psu: { mode: "independent", vSet: 10, iSet: 0.2, on: true }, rLoad: 220, meters: { u1241: { ...meterOff(), pos: "V", point: "psu.u" }, pt3340: { ...meterOff(), pos: "mADC", jack: "mA", point: "psu.i" } } }),
    steps: [
      { target: "psu.iknob", text: "Zuerst die Strombegrenzung: CURRENT auf etwa 0,10–0,30 A drehen. Sie schützt Bauteile, falls etwas falsch verdrahtet ist.", done: (s) => s.psu.iSet >= 0.09 && s.psu.iSet <= 0.31 },
      { target: "psu.vknob", text: "VOLTAGE auf 10 V drehen. Regler nach oben ziehen oder Mausrad; mit Umschalttaste fein. Antippen rechts/links geht auch.", done: (s) => Math.abs(s.psu.vSet - 10) <= 0.15 },
      { target: "psu.out", text: "OUTPUT einschalten. Die Lampe C.V. zeigt: Das Netzteil hält die Spannung konstant.", done: (s) => s.psu.on },
      { target: "u1241.switch", text: "Agilent als Voltmeter: Drehschalter auf „V“ stellen (DC ist voreingestellt).", done: (s) => s.meters.u1241.pos === "V" && !s.meters.u1241.ac && !s.meters.u1241.hz },
      { target: "u1241.jack", text: "Rote Messleitung in die Buchse „V Ω“ – die schwarze bleibt immer in COM.", done: (s) => s.meters.u1241.jack === "V" },
      { target: "u1241.leads", text: "Voltmeter parallel zum Widerstand anschließen: „Netzteil · Spannung an R“.", done: (s) => s.meters.u1241.point === "psu.u" },
      { target: "pt3340.switch", text: "PeakTech als Amperemeter: Drehschalter auf „mA⎓“ (Gleichstrom).", done: (s) => s.meters.pt3340.pos === "mADC" },
      { target: "pt3340.jack", text: "Rote Leitung in die mA-Buchse stecken (bis 400 mA abgesichert).", done: (s) => s.meters.pt3340.jack === "mA" },
      { target: "pt3340.leads", text: "Amperemeter in Reihe schalten: „Netzteil · Strom durch R“. Strommesser kommen immer in den Stromkreis, nie parallel!", done: (s) => s.meters.pt3340.point === "psu.i" },
      { target: null, text: "Ablesen: U ≈ 10 V und I ≈ 45 mA → R = U / I ≈ 220 Ω. Die Werte stehen hier im Labor; „In Notiz übernehmen“ fügt nur die Grafik ein." },
    ],
  },
  {
    id: "cc", title: "Strombegrenzung (C.V. / C.C.)", goal: "Sehen, wie das Netzteil von Konstantspannung auf Konstantstrom umschaltet.",
    setup: () => ({ ...base(), devices: { ...base().devices, psu: true, u1241: true }, psu: { mode: "independent", vSet: 0, iSet: 0, on: false }, rLoad: 100, pRating: 2, meters: { ...base().meters, u1241: { ...meterOff(), pos: "V", point: "psu.u" } } }),
    finish: () => ({ ...base(), devices: { ...base().devices, psu: true, u1241: true }, psu: { mode: "independent", vSet: 10, iSet: 0.05, on: true }, rLoad: 100, pRating: 2, meters: { ...base().meters, u1241: { ...meterOff(), pos: "V", point: "psu.u" } } }),
    steps: [
      { target: "psu.vknob", text: "VOLTAGE auf 10 V drehen.", done: (s) => Math.abs(s.psu.vSet - 10) <= 0.15 },
      { target: "psu.iknob", text: "CURRENT auf 0,05 A (50 mA) begrenzen.", done: (s) => s.psu.iSet >= 0.04 && s.psu.iSet <= 0.06 },
      { target: "psu.out", text: "OUTPUT einschalten.", done: (s) => s.psu.on },
      { target: null, text: "C.C. leuchtet rot: 10 V an 100 Ω bräuchten 100 mA, erlaubt sind 50 mA. Das Netzteil senkt die Spannung auf 50 mA · 100 Ω = 5 V – das Multimeter zeigt es." },
      { target: "psu.iknob", text: "CURRENT langsam aufdrehen, bis C.V. grün leuchtet (über 0,10 A).", done: (s, sim) => s.psu.on && sim.psu.regulation === "CV" },
      { target: null, text: "Merke: Die eingestellte Spannung ist eine Obergrenze, der Strom auch. Was gerade begrenzt, zeigen C.V. und C.C." },
    ],
  },
  {
    id: "scope", title: "Signal am Oszilloskop", goal: "Generator einstellen, Signal auf dem Oszilloskop darstellen und vermessen.",
    setup: () => ({ ...base(), devices: { ...base().devices, gen: true, scope: true }, gen: { model: "7404", waveform: "triangle", freq: 50, vpp: 1, offset: 0, symmetry: 0.5 }, genRange: 100, scope: { ...defaultScope(), sDiv: 0.01, ch: [{ ...defaultScope().ch[0], vDiv: 5 }, defaultScope().ch[1]] } }),
    finish: () => { const s = { ...base(), devices: { ...base().devices, gen: true, scope: true }, gen: { model: "7404" as GenModel, waveform: "sine" as Waveform, freq: 1000, vpp: 4, offset: 0, symmetry: 0.5 }, scopeMenu: "measure" as ScopeMenu }; s.scope = { ...defaultScope(), sDiv: 250e-6, ch: [{ ...defaultScope().ch[0], source: "gen.out" }, defaultScope().ch[1]] }; return s; },
    steps: [
      { target: "gen.wave", text: "Am Generator die Kurvenform Sinus (∿) wählen.", done: (s) => s.gen.waveform === "sine" },
      { target: "gen.range", text: "Frequenzbereich „1k“ drücken. Die Skala am FREQUENZ-Regler reicht dann von ×0,05 bis ×5, also 50 Hz bis 5 kHz.", done: (s) => s.genRange === 1000 },
      { target: "gen.freq", text: "FREQUENZ-Regler drehen, bis der Zähler etwa 1,000 kHz zeigt.", done: (s) => Math.abs(s.gen.freq - 1000) <= 30 },
      { target: "gen.amp", text: "AMPLITUDE auf etwa 4 Vss drehen (Wert steht unten auf der Frontplatte).", done: (_s, sim) => sim.genEff.vpp >= 3.6 && sim.genEff.vpp <= 4.4 },
      { target: "scope.bnc0", text: "Tastkopf an CH1 anschließen und an den Generatorausgang klemmen: BNC-Buchse CH1 antippen.", done: (s) => s.scope.ch[0].source === "gen.out" },
      { target: "scope.vdiv0", text: "VOLTS/DIV 1 drehen, bis das Signal 4–7 Kästchen hoch ist.", done: (s, sim) => { const h = divHeight(s, sim, 0); return h >= 3.5 && h <= 7.5; } },
      { target: "scope.sdiv", text: "SEC/DIV drehen, bis 2–5 Perioden auf dem Schirm sind.", done: (s, sim) => { const c = cyclesOnScreen(s, sim); return c >= 2 && c <= 5; } },
      { target: "scope.measure", text: "MEASURE drücken: Frequenz, Uss und Effektivwert erscheinen rechts im Bild.", done: (s) => s.scopeMenu === "measure" },
      { target: null, text: "Kontrolle: Ueff = Uss / (2·√2) ≈ 1,41 V. Tipp für später: AUTOSET erledigt VOLTS/DIV und SEC/DIV auf einen Druck." },
    ],
  },
  {
    id: "rc", title: "RC-Tiefpass", goal: "Lade- und Entladekurve eines Kondensators beobachten und die Grenzfrequenz verstehen.",
    setup: () => { const s = { ...base(), devices: { ...base().devices, gen: true, scope: true }, gen: { model: "7404" as GenModel, waveform: "sine" as Waveform, freq: 1000, vpp: 6, offset: 0, symmetry: 0.5 } }; s.scope = { ...defaultScope(), sDiv: 500e-6, ch: [{ ...defaultScope().ch[0], source: "gen.out", vDiv: 2 }, defaultScope().ch[1]] }; return s; },
    finish: () => { const s = { ...base(), devices: { ...base().devices, gen: true, scope: true }, load: "rc" as const, genRange: 1000, gen: { model: "7404" as GenModel, waveform: "square" as Waveform, freq: 500, vpp: 6, offset: 0, symmetry: 0.5 } }; s.scope = { ...defaultScope(), sDiv: 500e-6, ch: [{ ...defaultScope().ch[0], source: "gen.out" }, { ...defaultScope().ch[1], source: "gen.c" }] }; return s; },
    steps: [
      { target: "gen.wave", text: "Kurvenform Rechteck (⊓⊔) wählen.", done: (s) => s.gen.waveform === "square" },
      { target: "gen.freq", text: "Frequenz auf etwa 500 Hz drehen.", done: (s) => Math.abs(s.gen.freq - 500) <= 25 },
      { target: "circuit.load", text: "Im Schaltplan als Last „RC-Tiefpass“ wählen (R = 1 kΩ, C = 100 nF).", done: (s) => s.load === "rc" },
      { target: "scope.bnc1", text: "Tastkopf CH2 an den Kondensator: BNC CH2 antippen, bis „U an C“ angezeigt wird.", done: (s) => s.scope.ch[1].source === "gen.c" },
      { target: "scope.autoset", text: "AUTOSET drücken – das Oszilloskop stellt sich selbst ein.", done: (s, sim) => { const h = divHeight(s, sim, 1); return h >= 2 && h <= 8 && cyclesOnScreen(s, sim) >= 1; } },
      { target: null, text: "CH2 (cyan) lädt sich mit τ = (R + 50 Ω)·C = 105 µs auf. Nach etwa 5τ ≈ 0,5 ms ist C voll geladen – bei 500 Hz bleibt dafür 1 ms Zeit." },
      { target: "gen.freq", text: "Frequenz auf etwa 5 kHz erhöhen (FREQUENZ-Regler bis zum Anschlag oder Bereich „10k“). Danach AUTOSET drücken.", done: (s) => s.gen.freq >= 4000 },
      { target: null, text: "Jetzt reicht die Zeit nicht zum Laden: CH2 wird ein kleines Dreieck. Grenzfrequenz fg = 1 / (2π·1050 Ω·100 nF) ≈ 1,52 kHz." },
    ],
  },
];

/** Zahl + Einheit (Eingabe mit Komma oder Punkt). */
function QtyInput({ value, onChange, units, label, min = 0 }: { value: number; onChange: (v: number) => void; units: [string, number][]; label: string; min?: number }) {
  const pick = (v: number) => [...units].reverse().find(([, f]) => Math.abs(v) >= f * 0.999) ?? units[0];
  const [unit, setUnit] = useState(() => pick(value));
  const [text, setText] = useState(() => String(+(value / unit[1]).toPrecision(6)).replace(".", ","));
  useEffect(() => {
    const parsed = Number(text.replace(",", ".")) * unit[1];
    if (!Number.isFinite(parsed) || Math.abs(parsed - value) > Math.abs(value) * 1e-9 + 1e-15) { const u = pick(value); setUnit(u); setText(String(+(value / u[1]).toPrecision(6)).replace(".", ",")); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (t: string, u = unit) => { setText(t); const v = Number(t.replace(",", ".")) * u[1]; if (Number.isFinite(v) && v >= min) onChange(v); };
  return <label className="xnts-lab-field"><span>{label}</span><span className="flex gap-1">
    <input inputMode="decimal" value={text} onChange={(e) => commit(e.target.value)} aria-label={label} />
    <select value={unit[0]} aria-label={`${label} Einheit`} onChange={(e) => { const u = units.find((x) => x[0] === e.target.value)!; setUnit(u); commit(text, u); }}>
      {units.map(([n]) => <option key={n} value={n}>{n}</option>)}
    </select></span></label>;
}

const measureText = (m: NonNullable<ScopeResult["traces"][number]>["measure"]) => m ? [
  m.freq !== null ? `f = ${si(m.freq, "Hz", 4)}` : "f = ?", `Uss = ${si(m.pkpk, "V", 3)}`, `Mittel = ${si(m.mean, "V", 3)}`,
  m.rms !== null ? `Ueff = ${si(m.rms, "V", 3)}` : "Ueff = ?", m.clipped ? "übersteuert" : "", m.undersampled ? "Unterabtastung" : "",
].filter(Boolean).join(" · ") : "";

export default function LabBench({ onClose, onInsert, noteCircuit }: { onClose: () => void; onInsert: (r: LabRecord) => void; noteCircuit?: CircuitAnalysis | null }) {
  const [st, setSt] = useState<LabState>(loadState);
  const [wide, setWide] = useState(() => { try { return localStorage.getItem("xnts-lab-wide") === "true"; } catch { return false; } });
  const [tut, setTut] = useState<{ id: string; step: number } | null>(null);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(st)); } catch { /* nur Sitzung */ } }, [st]);
  useEffect(() => { try { localStorage.setItem("xnts-lab-wide", String(wide)); } catch { /* nur Sitzung */ } }, [wide]);
  // Anordnung der Geräte auf der Werkbank (eigener Speicher, der Versuchsaufbau bleibt unverändert):
  // ausblenden = Gerät bleibt eingeschaltet und angeschlossen, verschieben und skalieren pro Gerät
  type Layout = Partial<Record<DeviceKey, { hidden?: boolean; x?: number; y?: number; k?: number }>>;
  const [layout, setLayout] = useState<Layout>(() => { try { const v = JSON.parse(localStorage.getItem("xnts-lab-layout") ?? "{}"); return v && typeof v === "object" ? v as Layout : {}; } catch { return {}; } });
  useEffect(() => { try { localStorage.setItem("xnts-lab-layout", JSON.stringify(layout)); } catch { /* nur Sitzung */ } }, [layout]);
  const lay = (k: DeviceKey) => ({ hidden: false, x: 0, y: 0, k: 1, ...(layout[k] ?? {}) });
  const setLay = (k: DeviceKey, p: { hidden?: boolean; x?: number; y?: number; k?: number }) => setLayout((l) => ({ ...l, [k]: { ...(l[k] ?? {}), ...p } }));
  const shown = (k: DeviceKey) => st.devices[k] && !lay(k).hidden;
  const dragDevice = (k: DeviceKey, mode: "move" | "size") => (e: React.PointerEvent) => {
    if (e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, l0 = lay(k), id = e.pointerId;
    const panel = (e.currentTarget as HTMLElement).closest(".xnts-lab-panel");
    // Ein Gerät darf nicht so weit verschoben werden, dass seine Bedienelemente unerreichbar werden.
    const maxX = Math.max(64, Math.min(220, (panel?.clientWidth ?? 640) * 0.35));
    const maxY = Math.max(80, Math.min(220, (panel?.clientHeight ?? 720) * 0.3));
    const mv = (ev: PointerEvent) => { if (ev.pointerId !== id) return; const dx = ev.clientX - sx, dy = ev.clientY - sy;
      setLay(k, mode === "move" ? { x: Math.round(Math.max(-maxX, Math.min(maxX, l0.x + dx))), y: Math.round(Math.max(-maxY, Math.min(maxY, l0.y + dy))) } : { k: Math.max(0.5, Math.min(2, +(l0.k + (dx + dy) / 600).toFixed(2))) }); };
    const up = (ev: PointerEvent) => { if (ev.pointerId !== id) return; window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };
  const cardStyle = (k: DeviceKey): React.CSSProperties => { const l = lay(k); return { transform: l.x || l.y ? `translate(${l.x}px, ${l.y}px)` : undefined, zoom: l.k !== 1 ? l.k : undefined, position: "relative", zIndex: l.x || l.y ? 3 : undefined }; };
  const cardBar = (k: DeviceKey) => { const l = lay(k); return <div className="xnts-lab-cardbar">
    <span className="xnts-lab-cardbar__grip" onPointerDown={dragDevice(k, "move")} title="Ziehen zum Verschieben" aria-label={`${DEVICE_LABEL[k]} verschieben`}>⠿ {DEVICE_LABEL[k]}</span>
    <button type="button" onClick={() => setLay(k, { k: Math.max(0.5, +(l.k - 0.1).toFixed(2)) })} aria-label="Kleiner" title="Kleiner">−</button>
    <button type="button" onClick={() => setLay(k, { k: 1, x: 0, y: 0 })} title="Größe und Position zurücksetzen">{Math.round(l.k * 100)} %</button>
    <button type="button" onClick={() => setLay(k, { k: Math.min(2, +(l.k + 0.1).toFixed(2)) })} aria-label="Größer" title="Größer">＋</button>
    <button type="button" onClick={() => setLay(k, { hidden: true })} title="Ausblenden – das Gerät bleibt eingeschaltet und angeschlossen" aria-label={`${DEVICE_LABEL[k]} ausblenden`}>–</button>
    <button type="button" onClick={() => { set({ devices: { ...st.devices, [k]: false } }); setLay(k, { hidden: false }); }} title="Vom Labortisch nehmen (ausschalten)" aria-label={`${DEVICE_LABEL[k]} entfernen`}>✕</button>
    <span className="xnts-lab-cardbar__size" onPointerDown={dragDevice(k, "size")} title="Ziehen: größer/kleiner" aria-hidden="true" />
  </div>; };
  const set = (patch: Partial<LabState>) => setSt((s) => ({ ...s, ...patch }));
  const useNoteCircuitAsRc = () => {
    setSt((current) => ({
      ...current,
      devices: { ...current.devices, gen: true, scope: true },
      gen: { ...current.gen, waveform: "square", freq: 1000, vpp: 4, offset: 0 },
      load: "rc", rcR: 1000, rcC: 100e-9,
      scope: { ...current.scope, sDiv: 500e-6, ch: [
        { ...current.scope.ch[0], source: "gen.out" },
        { ...current.scope.ch[1], source: "gen.c" },
      ] },
    }));
    setTut(null);
  };
  const setMeter = (k: MeterKey, patch: Partial<MeterState>) => setSt((s) => ({ ...s, meters: { ...s.meters, [k]: { ...s.meters[k], ...patch } } }));
  const setScope = (patch: Partial<ScopeSettings>) => setSt((s) => ({ ...s, scope: { ...s.scope, ...patch } }));
  const setCh = (i: number, patch: Partial<ScopeSettings["ch"][number]>) => setSt((s) => ({ ...s, scope: { ...s.scope, ch: s.scope.ch.map((c, k) => (k === i ? { ...c, ...patch } : c)) } }));
  const sim = useMemo(() => simulate(st), [st]);
  const on = st.devices;

  /* ───── Übung ───── */
  const tutorial = tut ? TUTORIALS.find((t) => t.id === tut.id)! : null;
  const step = tutorial ? tutorial.steps[tut!.step] : null;
  const stepDone = !!step?.done?.(st, sim);
  const hl = step?.target ?? null;
  useEffect(() => {
    if (!tut || !stepDone) return;
    const t = setTimeout(() => setTut((x) => (x && x.step < tutorial!.steps.length - 1 ? { ...x, step: x.step + 1 } : x)), 700);
    return () => clearTimeout(t);
  }, [tut, stepDone, tutorial]);
  useEffect(() => { // Zielelement in den sichtbaren Bereich holen
    if (!hl) return;
    const el = document.querySelector(`.xnts-lab-panel [data-id="${hl}"], .xnts-lab-panel [data-id^="${hl}."]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hl]);
  const startTutorial = (t: Tutorial) => { setSt(t.setup()); setTut({ id: t.id, step: 0 }); };

  /* ───── Oszilloskop-Menüs ───── */
  const vIds = sim.points.filter((p) => p.kind === "voltage").map((p) => p.id);
  const shortOf = (id: string | null) => (id ? sim.points.find((p) => p.id === id)?.short ?? "—" : "aus");
  const cycleProbe = (i: number) => { const list = [null, ...vIds], cur = list.indexOf(st.scope.ch[i].source); setCh(i, { source: list[(cur + 1) % list.length] }); };
  const softkeys: SoftKey[] = st.scopeMenu === "ch0" || st.scopeMenu === "ch1" ? (() => {
    const i = st.scopeMenu === "ch0" ? 0 : 1, c = st.scope.ch[i];
    return [
      { title: "Kopplung", value: c.coupling, onPress: () => setCh(i, { coupling: (["DC", "AC", "GND"] as Coupling[])[(["DC", "AC", "GND"].indexOf(c.coupling) + 1) % 3] }) },
      { title: "BW-Grenze", value: c.bwLimit ? "20 MHz" : "Aus", onPress: () => setCh(i, { bwLimit: !c.bwLimit }) },
      { title: "Tastkopf", value: `${c.probe}×`, onPress: () => { const probe = c.probe === 10 ? 1 : 10; setCh(i, { probe, vDiv: c.vDiv * (probe / c.probe) }); } },
      { title: "Anschluss", value: shortOf(c.source), onPress: () => cycleProbe(i) },
      { title: "Kanal", value: c.source ? "Ein" : "Aus", onPress: () => setCh(i, { source: c.source ? null : vIds[0] ?? null }) },
    ];
  })() : st.scopeMenu === "trig" ? [
    { title: "Quelle", value: `CH${st.scope.triggerSource + 1}`, onPress: () => setScope({ triggerSource: st.scope.triggerSource === 0 ? 1 : 0 }) },
    { title: "Flanke", value: st.scope.triggerSlope === "rise" ? "steigend" : "fallend", onPress: () => setScope({ triggerSlope: st.scope.triggerSlope === "rise" ? "fall" : "rise" }) },
    { title: "Pegel", value: "auf 50 %", onPress: () => { const s = st.scope.ch[st.scope.triggerSource].source, sig = s ? sim.voltageSources[s] : null; if (sig) setScope({ triggerLevel: isDc(sig) ? sig.samples[0] : (maxOf(sig) + minOf(sig)) / 2 }); } },
    { title: "Modus", value: "Auto" }, { title: "Kopplung", value: "DC" },
  ] : [];
  const tr = sim.scope?.traces ?? [];
  const measureSlots = [
    { title: "CH1 Freq", value: tr[0]?.measure?.freq ? si(tr[0].measure.freq, "Hz", 4) : "?" },
    { title: "CH1 Uss", value: tr[0]?.measure ? si(tr[0].measure.pkpk, "V", 3) : "—" },
    { title: "CH1 Ueff", value: tr[0]?.measure?.rms != null ? si(tr[0].measure.rms, "V", 3) : "?" },
    { title: tr[1] ? "CH2 Uss" : "CH1 Mittel", value: tr[1]?.measure ? si(tr[1].measure.pkpk, "V", 3) : tr[0]?.measure ? si(tr[0].measure.mean, "V", 3) : "—" },
    { title: tr[1] ? "CH2 Ueff" : "CH1 Min", value: tr[1]?.measure?.rms != null ? si(tr[1].measure.rms, "V", 3) : tr[0]?.measure ? si(tr[0].measure.min, "V", 3) : "—" },
  ];

  /* ───── Protokoll ───── */
  const buildRecord = (): LabRecord => {
    const now = new Date();
    const lines: string[] = [`Datum: ${now.toLocaleDateString("de-DE")} ${now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} · Simulation nach Handbuch-Kenndaten, keine echte Messung`];
    if (tutorial) lines.push(`Übung: ${tutorial.title}`);
    if (on.psu) {
      const p = sim.psu;
      lines.push(`Netzteil ${PSU.name} (${PSU.modes[st.psu.mode].label}): Soll ${si(p.vSet, "V", 3)} / max. ${si(p.iSet, "A", 3)} → Anzeige ${psuDisplay(p.u)} V · ${psuDisplay(p.i)} A · ${p.regulation}`);
      const P = p.i * p.i * st.rLoad;
      lines.push(`Last R = ${si(st.rLoad, "Ω", 3)} · P = ${si(P, "W", 3)}${P > st.pRating ? ` (über ${si(st.pRating, "W", 2)} Belastbarkeit!)` : ""}`);
    }
    if (on.gen) {
      const g = sim.gen.limits;
      lines.push(`Funktionsgenerator TOE ${st.gen.model}: ${GENERATOR.waveforms[st.gen.waveform]}${st.gen.waveform !== "dc" ? `, ${si(g.freq, "Hz", 4)}, ${si(g.vpp, "V", 3)}ss (Leerlauf)${st.atten ? `, Abschwächer −${st.atten} dB` : ""}` : ""}, Offset ${si(g.offset, "V", 3)}`);
      lines.push(`Last: ${st.load === "open" ? "offen (nur Messgeräte)" : st.load === "50ohm" ? "50-Ω-Abschluss" : `RC-Tiefpass R = ${si(st.rcR, "Ω", 3)}, C = ${si(st.rcC, "F", 3)}, fg = ${si(sim.gen.fc!, "Hz", 3)}`}`);
    }
    for (const k of ["u1241", "pt3340"] as MeterKey[]) if (on[k]) {
      const o = sim.meters[k], m = st.meters[k], pt = sim.points.find((p) => p.id === m.point);
      if (!o.fn || !o.reading) { lines.push(`${METER_SPEC[k].name}: aus`); continue; }
      const r = o.reading, unit = METER_SPEC[k].functions[o.fn]!.unit;
      lines.push(`${METER_SPEC[k].name} · ${METER_SPEC[k].functions[o.fn]!.label} an „${pt?.label ?? "nicht angeschlossen"}“: ${r.text} ${r.text === "OL" || r.text === "----" ? "" : r.unit}${r.uncertainty !== null ? ` (± ${si(r.uncertainty, unit, 2)})` : ""} · Bereich ${r.rangeLabel}`);
      for (const w of o.warnings) lines.push(`  ⚠ ${w}`);
    }
    let scopeRec: LabRecord["scope"] = null;
    if (on.scope && sim.scope) {
      const caption = st.scope.ch.map((c, i) => (c.source ? `CH${i + 1} ${fmtDiv(c.vDiv, "V")}/div ${c.coupling}` : null)).filter(Boolean).join(" · ") + ` · ${fmtDiv(st.scope.sDiv, "s")}/div`;
      lines.push(`Oszilloskop ${st.scope.model}: ${caption}${sim.scope.triggered ? "" : " · nicht getriggert"}`);
      sim.scope.traces.forEach((t, i) => { if (t?.measure) lines.push(`  CH${i + 1} (${shortOf(st.scope.ch[i].source)}): ${measureText(t.measure)}`); });
      scopeRec = { caption, traces: sim.scope.traces.flatMap((t, i) => (t ? [{ color: PAPER_COLORS[i], label: t.label, points: t.points }] : [])) };
    }
    const title = tutorial?.title ?? ([on.psu && "Gleichstromkreis", on.gen && (st.load === "rc" ? "RC-Tiefpass" : "Signalquelle"), on.scope && "Oszilloskop"].filter(Boolean).join(" · ") || "Messung");
    return { title: `Messprotokoll · ${title}`, lines, scope: scopeRec };
  };

  /* ───── Schaltplan-Markierungen ───── */
  const tagsFor = (pointIds: string[]) => {
    const out: { label: string; color: string }[] = [];
    (["u1241", "pt3340"] as MeterKey[]).forEach((k) => { const o = sim.meters[k]; if (on[k] && o?.fn && pointIds.includes(st.meters[k].point)) out.push({ label: meterNeeds(o.fn) === "current" ? "A" : meterNeeds(o.fn) === "resistance" ? "Ω" : meterNeeds(o.fn) === "capacitance" ? "C" : "V", color: k === "u1241" ? "#b45309" : "#1d4ed8" }); });
    if (on.scope) st.scope.ch.forEach((c, i) => { if (c.source && pointIds.includes(c.source)) out.push({ label: `${i + 1}`, color: i === 0 ? "#a16207" : "#0e7490" }); });
    return out;
  };

  const noDevice = !Object.values(on).some(Boolean);
  const hlClass = (id: string) => (hl === id ? " xnts-lab-hl" : "");
  return (
    <aside className={"xnts-lab-panel" + (wide ? " xnts-lab-panel--wide" : "")} aria-label="Labor">
      <header className="xnts-lab-head">
        <div><strong>Labor</strong><span className="xnts-status xnts-status--prototype">Simulation</span></div>
        <div><button className="xnts-lab-headbtn" aria-pressed={wide} onClick={() => setWide(!wide)}>{wide ? "Schmal" : "Werkbank groß"}</button>
          <button onClick={onClose} aria-label="Labor schließen" className="xnts-lab-close">×</button></div>
      </header>

      {noteCircuit && <section className="xnts-lab-note-circuit" aria-label="Schaltung aus der Notiz">
        <div className="xnts-lab-note-circuit__heading"><strong>Schaltung aus deiner Notiz</strong><span>Skizze erkannt</span></div>
        <p>{noteCircuit.summary}</p>
        <svg viewBox={`${noteCircuit.bounds.x - 8} ${noteCircuit.bounds.y - 8} ${noteCircuit.bounds.width + 16} ${noteCircuit.bounds.height + 16}`} role="img" aria-label="Vorschau der ausgewählten handgezeichneten Schaltung">
          {noteCircuit.paths.map((path) => <polyline key={path.id} points={path.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={path.color.toLowerCase() === "#ffffff" || path.color.toLowerCase() === "white" ? "#253047" : path.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
        </svg>
        {noteCircuit.supportsRc ? <>
          <p className="xnts-lab-note-circuit__hint">Diese Auswahl sieht nach einem einfachen RC-Kreis aus. Ich übernehme die Skizze als RC-Tiefpass-Versuch mit Startwerten (1 kΩ, 100 nF). Beschriftungen und Bauteilwerte aus der Zeichnung werden noch nicht automatisch gelesen – bitte Werte unten prüfen.</p>
          <button type="button" className="xnts-lab-note-circuit__use" onClick={useNoteCircuitAsRc}>Als RC-Versuch verwenden</button>
        </> : <p className="xnts-lab-note-circuit__hint">Die Geometrie wird als Skizze angezeigt. Für diese Schaltung gibt es noch keine passende Simulation; Bauteilbeschriftungen werden nicht ausgelesen.</p>}
      </section>}

      {tutorial && step && <div className="xnts-lab-tutorial" role="status" aria-live="polite">
        <div className="xnts-lab-tutorial__top"><strong>{tutorial.title}</strong><span>Schritt {tut!.step + 1} / {tutorial.steps.length}</span></div>
        <div className="xnts-lab-tutorial__bar"><span style={{ width: `${((tut!.step + (stepDone ? 1 : 0)) / tutorial.steps.length) * 100}%` }} /></div>
        <p>{stepDone && <b className="xnts-lab-ok">✓ </b>}{step.text}</p>
        <div className="xnts-lab-tutorial__actions">
          <button disabled={tut!.step === 0} onClick={() => setTut({ ...tut!, step: tut!.step - 1 })}>Zurück</button>
          {tut!.step < tutorial.steps.length - 1 ? <button className="xnts-lab-next" disabled={!!step.done && !stepDone} onClick={() => setTut({ ...tut!, step: tut!.step + 1 })}>Weiter</button>
            : <button className="xnts-lab-next" onClick={() => setTut(null)}>Übung beenden</button>}
          <button onClick={() => { setSt(tutorial.finish()); setTut(null); }}>Lösung zeigen</button>
          <button onClick={() => setTut(null)}>Abbrechen</button>
        </div>
      </div>}

      {!tutorial && <section className="xnts-lab-section">
        <p className="xnts-lab-note">Bedienbare Nachbildungen deiner Laborgeräte nach den Handbüchern – Frontplatten vereinfacht, keine Verbindung zu echten Geräten. Regler ziehen, Mausrad drehen oder antippen.</p>
        <h3>Übungen</h3>
        <div className="xnts-lab-tutcards">{TUTORIALS.map((t) => <div key={t.id} className="xnts-lab-tutcard">
          <strong>{t.title}</strong><small>{t.goal}</small>
          <div><button className="xnts-lab-next" onClick={() => startTutorial(t)}>▶ Schritt für Schritt</button><button onClick={() => { setSt(t.finish()); }}>Fertig aufbauen</button></div>
        </div>)}</div>
        <h3>Geräte frei wählen</h3>
        <div className="xnts-lab-chips">{(Object.keys(DEVICE_LABEL) as DeviceKey[]).map((k) => { const bg = on[k] && lay(k).hidden;
          return <button key={k} aria-pressed={on[k] && !bg} className={bg ? "is-background" : ""} title={bg ? "Läuft im Hintergrund – antippen zeigt das Gerät wieder" : on[k] ? "Antippen blendet das Gerät aus; es bleibt eingeschaltet und angeschlossen" : "Auf den Labortisch legen"}
            onClick={() => { if (!on[k]) { set({ devices: { ...on, [k]: true } }); setLay(k, { hidden: false }); } else setLay(k, { hidden: !bg }); }}>{DEVICE_LABEL[k]}{bg ? " · im Hintergrund" : ""}</button>; })}</div>
        {noDevice && <p className="xnts-lab-hint">Wähle eine Übung oder ein oder mehrere Geräte.</p>}
      </section>}

      {(on.psu || on.gen) && <section className="xnts-lab-section">
        <h3>Aufbau</h3>
        {on.gen && <div className={"xnts-lab-chips xnts-lab-loads" + hlClass("circuit.load")} data-id="circuit.load">
          <span>Last am Generator:</span>
          {([["open", "offen"], ["50ohm", "50 Ω"], ["rc", "RC-Tiefpass"]] as const).map(([v, l]) => <button key={v} aria-pressed={st.load === v} onClick={() => set({ load: v })}>{l}</button>)}
        </div>}
        <Schematic
          psu={on.psu ? { r: st.rLoad, on: st.psu.on, tags: { u: tagsFor(["psu.u"]), i: tagsFor(["psu.i"]), r: tagsFor(["psu.r"]) } } : null}
          gen={on.gen ? { load: st.load, r: st.rcR, c: st.rcC, tags: { out: tagsFor(["gen.out"]), c: tagsFor(["gen.c", "gen.C"]), r: tagsFor(["gen.r", "gen.R"]), i: tagsFor(["gen.i"]) } } : null} />
        <p className="xnts-lab-hint">Kreise im Schaltplan: V/A/Ω = Multimeter (braun Agilent, blau PeakTech), 1/2 = Oszilloskop-Kanal.</p>
      </section>}

      <div className="xnts-lab-bench">
        {shown("psu") && <section className="xnts-lab-section xnts-lab-device" style={cardStyle("psu")}>{cardBar("psu")}
          <PsuFront s={st.psu} r={sim.psu} hl={hl} set={(p) => setSt((s) => ({ ...s, psu: { ...s.psu, ...p } }))} />
          <ul className="xnts-lab-warn">
            {sim.psu.regulation === "CC" && <li>Strombegrenzung aktiv (C.C.): Die Spannung bricht auf I·R = {si(sim.psu.u, "V", 3)} ein</li>}
            {sim.psu.i ** 2 * st.rLoad > st.pRating && <li>Widerstand überlastet: P = {si(sim.psu.i ** 2 * st.rLoad, "W", 3)} &gt; {si(st.pRating, "W", 2)}</li>}
            {sim.psu.overload && <li>CH3 überlastet</li>}
            {sim.ep > 0 && <li>Strommesser im Kreis: +{si(sim.ep, "Ω", 2)} Bürde</li>}
          </ul>
          <details className="xnts-lab-fine"><summary>Werte eintippen</summary><div className="xnts-lab-grid">
            <label className="xnts-lab-field"><span>Betriebsart</span><select value={st.psu.mode} onChange={(e) => set({ psu: { ...st.psu, mode: e.target.value as PsuMode } })}>{(Object.keys(PSU.modes) as PsuMode[]).map((m) => <option key={m} value={m}>{PSU.modes[m].label}</option>)}</select></label>
            <QtyInput label={`Spannung (max. ${PSU.modes[st.psu.mode].vMax} V)`} value={st.psu.vSet} onChange={(v) => set({ psu: { ...st.psu, vSet: v } })} units={[["mV", 1e-3], ["V", 1]]} />
            <QtyInput label={`Strombegrenzung (max. ${PSU.modes[st.psu.mode].iMax} A)`} value={st.psu.iSet} onChange={(v) => set({ psu: { ...st.psu, iSet: v } })} units={[["mA", 1e-3], ["A", 1]]} />
            <QtyInput label="Lastwiderstand R" value={st.rLoad} onChange={(v) => set({ rLoad: v })} units={[["Ω", 1], ["kΩ", 1e3], ["MΩ", 1e6]]} />
            <QtyInput label="Belastbarkeit R" value={st.pRating} onChange={(v) => set({ pRating: v })} units={[["mW", 1e-3], ["W", 1]]} />
          </div></details>
        </section>}

        {shown("gen") && <section className="xnts-lab-section xnts-lab-device" style={cardStyle("gen")}>{cardBar("gen")}
          <GenFront model={st.gen.model} wave={st.gen.waveform} freq={st.gen.freq} range={st.genRange} vpp={st.gen.vpp} offset={st.gen.offset} symmetry={st.gen.symmetry} atten={st.atten}
            counter={st.gen.waveform === "dc" ? "----" : si(sim.gen.limits.freq, "Hz", 4)} hl={hl}
            set={(p) => setSt((s) => ({ ...s, atten: p.atten ?? s.atten, genRange: p.range ?? s.genRange, gen: { ...s.gen, ...(p.waveform ? { waveform: p.waveform } : {}), ...(p.freq !== undefined ? { freq: p.freq } : {}), ...(p.vpp !== undefined ? { vpp: p.vpp } : {}), ...(p.offset !== undefined ? { offset: p.offset } : {}), ...(p.symmetry !== undefined ? { symmetry: p.symmetry } : {}) } }))} />
          <ul className="xnts-lab-warn">{sim.gen.limits.warnings.map((w) => <li key={w}>{w}</li>)}{sim.eg > 0 && <li>Strommesser im Kreis: +{si(sim.eg, "Ω", 2)} Bürde</li>}</ul>
          {st.load === "rc" && sim.gen.fc && <p className="xnts-lab-hint">Grenzfrequenz mit 50-Ω-Innenwiderstand: f<sub>g</sub> = 1 / (2π·(R+50 Ω)·C) = {si(sim.gen.fc, "Hz", 3)}</p>}
          <details className="xnts-lab-fine"><summary>Werte eintippen</summary><div className="xnts-lab-grid">
            <label className="xnts-lab-field"><span>Modell</span><select value={st.gen.model} onChange={(e) => set({ gen: { ...st.gen, model: e.target.value as GenModel } })}><option value="7402">TOE 7402</option><option value="7404">TOE 7404 (Symmetrie)</option></select></label>
            <QtyInput label="Frequenz" value={st.gen.freq} onChange={(v) => set({ gen: { ...st.gen, freq: v }, genRange: v >= st.genRange * 0.05 && v <= st.genRange * 5 ? st.genRange : genRangeOf(v) })} units={[["Hz", 1], ["kHz", 1e3], ["MHz", 1e6]]} />
            <QtyInput label="Amplitude Uss (vor Abschwächer)" value={st.gen.vpp} onChange={(v) => set({ gen: { ...st.gen, vpp: v } })} units={[["mV", 1e-3], ["V", 1]]} />
            <QtyInput label="DC-Offset" value={st.gen.offset} min={-10} onChange={(v) => set({ gen: { ...st.gen, offset: v } })} units={[["mV", 1e-3], ["V", 1]]} />
            {st.load === "rc" && <><QtyInput label="R" value={st.rcR} onChange={(v) => set({ rcR: v })} units={[["Ω", 1], ["kΩ", 1e3], ["MΩ", 1e6]]} />
              <QtyInput label="C" value={st.rcC} onChange={(v) => set({ rcC: v })} units={[["pF", 1e-12], ["nF", 1e-9], ["µF", 1e-6]]} /></>}
          </div></details>
        </section>}

        {shown("scope") && <section className="xnts-lab-section xnts-lab-device xnts-lab-device--scope" style={cardStyle("scope")}>{cardBar("scope")}
          <ScopeFront st={st.scope} res={sim.scope} menu={st.scopeMenu} softkeys={softkeys} measureSlots={measureSlots} colors={CH_COLORS} hl={hl}
            set={setScope} setCh={setCh} onMenu={(m) => set({ scopeMenu: m })} onAutoset={() => set({ scope: autoset(st.scope, sim.voltageSources) })}
            onDefault={() => set({ scope: { ...defaultScope(), model: st.scope.model, ch: defaultScope().ch.map((c, i) => ({ ...c, source: st.scope.ch[i].source })) }, scopeMenu: null })}
            onProbe={cycleProbe} probeLabels={st.scope.ch.map((c) => (c.source ? sim.points.find((p) => p.id === c.source)?.label ?? "—" : "nicht angeschlossen"))} />
          {!on.gen && !on.psu && <p className="xnts-lab-hint">Das Oszilloskop braucht eine Quelle: Funktionsgenerator oder Netzteil dazunehmen.</p>}
          {sim.scope?.traces.some((t) => t?.measure?.undersampled) && <ul className="xnts-lab-warn"><li>Unterabtastung (Aliasing): SEC/DIV verkleinern</li></ul>}
          {sim.scope?.traces.some((t) => t?.measure?.clipped) && <ul className="xnts-lab-warn"><li>Signal läuft aus dem Bild: VOLTS/DIV vergrößern oder Position ändern</li></ul>}
          <details className="xnts-lab-fine"><summary>Modell und Werte</summary><div className="xnts-lab-grid">
            <label className="xnts-lab-field"><span>Modell</span><select value={st.scope.model} onChange={(e) => setScope({ model: e.target.value as ScopeModelId })}>{(Object.keys(SCOPE_MODELS) as ScopeModelId[]).map((m) => <option key={m} value={m}>{m} · {SCOPE_MODELS[m].bandwidth / 1e6} MHz</option>)}</select></label>
            <QtyInput label="Trigger-Pegel" value={st.scope.triggerLevel} min={-1000} onChange={(v) => setScope({ triggerLevel: v })} units={[["mV", 1e-3], ["V", 1]]} />
          </div></details>
        </section>}

        {(["u1241", "pt3340"] as MeterKey[]).filter((k) => shown(k)).map((k) => {
          const m = st.meters[k], o = sim.meters[k], fn = o?.fn ?? null;
          const usable = fn ? sim.points.filter((p) => p.kind === meterNeeds(fn)) : [];
          const canAc = k === "u1241" && ["V", "mA", "A"].includes(m.pos);
          const subset = fn ? rangeSubset(k, m, fn) : [];
          return <section key={k} className="xnts-lab-section xnts-lab-device xnts-lab-device--meter" style={cardStyle(k)}>{cardBar(k)}
            <MeterFront spec={METER_SPEC[k]} positions={POSITIONS[k]} pos={m.pos} reading={o?.reading ?? null} jack={m.jack} jacks={JACKS[k]} ac={!!fn && (fn === "VAC" || fn === "AAC")} hz={fn === "HZ"}
              rangeAuto={o?.auto ?? true} canAc={canAc} hl={hl} prefix={k} body={k === "u1241" ? "#3f4650" : "#35506b"}
              onPos={(p) => setMeter(k, { pos: p, range: "auto", hz: false })}
              onJack={(j) => setMeter(k, { jack: j as Jack })}
              onRange={() => { if (!fn) return; const cur = m.range === "auto" ? -1 : subset.indexOf(m.range); const next = cur + 1 >= subset.length ? "auto" : subset[cur + 1]; setMeter(k, { range: next }); }}
              onAc={k === "u1241" ? () => { if (canAc) setMeter(k, { ac: !m.ac, hz: false, range: "auto" }); } : undefined}
              onHz={k === "u1241" ? () => { if (m.pos === "V") setMeter(k, { hz: !m.hz, range: "auto" }); } : undefined} />
            <label className={"xnts-lab-field xnts-lab-leads" + hlClass(`${k}.leads`)} data-id={`${k}.leads`}><span>Messleitungen angeschlossen an</span>
              <select value={usable.some((p) => p.id === m.point) ? m.point : ""} onChange={(e) => setMeter(k, { point: e.target.value })} disabled={!fn}>
                <option value="" disabled>{!fn ? "Gerät ist aus" : usable.length ? "Messpunkt wählen" : "kein passender Messpunkt"}</option>
                {usable.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
            {o?.reading && o.reading.uncertainty !== null && <p className="xnts-lab-hint">Messunsicherheit laut Handbuch: ± {si(o.reading.uncertainty, METER_SPEC[k].functions[fn!]!.unit, 2)}</p>}
            <ul className="xnts-lab-warn">{o?.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </section>;
        })}
      </div>

      <footer className="xnts-lab-foot">
        <button className="xnts-lab-primary" disabled={noDevice} onClick={() => onInsert(buildRecord())}>In Notiz übernehmen</button>
        <small>{on.scope ? "Fügt nur die Grafik (Oszillogramm) ohne Protokolltext an einer freien Stelle ein · Rückgängig mit Strg+Z" : "Übernommen wird nur die Grafik – dafür das Oszilloskop einschalten"}</small>
        {tutorial && <button className="xnts-lab-linkbtn" onClick={() => setTut(null)}>Übung verlassen</button>}
        <details><summary>Gerätedaten aus den Handbüchern</summary><ul>
          {[...PSU.notes.map((n) => `Netzteil: ${n}`), ...GENERATOR.notes.map((n) => `Generator: ${n}`), ...SCOPE.notes.map((n) => `Oszilloskop: ${n}`), ...METERS.flatMap((m) => m.notes.map((n) => `${m.short}: ${n}`)), "Frontplatten sind vereinfachte Zeichnungen; Anordnung kann vom echten Gerät abweichen."].map((n) => <li key={n}>{n}</li>)}
        </ul></details>
      </footer>
    </aside>
  );
}
