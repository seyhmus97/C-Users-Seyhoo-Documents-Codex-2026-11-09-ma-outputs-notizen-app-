import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "de.notizraum.app",
  appName: "XNTS",
  webDir: "dist",
  backgroundColor: "#f3df35",
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "automatic",
  },
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
};

export default config;
