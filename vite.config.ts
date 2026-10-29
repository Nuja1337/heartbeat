import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// dev.html (the game harness) is served by the dev server only. The build input stays index.html.
// The asset manifest lists every built file, and the service worker precaches from it (PLAN-2 §8.3).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    manifest: "asset-manifest.json",
  },
});
