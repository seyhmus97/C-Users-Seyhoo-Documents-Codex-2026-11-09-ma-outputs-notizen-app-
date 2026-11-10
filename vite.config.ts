import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const base = env.VITE_BASE_PATH || "/";

  return {
    base,
    build: {
      rolldownOptions: {
        input: {
          landing: "index.html",
          app: "app.html",
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        includeAssets: [
          "favicon.ico", "icon.svg", "notizraum-logo.svg", "apple-touch-icon-180x180.png",
          "pwa-64x64.png", "pwa-192x192.png", "pwa-512x512.png", "maskable-icon-512x512.png",
        ],
        manifest: {
          id: base,
          name: "Notizraum – Notizen & PDFs",
          short_name: "Notizraum",
          description: "Notizen, PDFs und Skizzen an einem Ort – auch offline.",
          lang: "de-DE",
          start_url: base + "app.html",
          scope: base,
          display: "standalone",
          orientation: "any",
          background_color: "#f1f5f9",
          theme_color: "#11182e",
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
