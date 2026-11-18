// Prüfungen für Seitenauswahl, Dateityp-Erkennung, ZIP-Leser und Markdown-Umwandlung – nur Node-Bordmittel.
// Ausführen: pnpm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatPageRange, matchingPrefix, parsePageRange } from "../src/pageRange.ts";
import { classifyFile, markdownToFlow, mdInline } from "../src/officeConvert.ts";
import { openZip, resolveZipPath } from "../src/zipReader.ts";

test("Seitenbereich: Bereiche, Einzelseiten, Gedankenstrich und Leerzeichen", () => {
  assert.deepEqual(parsePageRange("10-12", 30).pages, [9, 10, 11]);
  assert.deepEqual(parsePageRange("10 – 12, 3; 3", 30).pages, [2, 9, 10, 11]);
  assert.deepEqual(parsePageRange("Seite 28-", 30).pages, [27, 28, 29]);
  assert.deepEqual(parsePageRange("-2", 30).pages, [0, 1]);
  assert.deepEqual(parsePageRange("12-10", 30).pages, [9, 10, 11]);
});
test("Seitenbereich: ungültige Angaben werden gemeldet", () => {
  const r = parsePageRange("2, 99, abc, 40-50", 30);
  assert.deepEqual(r.pages, [1]);
  assert.deepEqual(r.invalid, ["99", "abc", "40-50"]);
});
test("Seitenbereich: kompakte Anzeige", () => {
  assert.equal(formatPageRange([0, 1, 2, 4, 6, 7]), "1–3, 5, 7–8");
  assert.equal(formatPageRange([]), "");
});
test("Fortgeschriebenes Skript: übereinstimmende erste Seiten", () => {
  assert.equal(matchingPrefix(["A", "B", "C"], ["a", "b ", "C", "D", "E"]), 3);
  assert.equal(matchingPrefix(["A", "B"], ["A", "X", "B"]), 1);
  assert.equal(matchingPrefix(["", ""], ["", "", "neu"]), 0); // reine Bildseiten gelten nicht als bekannt
});
test("Dateityp-Erkennung", () => {
  assert.equal(classifyFile({ name: "Skript.PDF", type: "" }), "pdf");
  assert.equal(classifyFile({ name: "a.docx", type: "" }), "docx");
  assert.equal(classifyFile({ name: "a.pptx", type: "" }), "pptx");
  assert.equal(classifyFile({ name: "notizen.md", type: "" }), "markdown");
  assert.equal(classifyFile({ name: "a.txt", type: "text/plain" }), "text");
  assert.equal(classifyFile({ name: "IMG_0001.HEIC", type: "" }), "image");
  assert.equal(classifyFile({ name: "alt.doc", type: "" }), "unsupported");
});
test("ZIP-Leser öffnet eine echte .docx und entpackt document.xml", async () => {
  const buf = readFileSync(new URL("./fixtures/beispiel.docx", import.meta.url));
  const zip = openZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.ok(zip.has("word/document.xml"));
  const xml = await zip.text("word/document.xml");
  assert.match(xml ?? "", /Skript Elektrotechnik/);
  assert.equal(resolveZipPath("word/document.xml", "media/image1.png"), "word/media/image1.png");
  assert.equal(resolveZipPath("ppt/slides/slide1.xml", "../media/a.png"), "ppt/media/a.png");
});
test("Markdown: Überschrift, Liste, Tabelle, Code und Inline-Format", () => {
  const flow = markdownToFlow("# Titel\n\n- eins\n- zwei\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\nx = 1\n```\n");
  assert.deepEqual(flow.map((b) => b.kind), ["p", "p", "p", "table", "p"]);
  const runs = mdInline("ein **fettes** und *kursives* `x`");
  assert.ok(runs.some((r) => r.bold && r.text === "fettes"));
  assert.ok(runs.some((r) => r.italic && r.text === "kursives"));
  assert.ok(runs.some((r) => r.mono && r.text === "x"));
});
