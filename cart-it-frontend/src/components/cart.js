import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuFilter, LuPen, LuArrowLeft } from "react-icons/lu";
import Sidebar from './sidebar';
import '../styles/wishlist.css';
import { apiRequest } from './api';

const formatMoney = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : "$0.00";
};

const purchasedPriceLabel = (item) => {
  const n = Number(item.purchase_price ?? item.current_price);
  if (Number.isFinite(n) && n > 0) return `Purchased ${formatMoney(n)}`;
  return "Purchased (no price on file)";
};

const formatRelativeTime = (iso) => {
  if (!iso) return "recently";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "recently";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const Cart = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [wishlists, setWishlists] = useState([]);
  const [filter, setFilter] = useState("all");
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState({});
  const [moveGroupId, setMoveGroupId] = useState("");
  const [noteDrafts, setNoteDrafts] = useState({});
  const [savingNoteId, setSavingNoteId] = useState(null);
  const [togglingPurchasedId, setTogglingPurchasedId] = useState(null);

  const load = useCallback(async () => {
    if (!localStorage.getItem("token")) {
      navigate("/login");
      return;
    }
    const [groups, cart] = await Promise.all([
      apiRequest("/api/groups"),
      apiRequest("/api/cart-items"),
    ]);
    setWishlists(Array.isArray(groups) ? groups : []);
    const safeItems = Array.isArray(cart) ? cart : [];
    setItems(safeItems);
    setNoteDrafts((prev) => {
      const next = { ...prev };
      safeItems.forEach((item) => {
        if (next[item.item_id] === undefined) {
          next[item.item_id] = item.notes || "";
        }
      });
      return next;
    });
  }, [navigate]);

  const notifyItemsUpdated = () => {
    try {
      window.dispatchEvent(new Event("cartit:items-updated"));
    } catch (_) {
      /* ignore */
    }
  };

  useEffect(() => {
    load().catch((e) => console.error(e));
  }, [load]);

  useEffect(() => {
    if (filter === "inStock" || filter === "outOfStock") setFilter("all");
  }, [filter]);

  const filteredItems = useMemo(() => {
    let list = [...items];
    if (filter === "open") list = list.filter((i) => !i.is_purchased);
    if (filter === "purchased") list = list.filter((i) => i.is_purchased);
    return list;
  }, [items, filter]);

  const cartTotal = useMemo(
    () =>
      filteredItems.reduce((s, i) => {
        const price = i.is_purchased
          ? Number(i.purchase_price ?? i.current_price ?? 0)
          : Number(i.current_price || 0);
        return s + price;
      }, 0),
    [filteredItems]
  );

  const lastUpdated = useMemo(() => {
    const times = items
      .map((i) => i.created_at || i.purchase_date)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .filter((n) => !Number.isNaN(n));
    if (times.length === 0) return "—";
    const latest = new Date(Math.max(...times)).toISOString();
    return formatRelativeTime(latest);
  }, [items]);

  const toggleSelect = (id) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  };

  const handleDeleteSelected = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (ids.length === 0) {
      alert("Select items to remove (turn on Edit, then use checkboxes).");
      return;
    }
    if (!window.confirm(`Remove ${ids.length} item(s) from your cart?`)) return;
    for (const id of ids) {
      await apiRequest(`/api/cart-items/${id}`, { method: "DELETE" });
    }
    setSelected({});
    setEditMode(false);
    await load();
    notifyItemsUpdated();
  };

  const handleMoveSelected = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (ids.length === 0) {
      alert("Select items first, then choose a wishlist.");
      return;
    }
    const parsed = Number(moveGroupId);
    if (!Number.isFinite(parsed)) {
      alert("Choose a destination wishlist first.");
      return;
    }
    const targetGroup = parsed === 0 ? null : parsed;
    try {
      for (const id of ids) {
        await apiRequest(`/api/cart-items/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ group_id: targetGroup }),
        });
      }
      setSelected({});
      setMoveGroupId("");
      setEditMode(false);
      await load();
      notifyItemsUpdated();
    } catch (error) {
      alert(error.message || "Could not move selected items.");
    }
  };

  const handleSaveNotes = async (item) => {
    const itemId = item?.item_id;
    if (!itemId) return;
    setSavingNoteId(itemId);
    try {
      await apiRequest(`/api/cart-items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes: String(noteDrafts[itemId] ?? "").trim() || null,
        }),
      });
      await load();
      notifyItemsUpdated();
    } catch (error) {
      alert(error.message || "Could not save notes.");
    } finally {
      setSavingNoteId(null);
    }
  };

  const handleTogglePurchased = async (item, checked) => {
    const itemId = item?.item_id;
    if (!itemId) return;
    setTogglingPurchasedId(itemId);
    try {
      const purchasePrice = checked ? Number(item.current_price || 0) : null;
      await apiRequest(`/api/cart-items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          purchased: !!checked,
          purchase_price: checked ? (Number.isFinite(purchasePrice) ? purchasePrice : null) : null,
        }),
      });
      await load();
      notifyItemsUpdated();
    } catch (error) {
      alert(error.message || "Could not update purchase status.");
    } finally {
      setTogglingPurchasedId(null);
    }
  };

  return (
    <div className="page-wrapper dash-with-topnav">
      <Sidebar showExtension={false} />

      <main className="detail-main">
        <header className="detail-header">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="back-link"
          >
            <LuArrowLeft /> Back to Dashboard
          </button>

          <div className="header-content">
            <h1 className="wishlist-title">Cart</h1>

            <div className="stats">
              <span>
                Total (visible items): <strong>{formatMoney(cartTotal)}</strong>
              </span>
              <span className="text-gray-300">•</span>
              <span>Updated {lastUpdated}</span>
            </div>
          </div>

          <div className="toolbar">
            <div className="toolbar-filter-wrap">
              <LuFilter size={16} className="shrink-0 text-gray-500" aria-hidden />
              <select
                className="toolbar-filter-select"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter cart items"
              >
                <option value="all">All items</option>
                <option value="open">Not purchased</option>
                <option value="purchased">Purchased</option>
              </select>
            </div>
            <button
              type="button"
              className={`tool-btn tool-btn--pink ${editMode ? "ring-2 ring-pink-300 ring-offset-2" : ""}`}
              onClick={() => {
                setEditMode((e) => !e);
                if (editMode) setSelected({});
              }}
            >
              <LuPen size={16} /> {editMode ? "Done" : "Edit"}
            </button>
            {editMode ? (
              <>
                <select
                  className="tool-btn"
                  value={moveGroupId}
                  onChange={(e) => setMoveGroupId(e.target.value)}
                >
                  <option value="">Move selected to...</option>
                  <option value="0">No wishlist (cart only)</option>
                  {wishlists.map((w) => {
                    const id = w.group_id ?? w.id;
                    const name = w.group_name ?? w.name ?? "Untitled";
                    return (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    );
                  })}
                </select>
                <button type="button" className="tool-btn" onClick={handleDeleteSelected}>
                  Remove selected
                </button>
              </>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Tip: Click Edit to select items, then move them to a wishlist or remove them.
          </p>
        </header>

        <section className="item-grid">
          {filteredItems.length === 0 ? (
            <p className="col-span-full text-gray-500">
              No cart items match this filter.
            </p>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.item_id}
                className="item-card"
                role={!editMode && item.product_url ? "button" : undefined}
                tabIndex={!editMode && item.product_url ? 0 : undefined}
                onClick={() => {
                  if (editMode || !item.product_url) return;
                  window.open(item.product_url, "_blank", "noopener,noreferrer");
                }}
                onKeyDown={(e) => {
                  if (editMode || !item.product_url) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    window.open(item.product_url, "_blank", "noopener,noreferrer");
                  }
                }}
              >
                <div className="img-wrapper">
                  <img
                    src={item.image_url || "/logo.png"}
                    alt={item.item_name || "Product"}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = "/logo.png";
                    }}
                  />
                  {editMode ? (
                    <input
                      type="checkbox"
                      className="select-check"
                      checked={!!selected[item.item_id]}
                      onChange={() => toggleSelect(String(item.item_id))}
                    />
                  ) : null}
                </div>
                <div className="item-details">
                  <p className="store">{item.store || "—"}</p>
                  <h3 className="name">{item.item_name}</h3>
                  <p className="price">
                    {item.is_purchased
                      ? purchasedPriceLabel(item)
                      : formatMoney(item.current_price)}
                  </p>
                  <label
                    className="mt-1 flex items-center gap-2 text-xs text-slate-700"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={!!item.is_purchased}
                      disabled={togglingPurchasedId === item.item_id}
                      onChange={(e) => handleTogglePurchased(item, e.target.checked)}
                    />
                    {togglingPurchasedId === item.item_id ? "Updating…" : "Purchased"}
                  </label>
                  <textarea
                    rows={2}
                    className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                    value={noteDrafts[item.item_id] ?? item.notes ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setNoteDrafts((prev) => ({
                        ...prev,
                        [item.item_id]: e.target.value,
                      }))
                    }
                    placeholder="Add notes (size, quality, reminders)"
                  />
                  <button
                    type="button"
                    className="mt-2 rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    disabled={savingNoteId === item.item_id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSaveNotes(item);
                    }}
                  >
                    {savingNoteId === item.item_id ? "Saving..." : "Save notes"}
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
};

export default Cart;
