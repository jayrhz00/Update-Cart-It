const DEFAULT_API =
  typeof CART_IT_CONFIG !== "undefined" && CART_IT_CONFIG.defaultApiBase
    ? CART_IT_CONFIG.defaultApiBase
    : "https://cart-it.onrender.com";

/** Runs in the product tab — name, price, image, store from the page. */
function getPageData() {
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
  const isFashionNova = hostNorm.endsWith("fashionnova.com") || hostNorm.includes("fashionnova.com");
  const isTarget = hostNorm.endsWith("target.com") || hostNorm.includes("target.com");

  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;
  const FRAG_NODE = 11;

  /** Shein / modern PDPs put price + gallery inside open shadow roots — light DOM text is empty. */
  const collectPageTextDeep = (maxLen) => {
    const buf = [];
    let curLen = 0;
    const collect = (node) => {
      if (!node || curLen > maxLen) return;
      if (node.nodeType === TEXT_NODE) {
        const t = node.textContent;
        if (t && /\S/.test(t)) {
          buf.push(t);
          curLen += t.length;
        }
        return;
      }
      if (node.nodeType === ELEMENT_NODE) {
        if (node.shadowRoot) collect(node.shadowRoot);
        for (let c = node.firstChild; c; c = c.nextSibling) collect(c);
      } else if (node.nodeType === FRAG_NODE) {
        for (let c = node.firstChild; c; c = c.nextSibling) collect(c);
      }
    };
    const start = document.body || document.documentElement;
    if (start) collect(start);
    return buf
      .join(" ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen);
  };

  const memoizedRoots = [];
  const getAllRoots = () => {
    if (memoizedRoots.length) return memoizedRoots;
    memoizedRoots.push(document);
    try {
      const stack = [...document.querySelectorAll("*")];
      while (stack.length) {
        const el = stack.pop();
        if (el && el.shadowRoot) {
          memoizedRoots.push(el.shadowRoot);
          const shadowEls = el.shadowRoot.querySelectorAll("*");
          for (let i = 0; i < shadowEls.length; i++) stack.push(shadowEls[i]);
        }
      }
    } catch (_) {}
    return memoizedRoots;
  };

  const querySelectorAllDeep = (sel) => {
    const out = [];
    for (const root of getAllRoots()) {
      try {
        root.querySelectorAll(sel).forEach((el) => out.push(el));
      } catch (_) {}
    }
    return out;
  };

  const absolutizeMediaUrl = (u) => {
    if (!u) return "";
    const s = String(u).trim();
    if (!s) return "";
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/") && !s.startsWith("//")) {
      try {
        return new URL(s, location.origin).href;
      } catch {
        return s;
      }
    }
    return s;
  };

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
  
  const BAD_PRICE_BEFORE = /(?:shipping|postage|delivery|interest-free|payments?\s*of|pay\s*later|afterpay|klarna|affirm|zip|quadpay|split\s*into|only|over|above|spend|orders|min|minimum|standard|expedited|express|saver)\s*[:\-]?\s*\$?\s*$/i;
  const BAD_PRICE_AFTER = /^\s*(?:shipping|delivery|interest-free|payments?|installments?|per\s+month|mo\b|for\s+free|more\s+to|off|discount|each|unit)/i;

  const looksLikeBadPrice = (fullText, matchIndex, matchLength) => {
    const before = fullText.slice(Math.max(0, matchIndex - 60), matchIndex);
    if (SAVINGS_BEFORE.test(before) || BAD_PRICE_BEFORE.test(before)) return true;
    const afterStart = matchIndex + matchLength;
    const after = fullText.slice(afterStart, afterStart + 60);
    if (SAVINGS_AFTER.test(after) || BAD_PRICE_AFTER.test(after)) return true;
    return false;
  };

  /** Drop BNPL/shipping-style amounts when a larger cluster of prices exists (Fashion Nova–style pages). */
  const pickRepresentativePrice = (arr) => {
    const vals = [...new Set(arr.filter((n) => typeof n === "number" && n > 0 && n < 1_000_000))].sort(
      (a, b) => a - b
    );
    if (!vals.length) return null;
    if (vals.length === 1) return vals[0];
    const lo = vals[0];
    const hi = vals[vals.length - 1];
    
    // If we have a huge gap (e.g. 16.00 vs 30.00),
    // we only pick high if the low one looks like an installment (exactly 1/4)
    // or is extremely low (< $6) while the high one is reasonable.
    // Also check if lo is a common shipping amount (like 4.99, 6.99, 9.99, 15.00, 16.00, 20.00).
    const commonShipping = [4.99, 5.00, 5.99, 6.99, 7.00, 7.99, 8.99, 9.00, 9.99, 12.00, 15.00, 16.00, 19.99, 20.00, 25.00];
    const looksLikeShipping = commonShipping.some(s => Math.abs(s - lo) < 0.05);

    if (hi / lo > 1.4 && lo < 45) {
      if (Math.abs(hi / 4 - lo) < 1.6) return hi;
      if (lo < 6.5 && hi < 500) return hi;
      if (looksLikeShipping && hi / lo > 1.6) return hi;
    }
    
    if (hi / lo < 3) return lo;
    const med = vals[Math.floor(vals.length / 2)];
    const filtered = vals.filter((p) => !(p < med * 0.35 && p < 20));
    return filtered.length ? Math.min(...filtered) : lo;
  };

  const pickNearCartPriceFromText = (text) => {
    const prices = [];
    const re = /(?:US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (looksLikeBadPrice(text, m.index, m[0].length)) continue;
      const p = parsePriceText(m[1]);
      if (p != null && p >= 0.01 && p < 1_000_000) prices.push(p);
    }
    if (!prices.length) return null;
    return pickRepresentativePrice(prices);
  };

  const climbDomIncludingShadow = (start, maxDepth, visitor) => {
    let node = start;
    for (let depth = 0; depth < maxDepth && node; depth++) {
      visitor(node);
      const p = node.parentNode;
      if (!p) {
        node = null;
      } else if (p.nodeType === ELEMENT_NODE) {
        node = p;
      } else if (p.nodeType === FRAG_NODE && p.host) {
        node = p.host;
      } else {
        node = null;
      }
    }
  };

  const priceNearPrimaryAddToCart = () => {
    const candidates = querySelectorAllDeep(
      'button[name="add"], button[id*="AddToCart"], button[class*="add-to-cart"], [data-add-to-cart], .cider-add-to-cart-btn, button[type="button"], [class*="add-cart"], [class*="addToCart"], [class*="product-form__submit"], button[type="submit"]'
    );
    const btn = candidates.find((b) =>
      /add\s*to\s*cart|add\s*to\s*bag|cart|bag|checkout|buy\s*now/i.test(b.textContent || "")
    );
    if (!btn) return null;
    const collected = [];
    climbDomIncludingShadow(btn, 14, (node) => {
      const text = (node.innerText || node.textContent || "").slice(0, 4000);
      const re = /(?:US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (looksLikeBadPrice(text, m.index, m[0].length)) continue;
        const p = parsePriceText(m[1]);
        if (p != null && p >= 0.01 && p < 1_000_000) collected.push(p);
      }
    });
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

  const getMetaTagPrice = () => {
    const metas = [
      document.querySelector('meta[property="product:price:amount"]'),
      document.querySelector('meta[property="og:price:amount"]'),
      document.querySelector('meta[itemprop="price"][content]'),
    ].filter(Boolean);
    const cands = [];
    for (const node of metas) {
      const raw = node.getAttribute("content") || "";
      const p = parsePriceText(raw);
      if (p != null && p > 0) cands.push(p);
    }
    const vis = document.querySelector('[itemprop="price"]');
    if (vis) {
      const raw = vis.getAttribute("content") || vis.textContent || "";
      const p = parsePriceText(raw);
      if (p != null && p > 0) cands.push(p);
    }
    return cands.length ? Math.min(...cands) : null;
  };

  /**
   * Shopify / Fashion Nova: `price` in ProductJson is usually **cents** (3149 → $31.49).
   * Parsing cents as dollars was the main reason FN prices failed.
   */
  const extractShopifyStyleJsonPrices = () => {
    const cands = [];
    const addRaw = (raw, priority = 0) => {
      const s = String(raw ?? "").trim();
      if (!s) return;
      if (!s.includes(".") && /^\d+$/.test(s)) {
        const n = Number(s);
        if (n >= 100 && n <= 99999999) {
          const dollars = n / 100;
          if (dollars >= 0.5 && dollars < 50000) {
            cands.push({ val: dollars, prio: priority });
            return;
          }
        }
        if (n > 0 && n < 50000) {
          cands.push({ val: n, prio: priority });
          return;
        }
        return;
      }
      const asDec = parsePriceText(s);
      if (asDec != null && asDec > 0 && asDec < 500000) cands.push({ val: asDec, prio: priority });
    };
    const consumeProductBlob = (obj) => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        for (const x of obj) consumeProductBlob(x);
        return;
      }
      // Prioritize sale keys
      for (const k of ["price", "price_min", "sale_price", "salePrice"]) {
        if (obj[k] != null && obj[k] !== "") addRaw(obj[k], 100);
      }
      for (const k of ["price_max", "compare_at_price", "compareAtPrice"]) {
        if (obj[k] != null && obj[k] !== "") addRaw(obj[k], -50);
      }
      if (Array.isArray(obj.variants)) {
        for (const v of obj.variants) consumeProductBlob(v);
      }
      if (obj.product && typeof obj.product === "object") consumeProductBlob(obj.product);
    };
    const tryParseScriptText = (t) => {
      if (!t || t.length < 8 || t.length > 600000) return;
      if (!/product|variants|price|shopify|ProductJson/i.test(t)) return;
      try {
        const data = JSON.parse(t);
        consumeProductBlob(data);
      } catch (_) {
        for (const mm of t.matchAll(
          /"(?:price|sale_price|salePrice|price_min)"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/gi
        )) {
          addRaw(mm[1], 80);
        }
        for (const mm of t.matchAll(
          /"(?:compare_at_price|compareAtPrice|price_max)"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/gi
        )) {
          addRaw(mm[1], -20);
        }
      }
    };

    document.querySelectorAll('script[type="application/json"]').forEach((node) => {
      tryParseScriptText(node.textContent || "");
    });
    document
      .querySelectorAll(
        'script[id*="ProductJson"], script[id*="product-json"], script[data-product-json]'
      )
      .forEach((node) => {
        tryParseScriptText(node.textContent || "");
      });
    
    if (!cands.length) return null;
    cands.sort((a, b) => b.prio - a.prio || a.val - b.val);
    return cands[0].val;
  };

  /**
   * When ProductJson fails JSON.parse (or lives in a non-standard script), regex-scan raw text.
   * Helps Fashion Nova when the PDP UI is behind closed shadow DOM but boot data is still in page HTML.
   */
  const extractShopifyPricesFromRawScripts = () => {
    const cands = [];
    const addCents = (n, priority = 0) => {
      if (typeof n !== "number" || !Number.isFinite(n)) return;
      if (n >= 100 && n <= 99999999) {
        const d = n / 100;
        if (d >= 0.5 && d < 50000) cands.push({ val: d, prio: priority });
        return;
      }
      if (n > 0 && n < 50000) cands.push({ val: n, prio: priority });
    };
    document.querySelectorAll("script:not([src])").forEach((node) => {
      const t = node.textContent || "";
      if (t.length < 60 || t.length > 2_500_000) return;
      if (!/shopify|cdn\.shop|ProductJson|variants|"price"|productId|featured_image/i.test(t)) return;
      
      for (const mm of t.matchAll(/"(?:price|price_min|sale_price)"\s*:\s*(\d{3,8})\b/g)) {
        addCents(Number(mm[1]), 100);
      }
      for (const mm of t.matchAll(/"(?:compare_at_price|compareAtPrice)"\s*:\s*(\d{3,8})\b/g)) {
        addCents(Number(mm[1]), -50);
      }
      // Also catch decimal strings in scripts
      for (const mm of t.matchAll(/"(?:price|price_min|sale_price)"\s*:\s*"(\d+\.\d{2})"/g)) {
        const p = parseFloat(mm[1]);
        if (p > 0) cands.push({ val: p, prio: 110 });
      }
    });
    
    if (!cands.length) return null;
    cands.sort((a, b) => b.prio - a.prio || a.val - b.val);
    return cands[0].val;
  };

  const getSheinPrice = () => {
    const cands = [];
    const add = (raw, contextText = "", priority = 0) => {
      const p = parsePriceText(String(raw).trim());
      if (p != null && p >= 0.1 && p < 50000) {
        // Ultimate exclusion for savings badges/conditional prices/shipping thresholds
        if (/(?:save|saving|off|discount|buy\s+\d+|more\s+to|coupon|points|limit|exclusive|reduced|extra|percent|estimated|spend|shipping|order|threshold|minimum|above|over)/i.test(contextText)) return;
        cands.push({ val: p, prio: priority });
      }
    };
    const scope =
      document.querySelector("#productMainColumnId, #goodsDetailAnchor, [id*='goodsDetail'], main") ||
      document.body;
    
    // 1. High-confidence Shein sale price classes - Highest priority
    querySelectorAllDeep('.price-info__price, .product-intro__price-sale, .sale-price, [class*="price-sale"], [class*="PriceSale"], .product-intro__price-actual, .product-intro__price-now').forEach(el => {
      const t = el.textContent || "";
      const cls = (el.className || "").toLowerCase();
      let prio = 200;
      // Demote if it's explicitly retail/original
      if (/(?:retail|original|was|del-price)/i.test(cls + t)) prio = -100;
      if (/\d/.test(t)) add(t, "ultimate-sale-priority", prio);
    });

    const light = (scope.innerText || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
    const deep = collectPageTextDeep(30000);
    const chunk = `${light} ${deep}`.replace(/\s+/g, " ").trim().slice(0, 30000);
    
    const usdRe = /(?:US\$|\$|USD)\s*(\d{1,5}\.\d{2})\b/gi;
    let m;
    while ((m = usdRe.exec(chunk)) !== null) {
      const before = chunk.slice(Math.max(0, m.index - 60), m.index);
      const after = chunk.slice(m.index + m[0].length, m.index + m[0].length + 60);
      let prio = 10;
      const combined = (before + after).toLowerCase();
      if (/(?:sale|current|now|only|actual|price\s*:)/i.test(combined)) prio = 70;
      if (/(?:retail|msrp|original|was|previous|compare)/i.test(combined)) prio = -80;
      add(m[1], combined, prio);
    }

    if (!cands.length) {
      document.querySelectorAll("script:not([src])").forEach((s) => {
        const t = s.textContent || "";
        if (t.length < 80 || t.length > 1500000) return;
        if (!/salePrice|retailPrice|"price"|goods_id|productInfo/i.test(t)) return;
        for (const mm of t.matchAll(
          /"(?:sale_price|salePrice|mainSalePrice|special_price|sku_sale_price|productPrice)"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/gi
        )) {
          add(mm[1], "json-sale-priority", 150);
        }
      });
    }

    if (!cands.length) return null;
    
    // Grab the winner with the highest confidence. 
    // If multiple have same priority, pick the SMALLEST (sale price usually wins over retail/bundle).
    const topPrio = cands[0].prio;
    const winners = cands.filter(c => c.prio === topPrio).map(c => c.val);
    if (topPrio >= 70) return Math.min(...winners);
    
    const vals = [...new Set(cands.map(c => c.val))];
    return pickRepresentativePrice(vals);
  };

  const resolveImgSrc = (img) => {
    const pick = (s) => (s && String(s).trim()) || "";
    let src = pick(
      img.getAttribute("data-original-src") ||
      img.getAttribute("data-zoom-src") ||
      img.getAttribute("data-src-webp") ||
      img.currentSrc ||
      img.getAttribute("src") ||
      img.src ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-before-crop-src")
    );
    
    // Handle srcset
    if (!src || src.startsWith("data:")) {
      const srcset = img.getAttribute("srcset");
      if (srcset) {
        const parts = srcset.split(",").map(p => p.trim().split(/\s+/)[0]);
        src = parts[parts.length - 1]; 
      }
    }
    return src;
  };

  const pickSheinProductImage = () => {
    const allImgs = querySelectorAllDeep("img");
    
    // 1. Priority: Images inside high-confidence gallery containers (searching through shadow roots)
    const gallerySelectors = [
      '.product-intro__main-img', '.main-image-container', '.js-main-image', 
      '.product-intro__img-container', '.c-video-container', '.gallery-slide',
      '.product-intro__gallery', '.she-image-container', '.image-box'
    ];
    
    let best = "";
    let bestScore = -1e9;

    for (const img of allImgs) {
      const src = resolveImgSrc(img);
      if (!src || src.startsWith("data:")) continue;
      if (/logo|icon|sprite|badge|banner|avatar|emoji|payment|trustpilot|footer|ad-item|prop-img|share-icon|loading|video/i.test(src)) continue;
      
      let score = 0;
      
      // Check ancestry for gallery classes
      let inGallery = false;
      climbDomIncludingShadow(img, 10, (node) => {
        if (node.className && typeof node.className === 'string') {
          if (gallerySelectors.some(sel => node.classList.contains(sel.slice(1)))) {
            inGallery = true;
          }
        }
      });
      
      if (inGallery) score += 1000000;

      const dim = src.match(/_(\d{2,4})x(\d{2,4})/);
      if (dim) score += parseInt(dim[1], 10) * parseInt(dim[2], 10);
      else score += 25000;

      if (/_goods_img|origin|imresize|main-img|primary-img|pdp-main|goods_id/i.test(src)) score += 900000;
      if (/\/large\/|\b850x|\b900x|\b1000x|\b1200x|\b1500x/i.test(src)) score += 700000;
      
      if (/list_?0|thumb|thumbnail|small|mini|_s\.|_xs\.|\b150x|\b220x|100x100/i.test(src)) score -= 1500000;
      
      const alt = (img.getAttribute("alt") || "").toLowerCase();
      if (alt.length > 10 && !/shein\.com|women|curve|home|close|zoom|size|click/i.test(alt)) score += 60000;
      
      if (score > bestScore) {
        bestScore = score;
        best = src;
      }
    }

    // 2. Fallback: Search for background images in gallery containers
    if (!best || bestScore < 500000) {
      for (const sel of gallerySelectors) {
        const els = querySelectorAllDeep(sel);
        for (const el of els) {
          const bg = window.getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none' && bg.includes('http')) {
            const m = bg.match(/url\(["']?([^"']+)["']?\)/);
            if (m?.[1]) return absolutizeMediaUrl(m[1]);
          }
        }
      }
    }

    return best;
  };

  /** Fashion Nova / Shopify: real photos are often on cdn.shopify.com; og:image may be a grey logo tile. */
  const pickShopifyStyleProductImage = () => {
    const imgs = querySelectorAllDeep("img").filter((img) => {
      const src = resolveImgSrc(img).toLowerCase();
      if (!src || src.startsWith("data:")) return false;
      if (
        /logo|icon|sprite|placeholder|1x1|1\.gif|pixel|spacer|badge|payment|navbar|header-nav|footer/i.test(
          src
        )
      ) {
        return false;
      }
      return /cdn\.shopify\.com|\/cdn\/shop\/|fashionnova|\/products\//i.test(src);
    });
    let best = "";
    let bestScore = -1e9;
    for (const img of imgs) {
      const src = resolveImgSrc(img);
      if (!src || src.startsWith("data:")) continue;
      if (/logo|placeholder|sprite|icon|footer|trust|payment/i.test(src)) continue;
      let score = 0;
      const dim = src.match(/[_/](\d{2,4})x(\d{2,4})(?:\.|\/|\?|$)/i);
      if (dim) score += parseInt(dim[1], 10) * parseInt(dim[2], 10);
      else score += 6000;
      if (/thumb|thumbnail|small|mini|50x|100x|150x|200x|_compact|_small/i.test(src)) score -= 300000;
      if (/1024|1536|2048|_grande|_large|master|zoom|2048x|width=\d{3,4}/i.test(src)) score += 250000;
      const alt = (img.getAttribute("alt") || "").toLowerCase();
      if (alt.length > 12 && !/fashion nova|novababe|close|zoom|size chart/i.test(alt)) score += 8000;
      if (score > bestScore) {
        bestScore = score;
        best = src;
      }
    }
    return best;
  };

  /** Pull Shopify CDN image URLs from preload + JSON blobs + srcset (works when <img> is in closed shadow). */
  const extractShopifyMediaFromPage = () => {
    const absolutize = (u) => {
      if (!u) return "";
      const s = String(u).trim();
      if (!s) return "";
      if (s.startsWith("//")) return `https:${s}`;
      if (s.startsWith("/") && !s.startsWith("//")) {
        try {
          return new URL(s, location.origin).href;
        } catch {
          return s;
        }
      }
      return s;
    };
    const scoreUrl = (u) => {
      let sc = Math.min(u.length, 800);
      if (/\d{3,4}x\d{3,4}/.test(u)) sc += 900;
      if (/thumb|small|compact|50x|100x|150x|icon\b|logo|placeholder|og-image|\.svg(\?|$)/i.test(u))
        sc -= 6000;
      return sc;
    };
    let best = "";
    let bestSc = -1e9;
    const consider = (raw) => {
      const a = absolutize(raw);
      if (!a || (!/shopify\.com/i.test(a) && !/\/cdn\/shop\//i.test(a))) return;
      if (/logo|placeholder|favicon|og-image|badge|payment|trustpilot/i.test(a)) return;
      const sc = scoreUrl(a);
      if (sc > bestSc) {
        bestSc = sc;
        best = a;
      }
    };
    document.querySelectorAll('link[rel="preload"][as="image"]').forEach((l) => consider(l.getAttribute("href")));
    document.querySelectorAll("script:not([src])").forEach((s) => {
      const t = s.textContent || "";
      if (t.length < 200 || !/cdn\.shopify\.com|\/cdn\/shop\//i.test(t)) return;
      const re = /(https?:)?\/\/cdn\.shopify\.com[^"'\\\s<>)]+/gi;
      let m;
      while ((m = re.exec(t)) !== null) {
        let u = m[0].replace(/\\+$/, "");
        consider(u);
      }
    });
    querySelectorAllDeep("img").forEach((img) => {
      consider(resolveImgSrc(img));
      const ss = img.getAttribute("srcset") || "";
      if (ss) {
        for (const part of ss.split(",")) {
          const url = part.trim().split(/\s+/)[0];
          consider(url);
        }
      }
    });
    querySelectorAllDeep("source[srcset]").forEach((src) => {
      const ss = src.getAttribute("srcset") || "";
      for (const part of ss.split(",")) {
        const url = part.trim().split(/\s+/)[0];
        consider(url);
      }
    });
    return best || null;
  };

  const extractJsonLdProductImage = () => {
    const walk = (o, depth = 0) => {
      if (depth > 20 || !o || typeof o !== "object") return "";
      if (typeof o.image === "string" && /^https?:\/\//i.test(o.image)) return o.image;
      if (o.image && typeof o.image === "object") {
        if (typeof o.image.url === "string") return o.image.url;
        if (Array.isArray(o.image) && o.image[0]) {
          const x = o.image[0];
          return typeof x === "string" ? x : x?.url || "";
        }
      }
      if (Array.isArray(o["@graph"])) {
        for (const g of o["@graph"]) {
          const u = walk(g, depth + 1);
          if (u) return u;
        }
      }
      for (const v of Object.values(o)) {
        if (v && typeof v === "object") {
          const u = walk(v, depth + 1);
          if (u) return u;
        }
      }
      return "";
    };
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const node of scripts) {
      try {
        const data = JSON.parse(node.textContent || "{}");
        const roots = Array.isArray(data) ? data : [data];
        for (const root of roots) {
          const u = walk(root);
          if (u) return u.trim();
        }
      } catch (_) {}
    }
    return "";
  };

  const getAmazonProductImage = () => {
    const bad = /sprite|nav-sprites|transparent|1x1|pixel|gif\.gif|grey-pixel/i;
    const trySrc = (raw) => {
      if (!raw || typeof raw !== "string") return "";
      let src = raw.trim();
      if (src.startsWith("{") || src.includes("&quot;")) {
        try {
          const o = JSON.parse(src.replace(/&quot;/g, '"'));
          const keys = Object.keys(o).filter((k) => /^https?:\/\//i.test(k));
          if (keys.length) {
            keys.sort((a, b) => {
              const wa = o[a]?.[0] ?? 0;
              const wb = o[b]?.[0] ?? 0;
              return wb - wa;
            });
            src = keys[0];
          }
        } catch (_) {}
      }
      src = absolutizeMediaUrl(src);
      if (src && !bad.test(src)) return src;
      return "";
    };
    const sels = [
      "#landingImage",
      "#imgBlkFront",
      "#mainImage",
      "#main-image",
      "#landing-image",
      "#imageBlock_feature_div img",
      "#leftCol #landingImage",
      'img[data-a-image-name="landingImage"]',
      "#main-image-container img",
      "#main-image-feature-container img",
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const hires = el.getAttribute?.("data-old-hires");
      if (hires) {
        const u = trySrc(hires);
        if (u) return u;
      }
      const dyn = el.getAttribute?.("data-a-dynamic-image");
      if (dyn) {
        const u = trySrc(dyn);
        if (u) return u;
      }
      const u = trySrc(el.getAttribute?.("src") || resolveImgSrc(el));
      if (u) return u;
    }
    const anyHires = document.querySelector("[data-old-hires]");
    if (anyHires) {
      const u = trySrc(anyHires.getAttribute("data-old-hires"));
      if (u) return u;
    }
    return "";
  };

  const pickGenericHeroProductImage = () => {
    const badSrc =
      /logo|icon|sprite|placeholder|favicon|avatar|badge|payment|1x1|pixel|spacer|trustpilot|navbar|social-share|facebook|pinterest|sprite|grey-pixel|transparent/i;
    const scoped = [
      "main img",
      '[role="main"] img',
      "article img",
      "#productImage img",
      "#product-image img",
      ".product-gallery img",
      ".product__media img",
      ".product-single__photo img",
      "[data-testid*=gallery] img",
      "[data-test*=Gallery] img",
      "#landingImage",
      "#imgBlkFront",
    ];
    const seen = new Set();
    const imgs = [];
    for (const sel of scoped) {
      try {
        for (const el of querySelectorAllDeep(sel)) {
          if (!seen.has(el)) {
            seen.add(el);
            imgs.push(el);
          }
        }
      } catch (_) {}
    }
    if (imgs.length < 3) {
      for (const el of querySelectorAllDeep("img")) {
        if (!seen.has(el)) {
          seen.add(el);
          imgs.push(el);
        }
        if (imgs.length > 80) break;
      }
    }
    let best = "";
    let bestScore = -1e9;
    for (const img of imgs) {
      let src = resolveImgSrc(img);
      if (!src || src.startsWith("data:")) continue;
      src = absolutizeMediaUrl(src);
      if (!src || badSrc.test(src)) continue;
      const w = Number(img.getAttribute("width") || 0);
      const h = Number(img.getAttribute("height") || 0);
      let score = w && h ? w * h : 4000;
      const dim = src.match(/(\d{2,4})x(\d{2,4})/);
      if (dim) score = Math.max(score, parseInt(dim[1], 10) * parseInt(dim[2], 10));
      if (/thumb|thumbnail|small|mini|50x|100x|150x|200x|icon\b/i.test(src)) score -= 400000;
      if (/800x|1024|1200|1500|2048|large|grande|zoom/i.test(src)) score += 120000;
      if (score > bestScore) {
        bestScore = score;
        best = src;
      }
    }
    return best || null;
  };

  const imageLooksWeak = (u) =>
    !u ||
    String(u).trim().length < 12 ||
    /logo|og-default|placeholder|favicon|sprite|avatar-default|mshops\/small|grey-pixel|transparent|data:image/i.test(
      String(u)
    );

  /** Target PDP: prices often live under LWC/custom elements (open shadow) + data-test attrs. */
  const extractTargetNextDataPrice = () => {
    const cands = [];
    const add = (raw, key = "", prio = 0) => {
      const s = String(raw ?? "").trim();
      if (!s) return;
      if (/(?:quantity|rating|count|review|index|id|position|shipping|threshold|save|off|discount)/i.test(key)) return;
      const p = parsePriceText(s);
      if (p != null && p > 0 && p < 50000) {
        const finalP = (Number.isInteger(p) && p >= 100 && !s.includes(".")) ? p / 100 : p;
        cands.push({ val: finalP, prio });
      }
    };

    const node = document.querySelector("#__NEXT_DATA__");
    if (node) {
      try {
        const data = JSON.parse(node.textContent);
        const p = data?.props?.pageProps?.product;
        if (p) {
          const mainPrice = p.price?.current_retail || p.price?.current_retail_min || p.price?.price;
          if (mainPrice) add(mainPrice, "primary", 100);
          
          if (Array.isArray(p.children)) {
            for (const child of p.children) {
              const cp = child.price?.current_retail || child.price?.price;
              if (cp) add(cp, "variant", 80);
            }
          }
        }
      } catch (_) {}
    }

    if (!cands.length && node) {
      // Fallback to regex scan if JSON parse fails or path is different
      const t = node.textContent || "";
      for (const mm of t.matchAll(/"(current_retail|current_retail_min|price|current_price|list_price|comparison_price)"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/gi)) {
        let prio = 10;
        if (mm[1].includes("current")) prio = 50;
        if (mm[1].includes("list")) prio = -20;
        add(mm[2], mm[1], prio);
      }
    }

    if (!cands.length) return null;
    cands.sort((a, b) => b.prio - a.prio || a.val - b.val);
    return cands[0].val;
  };

  const getTargetPrice = () => {
    // 1. Priority 1: High-confidence JSON-LD / NEXT_DATA
    const fromNext = extractTargetNextDataPrice();
    if (fromNext != null) return fromNext;

    // 2. Priority 2: Very specific "Primary" price selectors
    const scope = document.querySelector('main, #mainContainer, [data-test="product-detail-page"]') || document.body;
    const primarySelectors = [
      '[data-test="product-price"]',
      '[data-test="@web/Price"]',
      '#pdp-pricing-id [data-test="product-price"]',
      '[class*="CurrentPrice"]',
    ];
    for (const sel of primarySelectors) {
      const el = scope.querySelector(sel);
      if (el) {
        const raw = el.textContent || "";
        if (raw && !looksLikeBadPrice(raw, 0, raw.length)) {
          const p = parsePriceText(raw);
          if (p != null && p > 0.5) return p;
        }
      }
    }

    // 3. Fallback: Broader generic scan
    const selectors = [
      '[data-test*="product-price" i]',
      '[data-test*="/Price" i]',
      '[data-test*="ProductPrice" i]',
      '[data-test*="current-price" i]',
      '[class*="currentPrice"]',
    ];
    const cands = [];
    for (const sel of selectors) {
      try {
        scope.querySelectorAll(sel).forEach((el) => {
          const raw = el.getAttribute?.("content") || el.getAttribute?.("value") || el.textContent || "";
          if (!raw || raw.length > 600) return;
          if (looksLikeBadPrice(raw, 0, raw.length)) return;
          const p = parsePriceText(raw);
          if (p != null && p > 0 && p < 50000) cands.push(p);
        });
      } catch (_) {}
    }
    
    if (cands.length) return pickRepresentativePrice(cands);
    return pickNearCartPriceFromText(collectPageTextDeep(22000));
  };

  let price = null;
  if (isAmazon) {
    price = getAmazonPrice() ?? getAmazonPriceFromBuybox();
  } else if (isTarget) {
    price =
      getTargetPrice() ??
      getMetaTagPrice() ??
      extractJsonLdProductPrice() ??
      priceNearPrimaryAddToCart() ??
      pickNearCartPriceFromText(collectPageTextDeep(22000));
  } else if (isShein) {
    price =
      getSheinPrice() ??
      getMetaTagPrice() ??
      extractJsonLdProductPrice() ??
      extractShopifyStyleJsonPrices() ??
      priceNearPrimaryAddToCart() ??
      pickNearCartPriceFromText(collectPageTextDeep(18000));
  } else if (isFashionNova) {
    price =
      extractShopifyPricesFromRawScripts() ??
      extractShopifyStyleJsonPrices() ??
      getMetaTagPrice() ??
      extractJsonLdProductPrice() ??
      priceNearPrimaryAddToCart() ??
      pickNearCartPriceFromText(collectPageTextDeep(24000)) ??
      pickNearCartPriceFromText(
        (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ").slice(0, 14000)
      );
  } else {
    price =
      getMetaTagPrice() ??
      extractJsonLdProductPrice() ??
      extractShopifyStyleJsonPrices() ??
      priceNearPrimaryAddToCart() ??
      pickNearCartPriceFromText(collectPageTextDeep(22000));
  }

  if (price == null && !isAmazon) {
    const genericSels = [
      ".price", ".product-price", ".sale-price", ".current-price",
      ".product__price", ".pdp-price", ".cider-product-price",
      ".price-item", ".price-item--regular", ".price-item--sale",
      ".product-single__price", ".price .money", "span.money",
      "[itemprop='price']", "[data-testid*='price']",
      "[data-test='product-price']", "[data-test*='current-price']",
      "[data-test*='product-price']", "[data-product-price]",
      "[id*='ProductPrice']", "[class*='product-price']",
      "[data-test*='Price']",
    ];
    const foundPrices = [];
    for (const sel of genericSels) {
      const els = querySelectorAllDeep(sel);
      els.forEach((el) => {
        const raw = el.textContent || el.getAttribute("content") || "";
        if (looksLikeBadPrice(raw, 0, raw.length)) return;
        const p = parsePriceText(raw);
        if (p != null && p > 0) foundPrices.push(p);
      });
    }
    if (foundPrices.length) price = pickRepresentativePrice(foundPrices);
  }

  if (price == null) price = priceNearPrimaryAddToCart();

  if (price == null && !isAmazon) {
    price = pickNearCartPriceFromText(collectPageTextDeep(26000));
  }

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

  const jsonLdImg = extractJsonLdProductImage();

  let image_url = absolutizeMediaUrl((ogImageRaw || "").trim());

  if (isAmazon) {
    const amzImg = getAmazonProductImage();
    if (amzImg) image_url = absolutizeMediaUrl(amzImg);
  } else if (isShein) {
    // Shein og:image is often very reliable if it contains "goods_img"
    const sheinOg = (ogImageRaw || "").trim();
    if (sheinOg && /goods_img|origin/i.test(sheinOg)) {
      image_url = absolutizeMediaUrl(sheinOg);
    } else {
      const sheinImg = pickSheinProductImage();
      if (sheinImg) image_url = absolutizeMediaUrl(sheinImg);
    }
  } else if (isFashionNova) {
    const shopImg = pickShopifyStyleProductImage() || extractShopifyMediaFromPage();
    if (shopImg) {
      image_url = absolutizeMediaUrl(shopImg);
    } else if (
      image_url &&
      /logo|og-default|placeholder|favicon|sprite|files\/[^/]*logo/i.test(image_url)
    ) {
      const fallbackImg =
        document.querySelector('meta[property="og:image:secure_url"]')?.content ||
        extractShopifyMediaFromPage() ||
        querySelectorAllDeep('img[src*="cdn.shopify.com"], img[src*="/cdn/shop/"]')
          .map((img) => resolveImgSrc(img))
          .find((u) => u && !/logo|placeholder/i.test(u)) ||
        "";
      if (fallbackImg) image_url = absolutizeMediaUrl(fallbackImg);
    }
  } else if (
    image_url &&
    /logo|og-default|placeholder|favicon|sprite/i.test(image_url) &&
    !/ltwebstatic|cloudinary|img\./i.test(image_url)
  ) {
    const fallbackImg =
      document.querySelector('meta[property="og:image:secure_url"]')?.content ||
      document.querySelector('article img[src^="http"], main img[src^="http"]')?.src ||
      "";
    if (fallbackImg && !/logo/i.test(fallbackImg)) image_url = absolutizeMediaUrl(fallbackImg);
  }

  if (imageLooksWeak(image_url)) {
    const hero = pickGenericHeroProductImage();
    if (hero) image_url = absolutizeMediaUrl(hero);
  }
  if (imageLooksWeak(image_url) && jsonLdImg) {
    image_url = absolutizeMediaUrl(jsonLdImg);
  }
  if (imageLooksWeak(image_url)) {
    const pre = document.querySelector('link[rel="preload"][as="image"]')?.getAttribute("href");
    if (pre && !imageLooksWeak(pre)) image_url = absolutizeMediaUrl(pre);
  }

  image_url = absolutizeMediaUrl(image_url);

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
    imgEl.referrerPolicy = "no-referrer";
    imgEl.src = img;
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
  // Signed-out must win over any stale jwt — the content script can push CARTIT_TOKEN again
  // before localStorage is cleared, and the background used to re-store jwt without checking.
  if (stored.manualAuth === "signed-out") {
    if (isLikelyJwt(stored.jwt)) {
      await chrome.storage.local.remove(["jwt", "jwt_origin"]);
    }
    return "";
  }
  if (isLikelyJwt(stored.jwt)) {
    authRejected = false;
    return stored.jwt;
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
  const { manualAuth } = await chrome.storage.local.get(["manualAuth"]);
  if (manualAuth === "signed-out") return false;

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
    if (manualPriceEl && !manualPriceEl.dataset.cartItHintBound) {
      manualPriceEl.dataset.cartItHintBound = "1";
      manualPriceEl.addEventListener("input", () => {
        manualPriceDirty = true;
        const v = parseFloat(String(manualPriceEl.value || "").trim());
        if (Number.isFinite(v) && v > 0) {
          setPriceHint(`Using your price: $${v.toFixed(2)}`, true);
        } else if (!v) {
          setPriceHint("", true);
        }
      });
    }
    if (manualPriceEl) {
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
      const manual = parseFloat(String(manualPriceEl?.value || "").trim());
      if (Number.isFinite(manual) && manual > 0 && manualPriceDirty) {
        setPriceHint(`Using your price: $${manual.toFixed(2)}`, true);
      } else {
        setPriceHint("Price not found. Please enter manually.", false);
      }
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
        <img src="${item.image_url || ""}" alt="" />
        <div class="wishlist-item-info">
          <p class="wishlist-item-name">${truncate(item.item_name, 40)}</p>
          <p class="wishlist-item-price">$${Number(item.current_price || 0).toFixed(2)}</p>
          <div class="wishlist-item-actions">
            <button class="action-icon-btn open-btn" title="Open product">🔗</button>
            <button class="action-icon-btn delete-btn" title="Delete">🗑️</button>
          </div>
        </div>
      `;
      const thumb = el.querySelector("img");
      if (thumb) {
        const fallbackSrc = chrome.runtime.getURL("icon-128.png");
        if (!item.image_url) thumb.src = fallbackSrc;
        thumb.addEventListener(
          "error",
          () => {
            thumb.src = fallbackSrc;
          },
          { once: true }
        );
      }
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
  // Set signed-out first so token bridge / background cannot re-store jwt during cleanup.
  await chrome.storage.local.set({ manualAuth: "signed-out" });
  await chrome.storage.local.remove(["jwt", "jwt_origin"]);
  await clearTokenFromOpenTabs();
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

// Auto-refresh when tab changes or loads
chrome.tabs.onActivated.addListener(() => refreshFromTab());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") refreshFromTab();
});

// Initialization
async function init() {
  await setAuthLine();
  await loadCategories();
  await refreshFromTab();
}

init();
