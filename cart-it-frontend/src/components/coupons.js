import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "./sidebar";
import { LuExternalLink, LuTicket } from "react-icons/lu";
import "../styles/coupons.css";
import { apiRequest, publicApiGet } from "./api";

function formatExpiry(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const OFFICIAL_OFFERS_BY_HOST = {
  "walmart.com": "https://www.walmart.com/deals",
  "target.com": "https://www.target.com/circle",
  "nordstrom.com": "https://www.nordstrom.com/browse/sale",
  "nike.com": "https://www.nike.com/membership",
  "sephora.com": "https://www.sephora.com/beauty/beauty-offers",
  "bestbuy.com": "https://www.bestbuy.com/deals",
  "kohls.com": "https://www.kohls.com/sale-event/coupon.jsp",
  "oldnavy.gap.com": "https://oldnavy.gap.com/",
  "amazon.com": "https://www.amazon.com/gp/goldbox",
  "aldoshoes.com": "https://www.aldoshoes.com/us/en_US",
};

function rootHost(host) {
  const h = String(host || "").toLowerCase().trim();
  if (!h) return "";
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}

function deriveHostFromCartItem(item) {
  const store = String(item?.store || "").trim();
  if (store) return store;
  const url = String(item?.product_url || "").trim();
  if (!url) return "";
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

export default function Coupons() {
  const navigate = useNavigate();
  const [curated, setCurated] = useState([]);
  const [curatedLoading, setCuratedLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cartStores, setCartStores] = useState([]);

  const loadCurated = useCallback(async () => {
    setCuratedLoading(true);
    try {
      const rows = await publicApiGet("/api/public/curated-coupons");
      setCurated(Array.isArray(rows) ? rows : []);
    } catch {
      setCurated([]);
    } finally {
      setCuratedLoading(false);
    }
  }, []);

  const loadCartStores = useCallback(async () => {
    try {
      const items = await apiRequest("/api/cart-items");
      const safe = Array.isArray(items) ? items : [];
      const hosts = safe
        .map(deriveHostFromCartItem)
        .map((h) => h.replace(/^www\./i, ""))
        .filter(Boolean);
      const uniq = [...new Set(hosts)];
      setCartStores(uniq.slice(0, 20));
    } catch {
      setCartStores([]);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      navigate("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        await Promise.all([loadCurated(), loadCartStores()]);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load coupons.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, loadCurated, loadCartStores]);

  const isExpired = (iso) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t < Date.now();
  };

  const storeHref = (domain) => {
    const d = String(domain || "").trim().replace(/^https?:\/\//i, "");
    if (!d) return null;
    return `https://${d}`;
  };

  const storeCards = useMemo(() => {
    const out = [];
    for (const host of cartStores) {
      const base = rootHost(host);
      const url = OFFICIAL_OFFERS_BY_HOST[host] || OFFICIAL_OFFERS_BY_HOST[base] || `https://${host}`;
      out.push({ host, url });
    }
    return out;
  }, [cartStores]);

  return (
    <div className="dashboard-container">
      <Sidebar showExtension />
      <main className="coupons-main">
        <div className="coupons-hero-pill">
          <LuTicket size={14} aria-hidden />
          Coupons
        </div>
        <h1 className="coupons-title">Deals to try</h1>
        <p className="coupons-lede">
          We don’t scrape coupon sites. Instead, Cart-It links you to retailer-published offers. Promos can still
          change fast — always confirm at checkout.
        </p>

        {error ? <div className="coupons-error">{error}</div> : null}

        <section className="coupons-curated-section" aria-labelledby="cart-offers-heading">
          <h2 id="cart-offers-heading" className="coupons-section-title">
            Offers for stores in your cart
          </h2>
          <p className="coupons-section-sub">
            We’ll link you to each store’s official deals/offers page. Promos may require membership, minimums, or
            exclusions.
          </p>
          {loading ? (
            <p className="coupons-muted">Loading store links…</p>
          ) : storeCards.length === 0 ? (
            <p className="coupons-empty-inline">
              Your cart doesn’t have any store URLs yet. Add an item from a product page and come back.
            </p>
          ) : (
            <ul className="coupons-curated-grid">
              {storeCards.map((c) => {
                const primaryHref = c.url;
                return (
                  <li
                    key={c.host}
                    className="coupons-curated-card"
                  >
                    <span className="coupons-card-store">{c.host}</span>
                    <div className="coupons-card-actions">
                      {primaryHref ? (
                        <a
                          href={primaryHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="coupons-icon-btn coupons-icon-link coupons-official-link"
                          aria-label={`Open official offers for ${c.host} in a new tab`}
                        >
                          <LuExternalLink size={14} aria-hidden />
                          Open official offers
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="coupons-curated-section" aria-labelledby="popular-retailers-heading">
          <h2 id="popular-retailers-heading" className="coupons-section-title">
            Popular retailers
          </h2>
          <p className="coupons-section-sub">
            A short list of retailer hubs we keep updated. If you don’t see a store here, we’ll still link from your
            cart above.
          </p>
          {curatedLoading ? (
            <p className="coupons-muted">Loading…</p>
          ) : curated.length === 0 ? (
            <p className="coupons-empty-inline">No retailers listed yet.</p>
          ) : (
            <ul className="coupons-curated-grid">
              {curated.map((c) => {
                const expired = isExpired(c.expires_at);
                const primaryHref =
                  (c.deals_url && String(c.deals_url).trim()) || storeHref(c.store_domain);
                return (
                  <li
                    key={c.id}
                    className={`coupons-curated-card${expired ? " coupons-card-expired" : ""}`}
                  >
                    <span className="coupons-card-store">{c.store_name}</span>
                    {c.discount_label ? (
                      <p className="coupons-card-discount">{c.discount_label}</p>
                    ) : null}
                    {c.fine_print ? (
                      <p className="coupons-fine-print">{c.fine_print}</p>
                    ) : null}
                    <div className="coupons-card-actions">
                      {primaryHref ? (
                        <a
                          href={primaryHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="coupons-icon-btn coupons-icon-link coupons-official-link"
                        >
                          <LuExternalLink size={14} aria-hidden />
                          Open official offers
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
