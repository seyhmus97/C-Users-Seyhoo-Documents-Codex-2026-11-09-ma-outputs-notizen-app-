// Kenndaten der Laborgeräte für die XNTS-Laborsimulation.
// Quelle: die vom Nutzer bereitgestellten Handbücher/Datenblätter. Werte, die dort nicht eindeutig
// lesbar waren, sind als "angenommen" kommentiert. Die Simulation ersetzt keine echte Messung.

export type MeterFn = "VDC" | "VAC" | "ADC" | "AAC" | "OHM" | "CAP" | "HZ";
/** Messbereich: Endwert, Auflösung, Genauigkeit ±(% vom Messwert + Digits), Bürdenwiderstand (Strom). */
export type MeterRange = { max: number; res: number; acc: [number, number]; burden?: number };
export type MeterFunction = {
  label: string;
  unit: string;
  ranges: MeterRange[];
  /** Spezifizierter Frequenzbereich (Wechselgrößen). */
  band?: [number, number];
  /** Frequenzabhängige Genauigkeit, überschreibt `acc` der Bereiche. */
  accAt?: (f: number) => [number, number] | null;
};
export type MeterSpec = {
  id: "u1241" | "pt3340";
  name: string;
  short: string;
  counts: number;
  trueRms: boolean | null; // null = Handbuch macht keine Angabe
  functions: Partial<Record<MeterFn, MeterFunction>>;
  /** Mindest-Effektivwert für die Frequenzmessung (V). */
  hzSensitivity: (rmsRange: number) => number;
  notes: string[];
};

const r = (max: number, res: number, pct: number, dig: number, burden?: number): MeterRange => ({ max, res, acc: [pct, dig], burden });

export const AGILENT_U1241: MeterSpec = {
  id: "u1241",
  name: "Agilent U1241A/U1242A",
  short: "U1241A",
  counts: 10000,
  trueRms: true,
  functions: {
    // Tabelle 6-17 (100-V-Bereich ohne eigene Angabe → wie 10 V angenommen)
    VDC: { label: "V DC", unit: "V", ranges: [r(1, 1e-4, 0.09, 5), r(10, 1e-3, 0.09, 2), r(100, 1e-2, 0.09, 2), r(1000, 0.1, 0.15, 5)] },
    // Tabelle 6-18, True RMS, AC-gekoppelt
    VAC: {
      label: "V AC", unit: "V", band: [40, 2000],
      ranges: [r(1, 1e-4, 1, 5), r(10, 1e-3, 1, 5), r(100, 1e-2, 1, 5), r(1000, 0.1, 1, 5)],
      accAt: (f) => (f >= 40 && f <= 1000 ? [1, 5] : f > 1000 && f <= 2000 ? [2, 5] : null),
    },
    ADC: { label: "A DC", unit: "A", ranges: [r(1e-3, 1e-7, 0.1, 3, 50), r(1e-2, 1e-6, 0.1, 3, 50), r(0.1, 1e-5, 0.2, 3, 0.5), r(0.44, 1e-4, 0.5, 3, 0.5), r(10, 1e-3, 0.6, 5, 0.01)] },
    AAC: {
      label: "A AC", unit: "A", band: [40, 1000],
      ranges: [r(1e-3, 1e-7, 1, 5, 50), r(1e-2, 1e-6, 1, 5, 50), r(0.1, 1e-5, 1, 5, 0.5), r(0.44, 1e-4, 1, 5, 0.5), r(10, 1e-3, 1, 5, 0.01)],
      accAt: (f) => (f >= 40 && f <= 500 ? [1, 5] : f > 500 && f <= 1000 ? [1.5, 5] : null),
    },
    OHM: { label: "Ω", unit: "Ω", ranges: [r(1e3, 0.1, 0.3, 3), r(1e4, 1, 0.3, 3), r(1e5, 10, 0.3, 3), r(1e6, 100, 0.3, 3), r(1e7, 1e3, 0.8, 3), r(1e8, 1e4, 1.5, 3)] },
    CAP: { label: "Kapazität", unit: "F", ranges: [r(1e-6, 1e-10, 1.2, 4), r(1e-5, 1e-9, 1.2, 4), r(1e-4, 1e-8, 1.2, 4), r(1e-3, 1e-7, 2, 4), r(1e-2, 1e-6, 2, 4)] },
    HZ: { label: "Frequenz", unit: "Hz", ranges: [r(100, 0.01, 0.03, 3), r(1000, 0.1, 0.03, 3), r(1e4, 1, 0.03, 3), r(1e5, 10, 0.03, 3), r(1e6, 100, 0.03, 3)] },
  },
  hzSensitivity: (rmsRange) => (rmsRange <= 1 ? 0.3 : rmsRange <= 10 ? 0.5 : rmsRange <= 100 ? 5 : 50),
  notes: ["Eingangswiderstand 10 MΩ", "AC-Spannung True RMS, spezifiziert 40 Hz – 2 kHz", "Strombereiche mit Bürdenwiderstand (verändert den Stromkreis)"],
};

