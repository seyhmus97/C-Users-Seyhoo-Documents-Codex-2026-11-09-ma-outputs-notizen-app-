// pageRange.ts – reine Hilfsfunktionen für die Seitenauswahl beim Import und Export (ohne DOM, daher testbar).

/**
 * Liest eine Seitenangabe wie „10-25“, „10–25, 30“ oder „3; 7-9“ (1-basiert) und liefert die Seiten
 * aufsteigend, ohne Doppelte und 0-basiert. Offene Bereiche sind erlaubt: „10-“ = ab Seite 10, „-5“ = bis Seite 5.
 * Ungültige Teile werden gemeldet, damit der Dialog sie anzeigen kann.
 */
export function parsePageRange(input: string, pageCount: number): { pages: number[]; invalid: string[] } {
  const out = new Set<number>(), invalid: string[] = [];
  const parts = input.replace(/[–—]/g, "-").replace(/\s*-\s*/g, "-").replace(/(seiten?|s\.)/gi, " ").split(/[,;\s]+/).filter(Boolean);
  for (const raw of parts) {
    const part = raw;
    const m = /^(\d*)-(\d*)$/.exec(part);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : pageCount;
      if (!m[1] && !m[2]) { invalid.push(raw); continue; }
      const lo = Math.max(1, Math.min(a, b)), hi = Math.min(pageCount, Math.max(a, b));
      if (lo > hi) { invalid.push(raw); continue; }
      for (let i = lo; i <= hi; i++) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = +part;
      if (n < 1 || n > pageCount) { invalid.push(raw); continue; }
      out.add(n - 1);
    } else invalid.push(raw);
  }
  return { pages: [...out].sort((x, y) => x - y), invalid };
}

/** Kompakte Schreibweise einer Auswahl: [0,1,2,4,6,7] → „1–3, 5, 7–8“ (1-basiert). */
export function formatPageRange(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b), out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    out.push(start === sorted[i] ? String(start + 1) : `${start + 1}–${sorted[i] + 1}`);
  }
  return out.join(", ");
}

/** Normalisiert einen Seitentext für den Vergleich „ist diese Seite schon importiert?“ (Leerraum/Groß-Klein egal). */
export const normalizePageText = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Wie viele Seiten am Anfang des neuen Dokuments stimmen mit einem bereits importierten Dokument überein?
 * Typischer Fall: Dozierende hängen neue Folien an dasselbe Skript an. Leere Seiten (z. B. reine Bilder) zählen
 * nur mit, wenn danach noch eine Textseite übereinstimmt – sonst würde ein Bild-PDF fälschlich als „bekannt“ gelten.
 */
export function matchingPrefix(existing: string[], incoming: string[]): number {
  let n = 0, lastText = 0;
  while (n < existing.length && n < incoming.length && normalizePageText(existing[n]) === normalizePageText(incoming[n])) {
    n++;
    if (normalizePageText(incoming[n - 1])) lastText = n;
  }
  return lastText;
}
