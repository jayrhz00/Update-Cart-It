/**
 * Runs on cart-It web pages (same origin as localStorage).
 * Mirrors the login JWT into extension storage so the side panel can call the API without
 * asking the user to paste a token.
 */
(function cartItTokenBridge() {
  const STORAGE_KEY = "token";
  let timerId = null;

  function pushToken() {
    if (!chrome?.runtime?.id) return;
    let token = null;
    try {
      token = localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      token = null;
    }
    if (typeof token === "string" && token.startsWith("Bearer ")) {
      token = token.slice(7).trim();
    }
    try {
      chrome.runtime.sendMessage({ type: "CARTIT_TOKEN", token }, () => {
        // When an extension is reloaded/updated, the old page context can outlive it briefly.
        // Ignore errors like: "Extension context invalidated."
        void chrome.runtime.lastError;
      });
    } catch (_) {
      /* ignore */
    }
  }

  pushToken();
  timerId = setInterval(pushToken, 1200);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pushToken();
  });
  window.addEventListener("focus", pushToken);
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key == null) pushToken();
  });

  window.addEventListener("beforeunload", () => {
    if (timerId) clearInterval(timerId);
    timerId = null;
  });
})();
