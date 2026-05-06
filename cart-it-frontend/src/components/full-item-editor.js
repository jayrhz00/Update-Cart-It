import React, { useCallback, useEffect, useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import { apiRequest } from "./api";
import "../styles/full-item-editor.css";

function money(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return "—";
  return x.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function toEditableMoneyString(value, fallback) {
  const direct = Number(value);
  if (Number.isFinite(direct) && direct >= 0) return String(direct);
  const fb = Number(fallback);
  if (Number.isFinite(fb) && fb >= 0) return String(fb);
  return "";
}

function formatCommentTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(iso);
  }
}

/** Display name + optional email line for group comment authors. */
function groupCommentAuthorParts(c) {
  const username = (c.username && String(c.username).trim()) || "";
  const email = (c.email && String(c.email).trim()) || "";
  const primary = username || email || `User #${c.user_id}`;
  const secondary = username && email ? email : null;
  return { primary, secondary };
}

/**
 * One saved product: link, purchased + amount, private notes, group comment thread (shared lists), delete.
 */
export default function FullItemEditor({
  item,
  onChanged,
  showGroupComments = false,
  allowCopyToPrivateFromShared = false,
}) {
  const [notes, setNotes] = useState(item.notes || "");
  const [thread, setThread] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [paidStr, setPaidStr] = useState(
    toEditableMoneyString(item.purchase_price, item.current_price)
  );
  const [busy, setBusy] = useState(false);
  const [threadBusy, setThreadBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [priceRefreshBusy, setPriceRefreshBusy] = useState(false);
  const [privateTargets, setPrivateTargets] = useState([]);
  const [selectedPrivateGroupId, setSelectedPrivateGroupId] = useState("");
  const [msg, setMsg] = useState("");
  const canCopyToPrivate = showGroupComments || allowCopyToPrivateFromShared;

  const loadThread = useCallback(async () => {
    if (!showGroupComments) return;
    const rows = await apiRequest(`/api/cart-items/${item.item_id}/group-comments`);
    setThread(Array.isArray(rows) ? rows : []);
  }, [showGroupComments, item.item_id]);

  useEffect(() => {
    setNotes(item.notes || "");
    setPaidStr(toEditableMoneyString(item.purchase_price, item.current_price));
  }, [item.item_id, item.notes, item.purchase_price, item.current_price]);

  useEffect(() => {
    if (!showGroupComments) {
      setThread([]);
      return;
    }
    loadThread().catch(() => setThread([]));
  }, [showGroupComments, loadThread]);

  useEffect(() => {
    if (!canCopyToPrivate) {
      setPrivateTargets([]);
      setSelectedPrivateGroupId("");
      return;
    }
    let alive = true;
    apiRequest("/api/groups")
      .then((rows) => {
        if (!alive) return;
        const mine = (Array.isArray(rows) ? rows : []).filter((g) => {
          const isOwner = String(g?.access_role || "").toLowerCase() === "owner";
          const isPrivate = String(g?.visibility || "").toLowerCase() === "private";
          return isOwner && isPrivate;
        });
        setPrivateTargets(mine);
        setSelectedPrivateGroupId((prev) => {
          if (prev && mine.some((g) => String(g.group_id) === String(prev))) return prev;
          return mine[0] ? String(mine[0].group_id) : "";
        });
      })
      .catch(() => {
        if (!alive) return;
        setPrivateTargets([]);
        setSelectedPrivateGroupId("");
      });
    return () => {
      alive = false;
    };
  }, [canCopyToPrivate]);

  const patch = async (body) => {
    setBusy(true);
    setMsg("");
    try {
      await apiRequest(`/api/cart-items/${item.item_id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await onChanged();
    } catch (e) {
      setMsg(e.message || "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePurchasedToggle = async (e) => {
    const checked = e.target.checked;
    if (!checked) {
      await patch({ is_purchased: false, purchase_price: null });
      return;
    }
    const paid = parseFloat(String(paidStr).replace(/,/g, ""), 10);
    const safe = Number.isNaN(paid) || paid < 0 ? Number(item.current_price) || 0 : paid;
    await patch({ is_purchased: true, purchase_price: safe });
  };

  const saveNotes = async () => {
    await patch({ notes: notes.trim() || null });
    setMsg("Notes saved.");
  };

  const postGroupComment = async () => {
    const text = newComment.trim();
    if (!text) return;
    setThreadBusy(true);
    setMsg("");
    try {
      await apiRequest(`/api/cart-items/${item.item_id}/group-comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      setNewComment("");
      await loadThread();
      setMsg("Comment posted.");
    } catch (e) {
      setMsg(e.message || "Could not post comment.");
    } finally {
      setThreadBusy(false);
    }
  };

  const savePaidOnly = async () => {
    const paid = parseFloat(String(paidStr).replace(/,/g, ""), 10);
    if (Number.isNaN(paid) || paid < 0) {
      setMsg("Enter a valid amount.");
      return;
    }
    await patch({ purchase_price: paid });
    setMsg("Purchase amount updated.");
  };

  const handleRefreshListPrice = async () => {
    if (!item?.product_url || !String(item.product_url).trim()) {
      setMsg("No product link on this item.");
      return;
    }
    setPriceRefreshBusy(true);
    setMsg("");
    try {
      await apiRequest(`/api/cart-items/${item.item_id}`, {
        method: "PATCH",
        body: JSON.stringify({ refresh_list_price: true }),
      });
      await onChanged();
      setMsg("List price updated from the store page.");
    } catch (e) {
      setMsg(e.message || "Could not refresh price.");
    } finally {
      setPriceRefreshBusy(false);
    }
  };

  const copyToPrivateList = async () => {
    setCopyBusy(true);
    setMsg("");
    try {
      await apiRequest("/api/cart-items", {
        method: "POST",
        body: JSON.stringify({
          group_id: selectedPrivateGroupId ? Number(selectedPrivateGroupId) : null,
          item_name: item.item_name,
          product_url: item.product_url,
          image_url: item.image_url,
          store: item.store,
          current_price: Number(item.current_price) || 0,
          is_in_stock: item.is_in_stock !== false,
          notes: notes.trim() || null,
        }),
      });
      if (selectedPrivateGroupId) {
        const selected = privateTargets.find(
          (g) => String(g.group_id) === String(selectedPrivateGroupId)
        );
        const label = selected?.group_name || "selected private list";
        setMsg(`Copied to "${label}".`);
      } else {
        setMsg("Copied to your private items.");
      }
    } catch (e) {
      setMsg(e.message || "Could not copy to your private list.");
    } finally {
      setCopyBusy(false);
    }
  };

  const handleDelete = async () => {
    const label = (item.item_name || "this item").slice(0, 80);
    if (!window.confirm(`Remove "${label}"?`)) return;
    setBusy(true);
    setMsg("");
    try {
      await apiRequest(`/api/cart-items/${item.item_id}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      setMsg(e.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="full-item-card">
      <div className="full-item-top">
        <a
          href={item.product_url}
          target="_blank"
          rel="noopener noreferrer"
          className="full-item-thumb"
        >
          {item.image_url ? (
            <img src={item.image_url} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="full-item-thumb-fallback">{item.item_name?.slice(0, 3)}</span>
          )}
        </a>
        <div className="full-item-head">
          <a href={item.product_url} target="_blank" rel="noopener noreferrer" className="full-item-title">
            {item.item_name}
          </a>
          {item.store ? <span className="full-item-store">{item.store}</span> : null}
          <div className="full-item-prices">
            <span>List: {money(item.current_price)}</span>
            {item.product_url && /^https?:\/\//i.test(String(item.product_url)) ? (
              <button
                type="button"
                className="full-item-secondary-btn full-item-refresh-price"
                disabled={busy || priceRefreshBusy}
                onClick={(e) => {
                  e.preventDefault();
                  handleRefreshListPrice();
                }}
              >
                {priceRefreshBusy ? "Refreshing…" : "Refresh price"}
              </button>
            ) : null}
            {item.is_in_stock === false ? (
              <span className="full-item-stock-tag">Out of stock</span>
            ) : null}
            {item.is_purchased ? (
              <span className="full-item-purchased-tag">Purchased</span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="full-item-delete"
          disabled={busy}
          aria-label={`Delete ${item.item_name}`}
          onClick={handleDelete}
        >
          <LuTrash2 size={18} />
        </button>
      </div>

      <div className="full-item-row">
        <label className="full-item-check">
          <input
            type="checkbox"
            checked={!!item.is_purchased}
            disabled={busy}
            onChange={handlePurchasedToggle}
          />
          <span>Mark as purchased</span>
        </label>
      </div>

      {canCopyToPrivate ? (
        <div className="full-item-row full-item-copy-row">
          <button
            type="button"
            className="full-item-secondary-btn"
            disabled={busy || threadBusy || copyBusy}
            onClick={copyToPrivateList}
          >
            {copyBusy ? "Copying…" : "Copy to my private list"}
          </button>
        </div>
      ) : null}

      {item.is_purchased ? (
        <div className="full-item-row full-item-paid-row">
          <label className="full-item-paid-label" htmlFor={`paid-${item.item_id}`}>
            Amount paid
          </label>
          <input
            id={`paid-${item.item_id}`}
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*"
            value={paidStr ?? ""}
            onChange={(e) => setPaidStr(e.target.value)}
          />
          <button type="button" className="full-item-secondary-btn" disabled={busy} onClick={savePaidOnly}>
            Update amount
          </button>
        </div>
      ) : null}

      <div className="full-item-row full-item-notes">
        <label className="full-item-notes-label" htmlFor={`notes-${item.item_id}`}>
          Notes
        </label>
        <p className="full-item-field-hint">
          Only you see this — your private reminders for this item (saved per person).
        </p>
        <textarea
          id={`notes-${item.item_id}`}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Sizing, coupons, reminders..."
        />
        <button type="button" className="full-item-primary-btn" disabled={busy} onClick={saveNotes}>
          Save notes
        </button>
      </div>

      {showGroupComments ? (
        <div className="full-item-row full-item-notes full-item-group-comments">
          <label className="full-item-notes-label">Group comments</label>
          <p className="full-item-field-hint">
            Thread visible to everyone on this shared wishlist. Comments stay here when you log out and back in.
          </p>
          <div className="full-item-thread" aria-live="polite">
            {thread.length === 0 ? (
              <p className="full-item-thread-empty">No comments yet — start the thread below.</p>
            ) : (
              thread.map((c) => {
                const { primary, secondary } = groupCommentAuthorParts(c);
                return (
                  <div key={c.comment_id} className="full-item-thread-row">
                    <div className="full-item-thread-meta">
                      <div className="full-item-thread-author">
                        <span className="full-item-thread-by">Posted by </span>
                        <strong className="full-item-thread-author-name">{primary}</strong>
                        {secondary ? (
                          <span className="full-item-thread-author-sub" title={secondary}>
                            {secondary}
                          </span>
                        ) : null}
                      </div>
                      <span className="full-item-thread-time">{formatCommentTime(c.created_at)}</span>
                    </div>
                    <div className="full-item-thread-body">{c.body}</div>
                  </div>
                );
              })
            )}
          </div>
          <textarea
            id={`gcomment-new-${item.item_id}`}
            rows={2}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment for the group..."
          />
          <button
            type="button"
            className="full-item-primary-btn"
            disabled={busy || threadBusy}
            onClick={postGroupComment}
          >
            {threadBusy ? "Posting…" : "Post comment"}
          </button>
        </div>
      ) : null}

      {msg ? <p className="full-item-msg">{msg}</p> : null}
    </article>
  );
}

