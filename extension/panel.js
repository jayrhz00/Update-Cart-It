const DEFAULT_API =
  typeof CART_IT_CONFIG !== "undefined" && CART_IT_CONFIG.defaultApiBase
    ? CART_IT_CONFIG.defaultApiBase
    : "https://cart-it.onrender.com";
const FALLBACK_LOCAL_API =
  typeof CART_IT_CONFIG !== "undefined" && CART_IT_CONFIG.fallbackLocalApi
    ? CART_IT_CONFIG.fallbackLocalApi
    : "http://127.0.0.1:5001";

/** Drop BNPL/shipping-style amounts when a larger cluster of prices exists (Fashion Nova–style pages). */
function pickRepresentativePrice(arr) {
  const vals = [...new Set(arr.filter((n) => typeof n === "number" && n > 0 && n < 1_000_000))].sort(
    (a, b) => a - b
  );
  if (!vals.length) return null;
  if (vals.length === 1) return vals[0];
  const lo = vals[0];
  const hi = vals[vals.length - 1];
  if (hi / lo < 3) return lo;
  const med = vals[Math.floor(vals.length / 2)];
  const filtered = vals.filter((p) => !(p < med * 0.35 && p < 20));
  return filtered.length ? Math.min(...filtered) : lo;
}

/** Runs in the product tab — name, price, image, store from the page. */
function getPageData() {
  const textFromScript = (selector) => {
    const el = document.querySelector(selector);
    return el?.textContent || "";
  };
  const ogImageRaw =
    document.querySelector('meta[property="og:image"]')?.content ||
    document.querySelector('meta[name="twitter:image"]')?.content ||
    document.querySelector('link[rel="image_src"]')?.href ||
    "";
  const parsePriceText = (raw) => {
    if (!raw) return null;
    const compact = String(raw).replace(/\s+/g, "");
    const match = compact.match(/([0-9][0-9.,]*)/);
    if (!match?.[1]) return null;
    let token = match[1];
    const hasComma = token.includes(",");
    const hasDot = token.includes(".");
    if (hasComma && hasDot) {
      const lastComma = token.lastIndexOf(",");
      const lastDot = token.lastIndexOf(".");
      if (lastComma > lastDot) {
        token = token.replace(/\./g, "").replace(",", ".");
      } else {
        token = token.replace(/,/g, "");
      }
    } else if (hasComma) {
      token = /,\d{1,2}$/.test(token) ? token.replace(",", ".") : token.replace(/,/g, "");
    }
    const parsed = Number(token);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const isAmazon = /\.amazon\./i.test(location.hostname);
  const hostNorm = (location.hostname || "").replace(/^www\./, "").toLowerCase();
  const isShein = hostNorm.includes("shein");

  const getAmazonPrice = () => {
    const selectors = [
      "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
      "#corePriceDisplay_mobile_feature_div .a-price .a-offscreen",
      "#corePrice_feature_div .a-price .a-offscreen",
      "#price_inside_buybox",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      "#priceblock_saleprice",
      "#reinvent_price_desktop_buybox .a-price .a-offscreen",
      "#apex_desktop .a-price .a-offscreen",
      'span[data-a-color="price"] .a-offscreen',
      ".a-price.aok-align-center .a-offscreen",
      ".a-price .a-offscreen",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const txt = el?.textContent || el?.getAttribute?.("content") || "";
      const parsed = parsePriceText(txt);
      if (parsed != null && /\.\d{2}\b/.test(String(txt))) return parsed;
    }
    return null;
  };

  const getAmazonPriceFromBuybox = () => {
    const roots = [
      document.querySelector("#buybox"),
      document.querySelector("#desktop_buybox"),
      document.querySelector("#unifiedPrice_feature_div"),
      document.querySelector("#corePriceDisplay_desktop_feature_div"),
      document.querySelector("#corePrice_feature_div"),
      document.querySelector("#apex_desktop"),
      document.querySelector("#rightCol"),
    ].filter(Boolean);
    const amounts = [];
    for (const root of roots) {
      root.querySelectorAll(".a-offscreen").forEach((el) => {
        const t = el.textContent || "";
        if (!/\d+\.\d{2}/.test(t)) return;
        const p = parsePriceText(t);
        if (p != null && p >= 0.01 && p < 1_000_000) amounts.push(p);
      });
    }
    if (!amounts.length) return null;
    return Math.min(...amounts);
  };

  const SAVINGS_BEFORE = /(?:save|saving|savings|off|discount|reward|coupon|bonus)\s*[:\-]?\s*\$?\s*$/i;
  const SAVINGS_AFTER = /^\s*(?:off|in\s+savings?|discount|saved|coupon)\b/i;
  const looksLikeSavingsAmount = (fullText, matchIndex, matchLength) => {
    const before = fullText.slice(Math.max(0, matchIndex - 32), matchIndex);
    if (SAVINGS_BEFORE.test(before)) return true;
    const afterStart = matchIndex + matchLength;
    const after = fullText.slice(afterStart, afterStart + 24);
    if (SAVINGS_AFTER.test(after)) return true;
    return false;
  };

  const pickNearCartPriceFromText = (text) => {
    const prices = [];
    const re = /(?:US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (looksLikeSavingsAmount(text, m.index, m[0].length)) continue;
      const p = parsePriceText(m[1]);
      if (p != null && p >= 0.01 && p < 1_000_000) prices.push(p);
    }
    if (!prices.length) return null;
    return pickRepresentativePrice(prices);
  };

  const priceNearPrimaryAddToCart = () => {
    const candidates = Array.from(
      document.querySelectorAll(
        'button[name="add"], button[id*="AddToCart"], button[class*="add-to-cart"], [data-add-to-cart], .cider-add-to-cart-btn, button[type="button"], [class*="add-cart"], [class*="addToCart"]'
      )
    );
    const btn = candidates.find((b) =>
      /add\s*to\s*cart|cart|bag|checkout|buy\s*now/i.test(b.textContent || "")
    );
    if (!btn) return null;
    const collected = [];
    let node = btn;
    for (let depth = 0; depth < 12 && node; depth++, node = node.parentElement) {
      const text = (node.innerText || "").slice(0, 4000);
      const re = /(?:US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (looksLikeSavingsAmount(text, m.index, m[0].length)) continue;
        const p = parsePriceText(m[1]);
        if (p != null && p >= 0.01 && p < 1_000_000) collected.push(p);
      }
    }
    return collected.length ? pickRepresentativePrice(collected) : null;
  };

  const extractJsonLdProductPrice = () => {
    const cands = [];
    const pushOffer = (o) => {
      const p = parsePriceText(o?.price ?? o?.lowPrice ?? o?.highPrice);
      if (p != null && p > 0) cands.push(p);
    };
    const walk = (root) => {
      if (!root || typeof root !== "object") return;
      const offers = root.offers;
      if (offers) {
        const list = Array.isArray(offers) ? offers : [offers];
        for (const o of list) pushOffer(o);
      }
      if (Array.isArray(root["@graph"])) for (const g of root["@graph"]) walk(g);
    };
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const node of scripts) {
      try {
        const data = JSON.parse(node.textContent);
        const roots = Array.isArray(data) ? data : [data];
        for (const root of roots) walk(root);
      } catch (_) {}
    }
    return cands.length ? pickRepresentativePrice(cands) : null;
  };

  const getSheinPrice = () => {
    const cands = [];
    const add = (raw) => {
      const p = parsePriceText(String(raw).trim());
      if (p != null && p >= 0.5 && p < 50000) cands.push(p);
    };
    const scope =
      document.querySelector("#productMainColumnId, #goodsDetailAnchor, [id*='goodsDetail'], main") ||
      document.body;
    const chunk = (scope.innerText || "").replace(/\s+/g, " ").slice(0, 16000);
    const usdRe = /(?:US\$|\$)\s*(\d{1,5}\.\d{2})\b/g;
    let m;
    while ((m = usdRe.exec(chunk)) !== null) {
      add(m[1]);
    }
    document.querySelectorAll('[class*="price"], [class*="Price"]').forEach((el) => {
      const t = (el.textContent || "").replace(/\s+/g, " ");
      if (!/(?:US\$|\$)\s*\d/.test(t)) return;
      const mm = t.match(/(?:US\$|\$)\s*(\d{1,5}\.\d{2})/);
      if (mm) add(mm[1]);
    });
    if (!cands.length) {
      const salePair = chunk.match(
        /\b(\d{1,3}\.\d{2})\b[\s\S]{0,120}(?:US\$|\$)\s*(\d{1,3}\.\d{2})\b/
      );
      if (salePair) {
        add(salePair[1]);
        add(salePair[2]);
      }
    }
    if (!cands.length) {
      document.querySelectorAll("script:not([src])").forEach((s) => {
        const t = s.textContent || "";
        if (t.length < 80 || t.length > 900000) return;
        if (!/salePrice|retailPrice|"price"|goods_id|productInfo/i.test(t)) return;
        for (const mm of t.matchAll(
          /"(?:sale_price|salePrice|retail_price|retailPrice|unit_discount_price|price)"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi
        )) {
          add(mm[1]);
        }
      });
    }
    if (!cands.length) return null;
    return pickRepresentativePrice([...new Set(cands)]);
  };

  const pickSheinProductImage = () => {
    const imgs = Array.from(document.querySelectorAll('img[src*="ltwebstatic.com"], img[src*="shein"]'));
    let best = "";
    let bestScore = -1e9;
    for (const img of imgs) {
      const src = (img.currentSrc || img.src || "").trim();
      if (!src || src.startsWith("data:")) continue;
      if (/logo|icon|sprite|badge|banner|avatar|emoji|payment|trustpilot|footer/i.test(src)) continue;
      let score = 0;
      const dim = src.match(/_(\d{2,4})x(\d{2,4})/);
      if (dim) score += parseInt(dim[1], 10) * parseInt(dim[2], 10);
      else score += 8000;
      if (/list_?0|thumb|thumbnail|small|mini|_s\.|_xs\.|\b150x|\b220x/i.test(src)) score -= 400000;
      if (/\/large\/|\b850x|\b900x|\b1000x|origin|imresize|big/i.test(src)) score += 350000;
      const alt = (img.getAttribute("alt") || "").toLowerCase();
      if (alt.length > 8 && !/shein\.com|women|curve|home|close|zoom|size/i.test(alt)) score += 12000;
      if (score > bestScore) {
        bestScore = score;
        best = src;
      }
    }
    return best;
  };

  let price = null;
  if (isAmazon) {
    price = getAmazonPrice() ?? getAmazonPriceFromBuybox();
  } else if (isShein) {
    price = getSheinPrice() ?? extractJsonLdProductPrice() ?? priceNearPrimaryAddToCart();
  } else {
    price = extractJsonLdProductPrice();
  }

  if (price == null && !isAmazon) {
    const genericSels = [
      ".price", ".product-price", ".sale-price", ".current-price",
      ".product__price", ".pdp-price", ".cider-product-price",
      "[itemprop='price']", "[data-testid*='price']",
      "[data-test='product-price']", "[data-test*='current-price']",
      "[data-test*='product-price']"
    ];
    const foundPrices = [];
    for (const sel of genericSels) {
      document.querySelectorAll(sel).forEach((el) => {
        const raw = el.textContent || el.getAttribute("content") || "";
        if (looksLikeSavingsAmount(raw, 0, raw.length)) return;
        const p = parsePriceText(raw);
        if (p != null && p > 0) foundPrices.push(p);
      });
    }
    if (foundPrices.length) price = pickRepresentativePrice(foundPrices);
  }

  if (price == null) price = priceNearPrimaryAddToCart();

  const product_description = (
    document.querySelector('meta[property="og:description"]')?.content ||
    document.querySelector('meta[name="description"]')?.content ||
    ""
  ).trim();

  const finalName = (
    document.querySelector('meta[property="og:title"]')?.content ||
    document.querySelector("h1")?.textContent ||
    document.title ||
    "Untitled page"
  ).trim();

  // Use the URL the user is actually viewing (with tracking params stripped) instead of
  // <link rel="canonical">. Some retailers (notably Amazon) collapse all color/size variants
  // onto a single canonical URL, which made saving a different color of the same product
  // dedupe onto the previous variant. The live URL keeps variant info (ASIN, ?color=, etc.)
  // so each variant becomes its own wishlist row.
  const stripTrackingParams = (href) => {
    try {
      const u = new URL(href);
      const TRACKING_KEYS = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "gclid",
        "fbclid",
        "msclkid",
        "ref",
        "ref_",
        "ref_src",
        "tag",
        "linkCode",
        "creativeASIN",
        "ascsubtag",
        "psc",
        "_encoding",
        "smid",
        "gclsrc",
      ];
      TRACKING_KEYS.forEach((k) => u.searchParams.delete(k));
      const search = u.searchParams.toString();
      return `${u.origin}${u.pathname}${search ? `?${search}` : ""}`;
    } catch {
      return href;
    }
  };
  const finalUrl = stripTrackingParams(location.href).trim();

  let image_url = (ogImageRaw || "").trim();
  if (isShein) {
    const sheinImg = pickSheinProductImage();
    if (sheinImg) image_url = sheinImg;
  } else if (
    image_url &&
    /logo|og-default|placeholder|favicon|sprite/i.test(image_url) &&
    !/ltwebstatic|cloudinary|img\./i.test(image_url)
  ) {
    const fallbackImg =
      document.querySelector('meta[property="og:image:secure_url"]')?.content ||
      document.querySelector('article img[src^="http"], main img[src^="http"]')?.src ||
      "";
    if (fallbackImg && !/logo/i.test(fallbackImg)) image_url = fallbackImg;
  }

  return {
    item_name: finalName.slice(0, 250),
    product_url: finalUrl,
    image_url,
    product_description: product_description.slice(0, 1000),
    store: location.hostname.replace(/^www\./, "").slice(0, 95),
    current_price: price != null ? price : 0,
    is_in_stock: true,
  };
}

