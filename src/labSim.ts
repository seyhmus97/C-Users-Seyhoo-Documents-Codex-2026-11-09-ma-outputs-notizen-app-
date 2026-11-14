// Rechenkern der XNTS-Laborsimulation: Stromkreise erzeugen Messgrößen, Messgeräte beobachten sie.
// Vereinfachungen: ideale Leitungen, Messgeräte-Eingangswiderstände (1 MΩ / 10 MΩ) werden vernachlässigt,
// lineare Bauteile, eingeschwungener (periodischer) Zustand.
import { GENERATOR, PSU, SCOPE, type GenModel, type MeterFn, type MeterSpec, type PsuMode, type ScopeModelId, SCOPE_MODELS, type Waveform } from "./labDevices";

export const N = 1024; // Abtastwerte je Periode

/** Periodisches Signal (eine Periode) oder Gleichgröße (period = null, samples[0]). */
export type Signal = { period: number | null; samples: number[] };
export const dc = (v: number): Signal => ({ period: null, samples: [v] });
export const isDc = (s: Signal) => s.period === null;
export const mean = (s: Signal) => s.samples.reduce((a, b) => a + b, 0) / s.samples.length;
export const rmsAc = (s: Signal) => { const m = mean(s); return Math.sqrt(s.samples.reduce((a, b) => a + (b - m) ** 2, 0) / s.samples.length); };
export const rmsTotal = (s: Signal) => Math.sqrt(s.samples.reduce((a, b) => a + b * b, 0) / s.samples.length);
export const minOf = (s: Signal) => Math.min(...s.samples);
export const maxOf = (s: Signal) => Math.max(...s.samples);
const mapSig = (s: Signal, f: (v: number, i: number) => number): Signal => ({ period: s.period, samples: s.samples.map(f) });
const combine = (a: Signal, b: Signal, f: (x: number, y: number) => number): Signal => {
  if (isDc(a) && isDc(b)) return dc(f(a.samples[0], b.samples[0]));
  const p = a.period ?? b.period, A = isDc(a) ? Array(N).fill(a.samples[0]) : a.samples, B = isDc(b) ? Array(N).fill(b.samples[0]) : b.samples;
  return { period: p, samples: A.map((x: number, i: number) => f(x, B[i])) };
};

/* ───────── Netzteil GPS-3303 ───────── */
export type PsuSettings = { mode: PsuMode; vSet: number; iSet: number; on: boolean };
export type PsuResult = { u: number; i: number; uLoad: number; regulation: "CV" | "CC" | "AUS"; overload: boolean; vSet: number; iSet: number; clamped: boolean };
export function solvePsu(s: PsuSettings, rLoad: number, rExtra = 0): PsuResult {
  const lim = PSU.modes[s.mode];
  const fixed = s.mode === "fixed5";
  const vSet = fixed ? 5 : Math.min(Math.max(s.vSet, 0), lim.vMax);
  const iSet = fixed ? lim.iMax : Math.min(Math.max(s.iSet, 0), lim.iMax);
  const clamped = !fixed && (vSet !== s.vSet || iSet !== s.iSet);
  if (!s.on) return { u: 0, i: 0, uLoad: 0, regulation: "AUS", overload: false, vSet, iSet, clamped };
  const rt = Math.max(0, rLoad) + Math.max(0, rExtra);
  const need = rt === 0 ? Infinity : vSet / rt;
  if (need <= iSet) return { u: vSet, i: need, uLoad: need * rLoad, regulation: "CV", overload: false, vSet, iSet, clamped };
  const i = iSet; // Konstantstrom: Spannung bricht auf I·R ein
  return { u: i * rt, i, uLoad: i * rLoad, regulation: "CC", overload: fixed, vSet, iSet, clamped };
}
/** 3-stellige LED-Anzeige des GPS-3303. */
export const psuDisplay = (v: number, digits = 3) => { const d = v >= 10 ? 1 : 2; const t = v.toFixed(d); return t.replace(".", ",").slice(0, digits + 1); };

