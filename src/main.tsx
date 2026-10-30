import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";

// A stale tab can ask for a chunk a redeploy removed. Reload to pick up the new build,
// at most once every 10 s so a broken deploy can't loop. Without session storage there's
// no way to know whether we already reloaded, so the error surfaces instead.
window.addEventListener("vite:preloadError", (event) => {
  let last: number;
  try {
    last = Number(sessionStorage.getItem("fw-reloaded-at")) || 0;
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem("fw-reloaded-at", String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
