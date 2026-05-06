import React, { useCallback, useState } from "react";
import { apiRequest } from "./api";

function formatCommentTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(iso);
  }
}

function authorParts(c) {
  const username = (c.username && String(c.username).trim()) || "";
  const email = (c.email && String(c.email).trim()) || "";
  const primary = username || email || `User #${c.user_id}`;
  const secondary = username && email ? email : null;
  return { primary, secondary };
}

/**
 * Group comment thread for shared wishlist items (same API as FullItemEditor group comments).
 */
export default function WishlistGroupChat({ itemId, enabled }) {
  const [thread, setThread] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [postBusy, setPostBusy] = useState(false);

  const loadThread = useCallback(async () => {
    if (!itemId || !enabled) return;
    setBusy(true);
    try {
      const rows = await apiRequest(`/api/cart-items/${itemId}/group-comments`);
      setThread(Array.isArray(rows) ? rows : []);
    } catch {
      setThread([]);
    } finally {
      setBusy(false);
    }
  }, [itemId, enabled]);

  const postComment = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const text = newComment.trim();
    if (!text || !itemId) return;
    setPostBusy(true);
    try {
      await apiRequest(`/api/cart-items/${itemId}/group-comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      setNewComment("");
      await loadThread();
    } catch (err) {
      alert(err.message || "Could not post comment.");
    } finally {
      setPostBusy(false);
    }
  };

  if (!enabled || !itemId) return null;

  return (
    <details
      className="wishlist-group-chat"
      onToggle={(e) => {
        if (e.target.open) loadThread();
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <summary className="wishlist-group-chat-summary">Group chat</summary>
      <div className="wishlist-group-chat-body">
        {busy ? (
          <p className="wishlist-group-chat-status">Loading messages…</p>
        ) : thread.length === 0 ? (
          <p className="wishlist-group-chat-empty">No messages yet — say hi below.</p>
        ) : (
          <div className="wishlist-group-chat-thread" aria-live="polite">
            {thread.map((c) => {
              const { primary, secondary } = authorParts(c);
              return (
                <div key={c.comment_id} className="wishlist-group-chat-row">
                  <div className="wishlist-group-chat-meta">
                    <strong>{primary}</strong>
                    {secondary ? (
                      <span className="wishlist-group-chat-email" title={secondary}>
                        {secondary}
                      </span>
                    ) : null}
                    <span className="wishlist-group-chat-time">{formatCommentTime(c.created_at)}</span>
                  </div>
                  <div className="wishlist-group-chat-text">{c.body}</div>
                </div>
              );
            })}
          </div>
        )}
        <textarea
          rows={2}
          className="wishlist-group-chat-input"
          placeholder="Message everyone on this list…"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          className="wishlist-group-chat-send"
          disabled={postBusy || !newComment.trim()}
          onClick={postComment}
        >
          {postBusy ? "Sending…" : "Send"}
        </button>
      </div>
    </details>
  );
}
