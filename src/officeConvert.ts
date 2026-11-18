// officeConvert.ts – wandelt .docx, .pptx, .txt und .md lokal in ein PDF mit festen Seiten um.
// Danach laufen diese Dateien durch denselben Weg wie ein echtes PDF (Seitenauswahl, Rasterbilder, Annotieren).
// Alles passiert im Gerät: Texte werden mit den Systemschriften auf Canvas-Seiten gesetzt (volle Unicode-Unterstützung,
// z. B. Formelzeichen und Umlaute) und als JPEG-Seiten in ein PDF gepackt. Ziel ist ein gut lesbares, annotierbares
// Seitenbild – keine pixelgenaue Kopie von Word/PowerPoint (eingebettete Schriften, SmartArt, Diagramme, Animationen,
// EMF/WMF-Grafiken und komplexe Tabellenformate werden vereinfacht oder ausgelassen).
import { openZip, resolveZipPath, type ZipArchive } from "./zipReader.ts";

export type ImportKind = "pdf" | "docx" | "pptx" | "text" | "markdown" | "image" | "unsupported";

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");
/** Erkennt den Dateityp aus MIME-Typ und Endung (Windows liefert für .md oft keinen MIME-Typ). */
export function classifyFile(file: { name: string; type: string }): ImportKind {
  const e = ext(file.name), t = file.type.toLowerCase();
  if (t === "application/pdf" || e === "pdf") return "pdf";
  if (e === "docx" || t === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (e === "pptx" || t === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (e === "md" || e === "markdown" || t === "text/markdown") return "markdown";
  if (e === "txt" || t === "text/plain") return "text";
  if (["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "bmp"].includes(e) || t.startsWith("image/")) return "image";
  return "unsupported";
}
export const IMPORT_ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";

/* ───────────────────────── Seitenaufbau ───────────────────────── */
const A4_W = 794, A4_H = 1123, MARGIN = 72, SCALE = 2; // CSS-Pixel bei 96 dpi; gerendert mit doppelter Auflösung
const SANS = `"Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`;
const MONO = `Consolas, "Cascadia Mono", Menlo, "Roboto Mono", monospace`;
const PT = 96 / 72;

type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; size?: number; color?: string; mono?: boolean };
type Align = "left" | "center" | "right";
type Para = { kind: "p"; runs: Run[]; align?: Align; indent?: number; bullet?: string; before?: number; after?: number; size?: number; quote?: boolean };
type FlowBlock = Para | { kind: "img"; blob: Blob; w: number; h: number } | { kind: "table"; rows: Para[][][] } | { kind: "break" } | { kind: "rule" };
type RenderedPage = { dataUrl: string; w: number; h: number };

const fontOf = (r: Run, base: number) => `${r.italic ? "italic " : ""}${r.bold ? "700" : "400"} ${r.size ?? base}px ${r.mono ? MONO : SANS}`;

type LineItem = { text: string; font: string; color: string; x: number; w: number; underline?: boolean; strike?: boolean; size: number };
type Line = { items: LineItem[]; width: number; size: number };

/** Bricht Textläufe mit gemischten Schriften in Zeilen um (Wortgrenzen; überlange Wörter zeichenweise). */
function layoutRuns(ctx: CanvasRenderingContext2D, runs: Run[], maxW: number, base: number, color = "#111827"): Line[] {
  const lines: Line[] = [];
  let cur: Line = { items: [], width: 0, size: base };
  const push = () => { lines.push(cur); cur = { items: [], width: 0, size: base }; };
  for (const r of runs) {
    const font = fontOf(r, base), size = r.size ?? base;
    ctx.font = font;
    for (const tok of r.text.replace(/\t/g, "    ").split(/(\n| +)/)) {
      if (!tok) continue;
      if (tok === "\n") { cur.size = Math.max(cur.size, size); push(); continue; }
      const space = /^ +$/.test(tok);
      if (space && cur.items.length === 0) continue; // Leerzeichen am Zeilenanfang weglassen
      let w = ctx.measureText(tok).width;
      if (!space && cur.width + w > maxW && cur.items.length) {
        // nachlaufende Leerzeichen der Zeile entfernen, dann umbrechen
        while (cur.items.length && /^ +$/.test(cur.items[cur.items.length - 1].text)) cur.width -= cur.items.pop()!.w;
        push();
      }
      let text = tok;
      while (!space && w > maxW && text.length > 1) { // ein einzelnes Wort ist breiter als die Zeile
        let n = text.length - 1;
        while (n > 1 && ctx.measureText(text.slice(0, n)).width > maxW - cur.width) n--;
        const part = text.slice(0, n), pw = ctx.measureText(part).width;
        cur.items.push({ text: part, font, color: r.color ?? color, x: cur.width, w: pw, underline: r.underline, strike: r.strike, size });
        cur.size = Math.max(cur.size, size); push();
        text = text.slice(n); w = ctx.measureText(text).width;
      }
      cur.items.push({ text, font, color: r.color ?? color, x: cur.width, w, underline: r.underline, strike: r.strike, size });
      cur.width += w; cur.size = Math.max(cur.size, size);
    }
  }
  if (cur.items.length || !lines.length) push();
  for (const l of lines) while (l.items.length && /^ +$/.test(l.items[l.items.length - 1].text)) l.width -= l.items.pop()!.w;
  return lines;
}
function drawLine(ctx: CanvasRenderingContext2D, line: Line, x: number, y: number, maxW: number, align: Align, lh: number) {
  const dx = align === "center" ? (maxW - line.width) / 2 : align === "right" ? maxW - line.width : 0;
  const baseline = y + line.size * 0.98 + (lh - 1) * line.size * 0.5;
  for (const it of line.items) {
    ctx.font = it.font; ctx.fillStyle = it.color; ctx.textBaseline = "alphabetic";
    ctx.fillText(it.text, x + dx + it.x, baseline);
    if (it.underline || it.strike) {
      ctx.fillRect(x + dx + it.x, it.underline ? baseline + it.size * 0.12 : baseline - it.size * 0.3, it.w, Math.max(1, it.size / 16));
    }
  }
}

/** Setzt einen Textfluss (Word, Markdown, Text) auf A4-Seiten. */
async function renderFlow(blocks: FlowBlock[], base = 11 * PT, progress?: (m: string) => void): Promise<RenderedPage[]> {
  const pages: RenderedPage[] = [];
  const cv = document.createElement("canvas"); cv.width = A4_W * SCALE; cv.height = A4_H * SCALE;
  const ctx = cv.getContext("2d")!;
  const maxW = A4_W - 2 * MARGIN, bottom = A4_H - MARGIN;
  let y = MARGIN, dirty = false;
  const fresh = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); y = MARGIN; dirty = false; };
  const flush = () => { pages.push({ dataUrl: cv.toDataURL("image/jpeg", 0.9), w: A4_W, h: A4_H }); progress?.(`Seite ${pages.length} gesetzt …`); fresh(); };
  const ensure = (h: number) => { if (y + h > bottom && dirty) flush(); };
  fresh();
  const drawPara = (p: Para, x0: number, w0: number, measureOnly = false) => {
    const size = p.size ?? base, indent = p.indent ?? 0, x = x0 + indent, w = w0 - indent, lh = 1.32;
    const lines = layoutRuns(ctx, p.runs.length ? p.runs : [{ text: " " }], w, size);
    let h = 0;
    for (const l of lines) h += l.size * lh;
    if (measureOnly) return h;
    return { lines, x, w, lh, size };
  };
  for (const b of blocks) {
    if (b.kind === "break") { if (dirty) flush(); continue; }
    if (b.kind === "rule") { ensure(14); ctx.fillStyle = "#cbd5e1"; ctx.fillRect(MARGIN, y + 6, maxW, 1.2); y += 14; dirty = true; continue; }
    if (b.kind === "img") {
      let w = b.w, h = b.h;
      const k = Math.min(1, maxW / w, (bottom - MARGIN) / h); w *= k; h *= k;
      ensure(h + 8);
      try { const bmp = await createImageBitmap(b.blob); ctx.drawImage(bmp, MARGIN, y, w, h); bmp.close(); }
      catch { ctx.strokeStyle = "#cbd5e1"; ctx.strokeRect(MARGIN, y, w, h); ctx.fillStyle = "#64748b"; ctx.font = `${base}px ${SANS}`; ctx.fillText("[Bild]", MARGIN + 6, y + base + 4); }
      y += h + 8; dirty = true; continue;
    }
    if (b.kind === "table") {
      const cols = Math.max(1, ...b.rows.map((r) => r.length)), cw = maxW / cols, pad = 4;
      for (const row of b.rows) {
        const cellH = row.map((cell) => cell.reduce((s, p) => s + (drawPara(p, 0, cw - 2 * pad, true) as number), 0));
        const rh = Math.max(base * 1.4, ...cellH) + 2 * pad;
        ensure(rh);
        row.forEach((cell, ci) => {
          const cx = MARGIN + ci * cw;
          ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 0.8; ctx.strokeRect(cx, y, cw, rh);
          let cy = y + pad;
          for (const p of cell) {
            const r = drawPara(p, cx + pad, cw - 2 * pad) as Exclude<ReturnType<typeof drawPara>, number>;
            for (const l of r.lines) { drawLine(ctx, l, r.x, cy, r.w, p.align ?? "left", r.lh); cy += l.size * r.lh; }
          }
        });
        y += rh; dirty = true;
      }
      y += 8; continue;
    }
    const r = drawPara(b, MARGIN, maxW) as Exclude<ReturnType<typeof drawPara>, number>;
    y += b.before ?? 0;
    if (y > bottom - r.size * 1.3 && dirty) flush();
    let first = true;
    for (const l of r.lines) {
      const lhPx = l.size * r.lh;
      if (y + lhPx > bottom && dirty) flush();
      if (first && b.bullet) { ctx.font = `400 ${r.size}px ${SANS}`; ctx.fillStyle = "#111827"; ctx.fillText(b.bullet, r.x - Math.max(14, ctx.measureText(b.bullet).width + 6), y + l.size * 0.98 + (r.lh - 1) * l.size * 0.5); }
      if (b.quote) { ctx.fillStyle = "#cbd5e1"; ctx.fillRect(r.x - 12, y, 3, lhPx); }
      drawLine(ctx, l, r.x, y, r.w, b.align ?? "left", r.lh);
      y += lhPx; dirty = true; first = false;
    }
    y += b.after ?? r.size * 0.45;
  }
  if (dirty || !pages.length) flush();
  cv.width = 0; cv.height = 0;
  return pages;
}

async function pagesToPdf(pages: RenderedPage[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const first = pages[0];
  const pdf = new jsPDF({ unit: "px", format: [first.w, first.h], orientation: first.w > first.h ? "landscape" : "portrait", hotfixes: ["px_scaling"] });
  pages.forEach((p, i) => {
    if (i > 0) pdf.addPage([p.w, p.h], p.w > p.h ? "landscape" : "portrait");
    pdf.addImage(p.dataUrl, "JPEG", 0, 0, p.w, p.h);
  });
  return pdf.output("blob");
}

/* ───────────────────────── XML-Hilfen ───────────────────────── */
const parseXml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const kids = (el: Element | null | undefined, tag?: string): Element[] => el ? Array.from(el.children).filter((c) => !tag || c.tagName === tag) : [];
const kid = (el: Element | null | undefined, tag: string): Element | null => kids(el, tag)[0] ?? null;
const desc = (el: Element | Document | null | undefined, tag: string): Element | null => el ? el.getElementsByTagName(tag)[0] ?? null : null;
const path = (el: Element | null | undefined, ...tags: string[]): Element | null => { let c: Element | null | undefined = el; for (const t of tags) c = kid(c, t); return c ?? null; };
const num = (v: string | null | undefined, d = 0) => (v != null && v !== "" && Number.isFinite(+v) ? +v : d);
const on = (el: Element | null) => !!el && !/^(0|false|off)$/i.test(el.getAttribute("w:val") ?? "true");

async function readRels(zip: ZipArchive, part: string): Promise<Map<string, string>> {
  const relPath = part.replace(/([^/]+)$/, "_rels/$1.rels"), xml = await zip.text(relPath), out = new Map<string, string>();
  if (!xml) return out;
  for (const r of Array.from(parseXml(xml).getElementsByTagName("Relationship"))) {
    if (r.getAttribute("TargetMode") === "External") continue;
    out.set(r.getAttribute("Id") ?? "", resolveZipPath(part, r.getAttribute("Target") ?? ""));
  }
  return out;
}
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };
async function zipImage(zip: ZipArchive, p: string): Promise<Blob | null> {
  const type = MIME[ext(p)];
  if (!type) return null; // EMF/WMF/TIFF können Browser nicht zeichnen
  const b = await zip.bytes(p);
  return b ? new Blob([b as BlobPart], { type }) : null;
}

/* ───────────────────────── Word (.docx) ───────────────────────── */
async function docxToFlow(zip: ZipArchive): Promise<{ blocks: FlowBlock[]; base: number }> {
  const docXml = await zip.text("word/document.xml");
  if (!docXml) throw new Error("Diese .docx-Datei enthält kein Dokument.");
  const doc = parseXml(docXml), rels = await readRels(zip, "word/document.xml");
  // Formatvorlagen: Name (für Überschriften) und Grundgröße
  const styles = new Map<string, { name: string; size?: number; bold?: boolean; based?: string; numPr?: Element | null }>();
  let base = 11 * PT;
  const stylesXml = await zip.text("word/styles.xml");
  if (stylesXml) {
    const sd = parseXml(stylesXml);
    const defSz = desc(desc(sd, "w:rPrDefault"), "w:sz")?.getAttribute("w:val");
    if (defSz) base = (num(defSz, 22) / 2) * PT;
    for (const st of Array.from(sd.getElementsByTagName("w:style"))) {
      const sz = desc(st, "w:sz")?.getAttribute("w:val");
      styles.set(st.getAttribute("w:styleId") ?? "", { name: kid(st, "w:name")?.getAttribute("w:val") ?? "", size: sz ? (num(sz) / 2) * PT : undefined, bold: !!desc(path(st, "w:rPr"), "w:b"), based: kid(st, "w:basedOn")?.getAttribute("w:val") ?? undefined, numPr: path(st, "w:pPr", "w:numPr") });
    }
  }
  // Aufzählungen: Format je numId/Ebene, Zähler laufen mit
  const numFmt = new Map<string, string>(), counters = new Map<string, number>();
  const numXml = await zip.text("word/numbering.xml");
  if (numXml) {
    const nd = parseXml(numXml), abs = new Map<string, Element>();
    for (const a of Array.from(nd.getElementsByTagName("w:abstractNum"))) abs.set(a.getAttribute("w:abstractNumId") ?? "", a);
    for (const n of Array.from(nd.getElementsByTagName("w:num"))) {
      const a = abs.get(kid(n, "w:abstractNumId")?.getAttribute("w:val") ?? "");
      for (const lvl of kids(a, "w:lvl")) numFmt.set(`${n.getAttribute("w:numId")}:${lvl.getAttribute("w:ilvl")}`, kid(lvl, "w:numFmt")?.getAttribute("w:val") ?? "bullet");
    }
  }
  const styleInfo = (id: string) => { let s = styles.get(id), size = s?.size, guard = 0; while (s && size == null && s.based && guard++ < 8) { s = styles.get(s.based); size = s?.size; } return { name: styles.get(id)?.name ?? id, size, bold: styles.get(id)?.bold }; };
  const blocks: FlowBlock[] = [];
  const runsOf = async (p: Element, paraSize: number | undefined, paraBold: boolean | undefined): Promise<{ runs: Run[]; images: FlowBlock[]; pageBreak: boolean }> => {
    const runs: Run[] = [], images: FlowBlock[] = [];
    let pageBreak = false;
    for (const r of Array.from(p.getElementsByTagName("w:r"))) {
      let anc: Element | null = r.parentElement, deleted = false; // gelöschte Änderungen (Überarbeitungsmodus) nicht zeigen
      while (anc && anc !== p) { if (anc.tagName === "w:del" || anc.tagName === "w:moveFrom") { deleted = true; break; } anc = anc.parentElement; }
      if (deleted) continue;
      const pr = kid(r, "w:rPr"), sz = kid(pr, "w:sz")?.getAttribute("w:val"), col = kid(pr, "w:color")?.getAttribute("w:val");
      const style: Run = { text: "", bold: kid(pr, "w:b") ? on(kid(pr, "w:b")) : paraBold, italic: on(kid(pr, "w:i")), underline: !!kid(pr, "w:u") && kid(pr, "w:u")?.getAttribute("w:val") !== "none", strike: on(kid(pr, "w:strike")),
        size: sz ? (num(sz) / 2) * PT : paraSize, color: col && /^[0-9a-f]{6}$/i.test(col) ? "#" + col : undefined,
        mono: /courier|consolas|mono/i.test(kid(pr, "w:rFonts")?.getAttribute("w:ascii") ?? "") };
      if (kid(pr, "w:vertAlign")?.getAttribute("w:val")?.match(/super|sub/)) style.size = (style.size ?? base) * 0.7;
      for (const c of Array.from(r.children)) {
        if (c.tagName === "w:t" || c.tagName === "w:delText") { if (c.tagName === "w:t") runs.push({ ...style, text: c.textContent ?? "" }); }
        else if (c.tagName === "w:tab") runs.push({ ...style, text: "\t" });
        else if (c.tagName === "w:br" || c.tagName === "w:cr") { if (c.getAttribute("w:type") === "page") pageBreak = true; else runs.push({ ...style, text: "\n" }); }
        else if (c.tagName === "w:sym") runs.push({ ...style, text: String.fromCharCode(parseInt(c.getAttribute("w:char") ?? "20", 16) & 0xffff) });
        else if (c.tagName === "w:drawing" || c.tagName === "w:pict" || c.tagName === "mc:AlternateContent") {
          const blip = desc(c, "a:blip"), id = blip?.getAttribute("r:embed") ?? desc(c, "v:imagedata")?.getAttribute("r:id");
          const target = id ? rels.get(id) : undefined, blob = target ? await zipImage(zip, target) : null;
          const extent = desc(c, "wp:extent");
          if (blob) images.push({ kind: "img", blob, w: Math.max(8, num(extent?.getAttribute("cx"), 3e6) / 9525), h: Math.max(8, num(extent?.getAttribute("cy"), 2e6) / 9525) });
        }
      }
    }
    return { runs, images, pageBreak };
  };
  const para = async (p: Element, inTable = false): Promise<FlowBlock[]> => {
    const ppr = kid(p, "w:pPr"), styleId = kid(ppr, "w:pStyle")?.getAttribute("w:val") ?? "", info = styleInfo(styleId);
    const hm = /^(heading|überschrift|berschrift|title|titel|subtitle|untertitel)\s*(\d)?/i.exec(info.name.replace(/\s+/g, " ")) ?? /^(heading|berschrift|title)(\d)?/i.exec(styleId);
    const level = hm ? (/title|titel/i.test(hm[1]) ? (/sub|unter/i.test(hm[1]) ? 3 : 0) : num(hm[2], 1)) : -1;
    const hSize = level === 0 ? 26 * PT : level === 1 ? 20 * PT : level === 2 ? 16 * PT : level === 3 ? 14 * PT : level > 3 ? 12 * PT : undefined;
    const size = info.size ?? hSize;
    const { runs, images, pageBreak } = await runsOf(p, size, level >= 0 ? true : info.bold);
    const out: FlowBlock[] = [];
    if (!inTable && kid(ppr, "w:pageBreakBefore") && on(kid(ppr, "w:pageBreakBefore"))) out.push({ kind: "break" });
    const jc = kid(ppr, "w:jc")?.getAttribute("w:val"), sp = kid(ppr, "w:spacing"), ind = kid(ppr, "w:ind");
    let bullet: string | undefined, indent = Math.max(0, num(ind?.getAttribute("w:left") ?? ind?.getAttribute("w:start")) / 15);
    const numPr = kid(ppr, "w:numPr") ?? styles.get(styleId)?.numPr ?? null; // Listen über die Formatvorlage („Aufzählungszeichen“)
    if (numPr) {
      const id = kid(numPr, "w:numId")?.getAttribute("w:val") ?? "0", lvl = num(kid(numPr, "w:ilvl")?.getAttribute("w:val")), key = `${id}:${lvl}`, fmt = numFmt.get(key) ?? "bullet";
      if (id !== "0") {
        for (const k of counters.keys()) { const [kid0, kl] = k.split(":"); if (kid0 === id && +kl > lvl) counters.delete(k); } // tiefere Ebenen neu zählen
        const n = (counters.get(key) ?? 0) + 1; counters.set(key, n);
        bullet = fmt === "decimal" ? `${n}.` : fmt === "lowerLetter" ? `${String.fromCharCode(96 + ((n - 1) % 26) + 1)})` : fmt === "upperLetter" ? `${String.fromCharCode(64 + ((n - 1) % 26) + 1)}.` : fmt === "lowerRoman" ? `${toRoman(n).toLowerCase()}.` : fmt === "upperRoman" ? `${toRoman(n)}.` : ["•", "◦", "▪"][lvl % 3];
        indent = Math.max(indent, 24 + lvl * 22);
      }
    }
    if (runs.some((r) => r.text.trim()) || !images.length)
      out.push({ kind: "p", runs, size, bullet, indent, align: jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : "left",
        before: sp?.getAttribute("w:before") ? num(sp.getAttribute("w:before")) / 15 : level >= 0 ? 10 : 0,
        after: sp?.getAttribute("w:after") ? num(sp.getAttribute("w:after")) / 15 : inTable ? 2 : undefined });
    out.push(...images);
    if (pageBreak && !inTable) out.push({ kind: "break" });
    return out;
  };
  const walk = async (container: Element | null) => {
    for (const el of kids(container)) {
      if (el.tagName === "w:p") blocks.push(...(await para(el)));
      else if (el.tagName === "w:sdt") await walk(kid(el, "w:sdtContent"));
      else if (el.tagName === "w:tbl") {
        const rows: Para[][][] = [];
        for (const tr of kids(el, "w:tr")) {
          const row: Para[][] = [];
          for (const tc of kids(tr, "w:tc")) {
            const cell: Para[] = [];
            for (const p of kids(tc, "w:p")) for (const b of await para(p, true)) if (b.kind === "p") cell.push(b);
            row.push(cell);
          }
          rows.push(row);
        }
        if (rows.length) blocks.push({ kind: "table", rows });
      }
    }
  };
  await walk(desc(doc, "w:body"));
  return { blocks, base };
}
function toRoman(n: number): string {
  const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

/* ───────────────────────── Markdown & Text ───────────────────────── */
/** Inline-Markdown: **fett**, *kursiv*, `Code`, ~~durchgestrichen~~, [Text](Link) */
export function mdInline(text: string, base: Run = { text: "" }): Run[] {
  const out: Run[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)\3|`([^`]+)`|~~(.+?)~~|!?\[([^\]]*)\]\([^)]*\)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ ...base, text: text.slice(last, m.index) });
    if (m[2] != null) out.push(...mdInline(m[2], { ...base, bold: true }));
    else if (m[4] != null) out.push(...mdInline(m[4], { ...base, italic: true }));
    else if (m[5] != null) out.push({ ...base, text: m[5], mono: true, color: "#9333ea" });
    else if (m[6] != null) out.push({ ...base, text: m[6], strike: true });
    else out.push({ ...base, text: m[7] ?? "", underline: !m[0].startsWith("!"), italic: m[0].startsWith("!") || base.italic, color: m[0].startsWith("!") ? "#64748b" : "#2563eb" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ ...base, text: text.slice(last) });
  return out;
}
export function markdownToFlow(src: string): FlowBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n"), out: FlowBlock[] = [], base = 11 * PT;
  let buf: string[] = [], i = 0;
  const flushPara = () => { if (buf.length) { out.push({ kind: "p", runs: mdInline(buf.join(" ")) }); buf = []; } };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flushPara(); i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      out.push({ kind: "p", runs: [{ text: code.join("\n") || " ", mono: true, size: base * 0.92 }], indent: 8, after: 10 });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flushPara(); const lv = h[1].length; out.push({ kind: "p", runs: mdInline(h[2], { text: "", bold: true }), size: [24, 19, 16, 14, 12, 11][lv - 1] * PT, before: lv <= 2 ? 14 : 8, after: 6 }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); out.push({ kind: "rule" }); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara();
      const rows: Para[][][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells.map((c) => [{ kind: "p", runs: mdInline(c, { text: "", bold: rows.length === 0 }), after: 0 }]));
        i++;
      }
      out.push({ kind: "table", rows }); continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    if (li) {
      flushPara();
      const depth = Math.floor(li[1].replace(/\t/g, "  ").length / 2), task = li[3];
      out.push({ kind: "p", runs: mdInline(li[4]), bullet: task != null ? (task.trim() ? "☑" : "☐") : /\d/.test(li[2]) ? li[2].replace(")", ".") : ["•", "◦", "▪"][depth % 3], indent: 22 + depth * 20, after: 2 });
      i++; continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) { flushPara(); out.push({ kind: "p", runs: mdInline(q[1], { text: "", italic: true, color: "#475569" }), indent: 18, quote: true, after: 4 }); i++; continue; }
    if (!line.trim()) { flushPara(); i++; continue; }
    buf.push(line.trim()); i++;
  }
  flushPara();
  return out;
}
export function textToFlow(src: string): FlowBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const aligned = lines.filter((l) => /^ {2,}\S|\t|\S {3,}\S/.test(l)).length > lines.length * 0.15; // Spalten mit Leerzeichen → Festbreite
  return lines.map((l) => ({ kind: "p" as const, runs: [{ text: l || " ", mono: aligned }], after: 0, size: aligned ? 10 * PT : undefined }));
}
function decodeText(buf: ArrayBuffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, ""); }
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

/* ───────────────────────── PowerPoint (.pptx) ───────────────────────── */
type Box = { x: number; y: number; w: number; h: number };
type Tx = (b: Box) => Box;
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
  return f(0) + f(8) + f(4);
}
async function pptxToPages(zip: ZipArchive, progress?: (m: string) => void): Promise<RenderedPage[]> {
  const presXml = await zip.text("ppt/presentation.xml");
  if (!presXml) throw new Error("Diese .pptx-Datei enthält keine Präsentation.");
  const pres = parseXml(presXml), presRels = await readRels(zip, "ppt/presentation.xml");
  const sz = desc(pres, "p:sldSz"), cx = num(sz?.getAttribute("cx"), 12192000), cy = num(sz?.getAttribute("cy"), 6858000);
  const W = A4_W, H = Math.round((A4_W * cy) / cx), k = W / cx; // EMU → Seitenpixel
  // Farbschema des ersten Designs
  const theme = new Map<string, string>();
  const themePath = [...presRels.values()].find((p) => /theme\d*\.xml$/.test(p)) ?? zip.names.find((n) => /^ppt\/theme\/theme\d*\.xml$/.test(n));
  const themeXml = themePath ? await zip.text(themePath) : null;
  if (themeXml) for (const c of kids(desc(parseXml(themeXml), "a:clrScheme"))) {
    const v = desc(c, "a:srgbClr")?.getAttribute("val") ?? desc(c, "a:sysClr")?.getAttribute("lastClr");
    if (v) theme.set(c.tagName.replace(/^a:/, ""), v);
  }
  const alias: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
  const colorOf = (holder: Element | null): string | undefined => {
    const c = holder ? kids(holder).find((x) => /^a:(srgbClr|schemeClr|sysClr|prstClr)$/.test(x.tagName)) : null;
    if (!c) return undefined;
    let hex = c.tagName === "a:srgbClr" ? c.getAttribute("val") : c.tagName === "a:sysClr" ? c.getAttribute("lastClr") : c.tagName === "a:schemeClr" ? theme.get(alias[c.getAttribute("val") ?? ""] ?? c.getAttribute("val") ?? "") ?? null : ({ black: "000000", white: "FFFFFF", red: "FF0000" } as Record<string, string>)[c.getAttribute("val") ?? ""] ?? null;
    if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
    const lumMod = kid(c, "a:lumMod"), lumOff = kid(c, "a:lumOff"), shade = kid(c, "a:shade"), tint = kid(c, "a:tint");
    if (lumMod || lumOff || shade || tint) {
      let [h, s, l] = hexToHsl(hex);
      if (lumMod) l *= num(lumMod.getAttribute("val"), 100000) / 100000;
      if (lumOff) l += num(lumOff.getAttribute("val")) / 100000;
      if (shade) l *= num(shade.getAttribute("val"), 100000) / 100000;
      if (tint) l += (1 - l) * (1 - num(tint.getAttribute("val"), 100000) / 100000);
      hex = hslToHex(h, s, Math.max(0, Math.min(1, l)));
    }
    const alpha = kid(c, "a:alpha");
    return alpha ? `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${num(alpha.getAttribute("val"), 100000) / 100000})` : "#" + hex;
  };
  const slideIds = kids(desc(pres, "p:sldIdLst"), "p:sldId").map((s) => presRels.get(s.getAttribute("r:id") ?? "")).filter(Boolean) as string[];
  const cv = document.createElement("canvas"); cv.width = W * SCALE; cv.height = H * SCALE;
  const ctx = cv.getContext("2d")!;
  const pages: RenderedPage[] = [];
  type Part = { doc: Document; rels: Map<string, string>; path: string };
  const loadPart = async (p: string): Promise<Part | null> => { const x = await zip.text(p); return x ? { doc: parseXml(x), rels: await readRels(zip, p), path: p } : null; };
  const phKey = (sp: Element) => { const ph = desc(path(sp, "p:nvSpPr", "p:nvPr") ?? path(sp, "p:nvPicPr", "p:nvPr"), "p:ph"); return ph ? { type: ph.getAttribute("type") ?? "body", idx: ph.getAttribute("idx") } : null; };
  const findPh = (part: Part | null, key: { type: string; idx: string | null }) => {
    if (!part) return null;
    const all = Array.from(part.doc.getElementsByTagName("p:sp"));
    return all.find((s) => { const k2 = phKey(s); return k2 && key.idx != null && k2.idx === key.idx; })
      ?? all.find((s) => { const k2 = phKey(s); return k2 && (k2.type === key.type || (/title/i.test(k2.type) && /title/i.test(key.type))); }) ?? null;
  };
  const xfrmOf = (el: Element | null): Box | null => {
    const x = el ? desc(kid(el, "p:spPr") ?? kid(el, "p:grpSpPr") ?? el, "a:xfrm") ?? desc(el, "p:xfrm") : null;
    const off = kid(x, "a:off"), e = kid(x, "a:ext");
    return off && e ? { x: num(off.getAttribute("x")), y: num(off.getAttribute("y")), w: num(e.getAttribute("cx")), h: num(e.getAttribute("cy")) } : null;
  };
  const drawImg = async (part: Part, blip: Element | null, b: Box) => {
    const target = part.rels.get(blip?.getAttribute("r:embed") ?? ""), blob = target ? await zipImage(zip, target) : null;
    if (!blob) return;
    try { const bmp = await createImageBitmap(blob); ctx.drawImage(bmp, b.x, b.y, b.w, b.h); bmp.close(); } catch { /* nicht darstellbares Bild auslassen */ }
  };
  const fillShape = (spPr: Element | null, b: Box) => {
    if (!spPr) return;
    const geom = kid(spPr, "a:prstGeom")?.getAttribute("prst") ?? "rect", fill = colorOf(kid(spPr, "a:solidFill")), ln = kid(spPr, "a:ln"), lc = kid(ln, "a:noFill") ? undefined : colorOf(kid(ln, "a:solidFill"));
    if (!fill && !lc) return;
    ctx.beginPath();
    if (geom === "ellipse") ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.abs(b.w / 2), Math.abs(b.h / 2), 0, 0, Math.PI * 2);
    else if (geom === "roundRect" && ctx.roundRect) ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.16);
    else if (geom === "line" || geom === "straightConnector1") { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y + b.h); }
    else ctx.rect(b.x, b.y, b.w, b.h);
    if (fill && geom !== "line" && geom !== "straightConnector1") { ctx.fillStyle = fill; ctx.fill(); }
    if (lc) { ctx.strokeStyle = lc; ctx.lineWidth = Math.max(0.75, num(ln?.getAttribute("w"), 12700) * k); ctx.stroke(); }
  };
  const drawText = (txBody: Element | null, b: Box, ph: { type: string } | null, fallbackSize: number) => {
    if (!txBody) return;
    const bodyPr = kid(txBody, "a:bodyPr");
    const ins = (a: string, d: number) => num(bodyPr?.getAttribute(a), d) * k;
    const box = { x: b.x + ins("lIns", 91440), y: b.y + ins("tIns", 45720), w: Math.max(10, b.w - ins("lIns", 91440) - ins("rIns", 91440)), h: Math.max(10, b.h - ins("tIns", 45720) - ins("bIns", 45720)) };
    const autoScale = num(desc(bodyPr, "a:normAutofit")?.getAttribute("fontScale"), 100000) / 100000;
    const isTitle = !!ph && /title/i.test(ph.type), isBody = !!ph && (ph.type === "body" || ph.type === "obj");
    const paras = kids(txBody, "a:p").map((p) => {
      const ppr = kid(p, "a:pPr"), lvl = num(ppr?.getAttribute("lvl"));
      const runs: Run[] = [];
      for (const r of kids(p)) {
        if (r.tagName === "a:br") { runs.push({ text: "\n" }); continue; }
        if (r.tagName !== "a:r" && r.tagName !== "a:fld") continue;
        const rp = kid(r, "a:rPr"), szv = rp?.getAttribute("sz");
        runs.push({ text: kid(r, "a:t")?.textContent ?? "", bold: rp?.getAttribute("b") === "1", italic: rp?.getAttribute("i") === "1", underline: !!rp?.getAttribute("u") && rp?.getAttribute("u") !== "none",
          size: szv ? (num(szv) / 100) * PT : undefined, color: colorOf(kid(rp, "a:solidFill")) });
      }
      const algn = ppr?.getAttribute("algn"), buChar = kid(ppr, "a:buChar")?.getAttribute("char"), buAuto = kid(ppr, "a:buAutoNum"), buNone = kid(ppr, "a:buNone");
      const bullet = buNone ? undefined : buChar ?? (buAuto ? "•" : isBody && runs.some((r) => r.text.trim()) ? "•" : undefined);
      return { runs, align: (algn === "ctr" ? "center" : algn === "r" ? "right" : "left") as Align, bullet, lvl };
    });
    if (!paras.some((p) => p.runs.some((r) => r.text.trim()))) return;
    const baseSize = (isTitle ? (ph?.type === "subTitle" ? 24 : 40) : isBody ? 24 : fallbackSize) * PT;
    const pxScale = (cx / 9525 > 0 ? W / (cx / 9525) : 1); // Punktgrößen beziehen sich auf die Originalfolie
    const layout = (s: number) => {
      let h = 0;
      const laid = paras.map((p) => {
        const indent = (p.bullet ? 22 : 0) * pxScale * s + p.lvl * 24 * pxScale * s;
        const lines = layoutRuns(ctx, p.runs.map((r) => ({ ...r, size: (r.size ?? baseSize) * pxScale * autoScale * s })), box.w - indent, baseSize * pxScale * autoScale * s, "#111827");
        const ph2 = lines.reduce((a, l) => a + l.size * 1.18, 0);
        h += ph2 + baseSize * pxScale * s * 0.2;
        return { p, lines, indent };
      });
      return { laid, h };
    };
    let s = 1, res = layout(1);
    while (res.h > box.h * 1.02 && s > 0.45) { s *= 0.9; res = layout(s); } // Text passt nicht → wie PowerPoint verkleinern
    const anchor = bodyPr?.getAttribute("anchor") ?? (isTitle ? "ctr" : "t");
    let y = anchor === "ctr" ? box.y + (box.h - res.h) / 2 : anchor === "b" ? box.y + box.h - res.h : box.y;
    const dflt = colorOf(desc(txBody, "a:defRPr") ? kid(desc(txBody, "a:defRPr"), "a:solidFill") : null) ?? (theme.get("dk1") ? "#" + theme.get("dk1") : "#111827");
    for (const { p, lines, indent } of res.laid) {
      let first = true;
      for (const l of lines) {
        for (const it of l.items) if (it.color === "#111827") it.color = dflt;
        if (first && p.bullet) { ctx.font = `400 ${l.size}px ${SANS}`; ctx.fillStyle = dflt; ctx.fillText(p.bullet, box.x + indent - 18 * pxScale * s, y + l.size * 0.98 + l.size * 0.09); }
        drawLine(ctx, l, box.x + indent, y, box.w - indent, p.align, 1.18);
        y += l.size * 1.18; first = false;
      }
      y += baseSize * pxScale * s * 0.2;
    }
  };
  const drawTree = async (tree: Element | null, part: Part, tx: Tx, layouts: (Part | null)[], skipPlaceholders: boolean) => {
    for (const el of kids(tree)) {
      if (el.tagName === "p:sp" || el.tagName === "p:cxnSp") {
        const key = phKey(el);
        if (key && skipPlaceholders) continue; // Platzhalter von Layout/Master nur als Vorlage, nicht als Inhalt zeichnen
        let box = xfrmOf(el);
        if (!box && key) for (const lp of layouts) { const src = findPh(lp, key); box = src ? xfrmOf(src) : null; if (box) break; }
        if (!box) continue;
        const b = tx(box);
        fillShape(kid(el, "p:spPr"), b);
        const blipFill = desc(kid(el, "p:spPr"), "a:blipFill");
        if (blipFill) await drawImg(part, desc(blipFill, "a:blip"), b);
        drawText(kid(el, "p:txBody"), b, key, 18);
      } else if (el.tagName === "p:pic") {
        const box = xfrmOf(el);
        if (box) await drawImg(part, desc(kid(el, "p:blipFill"), "a:blip"), tx(box));
      } else if (el.tagName === "p:grpSp") {
        const x = desc(kid(el, "p:grpSpPr"), "a:xfrm"), off = kid(x, "a:off"), e = kid(x, "a:ext"), co = kid(x, "a:chOff"), ce = kid(x, "a:chExt");
        if (!off || !e || !co || !ce) { await drawTree(el, part, tx, layouts, skipPlaceholders); continue; }
        const sx = num(e.getAttribute("cx"), 1) / Math.max(1, num(ce.getAttribute("cx"), 1)), sy = num(e.getAttribute("cy"), 1) / Math.max(1, num(ce.getAttribute("cy"), 1));
        const ox = num(off.getAttribute("x")), oy = num(off.getAttribute("y")), cxo = num(co.getAttribute("x")), cyo = num(co.getAttribute("y"));
        await drawTree(el, part, (b) => tx({ x: ox + (b.x - cxo) * sx, y: oy + (b.y - cyo) * sy, w: b.w * sx, h: b.h * sy }), layouts, skipPlaceholders);
      } else if (el.tagName === "p:graphicFrame") {
        const box = xfrmOf(el), tbl = desc(el, "a:tbl");
        if (!box) continue;
        const b = tx(box);
        if (!tbl) { // Diagramm/SmartArt: Hinweisrahmen statt leerer Fläche
          ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1; ctx.strokeRect(b.x, b.y, b.w, b.h);
          ctx.fillStyle = "#94a3b8"; ctx.font = `italic 400 ${12}px ${SANS}`; ctx.fillText("[Diagramm – in der Vorschau nicht darstellbar]", b.x + 6, b.y + 18); continue;
        }
        const cols = kids(desc(tbl, "a:tblGrid"), "a:gridCol").map((c) => num(c.getAttribute("w")) * k), rows = kids(tbl, "a:tr");
        const totalW = cols.reduce((a, c) => a + c, 0) || b.w, fx = b.w / totalW;
        let yy = b.y;
        for (const tr of rows) {
          const rh = Math.max(num(tr.getAttribute("h")) * k, 14);
          let xx = b.x;
          kids(tr, "a:tc").forEach((tc, ci) => {
            const cw = (cols[ci] ?? totalW / Math.max(1, cols.length)) * fx, cell = { x: xx, y: yy, w: cw, h: rh };
            const fill = colorOf(kid(kid(tc, "a:tcPr"), "a:solidFill"));
            if (fill) { ctx.fillStyle = fill; ctx.fillRect(cell.x, cell.y, cell.w, cell.h); }
            ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 0.7; ctx.strokeRect(cell.x, cell.y, cell.w, cell.h);
            drawText(kid(tc, "a:txBody"), cell, null, 14);
            xx += cw;
          });
          yy += rh;
        }
      }
    }
  };
  const bgOf = async (part: Part | null): Promise<boolean> => {
    const bgPr = part ? desc(desc(part.doc, "p:bg"), "p:bgPr") : null;
    if (!part || !bgPr) return false;
    const fill = colorOf(kid(bgPr, "a:solidFill"));
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, W, H); return true; }
    const blip = desc(kid(bgPr, "a:blipFill"), "a:blip");
    if (blip) { await drawImg(part, blip, { x: 0, y: 0, w: W, h: H }); return true; }
    const grad = desc(kid(bgPr, "a:gradFill"), "a:gs");
    if (grad) { const c = colorOf(grad); if (c) { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); return true; } }
    return false;
  };
  const scaleTx: Tx = (b) => ({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k });
  for (let i = 0; i < slideIds.length; i++) {
    progress?.(`Folie ${i + 1}/${slideIds.length} wird umgewandelt …`);
    const slide = await loadPart(slideIds[i]);
    if (!slide) continue;
    if (desc(slide.doc, "p:sld")?.getAttribute("show") === "0") continue; // ausgeblendete Folien überspringen
    const layoutPath = [...slide.rels.values()].find((p) => /slideLayouts\//.test(p)), layout = layoutPath ? await loadPart(layoutPath) : null;
    const masterPath = layout ? [...layout.rels.values()].find((p) => /slideMasters\//.test(p)) : undefined, master = masterPath ? await loadPart(masterPath) : null;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    if (!(await bgOf(slide)) && !(await bgOf(layout))) await bgOf(master);
    if (master && desc(layout?.doc, "p:sldLayout")?.getAttribute("showMasterSp") !== "0") await drawTree(desc(master.doc, "p:spTree"), master, scaleTx, [], true);
    if (layout) await drawTree(desc(layout.doc, "p:spTree"), layout, scaleTx, [master], true);
    await drawTree(desc(slide.doc, "p:spTree"), slide, scaleTx, [layout, master], false);
    pages.push({ dataUrl: cv.toDataURL("image/jpeg", 0.9), w: W, h: H });
  }
  cv.width = 0; cv.height = 0;
  if (!pages.length) throw new Error("Die Präsentation enthält keine sichtbaren Folien.");
  return pages;
}

/* ───────────────────────── Einstieg ───────────────────────── */
/**
 * Wandelt eine Office- oder Textdatei in ein PDF (Blob) um. Wirft verständliche Fehlermeldungen (deutsch).
 * Ältere Binärformate (.doc, .ppt) werden nicht unterstützt – dafür in Word/PowerPoint als .docx/.pptx oder PDF speichern.
 */
export async function convertToPdf(file: File, progress?: (m: string) => void): Promise<Blob> {
  const kind = classifyFile(file), buf = await file.arrayBuffer();
  progress?.("Datei wird umgewandelt …");
  if (kind === "markdown") return pagesToPdf(await renderFlow(markdownToFlow(decodeText(buf)), undefined, progress));
  if (kind === "text") return pagesToPdf(await renderFlow(textToFlow(decodeText(buf)), undefined, progress));
  if (kind === "docx" || kind === "pptx") {
    let zip: ZipArchive;
    try { zip = openZip(buf); } catch { throw new Error(`Diese Datei ist keine gültige ${kind === "docx" ? "Word" : "PowerPoint"}-Datei (.${kind}). Ältere .doc/.ppt-Dateien bitte als .${kind} oder PDF speichern.`); }
    if (kind === "pptx") return pagesToPdf(await pptxToPages(zip, progress));
    const { blocks, base } = await docxToFlow(zip);
    return pagesToPdf(await renderFlow(blocks, base, progress));
  }
  throw new Error("Dieses Dateiformat wird nicht unterstützt.");
}
