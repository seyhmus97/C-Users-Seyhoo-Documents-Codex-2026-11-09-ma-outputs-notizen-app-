// pdfRaster.worker.ts – rendert PDF-Seiten abseits des UI-Threads in JPEG-Bilder (OffscreenCanvas + pdf.js)
// Einbindung (Vite): new Worker(new URL("./pdfRaster.worker.ts", import.meta.url), { type: "module" })
import * as pdfjs from "pdfjs-dist";

export type RasterIn = { type: "start"; data: ArrayBuffer; width: number; quality: number };
export type RasterOut =
  | { type: "page"; pageNum: number; numPages: number; blob: Blob }
  | { type: "done" }
  | { type: "error"; message: string; pageNum?: number };

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const MAX_PIXELS = 10_000_000; // Obergrenze pro Seitenbild
const post = (m: RasterOut): void => (self as unknown as { postMessage(m: RasterOut): void }).postMessage(m);

// Im Worker gibt es kein `document`: pdf.js bekommt eigene Fabriken auf Basis von OffscreenCanvas.
class OffscreenFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error("Ungültige Canvas-Größe");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc: { canvas: OffscreenCanvas }, width: number, height: number): void { cc.canvas.width = width; cc.canvas.height = height; }
  destroy(cc: { canvas: OffscreenCanvas | null; context: unknown }): void {
    if (cc.canvas) { cc.canvas.width = 0; cc.canvas.height = 0; }
    cc.canvas = null; cc.context = null;
  }
}
class NoFilterFactory { // keine SVG-Filter nötig
  addFilter(): string { return "none"; }
  addHCMFilter(): string { return "none"; }
  addAlphaFilter(): string { return "none"; }
  addLuminosityFilter(): string { return "none"; }
  addKnockoutFilter(): string { return "none"; }
  addHighlightHCMFilter(): string { return "none"; }
  destroy(): void { /* nichts aufzuräumen */ }
}

self.addEventListener("message", async (ev: MessageEvent<RasterIn>) => {
  const msg = ev.data;
  if (msg.type !== "start") return;
  try {
    if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas wird nicht unterstützt");
    const loading = pdfjs.getDocument({
      data: msg.data, CanvasFactory: OffscreenFactory, FilterFactory: NoFilterFactory,
      disableFontFace: true, useSystemFonts: false, // Schriften als Pfade zeichnen (FontFace braucht ein document)
    } as Parameters<typeof pdfjs.getDocument>[0]);
    const doc = await loading.promise;
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(msg.width / base.width, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
        const vp = page.getViewport({ scale });
        const cv = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
        const ctx = cv.getContext("2d");
        if (!ctx) throw new Error("Kein 2D-Kontext");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height); // JPEG kennt keine Transparenz
        await page.render({ canvas: cv, canvasContext: ctx, viewport: vp, background: "#ffffff" } as unknown as Parameters<typeof page.render>[0]).promise; // OffscreenCanvas statt HTMLCanvasElement
        const blob = await cv.convertToBlob({ type: "image/jpeg", quality: msg.quality });
        cv.width = 0; cv.height = 0;
        page.cleanup();
        post({ type: "page", pageNum: i, numPages: doc.numPages, blob });
      } catch (err) {
        post({ type: "error", message: String(err), pageNum: i }); // diese Seite fällt auf den Canvas-Pfad zurück, die übrigen laufen weiter
      }
    }
    await loading.destroy();
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: String(err) });
  }
});