let lastCapture = null;
let authRejected = false;
let cachedGroups = [];
let currentUserLabel = "";
let manualPriceDirty = false;

function truncate(s, max) {
  const t = String(s || "");
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

async function getWebAppOrigin() {
  const fallback =
    typeof CART_IT_CONFIG !== "undefined" && CART_IT_CONFIG.defaultWebAppOrigin
      ? CART_IT_CONFIG.defaultWebAppOrigin
      : "https://cart-it.com";
  
  if (fallback.includes("localhost") || fallback.includes("127.0.0.1")) {
    return fallback.replace(/\/$/, "");
  }

  const { webAppOrigin: stored } = await chrome.storage.local.get(["webAppOrigin"]);
  const raw = String(stored || fallback).trim().replace(/\/$/, "");
  return raw || fallback.replace(/\/$/, "");
}

function setStatus(text, ok) {
  const el = document.getElementById("status");
  if (!el) return;
  if (!text) {
    el.className = "";
    el.textContent = "";
    el.classList.remove("active");
    return;
  }
  el.textContent = text;
  el.className = ok ? "ok active" : "err active";
}

function setWishlistLink(href) {
  const el = document.getElementById("viewWishlistLink");
  const row = document.getElementById("afterSaveActions");
  if (!el) return;
  if (!href) {
    el.removeAttribute("href");
    if (row) row.hidden = true;
    return;
  }
  el.href = href;
  if (row) row.hidden = false;
}

function setTabHint(text) {
  const el = document.getElementById("tabHint");
  if (el) el.textContent = text || "";
}

function setPriceHint(text, ok = true) {
  const el = document.getElementById("priceHint");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = ok ? "#166534" : "#991b1b";
}

function setCapturePreview(result) {
  const wrap = document.getElementById("capturePreview");
  const imgEl = document.getElementById("capturePreviewImg");
  const descEl = document.getElementById("capturePreviewDesc");
  if (!wrap || !imgEl || !descEl) return;
  const img = (result?.image_url && String(result.image_url).trim()) || "";
  const desc = (result?.product_description && String(result.product_description).trim()) || "";
  const title = (result?.item_name && String(result.item_name).trim()) || "";
  if (!img && !desc && !title) {
    wrap.hidden = true;
    imgEl.removeAttribute("src");
    descEl.textContent = "";
    return;
  }
  wrap.hidden = false;
  if (img) {
    imgEl.hidden = false;
    imgEl.src = img;
    imgEl.referrerPolicy = "no-referrer";
    imgEl.onerror = () => {
      imgEl.hidden = true;
    };
  } else {
    imgEl.hidden = true;
    imgEl.removeAttribute("src");
  }
  const descText = desc || title;
  if (descText) {
    descEl.hidden = false;
    descEl.textContent = descText.length > 220 ? `${descText.slice(0, 217)}…` : descText;
  } else {
    descEl.hidden = true;
    descEl.textContent = "";
  }
}

async function resolveJwt() {
  // Honor explicit user actions: if a token is already stored, trust it and don't auto-resync
  // from open cart-it.com tabs (otherwise sign-out and sign-in-as-other-user keep flipping back).
  const stored = await chrome.storage.local.get(["jwt", "manualAuth"]);
  if (isLikelyJwt(stored.jwt)) {
    authRejected = false;
    return stored.jwt;
  }
  if (stored.manualAuth === "signed-out") {
    return "";
  }
  await requestTokenSyncFromBackground();
  await syncTokenFromOpenTabs();
  const { jwt } = await chrome.storage.local.get(["jwt"]);
  const tok = isLikelyJwt(jwt) ? jwt : "";
  if (tok) authRejected = false;
  return tok;
}

async function getCartItTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch { return []; }
  return tabs.filter((tab) => {
    if (!tab?.id || !tab.url) return false;
    try {
      const u = new URL(tab.url);
      return isCartItHost(u.hostname);
    } catch { return false; }
  });
}

