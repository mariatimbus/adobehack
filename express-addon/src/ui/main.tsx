import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Surface hard crashes on screen (in Express the iframe console is not
// easily reachable for the user — a visible trap makes failures debuggable).
function installErrorTrap() {
  const show = (msg: string) => {
    let el = document.getElementById("creativedna-error-trap");
    if (!el) {
      el = document.createElement("pre");
      el.id = "creativedna-error-trap";
      el.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;max-height:45%;overflow:auto;background:#3b0d0d;color:#ffd7d7;font-size:11px;padding:8px;z-index:99999;white-space:pre-wrap;margin:0";
      document.body.appendChild(el);
    }
    el.textContent += msg + "\n";
  };
  window.addEventListener("error", (e) => {
    show(`[error] ${e.message} @ ${e.filename}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    show(`[unhandled rejection] ${String((e as PromiseRejectionEvent).reason).slice(0, 500)}`);
  });
}

installErrorTrap();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