/* ───────── Funktionsgenerator TOE 7402/7404 ───────── */
export type GenSettings = { model: GenModel; waveform: Waveform; freq: number; vpp: number; offset: number; symmetry: number };
export type GenLimits = { freq: number; vpp: number; offset: number; symmetry: number; warnings: string[] };
export function limitGen(s: GenSettings): GenLimits {
  const w: string[] = [];
  const fMin = GENERATOR.fMin[s.model];
  const freq = Math.min(Math.max(s.freq, fMin), GENERATOR.fMax);
  if (freq !== s.freq) w.push(`Frequenz auf ${s.model === "7402" ? "0,5 Hz" : "0,05 Hz"} … 5 MHz begrenzt`);
  const vMax = s.waveform === "pulse" ? GENERATOR.vppMaxPulse : GENERATOR.vppMax;
  const vpp = Math.min(Math.max(s.vpp, GENERATOR.vppMin), vMax);
  if (vpp !== s.vpp) w.push(`Amplitude auf ${GENERATOR.vppMin * 1000} mV … ${vMax} Vss begrenzt`);
  const offset = Math.min(Math.max(s.offset, -GENERATOR.offsetMax), GENERATOR.offsetMax);
  if (offset !== s.offset) w.push("DC-Offset auf ±10 V begrenzt");
  let symmetry = 0.5;
  if (s.model === "7404") symmetry = Math.min(Math.max(s.symmetry, GENERATOR.symmetryRange[0]), GENERATOR.symmetryRange[1]);
  return { freq, vpp, offset, symmetry, warnings: w };
}
/** Leerlaufspannung des Generators (vor dem 50-Ω-Innenwiderstand). */
export function generatorOpen(s: GenSettings): { signal: Signal; limits: GenLimits; clipped: boolean } {
  const L = limitGen(s);
  if (s.waveform === "dc") {
    const v = L.offset;
    return { signal: dc(v), limits: L, clipped: false };
  }
  const T = 1 / L.freq, a = L.vpp / 2, sym = L.symmetry;
  let clipped = false;
  const lim = GENERATOR.outputLimit;
  const samples = Array.from({ length: N }, (_, i) => {
    const x = i / N; // Phase 0..1
    let v: number;
    switch (s.waveform) {
      case "sine": v = a * Math.sin(2 * Math.PI * x); break;
      case "triangle": v = x < sym ? -a + (2 * a * x) / sym : a - (2 * a * (x - sym)) / (1 - sym); break;
      case "square": v = x < sym ? a : -a; break;
      case "pulse": v = x < sym ? 2 * a : 0; break; // unipolar von 0 bis Uss (angenommen)
      default: v = 0;
    }
    v += L.offset;
    if (v > lim || v < -lim) { clipped = true; v = Math.max(-lim, Math.min(lim, v)); }
    return v;
  });
  if (clipped) L.warnings.push("Ausgang begrenzt: Spitze + Offset über ±15 V");
  return { signal: { period: T, samples }, limits: L, clipped };
}

/** Periodischer Tiefpass 1. Ordnung (eingeschwungen), Halteglied-Diskretisierung. */
export function lowpassPeriodic(sig: Signal, tau: number): Signal {
  if (isDc(sig) || tau <= 0) return sig;
  const T = sig.period!, dt = T / N, a = Math.exp(-dt / tau), u = sig.samples;
  const run = (v0: number) => { const out = new Array<number>(N); let v = v0; for (let i = 0; i < N; i++) { out[i] = v; v = u[i] + (v - u[i]) * a; } return { out, end: v }; };
  const A = Math.pow(a, N);
  const first = run(0);
  const v0 = 1 - A > 1e-12 ? first.end / (1 - A) : mean(sig);
  return { period: T, samples: run(v0).out };
}

export type GenLoad = { kind: "open" } | { kind: "50ohm" } | { kind: "rc"; r: number; c: number };
export type GenCircuit = { out: Signal; cap?: Signal; res?: Signal; current: Signal; open: Signal; limits: GenLimits; clipped: boolean; tau?: number; fc?: number };
export function solveGenerator(s: GenSettings, load: GenLoad, rExtra = 0): GenCircuit {
  const { signal: vs, limits, clipped } = generatorOpen(s);
  const ri = GENERATOR.ri + rExtra;
  if (load.kind === "open") return { out: vs, current: mapSig(vs, () => 0), open: vs, limits, clipped };
  if (load.kind === "50ohm") {
    const k = 50 / (50 + ri);
    return { out: mapSig(vs, (v) => v * k), current: mapSig(vs, (v) => v / (50 + ri)), open: vs, limits, clipped };
  }
  const rt = ri + load.r, tau = rt * load.c;
  const cap = isDc(vs) ? vs : lowpassPeriodic(vs, tau); // bei DC: Kondensator voll geladen
  const current = combine(vs, cap, (v, c) => (v - c) / rt);
  const out = combine(vs, current, (v, i) => v - GENERATOR.ri * i);
  const res = combine(current, current, (i) => i * load.r);
  return { out, cap, res, current, open: vs, limits, clipped, tau, fc: 1 / (2 * Math.PI * tau) };
}

