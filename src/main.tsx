import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";

// A stale tab can ask for a chunk a redeploy removed. Reload to pick up the new build,
// at most once every 10 s so a broken deploy can't loop.
window.addEventListener("vite:preloadError", (event) => {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem("fw-reloaded-at")) || 0;
  } catch {
    // Storage can be blocked. Reloading once is still better than a dead page.
  }
  if (Date.now() - last < 10_000) return;
  event.preventDefault();
  try {
    sessionStorage.setItem("fw-reloaded-at", String(Date.now()));
  } catch {
    // See above.
  }
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
