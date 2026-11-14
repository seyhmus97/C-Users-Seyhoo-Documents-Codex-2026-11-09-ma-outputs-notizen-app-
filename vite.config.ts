import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  // --mode native / native-solo: eingebettete App (Tauri/Capacitor); --mode solo / native-solo: Edition ohne Lerngruppen und Gruppenchat
  const nativeShell = env.VITE_NATIVE_SHELL === "1" || mode === "native" || mode === "native-solo";
  const solo = env.VITE_XNTS_EDITION === "solo" || mode === "solo" || mode === "native-solo";
  const base = nativeShell ? "./" : env.VITE_BASE_PATH || "/";
  const input: Record<string, string> = nativeShell ? { index: "app.html" } : { landing: "index.html", app: "app.html" };

  return {
    base,
    define: { "import.meta.env.VITE_XNTS_EDITION": JSON.stringify(solo ? "solo" : "full") },
    build: {
      rolldownOptions: { input },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        disable: nativeShell,
        registerType: "prompt",
        includeAssets: [
          "favicon.ico", "icon.svg", "notizraum-logo.svg", "xnts-art-collage.webp", "apple-touch-icon-180x180.png",
          "pwa-64x64.png", "pwa-192x192.png", "pwa-512x512.png", "maskable-icon-512x512.png",
        ],
        manifest: {
          id: base,
          name: "XNTS — Xnotes",
          short_name: "XNTS",
          description: solo ? "Notizen, PDFs und kunstinspirierte Schreibflächen – auch offline." : "Notizen, PDFs, Lerngruppen mit Gruppenchat und kunstinspirierte Schreibflächen – auch offline.",
          lang: "de-DE",
          start_url: base + "app.html",
          scope: base,
          display: "standalone",
          orientation: "any",
          background_color: "#fffdf4",
          theme_color: "#f3df35",
          icons: [
            { src: base + "pwa-64x64.png", sizes: "64x64", type: "image/png" },
            { src: base + "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: base + "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: base + "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{html,js,mjs,css,svg,png,webp,webmanifest,json,woff2}"],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          navigateFallback: base + "app.html",
          cleanupOutdatedCaches: true,
          clientsClaim: true,
        },
      }),
    ],
  };
});
