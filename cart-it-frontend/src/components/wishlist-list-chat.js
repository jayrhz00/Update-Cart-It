import React, { useCallback, useEffect, useState } from "react";
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
 * Wishlist-wide group chat (shared lists). Uses GET/POST /api/groups/:id/comments.
 */
export default function WishlistListChat({ groupId, enabled }) {
  const [thread, setThread] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [postBusy, setPostBusy] = useState(false);

  const loadThread = useCallback(async () => {
    if (!groupId || !enabled) return;
    setBusy(true);
    try {
      const rows = await apiRequest(`/api/groups/${groupId}/comments`);
      setThread(Array.isArray(rows) ? rows : []);
    } catch {
      setThread([]);
    } finally {
      setBusy(false);
    }
  }, [groupId, enabled]);

  useEffect(() => {
    if (!enabled || !groupId) return;
    loadThread();
  }, [enabled, groupId, loadThread]);

  const postComment = async (e) => {
    e.preventDefault();
    const text = newComment.trim();
    if (!text || !groupId) return;
    setPostBusy(true);
    try {
      await apiRequest(`/api/groups/${groupId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      setNewComment("");
      await loadThread();
    } catch (err) {
      alert(err.message || "Could not post message.");
    } finally {
      setPostBusy(false);
    }
  };

  if (!enabled || !groupId) return null;

  return (
    <section
      className="wishlist-list-chat-panel"
      aria-labelledby="wishlist-group-chat-heading"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 id="wishlist-group-chat-heading" className="wishlist-list-chat-heading">
        Group chat
      </h2>
      <p className="wishlist-list-chat-lead">
        Collaborators can discuss this list here. Each message shows who sent it and when.
      </p>
      {busy ? (
        <p className="wishlist-group-chat-status">Loading messages…</p>
      ) : thread.length === 0 ? (
        <p className="wishlist-group-chat-empty">No messages yet — say hello below.</p>
      ) : (
        <div className="wishlist-group-chat-thread wishlist-list-chat-thread" aria-live="polite">
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
        rows={3}
        className="wishlist-group-chat-input"
        placeholder="Write a message to everyone on this list…"
        value={newComment}
        onChange={(e) => setNewComment(e.target.value)}
      />
      <button
        type="button"
        className="wishlist-group-chat-send"
        disabled={postBusy || !newComment.trim()}
        onClick={postComment}
      >
        {postBusy ? "Sending…" : "Send message"}
      </button>
    </section>
  );
}