export const PEAKTECH_3340: MeterSpec = {
  id: "pt3340",
  name: "PeakTech 3340",
  short: "PT 3340",
  counts: 3999,
  trueRms: null,
  functions: {
    VDC: { label: "V DC", unit: "V", ranges: [r(0.4, 1e-4, 0.5, 2), r(4, 1e-3, 1.2, 2), r(40, 1e-2, 1.2, 2), r(400, 0.1, 1.2, 2), r(1000, 1, 1.5, 2)] },
    // Handbuch: Frequenzbereich 50 … 100 Hz (handschriftlich korrigiert)
    VAC: { label: "V AC", unit: "V", band: [50, 100], ranges: [r(4, 1e-3, 1.2, 3), r(40, 1e-2, 1.5, 3), r(400, 0.1, 1.5, 3), r(700, 1, 2, 4)] },
    // Bürdenwiderstand im Handbuch nicht angegeben → ideal gerechnet
    ADC: { label: "A DC", unit: "A", ranges: [r(4e-4, 1e-7, 1, 3), r(4e-3, 1e-6, 1.5, 3), r(0.04, 1e-5, 1.5, 3), r(0.4, 1e-4, 1.5, 3), r(4, 1e-3, 2.5, 5), r(20, 1e-2, 2.5, 5)] },
    AAC: { label: "A AC", unit: "A", band: [50, 400], ranges: [r(4e-4, 1e-7, 1.5, 5), r(4e-3, 1e-6, 1.5, 5), r(0.04, 1e-5, 1.8, 5), r(0.4, 1e-4, 1.8, 5), r(4, 1e-3, 3, 7), r(20, 1e-2, 3, 7)] },
    OHM: { label: "Ω", unit: "Ω", ranges: [r(400, 0.1, 1.2, 4), r(4e3, 1, 1, 2), r(4e4, 10, 1.2, 2), r(4e5, 100, 1.2, 2), r(4e6, 1e3, 1.2, 2), r(4e7, 1e4, 2, 3)] },
    CAP: { label: "Kapazität", unit: "F", ranges: [r(4e-8, 1e-11, 5, 7), r(4e-7, 1e-10, 3, 5), r(4e-6, 1e-9, 3, 5), r(4e-5, 1e-8, 3, 5), r(1e-4, 1e-7, 5, 5)] },
    // Handbuch-Tabelle nennt nur die Bereiche 5/50/500 Hz
    HZ: { label: "Frequenz", unit: "Hz", ranges: [r(5, 1e-3, 1.5, 5), r(50, 1e-2, 1.5, 5), r(500, 0.1, 1.2, 4)] },
  },
  hzSensitivity: () => 0.5,
  notes: ["Eingangswiderstand 10 MΩ", "AC-Spannung spezifiziert nur 50 – 100 Hz", "Handbuch nennt kein True RMS", "Frequenzbereiche laut Tabelle bis 500 Hz"],
};