async function clearTokenFromOpenTabs() {
  const localTabs = await getCartItTabs();
  for (const tab of localTabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            localStorage.removeItem("token");
          } catch { /* ignore */ }
        },
      });
    } catch { /* no access */ }
  }
}

async function pushTokenToOpenTabs(jwt) {
  if (!isLikelyJwt(jwt)) return;
  const localTabs = await getCartItTabs();
  for (const tab of localTabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (token) => {
          try {
            const existing = localStorage.getItem("token");
            if (existing === token) return;
            localStorage.setItem("token", token);
          } catch { /* ignore */ }
        },
        args: [jwt],
      });
      try {
        await chrome.tabs.reload(tab.id);
      } catch { /* ignore */ }
    } catch { /* no access */ }
  }
}

async function setAuthLine() {
  const el = document.getElementById("authStatus");
  const userBanner = document.getElementById("signedInUser");
  const avatar = document.getElementById("userAvatar");
  const signInWrap = document.getElementById("signInWrap");
  const syncBtn = document.getElementById("syncSessionBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  const jwt = await resolveJwt();
  const ok = !!jwt;

  if (ok && !currentUserLabel) {
    try {
      const base = await apiBase();
      const meRes = await fetch(`${base}/api/me`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const meData = await meRes.json().catch(() => null);
      if (meRes.ok) {
        currentUserLabel = String(meData?.user?.username || meData?.user?.email || "");
      }
    } catch { /* ignore */ }
  }

  if (el) {
    el.textContent = ok
      ? "You're signed in. Save items from any product page."
      : "Leave cart-it.com open while logged in, then tap Sync login.";
  }

  if (userBanner) userBanner.textContent = ok && currentUserLabel ? currentUserLabel : "Not signed in";
  if (avatar && ok && currentUserLabel) avatar.textContent = currentUserLabel.charAt(0).toUpperCase();
  
  if (signInWrap) signInWrap.hidden = ok;
  if (syncBtn) syncBtn.hidden = ok;
  if (signOutBtn) signOutBtn.hidden = !ok;
  const goToDashBtn = document.getElementById("goToDashboardBtn");
  if (goToDashBtn) goToDashBtn.hidden = !ok;
}

function isLikelyJwt(token) {
  return typeof token === "string" && token.split(".").length === 3 && token.length > 20;
}

function isCartItHost(hostname) {
  const fn = globalThis.CART_IT_CONFIG?.isWebAppHost;
  if (typeof fn === "function") return fn(hostname);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("cart-it");
}

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
  } catch { /* no access */ }
  
  let tok = normalizePanelToken(raw);
  if (isLikelyJwt(tok)) return tok;
  
  try {
    const inj = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readFunc,
    });
    raw = inj?.[0]?.result ?? "";
  } catch { /* MAIN unsupported */ }
  return normalizePanelToken(raw);
}

