import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashShell from "./dash-shell";
import FullItemEditor from "./full-item-editor";
import { apiRequest } from "./api";
import "../styles/wishlist-page.css";

/**
 * All saved items (full cart). Route: /cart
 */
export default function CartPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [editMode, setEditMode] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const totalValue = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.current_price || 0), 0),
    [items]
  );

  const visibleItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const aId = Number(a.item_id || 0);
      const bId = Number(b.item_id || 0);
      return sortOrder === "newest" ? bId - aId : aId - bId;
    });
    return sorted;
  }, [items, sortOrder]);

  const load = useCallback(async () => {
    const list = await apiRequest("/api/cart-items");
    setItems(Array.isArray(list) ? list : []);
    setLastUpdated(new Date());
    setError("");
  }, []);

  const handleFilterClick = () => {
    setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"));
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/cart`;
    const subject = encodeURIComponent("Check out my Cart-It list");
    const body = encodeURIComponent(`Here is my Cart-It link:\n${shareUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    setStatusMessage("Email draft opened with your cart link.");
  };

  const updatedLabel = lastUpdated
    ? lastUpdated.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "just now";

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login");
      return;
    }
    (async () => {
      try {
        await load();
      } catch (e) {
        setError(e.message || "Could not load your cart.");
      }
    })();
  }, [navigate, load]);

  return (
    <DashShell>
      <button type="button" className="page-back-link" onClick={() => navigate("/dashboard")}>
        Back to Dashboard
      </button>
      <h1 className="dash-title">Cart</h1>
      <p className="wishlist-page-sub page-lead">Total Price: ${totalValue.toFixed(2)} · Updated {updatedLabel}</p>
      <div className="wishlist-toolbar">
        <button type="button" className="wishlist-toolbar-btn" onClick={handleFilterClick}>
          Filter ({sortOrder === "newest" ? "Newest to oldest" : "Oldest to newest"})
        </button>
        <button type="button" className="wishlist-toolbar-btn" onClick={handleShare}>
          Share
        </button>
        <button
          type="button"
          className="wishlist-toolbar-btn"
          onClick={() => setEditMode((prev) => !prev)}
        >
          {editMode ? "Done" : "Edit"}
        </button>
      </div>
      {error ? <p className="status-message">{error}</p> : null}
      {statusMessage ? <p className="wishlist-page-sub">{statusMessage}</p> : null}
      {!error && (
        <section className="wishlist-page-list">
          {visibleItems.length === 0 ? (
            <div className="empty-inline">No saved items yet.</div>
          ) : editMode ? (
            visibleItems.map((item) => <FullItemEditor key={item.item_id} item={item} onChanged={load} />)
          ) : (
            <div className="cart-readonly-grid">
              {visibleItems.map((item) => (
                <div key={item.item_id} className="cart-readonly-card">
                  <a href={item.product_url} target="_blank" rel="noreferrer" className="cart-readonly-media">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.item_name}
                        className="cart-readonly-image"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="cart-readonly-image cart-readonly-image-fallback">No image</div>
                    )}
                  </a>
                  <div className="cart-readonly-store">{item.store || "Unknown store"}</div>
                  <a href={item.product_url} target="_blank" rel="noreferrer" className="cart-readonly-name">
                    {item.item_name}
                  </a>
                  <div className="cart-readonly-price">${Number(item.current_price || 0).toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </DashShell>
  );
}
