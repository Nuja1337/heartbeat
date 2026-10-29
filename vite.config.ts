import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// dev.html (the game harness) is served by the dev server only. The build input stays index.html.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
  },
});