/* ───────── Multimeter ───────── */
export type Quantity = { kind: "voltage" | "current"; signal: Signal } | { kind: "resistance"; value: number } | { kind: "capacitance"; value: number };
export type MeterReading = {
  text: string; // LCD-Anzeige
  value: number | null;
  unit: string;
  rangeIndex: number;
  rangeLabel: string;
  uncertainty: number | null;
  overload: boolean;
  warnings: string[];
};
const FN_KIND: Record<MeterFn, Quantity["kind"]> = { VDC: "voltage", VAC: "voltage", ADC: "current", AAC: "current", OHM: "resistance", CAP: "capacitance", HZ: "voltage" };
export const meterNeeds = (fn: MeterFn) => FN_KIND[fn];

const PREFIX: [number, string][] = [[1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
/** Wählt den Präfix so, dass der Bereichsendwert als Zahl ≥ 1 erscheint (wie auf dem LCD). */
export function rangePrefix(max: number, res?: number): [number, string] {
  // wie am LCD: größter Präfix, bei dem der Endwert ≥ 1 ist und höchstens 3 Nachkommastellen nötig sind
  for (const [f, p] of PREFIX) if (max >= f * 0.999 && (res === undefined || Math.round(-Math.log10(res / f)) <= 3)) return [f, p];
  return [1e-12, "p"];
}
export const formatRange = (max: number, unit: string, res?: number) => { const [f, p] = rangePrefix(max, res); return `${fmtNum(max / f)} ${p}${unit}`; };
export function fmtNum(v: number, decimals?: number) {
  const s = decimals === undefined ? String(Math.round(v * 1e6) / 1e6) : v.toFixed(decimals);
  return s.replace(".", ",");
}
/** Messwert mit sinnvollem SI-Präfix, z. B. 1,234 kHz. */
export function si(v: number, unit: string, digits = 4) {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) < 1e-12) return `0 ${unit}`; // Rundungsrest statt „-0,0001 pV“
  const a = Math.abs(v);
  let [f, p] = PREFIX.find(([x]) => a >= x * 0.9995) ?? [1e-12, "p"];
  if (unit === "%" || unit === "°") { f = 1; p = ""; }
  const x = v / f, dec = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(x) || 1)));
  return `${x.toFixed(Math.min(dec, 6)).replace(".", ",")} ${p}${unit}`;
}

export function chooseRange(spec: MeterSpec, fn: MeterFn, magnitude: number, manual: number | "auto"): number {
  const f = spec.functions[fn]!;
  if (manual !== "auto") return Math.min(manual, f.ranges.length - 1);
  const i = f.ranges.findIndex((r) => magnitude <= r.max);
  return i < 0 ? f.ranges.length - 1 : i;
}
export const burdenOf = (spec: MeterSpec, fn: MeterFn, rangeIndex: number) => spec.functions[fn]?.ranges[rangeIndex]?.burden ?? 0;

