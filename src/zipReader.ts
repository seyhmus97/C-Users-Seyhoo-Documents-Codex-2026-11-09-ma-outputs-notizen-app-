// zipReader.ts – minimaler ZIP-Leser für .docx/.pptx (Office-Dateien sind ZIP-Archive mit XML).
// Ohne Zusatzbibliothek: das Inhaltsverzeichnis wird selbst gelesen, „deflate“ entpackt der Browser
// (DecompressionStream "deflate-raw"; Chrome/Edge 80+, Safari 16.4+, Firefox 113+, Android-WebView aktuell).

export type ZipArchive = {
  names: string[];
  has(name: string): boolean;
  bytes(name: string): Promise<Uint8Array | null>;
  text(name: string): Promise<string | null>;
};

const u16 = (b: DataView, o: number) => b.getUint16(o, true);
const u32 = (b: DataView, o: number) => b.getUint32(o, true);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("Dieser Browser kann komprimierte Office-Dateien nicht entpacken (DecompressionStream fehlt).");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Öffnet ein ZIP aus einem ArrayBuffer. Wirft einen Fehler, wenn die Datei kein ZIP ist. */
export function openZip(buf: ArrayBuffer): ZipArchive {
  const view = new DataView(buf), all = new Uint8Array(buf);
  // „End of central directory“ von hinten suchen (Signatur 0x06054b50, max. 64 KiB Kommentar)
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Keine gültige Office-Datei (ZIP-Verzeichnis fehlt).");
  const count = u16(view, eocd + 10), cdOffset = u32(view, eocd + 16);
  const entries = new Map<string, { method: number; size: number; local: number }>();
  const dec = new TextDecoder();
  let p = cdOffset;
  for (let i = 0; i < count && p + 46 <= buf.byteLength; i++) {
    if (u32(view, p) !== 0x02014b50) break;
    const method = u16(view, p + 10), size = u32(view, p + 20), nameLen = u16(view, p + 28), extraLen = u16(view, p + 30), commentLen = u16(view, p + 32), local = u32(view, p + 42);
    const name = dec.decode(all.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const bytes = async (name: string): Promise<Uint8Array | null> => {
    const e = entries.get(name.replace(/^\//, ""));
    if (!e || u32(view, e.local) !== 0x04034b50) return null;
    const start = e.local + 30 + u16(view, e.local + 26) + u16(view, e.local + 28), raw = all.subarray(start, start + e.size);
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateRaw(raw);
    throw new Error("Nicht unterstützte ZIP-Kompression");
  };
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name.replace(/^\//, "")),
    bytes,
    text: async (name) => { const b = await bytes(name); return b ? new TextDecoder().decode(b) : null; },
  };
}

/** Löst einen relativen Pfad aus einer .rels-Datei auf: ("word/document.xml", "media/a.png") → "word/media/a.png" */
export function resolveZipPath(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