export const METERS = [AGILENT_U1241, PEAKTECH_3340];

export type PsuMode = "independent" | "series" | "parallel" | "fixed5";
export const PSU = {
  name: "GW Instek GPS-3303",
  modes: {
    independent: { label: "Unabhängig (CH1)", vMax: 30, iMax: 3 },
    series: { label: "Tracking Serie (CH1+CH2)", vMax: 60, iMax: 3 },
    parallel: { label: "Tracking Parallel (CH1‖CH2)", vMax: 30, iMax: 6 },
    fixed5: { label: "CH3 · 5 V fest", vMax: 5, iMax: 3 },
  } as Record<PsuMode, { label: string; vMax: number; iMax: number }>,
  notes: ["3-stellige Anzeigen, Genauigkeit ±(0,5 % + 2 Digits)", "CV/CC-Umschaltung automatisch", "CH3: 5 V fest, max. 3 A"],
};

export type GenModel = "7402" | "7404";
export type Waveform = "sine" | "triangle" | "square" | "pulse" | "dc";
export const GENERATOR = {
  name: "Toellner TOE 7402/7404",
  fMin: { "7402": 0.5, "7404": 0.05 } as Record<GenModel, number>,
  fMax: 5e6,
  vppMin: 0.01,
  vppMax: 30, // Leerlauf
  vppMaxPulse: 15,
  offsetMax: 10,
  outputLimit: 15, // ±15 V Spitze (aus Uss = 30 V abgeleitet, angenommen)
  ri: 50,
  symmetryRange: [0.1, 0.9] as [number, number], // nur TOE 7404
  waveforms: { sine: "Sinus", triangle: "Dreieck", square: "Rechteck", pulse: "Impuls", dc: "Gleichspannung" } as Record<Waveform, string>,
  notes: ["Ausgangswiderstand 50 Ω", "Uss 10 mV … 30 V (Leerlauf), Impuls max. 15 Vss", "DC-Offset bis ±10 V", "Symmetrie 10–90 % nur TOE 7404"],
};

export type ScopeModelId = "TDS1002" | "TDS1012" | "TDS2002" | "TDS2012" | "TDS2014" | "TDS2022" | "TDS2024";
export const SCOPE_MODELS: Record<ScopeModelId, { channels: number; bandwidth: number; color: boolean }> = {
  TDS1002: { channels: 2, bandwidth: 60e6, color: false },
  TDS1012: { channels: 2, bandwidth: 100e6, color: false },
  TDS2002: { channels: 2, bandwidth: 60e6, color: true },
  TDS2012: { channels: 2, bandwidth: 100e6, color: true },
  TDS2014: { channels: 4, bandwidth: 100e6, color: true },
  TDS2022: { channels: 2, bandwidth: 200e6, color: true },
  TDS2024: { channels: 4, bandwidth: 200e6, color: true },
};
export const SCOPE = {
  name: "Tektronix TDS1000/TDS2000",
  vDiv: [2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1, 2, 5], // am BNC; mit 10×-Tastkopf ×10
  sDiv: [5e-9, 1e-8, 2.5e-8, 5e-8, 1e-7, 2.5e-7, 5e-7, 1e-6, 2.5e-6, 5e-6, 1e-5, 2.5e-5, 5e-5, 1e-4, 2.5e-4, 5e-4, 1e-3, 2.5e-3, 5e-3, 1e-2, 2.5e-2, 5e-2, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50],
  divX: 10,
  divY: 8,
  recordLength: 2500,
  probe1xBandwidth: 6e6,
  bwLimit: 20e6,
  acLowCut: 10,
  notes: ["Eingang 1 MΩ ‖ 20 pF", "Bandbreite mit 1×-Tastkopf nur 6 MHz", "2500 Punkte je Kanal, 10 × 8 Teilungen"],
};
