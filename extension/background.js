try {
  importScripts("config.js");
} catch {
  /* config optional in some dev setups */
}

/** Toolbar icon opens the side panel (Chrome 114+). */
function registerPanelClickOpensSide() {
  if (!chrome?.sidePanel?.setPanelBehavior) return Promise.resolve();
  return chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(registerPanelClickOpensSide);
chrome.runtime.onStartup.addListener(registerPanelClickOpensSide);
registerPanelClickOpensSide();

function normalizeToken(raw) {
  let t = typeof raw === "string" ? raw.trim() : "";
  if (t.startsWith("Bearer ")) t = t.slice(7).trim();
  return t;
}

function isLikelyJwt(token) {
  return typeof token === "string" && token.split(".").length === 3 && token.length > 20;
}

function isCartItHost(hostname) {
  const fn = globalThis.CART_IT_CONFIG?.isWebAppHost;
  if (typeof fn === "function") return fn(hostname);
  return (
    hostname === "cart-it.com" ||
    hostname === "www.cart-it.com" ||
    hostname.endsWith(".cart-it.com") ||
    hostname === "cart-it.pages.dev" ||
    hostname.endsWith(".cart-it.pages.dev") ||
    (hostname.endsWith(".pages.dev") && /cart-it/i.test(hostname)) ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

/**
 * Pull JWT from any open cart-It tab (cart-it.com, pages.dev, localhost / 127.0.0.1).
 * The side panel often runs on a shop tab, so the content script there never runs —
 * this keeps chrome.storage.local.jwt in sync with the site you logged into.
 */
/**
 * Read auth token from the tab's page storage. Tries the extension isolated world first,
 * then the page MAIN world — some environments only expose localStorage consistently in MAIN.
 */
async function readTokenFromTab(tabId) {
  const readFunc = () => {
    try {
      const t = localStorage.getItem("token");
      return typeof t === "string" ? t : "";
    } catch {
      return "";
    }
  };
  let raw = "";
  try {
    const inj = await chrome.scripting.executeScript({
      target: { tabId },
      func: readFunc,
    });
    raw = inj?.[0]?.result ?? "";
  } catch {
    /* no access */
  }
  let tok = normalizeToken(raw);
  if (isLikelyJwt(tok)) return tok;
  try {
    const inj = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readFunc,
    });
    raw = inj?.[0]?.result ?? "";
  } catch {
    /* MAIN unsupported or blocked */
  }
  return normalizeToken(raw);
}

async function syncTokenFromCartItTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let u;
    try {
      u = new URL(tab.url);
    } catch {
      continue;
    }
    if (!isCartItHost(u.hostname)) continue;
    try {
      const tok = await readTokenFromTab(tab.id);
      if (isLikelyJwt(tok)) {
        await chrome.storage.local.set({ jwt: tok, jwt_origin: u.origin });
        return true;
      }
    } catch {
      /* restricted page or no access */
    }
  }
  return false;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CARTIT_TOKEN") {
    const token = normalizeToken(message.token);
    // Empty pushes are common (other tabs, timing); never wipe a valid stored JWT.
    if (!isLikelyJwt(token)) return false;
    const payload = { jwt: token };
    if (_sender?.url) {
      try {
        const u = new URL(_sender.url);
        if (isCartItHost(u.hostname)) {
          payload.jwt_origin = u.origin;
        }
      } catch {
        /* ignore */
      }
    }
    chrome.storage.local.set(payload);
    return false;
  }
  if (message?.type === "REQUEST_TOKEN_SYNC") {
    syncTokenFromCartItTabs()
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});