function normalizePanelToken(raw) {
  let t = typeof raw === "string" ? raw.trim() : "";
  if (t.startsWith("Bearer ")) t = t.slice(7).trim();
  return t;
}

function requestTokenSyncFromBackground() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "REQUEST_TOKEN_SYNC" }, (r) => {
        void chrome.runtime.lastError;
        resolve(r && r.ok === true);
      });
    } catch {
      resolve(false);
    }
  });
}

async function syncTokenFromOpenTabs() {
  const tabs = await chrome.tabs.query({});
  const localTabs = tabs.filter((tab) => {
    if (!tab?.id || !tab.url) return false;
    try {
      const u = new URL(tab.url);
      return isCartItHost(u.hostname);
    } catch { return false; }
  });

  for (const tab of localTabs) {
    try {
      const clean = await readTokenFromTab(tab.id);
      if (isLikelyJwt(clean)) {
        const origin = new URL(tab.url).origin;
        await chrome.storage.local.set({ jwt: clean, jwt_origin: origin });
        return true;
      }
    } catch { /* ignore */ }
  }
  return false;
}

async function apiBase() {
  const { apiBase: raw } = await chrome.storage.local.get(["apiBase"]);
  return (raw || DEFAULT_API).replace(/\/$/, "");
}

async function refreshFromTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      lastCapture = null;
      setTabHint("");
      return false;
    }

    const manualPriceEl = document.getElementById("manualPrice");
    if (manualPriceEl) {
      manualPriceEl.addEventListener("input", () => {
        manualPriceDirty = true;
      });

      if (!manualPriceDirty) {
        manualPriceEl.placeholder = "Detecting price...";
        manualPriceEl.value = "";
      }
    }
    setPriceHint("Detecting price from page...", true);

    const inj = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: getPageData,
    });
    const result = inj?.[0]?.result;
    if (!result) {
      if (manualPriceEl) manualPriceEl.placeholder = "Price not found";
      setPriceHint("Price not found. Please enter manually.", false);
      return false;
    }
    
    lastCapture = result;
    setCapturePreview(result);
    
    if (manualPriceEl && (!manualPriceDirty || manualPriceEl.value === "")) {
      if (result.current_price > 0) {
        manualPriceEl.value = String(result.current_price);
        manualPriceEl.placeholder = "";
      } else {
        manualPriceEl.placeholder = "Enter price";
      }
    }
    
    if (Number(result?.current_price || 0) > 0) {
      setPriceHint(`Auto price: $${Number(result.current_price).toFixed(2)}`, true);
    } else {
      setPriceHint("Price not found. Please enter manually.", false);
    }
    
    const title = (result.item_name || "").trim();
    setTabHint(title ? `From: ${truncate(title, 50)}` : "Ready to save.");
    return true;
  } catch (e) {
    lastCapture = null;
    setCapturePreview(null);
    setTabHint("");
    return false;
  }
}

