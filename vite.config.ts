import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// dev.html (the game harness) is served by the dev server only. The build input stays index.html.
// The asset manifest lists every built file, and the service worker precaches from it (PLAN-2 §8.3).
// react-dom gets its own chunk: it is about 217 kB on its own, and it changes far less often than the app.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    manifest: "asset-manifest.json",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "react-dom", test: /node_modules[\/](react-dom|scheduler)[\/]/ }],
        },
      },
    },
  },
});
