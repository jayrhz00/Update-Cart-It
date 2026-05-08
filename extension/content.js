/**
 * Runs on cart-It web pages (same origin as localStorage).
 * Two-way bridge:
 *  - Page → extension: when the site has a JWT in localStorage, mirror it into chrome.storage.local
 *    so the side panel can call the API without asking the user to paste a token.
 *  - Extension → page: when the user signed in through the side panel and a fresh tab opens
 *    cart-it.com, write the extension's JWT into localStorage so the site is signed in too.
 */
(function cartItTokenBridge() {
  const STORAGE_KEY = "token";
  const SESSION_FLAG = "cartit-extension-token-applied";
  let timerId = null;

  function isLikelyJwt(token) {
    return typeof token === "string" && token.split(".").length === 3 && token.length > 20;
  }

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

  function pullExtensionToken() {
    if (!chrome?.storage?.local) return;
    try {
      chrome.storage.local.get(["jwt", "manualAuth"], ({ jwt, manualAuth }) => {
        if (manualAuth === "signed-out") return;
        if (!isLikelyJwt(jwt)) return;
        let existing = null;
        try {
          existing = localStorage.getItem(STORAGE_KEY);
        } catch (_) {
          existing = null;
        }
        if (isLikelyJwt(existing)) return;
        try {
          localStorage.setItem(STORAGE_KEY, jwt);
        } catch (_) {
          return;
        }
        // Reload once so the React app picks up the new auth state.
        try {
          if (sessionStorage.getItem(SESSION_FLAG)) return;
          sessionStorage.setItem(SESSION_FLAG, "1");
        } catch (_) {
          /* ignore */
        }
        try {
          location.reload();
        } catch (_) {
          /* ignore */
        }
      });
    } catch (_) {
      /* ignore */
    }
  }

  pullExtensionToken();
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
