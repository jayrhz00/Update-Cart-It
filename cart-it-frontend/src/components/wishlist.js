import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LuArrowLeft,
  LuPen,
  LuUsers,
  LuTrash2,
  LuLock,
} from "react-icons/lu";
import Sidebar from './sidebar';
import WishlistListChat from "./wishlist-list-chat";
import '../styles/wishlist.css';
import { apiRequest } from './api';

const formatMoney = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : "$0.00";
};

/** Checkbox "Purchased" copies list price into purchase_price; if list price was missing/$0, both stay zero. */
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

const Wishlist = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [group, setGroup] = useState(null);
  const [filter, setFilter] = useState("all");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState("");
  const [members, setMembers] = useState([]);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [savingNoteId, setSavingNoteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const groupId = Number(id);

  const loadAll = useCallback(async () => {
    if (!localStorage.getItem("token")) {
      navigate("/login");
      return;
    }
    if (Number.isNaN(groupId)) {
      navigate("/dashboard");
      return;
    }
    const [g, listItems, memberRows] = await Promise.all([
      apiRequest(`/api/groups/${groupId}`),
      apiRequest(`/api/cart-items?group_id=${groupId}`),
      apiRequest("/api/group-members").catch(() => []),
    ]);
    setGroup(g);
    const safeItems = Array.isArray(listItems) ? listItems : [];
    setItems(safeItems);
    setMembers(
      Array.isArray(memberRows)
        ? memberRows.filter((m) => Number(m.group_id) === Number(groupId))
        : []
    );
    setNoteDrafts((prev) => {
      const next = { ...prev };
      safeItems.forEach((item) => {
        if (next[item.item_id] === undefined) {
          next[item.item_id] = item.notes || "";
        }
      });
      return next;
    });
  }, [navigate, groupId]);

  const broadcastItemsChanged = useCallback(() => {
    try {
      window.dispatchEvent(new Event("cartit:items-updated"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadAll().catch((e) => console.error(e));
  }, [loadAll]);

  useEffect(() => {
    if (filter === "inStock") setFilter("all");
  }, [filter]);

  const listName = group?.group_name ?? group?.name ?? "Wishlist";

  const filteredItems = useMemo(() => {
    let list = [...items];
    if (filter === "open") list = list.filter((i) => !i.is_purchased);
    if (filter === "purchased") list = list.filter((i) => i.is_purchased);
    return list;
  }, [items, filter]);

  const totalOpen = useMemo(
    () =>
      items
        .filter((i) => !i.is_purchased)
        .reduce((s, i) => s + Number(i.current_price || 0), 0),
    [items]
  );

  /** Sum of what was paid for purchased rows (falls back to list price). */
  const totalPurchasedValue = useMemo(
    () =>
      items
        .filter((i) => i.is_purchased)
        .reduce(
          (s, i) => s + Number(i.purchase_price ?? i.current_price ?? 0),
          0
        ),
    [items]
  );

  const lastUpdated = useMemo(() => {
    const times = items
      .flatMap((i) => [i.created_at, i.updated_at, i.purchase_date])
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .filter((n) => !Number.isNaN(n));
    if (times.length === 0) return "—";
    return formatRelativeTime(new Date(Math.max(...times)).toISOString());
  }, [items]);

  const isOwner =
    String(group?.access_role || "").toLowerCase() === "owner";

  const isSharedList =
    String(group?.visibility || "").toLowerCase() === "shared";

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
      await loadAll();
    } catch (e) {
      alert(e.message || "Could not save notes.");
    } finally {
      setSavingNoteId(null);
    }
  };

  const handleTogglePurchased = async (item, checked) => {
    try {
      const purchasePrice = checked ? Number(item.current_price || 0) : null;
      await apiRequest(`/api/cart-items/${item.item_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          purchased: !!checked,
          purchase_price: checked
            ? Number.isFinite(purchasePrice) && purchasePrice >= 0
              ? purchasePrice
              : null
            : null,
        }),
      });
      await loadAll();
      broadcastItemsChanged();
    } catch (e) {
      alert(e.message || "Could not update this item.");
    }
  };

  const handleRemoveItem = async (item) => {
    const itemId = item?.item_id;
    if (!itemId) return;
    const label = (item.item_name || "this item").slice(0, 80);
    if (!window.confirm(`Remove “${label}” from this wishlist?`)) return;
    setDeletingId(itemId);
    try {
      await apiRequest(`/api/cart-items/${itemId}`, { method: "DELETE" });
      await loadAll();
      broadcastItemsChanged();
    } catch (e) {
      alert(e.message || "Could not remove this item.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRename = async () => {
    const next = window.prompt("New wishlist name:", listName);
    if (next == null) return;
    const t = next.trim();
    if (!t) return;
    try {
      await apiRequest(`/api/groups/${groupId}`, {
        method: "PATCH",
        body: JSON.stringify({ group_name: t }),
      });
      await loadAll();
    } catch (e) {
      alert(e.message || "Could not rename.");
    }
  };

  const handleInvite = async () => {
    if (!isOwner) {
      alert("Only the owner can invite collaborators.");
      return;
    }
    const email = inviteEmail.trim();
    if (!email) {
      setInviteMsg("Enter an email first.");
      return;
    }
    try {
      const res = await apiRequest(`/api/groups/${groupId}/invite`, {
        method: "POST",
        body: JSON.stringify({ email, role: "Editor" }),
      });
      setInviteMsg(res?.message || "Invite sent.");
      setInviteEmail("");
    } catch (e) {
      setInviteMsg(e.message || "Invite failed.");
    }
  };

  return (
    <div className="page-wrapper wishlist-page dash-with-topnav">
      <Sidebar showExtension={false} />

      <main className="detail-main">
        <header className="detail-header">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="back-link"
          >
            <LuArrowLeft /> Back to Wishlists
          </button>

          <div className="header-content">
            <h1 className="wishlist-title">{listName}</h1>

            <div className="stats stats-wishlist-meta">
              <span title="Total price of items you still haven’t marked purchased.">
                Open (not purchased): <strong>{formatMoney(totalOpen)}</strong>
              </span>
              <span className="text-slate-400">•</span>
              <span title="Total amount recorded for purchased items on this list.">
                Purchased: <strong>{formatMoney(totalPurchasedValue)}</strong>
              </span>
              <span className="text-slate-400">•</span>
              <span>Updated {lastUpdated}</span>
            </div>
          </div>

          <div className="toolbar">
            <div className="toolbar-filter-wrap">
              <select
                className="toolbar-filter-select"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter wishlist items"
              >
                <option value="all">All items</option>
                <option value="open">Not purchased</option>
                <option value="purchased">Purchased</option>
              </select>
            </div>
            {isSharedList ? (
              isOwner ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="email"
                    className="wishlist-invite-email rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-500 min-w-[12rem]"
                    placeholder="Email to invite"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                  <button type="button" className="tool-btn tool-btn--pink" onClick={handleInvite}>
                    <LuUsers size={16} /> Invite
                  </button>
                  <button
                    type="button"
                    className="tool-btn tool-btn--pink text-xs"
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "Make this list private? Collaborators will lose access until you share again."
                        )
                      )
                        return;
                      try {
                        await apiRequest(`/api/groups/${groupId}`, {
                          method: "PATCH",
                          body: JSON.stringify({ visibility: "Private" }),
                        });
                        setInviteMsg("This list is private again.");
                        await loadAll();
                      } catch (e) {
                        setInviteMsg(e.message || "Could not update.");
                      }
                    }}
                  >
                    <LuLock size={16} /> Make private
                  </button>
                </div>
              ) : null
            ) : (
              <>
                {isOwner ? (
                  <button
                    type="button"
                    className="tool-btn tool-btn--pink text-xs"
                    onClick={async () => {
                      try {
                        await apiRequest(`/api/groups/${groupId}`, {
                          method: "PATCH",
                          body: JSON.stringify({ visibility: "Shared" }),
                        });
                        setInviteMsg("List is now shared. Invite collaborators by email below.");
                        await loadAll();
                      } catch (e) {
                        setInviteMsg(e.message || "Could not update.");
                      }
                    }}
                  >
                    Make shared
                  </button>
                ) : null}
              </>
            )}
            <button type="button" className="tool-btn tool-btn--pink" onClick={handleRename}>
              <LuPen size={16} /> Rename list
            </button>
          </div>
          {isSharedList ? (
            <div className="wishlist-members-strip">
              <p className="wishlist-members-title">Members</p>
              <div className="wishlist-members-pills">
                <span className="wishlist-member-pill wishlist-member-pill--highlight">
                  Owner listed below
                </span>
                {members.length > 0 ? (
                  members.map((m) => (
                    <span
                      key={`${m.group_id}-${m.user_id}`}
                      className="wishlist-member-pill"
                    >
                      {(m.username || m.email || `User #${m.user_id}`)} — {m.role || "Editor"}
                    </span>
                  ))
                ) : (
                  <span className="wishlist-members-empty">No collaborators yet.</span>
                )}
              </div>
            </div>
          ) : null}
          {isSharedList ? (
            <WishlistListChat groupId={groupId} enabled={isSharedList} />
          ) : null}
          {inviteMsg ? <p className="wishlist-invite-msg text-sm">{inviteMsg}</p> : null}
        </header>

        <section className="item-grid">
          {filteredItems.length === 0 ? (
            <p className="col-span-full wishlist-empty-grid-msg">
              No items in this view. Use the Cart-It extension on any store’s product page to add items.
            </p>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.item_id}
                className="item-card"
                role={item.product_url ? "button" : undefined}
                tabIndex={item.product_url ? 0 : undefined}
                onClick={() => {
                  if (!item.product_url) return;
                  window.open(item.product_url, "_blank", "noopener,noreferrer");
                }}
                onKeyDown={(e) => {
                  if (!item.product_url) return;
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
                  <button
                    type="button"
                    className="wishlist-item-remove"
                    disabled={deletingId === item.item_id}
                    title="Remove from wishlist"
                    aria-label={`Remove ${item.item_name || "item"} from wishlist`}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleRemoveItem(item);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <LuTrash2 size={18} aria-hidden />
                  </button>
                </div>
                <div className="item-details">
                  <p className="store">{item.store || "—"}</p>
                  <h3 className="name">{item.item_name}</h3>
                  <p className="price">
                    {item.is_purchased
                      ? purchasedPriceLabel(item)
                      : formatMoney(item.current_price)}
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!item.is_purchased}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleTogglePurchased(item, e.target.checked)}
                    />
                    Purchased
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

export default Wishlist;
