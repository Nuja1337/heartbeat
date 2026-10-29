import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";

// A stale tab can ask for a chunk a redeploy removed. Reload once to pick up the new build.
window.addEventListener("vite:preloadError", () => {
  if (sessionStorage.getItem("fw-reloaded") === "1") return;
  sessionStorage.setItem("fw-reloaded", "1");
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
