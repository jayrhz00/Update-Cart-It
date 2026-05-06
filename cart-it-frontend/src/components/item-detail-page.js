import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ItemDetailModal from "./item-modal";
import { apiRequest } from "./api";

/**
 * Standalone route for /item/:id — opens the item drawer (used by the extension “See item” link).
 */
export default function ItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!localStorage.getItem("token")) {
        navigate("/login", { replace: true });
        return;
      }
      const data = await apiRequest(`/api/cart-items/${id}`);
      if (!data) {
        setError("That item was not found in your saved items.");
        setItem(null);
      } else {
        setItem(data);
      }
    } catch (e) {
      setError(e.message || "Could not load this item.");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const onClose = () => navigate("/dashboard", { replace: true });

  const onDelete = async (itemId) => {
    try {
      await apiRequest(`/api/cart-items/${itemId}`, { method: "DELETE" });
      try {
        window.dispatchEvent(new Event("cartit:items-updated"));
      } catch {
        /* ignore */
      }
      navigate("/dashboard", { replace: true });
    } catch (e) {
      alert(e.message || "Could not remove this item.");
    }
  };

  const onMarkPurchased = async (it) => {
    try {
      const purchasePrice = Number(it.current_price || 0);
      await apiRequest(`/api/cart-items/${it.item_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          purchased: true,
          purchase_price:
            Number.isFinite(purchasePrice) && purchasePrice >= 0 ? purchasePrice : null,
        }),
      });
      try {
        window.dispatchEvent(new Event("cartit:items-updated"));
      } catch {
        /* ignore */
      }
      await load();
    } catch (e) {
      alert(e.message || "Could not update purchase status.");
    }
  };

  const onAddNote = (itemId, combined) => {
    setItem((prev) =>
      prev && Number(prev.item_id) === Number(itemId) ? { ...prev, notes: combined } : prev
    );
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#475569",
        }}
      >
        Loading…
      </div>
    );
  }

  if (error || !item) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f8fafc",
          color: "#334155",
        }}
      >
        <p>{error || "Item not found."}</p>
        <button
          type="button"
          style={{
            border: "none",
            borderRadius: "8px",
            padding: "10px 18px",
            background: "#0d9488",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
          onClick={() => navigate("/dashboard")}
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <ItemDetailModal
      item={item}
      onClose={onClose}
      onDelete={onDelete}
      onMarkPurchased={onMarkPurchased}
      onAddNote={onAddNote}
      isCartPage={false}
    />
  );
}
