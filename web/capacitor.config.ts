import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rishil.rscreener",
  appName: "Rscreener",
  // the APK is a thin shell: it loads the live site, so data is always current
  // and the app never needs reinstalling for web updates
  webDir: "dist-shell",
  server: {
    url: "https://rishilbhutada.github.io/rscreener/",
    androidScheme: "https",
  },
};

export default config;