export function readMeter(spec: MeterSpec, fn: MeterFn, q: Quantity | null, manual: number | "auto"): MeterReading {
  const f = spec.functions[fn]!;
  const warnings: string[] = [];
  const base = (ri: number) => ({ unit: f.unit, rangeIndex: ri, rangeLabel: (manual === "auto" ? "Auto · " : "") + formatRange(f.ranges[ri].max, f.unit, f.ranges[ri].res) });
  if (!q || q.kind !== FN_KIND[fn]) return { text: "----", value: null, uncertainty: null, overload: false, warnings: ["Messgerät nicht passend angeschlossen"], ...base(0) };

  let value: number | null = null, freq: number | null = null;
  if (q.kind === "resistance" || q.kind === "capacitance") value = q.value;
  else {
    const s = q.signal;
    freq = s.period ? 1 / s.period : null;
    if (fn === "VDC" || fn === "ADC") value = mean(s);
    else if (fn === "VAC" || fn === "AAC") {
      value = rmsAc(s);
      if (spec.trueRms === null && !isDc(s)) warnings.push("Handbuch nennt kein True RMS – bei Nicht-Sinus kann das echte Gerät abweichen");
    } else if (fn === "HZ") {
      const rms = rmsAc(s);
      const sens = spec.hzSensitivity(rms <= 1 ? 1 : rms <= 10 ? 10 : rms <= 100 ? 100 : 1000);
      if (!freq || rms < sens) { warnings.push(`Frequenz nicht messbar (Signal unter ${si(sens, "V")} eff. oder Gleichgröße)`); return { text: "0,00", value: null, uncertainty: null, overload: false, warnings, ...base(0) }; }
      value = freq;
    }
  }
  if (value === null) return { text: "----", value: null, uncertainty: null, overload: false, warnings, ...base(0) };
  const ri = chooseRange(spec, fn, Math.abs(value), manual);
  const range = f.ranges[ri];
  const maxCounts = Math.min(Math.round(range.max / range.res), spec.counts);
  const counts = Math.round(Math.abs(value) / range.res);
  const [pf, pre] = rangePrefix(range.max, range.res);
  const decimals = Math.max(0, Math.round(-Math.log10(range.res / pf)));
  if (counts > maxCounts) {
    if (manual === "auto" && ri === f.ranges.length - 1) warnings.push("Messwert über dem größten Bereich – am echten Gerät Gefahr!");
    return { text: "OL", value, uncertainty: null, overload: true, warnings, unit: pre + f.unit, rangeIndex: ri, rangeLabel: base(ri).rangeLabel };
  }
  let acc = range.acc;
  if ((fn === "VAC" || fn === "AAC") && freq !== null) {
    const a = f.accAt?.(freq) ?? (f.band && freq >= f.band[0] && freq <= f.band[1] ? range.acc : null);
    if (!a) warnings.push(`Frequenz ${si(freq, "Hz")} außerhalb der Spezifikation (${si(f.band![0], "Hz")} – ${si(f.band![1], "Hz")}): Anzeige am echten Gerät unzuverlässig`);
    else acc = a;
  }
  const shown = (Math.sign(value) * counts * range.res) / pf;
  const uncertainty = (acc[0] / 100) * Math.abs(value) + acc[1] * range.res;
  return { text: fmtNum(shown, decimals), value, uncertainty, overload: false, warnings, unit: pre + f.unit, rangeIndex: ri, rangeLabel: base(ri).rangeLabel };
}

/* ───────── Oszilloskop TDS1000/2000 ───────── */
export type Coupling = "DC" | "AC" | "GND";
export type ScopeChannel = { source: string | null; vDiv: number; probe: 1 | 10; coupling: Coupling; position: number; bwLimit: boolean };
export type ScopeSettings = { model: ScopeModelId; sDiv: number; triggerSource: 0 | 1; triggerLevel: number; triggerSlope: "rise" | "fall"; ch: ScopeChannel[] };
export type ScopeMeasure = { freq: number | null; period: number | null; mean: number; pkpk: number; rms: number | null; min: number; max: number; clipped: boolean; undersampled: boolean };
export type ScopeTrace = { points: number[]; measure: ScopeMeasure | null; color: string; label: string };
export type ScopeResult = { traces: (ScopeTrace | null)[]; triggered: boolean; t0: number };

const sampleAt = (s: Signal, t: number) => {
  if (isDc(s)) return s.samples[0];
  const T = s.period!, ph = (((t % T) + T) % T) / T * N, i = Math.floor(ph), fr = ph - i;
  return s.samples[i % N] * (1 - fr) + s.samples[(i + 1) % N] * fr;
};
export function channelSignal(sig: Signal, ch: ScopeChannel, model: ScopeModelId): Signal {
  if (ch.coupling === "GND") return dc(0);
  let s = sig;
  if (ch.coupling === "AC") {
    const m = mean(s);
    s = isDc(s) ? dc(0) : mapSig(s, (v) => v - m);
    if (!isDc(s) && 1 / s.period! < SCOPE.acLowCut) s = lowpassHighpassApprox(s, SCOPE.acLowCut);
  }
  const bw = Math.min(SCOPE_MODELS[model].bandwidth, ch.probe === 1 ? SCOPE.probe1xBandwidth : Infinity, ch.bwLimit ? SCOPE.bwLimit : Infinity);
  return lowpassPeriodic(s, 1 / (2 * Math.PI * bw));
}
/** AC-Kopplung unterhalb ~10 Hz: Hochpass 1. Ordnung (Signal minus Tiefpassanteil). */
function lowpassHighpassApprox(s: Signal, fc: number): Signal {
  const lp = lowpassPeriodic(s, 1 / (2 * Math.PI * fc));
  return combine(s, lp, (a, b) => a - b);
}

export function findTrigger(s: Signal, level: number, slope: "rise" | "fall"): number | null {
  if (isDc(s)) return null;
  const T = s.period!, x = s.samples;
  for (let i = 0; i < N; i++) {
    const a = x[i], b = x[(i + 1) % N];
    if (slope === "rise" ? a < level && b >= level : a > level && b <= level) return ((i + (level - a) / (b - a || 1)) / N) * T;
  }
  return null;
}