async function loadCategories() {
  const jwt = await resolveJwt();
  const base = await apiBase();
  const sel = document.getElementById("category");
  if (!sel) return;
  
  if (!jwt) {
    sel.innerHTML = '<option value="">No category</option>';
    return;
  }
  
  try {
    const res = await fetch(`${base}/api/groups`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return;
    
    cachedGroups = Array.isArray(data) ? data : [];
    renderCategoryOptions();
  } catch { /* ignore */ }
}

function renderCategoryOptions() {
  const sel = document.getElementById("category");
  const scopeEl = document.getElementById("listScope");
  if (!sel) return;
  
  const prev = sel.value;
  const scope = scopeEl?.value || "Private";
  sel.innerHTML = '<option value="">No category</option>';
  
  const filtered = cachedGroups.filter((g) => String(g.visibility || "Private") === scope);
  for (const g of filtered) {
    const opt = document.createElement("option");
    opt.value = String(g.group_id);
    opt.textContent = g.group_name || `Category ${g.group_id}`;
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

async function loadWishlistItems() {
  const container = document.getElementById("wishlistItemsContainer");
  if (!container) return;
  
  const jwt = await resolveJwt();
  const base = await apiBase();
  
  if (!jwt) {
    container.innerHTML = '<div class="empty-state"><p>Sign in to view your items.</p></div>';
    return;
  }
  
  container.innerHTML = '<div class="empty-state"><p>Loading items...</p></div>';
  
  try {
    const gidRaw = document.getElementById("category").value;
    const url = gidRaw ? `${base}/api/cart-items?group_id=${gidRaw}` : `${base}/api/cart-items`;
    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const items = await res.json();
    
    if (!res.ok || !Array.isArray(items) || items.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No items found in this category.</p></div>';
      return;
    }
    
    container.innerHTML = "";
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "wishlist-item";
      el.innerHTML = `
        <img src="${item.image_url || 'icon.png'}" onerror="this.src='icon.png'" />
        <div class="wishlist-item-info">
          <p class="wishlist-item-name">${truncate(item.item_name, 40)}</p>
          <p class="wishlist-item-price">$${Number(item.current_price || 0).toFixed(2)}</p>
          <div class="wishlist-item-actions">
            <button class="action-icon-btn open-btn" title="Open product">🔗</button>
            <button class="action-icon-btn delete-btn" title="Delete">🗑️</button>
          </div>
        </div>
      `;
      el.querySelector(".open-btn").addEventListener("click", () => chrome.tabs.create({ url: item.product_url }));
      el.querySelector(".delete-btn").addEventListener("click", async () => {
        if (!confirm("Delete this item?")) return;
        await fetch(`${base}/api/cart-items/${item.item_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${jwt}` },
        });
        loadWishlistItems();
      });
      container.appendChild(el);
    });
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Error loading items.</p></div>';
  }
}

