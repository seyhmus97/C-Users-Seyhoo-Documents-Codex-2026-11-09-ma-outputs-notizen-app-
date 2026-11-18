// imageImport.ts – Fotos und Bilder für die Notiz vorbereiten: Ausrichtung (EXIF) übernehmen, große Kamerafotos
// verkleinern (spart IndexedDB-Speicher) und HEIC-Fotos erkennen. HEIC können nur Browser mit eingebautem Decoder
// lesen (Safari auf iPhone/iPad/Mac); andere Geräte bekommen eine klare Meldung statt eines leeren Bildes.

export const MAX_IMAGE_EDGE = 2400; // reicht für scharfe Darstellung bis ~300 % Zoom auf einer 794 px breiten Seite

export type PreparedImage = { blob: Blob; w: number; h: number };

const isHeic = (f: File) => /\.(heic|heif)$/i.test(f.name) || /image\/hei[cf]/i.test(f.type);

export async function prepareImage(file: File): Promise<PreparedImage> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions); }
  catch {
    try { bmp = await createImageBitmap(file); }
    catch {
      throw new Error(isHeic(file)
        ? "HEIC-Fotos kann dieser Browser nicht öffnen. Tipp: Auf dem iPhone unter Einstellungen › Kamera › Formate „Maximale Kompatibilität“ wählen oder das Foto als JPG teilen."
        : "Dieses Bild konnte nicht gelesen werden.");
    }
  }
  const k = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  // Kleine PNG/WebP (z. B. Screenshots mit Transparenz) unverändert lassen; alles andere als JPEG neu kodieren
  if (k === 1 && !isHeic(file) && /image\/(png|webp|jpeg)/.test(file.type) && file.size < 2_500_000) { bmp.close(); return { blob: file, w, h }; }
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d")!;
  const keepAlpha = /png|webp/.test(file.type);
  if (!keepAlpha) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
  const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, keepAlpha ? "image/png" : "image/jpeg", 0.88));
  cv.width = 0; cv.height = 0;
  if (!blob) throw new Error("Das Bild konnte nicht verarbeitet werden.");
  return { blob, w, h };
}