export function runScope(settings: ScopeSettings, sources: Record<string, Signal>, colors: string[]): ScopeResult {
  const sigs = settings.ch.map((ch) => (ch.source && sources[ch.source] ? channelSignal(sources[ch.source], ch, settings.model) : null));
  const trig = sigs[settings.triggerSource] ?? sigs.find(Boolean) ?? null;
  const t0 = trig ? findTrigger(trig, settings.triggerLevel, settings.triggerSlope) : null;
  const triggered = t0 !== null;
  const span = SCOPE.divX * settings.sDiv, M = SCOPE.recordLength;
  const traces = sigs.map((s, k) => {
    if (!s) return null;
    const ch = settings.ch[k];
    const start = (t0 ?? 0) - span / 2;
    const raw = Array.from({ length: M }, (_, i) => sampleAt(s, start + (i / (M - 1)) * span));
    const points = raw.map((v) => v / ch.vDiv + ch.position); // in Teilungen, 0 = Bildmitte
    const clipped = points.some((p) => p > SCOPE.divY / 2 || p < -SCOPE.divY / 2);
    const T = s.period;
    const cycles = T ? span / T : 0;
    const undersampled = !!T && T / (span / M) < 2;
    const mn = Math.min(...raw), mx = Math.max(...raw), avg = raw.reduce((a, b) => a + b, 0) / M;
    let rms: number | null = null;
    if (T && cycles >= 1 && !undersampled) { // Zyklus-Effektivwert über den ersten vollständigen Zyklus
      const n = Math.max(2, Math.round((T / span) * (M - 1)));
      rms = Math.sqrt(raw.slice(0, n).reduce((a, b) => a + b * b, 0) / n);
    } else if (!T) rms = Math.abs(avg);
    const measure: ScopeMeasure = { freq: T && cycles >= 1 && !undersampled ? 1 / T : null, period: T && cycles >= 1 && !undersampled ? T : null, mean: avg, pkpk: mx - mn, rms, min: mn, max: mx, clipped, undersampled };
    return { points, measure, color: colors[k] ?? "#facc15", label: `CH${k + 1}` };
  });
  return { traces, triggered, t0: t0 ?? 0 };
}

/** Autoset: Zeitbasis für ~2–3 Perioden, V/div für ~6 Teilungen Spitze-Spitze, Trigger auf Mittelwert. */
export function autoset(settings: ScopeSettings, sources: Record<string, Signal>): ScopeSettings {
  const ch = settings.ch.map((c) => {
    const sig = c.source ? sources[c.source] : null;
    if (!sig) return c;
    const pp = isDc(sig) ? Math.abs(sig.samples[0]) * 2 : maxOf(sig) - minOf(sig);
    const minV = SCOPE.vDiv[0] * c.probe;
    const target = Math.max(pp / 6, minV);
    const vDiv = SCOPE.vDiv.map((v) => v * c.probe).find((v) => v >= target) ?? SCOPE.vDiv[SCOPE.vDiv.length - 1] * c.probe;
    const m = isDc(sig) ? 0 : (maxOf(sig) + minOf(sig)) / 2;
    return { ...c, vDiv, coupling: "DC" as Coupling, position: isDc(sig) ? -2 : Math.max(-4, Math.min(4, -m / vDiv)) };
  });
  const first = settings.ch.map((c) => (c.source ? sources[c.source] : null)).find((s) => s && !isDc(s));
  const sDiv = first ? SCOPE.sDiv.find((d) => d * SCOPE.divX >= 2.5 * first.period!) ?? SCOPE.sDiv[SCOPE.sDiv.length - 1] : settings.sDiv;
  const trigSig = first ?? null;
  const level = trigSig ? (maxOf(trigSig) + minOf(trigSig)) / 2 : 0;
  const triggerSource = (settings.ch.findIndex((c) => c.source && sources[c.source] && !isDc(sources[c.source])) as 0 | 1);
  return { ...settings, ch, sDiv, triggerLevel: level, triggerSource: triggerSource < 0 ? 0 : triggerSource };
}
export const fmtDiv = (v: number, unit: string) => {
  const m = si(v, unit, 3).match(/^(-?[\d,]+) (.*)$/);
  if (!m) return si(v, unit, 3);
  const num = m[1].includes(",") ? m[1].replace(/0+$/, "").replace(/,$/, "") : m[1];
  return `${num} ${m[2]}`;
};
