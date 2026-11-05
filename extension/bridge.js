// Jembatan antara halaman dashboard dan extension.
// Dashboard -> window.postMessage -> bridge.js -> background.js
// background.js -> bridge.js -> window.postMessage -> Dashboard
(() => {
  if (window.__tkpBridge) return;
  window.__tkpBridge = true;

  const post = (data) =>
    window.postMessage({ source: "tkp-extension", ...data }, window.location.origin);

  const version = () => {
    try { return chrome.runtime.getManifest().version; } catch (_) { return null; }
  };

  window.addEventListener("message", async (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "tkp-dashboard") return;

    if (d.type === "PING") {
      const v = version();
      if (v) post({ type: "PONG", version: v });
      return;
    }

    try {
      await chrome.runtime.sendMessage({ kind: "tkp-cmd", cmd: d });
    } catch (_) {
      post({
        type: "ERROR",
        jobId: d.jobId,
        message: "Extension tidak merespons. Muat ulang halaman dashboard ini.",
      });
    }
  });

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.kind === "tkp-event") post(msg.event);
    });
  } catch (_) {}

  const v = version();
  if (v) post({ type: "PONG", version: v });
})();