// Tab Switching
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    
    btn.classList.add("active");
    const panelId = `${btn.dataset.tab}Panel`;
    document.getElementById(panelId).classList.add("active");
    
    if (btn.dataset.tab === "wishlist") loadWishlistItems();
    if (btn.dataset.tab === "account") setAuthLine();
  });
});

document.getElementById("toggleNewCat")?.addEventListener("click", () => {
  const wrap = document.getElementById("newCatWrap");
  if (wrap) wrap.hidden = !wrap.hidden;
});

document.getElementById("createCatBtn")?.addEventListener("click", async () => {
  const name = document.getElementById("newCatName").value.trim();
  if (!name) return setStatus("Enter a name.", false);
  
  const jwt = await resolveJwt();
  const base = await apiBase();
  const visibility = document.getElementById("listScope").value;
  
  try {
    const res = await fetch(`${base}/api/groups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ group_name: name, visibility }),
    });
    if (res.ok) {
      const data = await res.json();
      document.getElementById("newCatName").value = "";
      document.getElementById("newCatWrap").hidden = true;
      await loadCategories();
      document.getElementById("category").value = String(data.group.group_id);
      setStatus("Category created!", true);
    }
  } catch (e) { setStatus("Error creating category.", false); }
});

document.getElementById("saveBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("saveBtn");
  btn.disabled = true;
  setStatus("Saving...", true);
  
  try {
    const jwt = await resolveJwt();
    if (!jwt) return setStatus("Please sign in first.", false);
    
    const cap = lastCapture;
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const product_url = cap?.product_url || activeTab?.url;
    const item_name = cap?.item_name || activeTab?.title || "New Item";
    const manualPriceVal = document.getElementById("manualPrice").value;
    const current_price = manualPriceVal !== "" ? parseFloat(manualPriceVal) : (cap?.current_price || 0);
    
    const body = {
      item_name,
      product_url,
      current_price,
      image_url: cap?.image_url,
      store: cap?.store,
      notes: document.getElementById("notes").value,
      group_id: document.getElementById("category").value || null,
    };
    
    console.log("Saving body:", body);
    const base = await apiBase();
    console.log("Calling API:", `${base}/api/cart-items`);
    const res = await fetch(`${base}/api/cart-items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
    });
    
    console.log("Save response status:", res.status);
    if (res.ok) {
      const data = await res.json();
      console.log("Saved item data:", data);
      const wasUpdate = res.status === 200;
      setStatus(wasUpdate ? "Already saved — updated price." : "Saved successfully!", true);
      const webBase = await getWebAppOrigin();
      const dashboardUrl = `${webBase}/dashboard`;

      const wishlistLink = document.getElementById("viewWishlistLink");
      if (wishlistLink) {
        wishlistLink.href = dashboardUrl;
        wishlistLink.onclick = (e) => {
          e.preventDefault();
          chrome.tabs.create({ url: dashboardUrl });
        };
      }

      setWishlistLink(dashboardUrl);
    } else {
      const err = await res.json();
      setStatus(err.message || "Save failed.", false);
    }
  } catch (e) { setStatus("Network error.", false); }
  finally { btn.disabled = false; }
});

document.getElementById("reScrapeBtn")?.addEventListener("click", () => {
  setStatus("Refreshing page data...", true);
  refreshFromTab().then(() => setStatus("Refreshed.", true));
});

document.getElementById("aiSummarizeBtn")?.addEventListener("click", async () => {
  if (!lastCapture) return setStatus("No product data captured yet.", false);
  
  const jwt = await resolveJwt();
  const base = await apiBase();
  if (!jwt) return setStatus("Please sign in to use AI features.", false);
  
  setStatus("AI is summarizing...", true);
  try {
    const res = await fetch(`${base}/api/ai/summarize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        item_name: lastCapture.item_name,
        product_description: lastCapture.product_description,
        store: lastCapture.store,
      }),
    });
    const data = await res.json();
    if (res.ok && data.summary) {
      document.getElementById("notes").value = data.summary;
      setStatus("Summary added to notes!", true);
    } else {
      setStatus(data.message || "AI summary failed.", false);
    }
  } catch (e) { setStatus("Error connecting to AI service.", false); }
});

document.getElementById("goToDashboardBtn")?.addEventListener("click", async () => {
  const origin = await getWebAppOrigin();
  chrome.tabs.create({ url: `${origin}/dashboard` });
});

document.getElementById("signOutBtn")?.addEventListener("click", async () => {
  await clearTokenFromOpenTabs();
  await chrome.storage.local.remove(["jwt", "jwt_origin"]);
  await chrome.storage.local.set({ manualAuth: "signed-out" });
  currentUserLabel = "";
  await setAuthLine();
  await loadCategories();
  setStatus("Signed out.", true);
});

document.getElementById("signInBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("signInEmail").value.trim();
  const password = document.getElementById("signInPassword").value;
  if (!email || !password) return setStatus("Enter email and password.", false);
  
  const base = await apiBase();
  try {
    const res = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) {
      await chrome.storage.local.set({ jwt: data.token, manualAuth: "signed-in" });
      currentUserLabel = data.user?.username || data.user?.email || "";
      await pushTokenToOpenTabs(data.token);
      await setAuthLine();
      await loadCategories();
      setStatus("Signed in!", true);
    } else {
      setStatus(data.message || "Sign in failed.", false);
    }
  } catch (e) { setStatus("Network error.", false); }
});

document.getElementById("createAccountBtn")?.addEventListener("click", async () => {
  const origin = await getWebAppOrigin();
  chrome.tabs.create({ url: `${origin}/signup` });
});

document.getElementById("syncSessionBtn")?.addEventListener("click", async () => {
  setStatus("Syncing...", true);
  await chrome.storage.local.remove(["manualAuth"]);
  await syncTokenFromOpenTabs();
  currentUserLabel = "";
  await setAuthLine();
  await loadCategories();
  setStatus("Synced!", true);
});

document.getElementById("listScope")?.addEventListener("change", renderCategoryOptions);
document.getElementById("category")?.addEventListener("change", () => {
  if (document.querySelector(".tab-btn[data-tab='wishlist']").classList.contains("active")) {
    loadWishlistItems();
  }
});

document.getElementById("closePanelBtn")?.addEventListener("click", () => {
  window.close();
});

// Initialization
async function init() {
  await setAuthLine();
  await loadCategories();
  await refreshFromTab();
}

init();
