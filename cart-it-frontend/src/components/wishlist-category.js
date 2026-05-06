import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DashShell from "./dash-shell";
import FullItemEditor from "./full-item-editor";
import { apiRequest } from "./api";
import "../styles/wishlist-page.css";

function formatCommentTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(iso);
  }
}

function groupCommentAuthorParts(c) {
  const username = (c.username && String(c.username).trim()) || "";
  const email = (c.email && String(c.email).trim()) || "";
  return {
    primary: username || email || `User #${c.user_id}`,
    secondary: username && email ? email : null,
  };
}

/**
 * Individual wishlist (one category): items, purchased, notes, delete.
 * Route: /wishlist/:groupId
 */
export default function WishlistCategoryPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [groupThread, setGroupThread] = useState([]);
  const [newGroupComment, setNewGroupComment] = useState("");
  const [groupThreadBusy, setGroupThreadBusy] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");
  const [showCollabPanel, setShowCollabPanel] = useState(false);
  const inviteInputRef = useRef(null);

  const handleRenameWishlist = async () => {
    if (!group) return;
    const currentName = String(group.group_name || "").trim();
    const nextName = window.prompt("Rename wishlist:", currentName);
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed) {
      setError("Wishlist name cannot be empty.");
      return;
    }
    if (trimmed === currentName) return;
    try {
      await apiRequest(`/api/groups/${group.group_id}`, {
        method: "PATCH",
        body: JSON.stringify({ group_name: trimmed }),
      });
      await load();
    } catch (e) {
      setError(e.message || "Could not rename wishlist.");
    }
  };

  const handleDeleteWishlist = async () => {
    if (!group) return;
    const name = String(group.group_name || "this wishlist");
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await apiRequest(`/api/groups/${group.group_id}`, { method: "DELETE" });
      navigate("/dashboard");
    } catch (e) {
      setError(e.message || "Could not delete wishlist.");
    }
  };

  const handleVisibilityChange = async (nextVisibility) => {
    if (!group) return;
    try {
      await apiRequest(`/api/groups/${group.group_id}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      await load();
      setInviteStatus("");
    } catch (e) {
      setError(e.message || "Could not update wishlist visibility.");
    }
  };

  const handleInviteMember = async () => {
    if (!group) return;
    const email = inviteEmail.trim();
    if (!email) {
      setInviteStatus("Enter an email address first.");
      return;
    }
    try {
      const result = await apiRequest(`/api/groups/${group.group_id}/invite`, {
        method: "POST",
        body: JSON.stringify({ email, role: "Editor" }),
      });
      const invitedLabel = result?.invited?.username || result?.invited?.email || email;
      const groupLabel = group?.group_name || "this wishlist";
      setInviteStatus(`${invitedLabel} added to "${groupLabel}" as Editor.`);
      setInviteEmail("");
      await load();
    } catch (e) {
      setInviteStatus(e.message || "Could not send invite.");
    }
  };

  const load = useCallback(async () => {
    const gid = Number(groupId);
    if (!groupId || Number.isNaN(gid)) {
      setError("Invalid category.");
      return;
    }
    const [me, g, list, memberRows, comments] = await Promise.all([
      apiRequest("/api/me"),
      apiRequest(`/api/groups/${gid}`),
      apiRequest(`/api/cart-items?group_id=${encodeURIComponent(String(gid))}`),
      apiRequest("/api/group-members").catch(() => []),
      apiRequest(`/api/groups/${gid}/comments`).catch(() => []),
    ]);
    setGroup({ ...g, _viewerUserId: me?.user?.userId });
    setItems(Array.isArray(list) ? list : []);
    setGroupThread(Array.isArray(comments) ? comments : []);
    const perGroup = Array.isArray(memberRows)
      ? memberRows.filter((m) => Number(m.group_id) === gid)
      : [];
    setMembers(perGroup);
    setError("");
  }, [groupId]);

  const postGroupComment = async () => {
    const gid = Number(groupId);
    const text = newGroupComment.trim();
    if (!gid || Number.isNaN(gid) || !text) return;
    setGroupThreadBusy(true);
    try {
      await apiRequest(`/api/groups/${gid}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      const fresh = await apiRequest(`/api/groups/${gid}/comments`);
      setGroupThread(Array.isArray(fresh) ? fresh : []);
      setNewGroupComment("");
      setInviteStatus("Comment posted.");
    } catch (e) {
      setInviteStatus(e.message || "Could not post group comment.");
    } finally {
      setGroupThreadBusy(false);
    }
  };

  const ownerMembers = members.filter((m) => String(m.role || "").toLowerCase() === "owner");
  const editorMembers = members.filter((m) => String(m.role || "").toLowerCase() !== "owner");
  const sortedMembers = [...ownerMembers, ...editorMembers];
  const isWishlistOwner =
    group &&
    group._viewerUserId != null &&
    Number(group.owner_id) === Number(group._viewerUserId);
  const visibleItems = useMemo(() => {
    if (activeFilter === "purchased") return items.filter((item) => Boolean(item.is_purchased));
    if (activeFilter === "open") return items.filter((item) => !item.is_purchased);
    return items;
  }, [items, activeFilter]);
  const totalPrice = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.current_price || 0), 0),
    [items]
  );

  const handleFilterClick = () => {
    setActiveFilter((prev) => (prev === "all" ? "open" : prev === "open" ? "purchased" : "all"));
  };

  const handleShareWishlist = async () => {
    const shareUrl = `${window.location.origin}/wishlist/${group?.group_id || groupId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setInviteStatus("Wishlist link copied. Send it to collaborators.");
    } catch {
      setInviteStatus(`Share this link: ${shareUrl}`);
    }
  };

  const handleToggleCollab = () => {
    if (String(group?.visibility || "").toLowerCase() !== "shared") {
      setInviteStatus("Switch this wishlist to Shared to collaborate.");
      return;
    }
    setShowCollabPanel((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => inviteInputRef.current?.focus(), 0);
      }
      return next;
    });
  };

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
        setError(e.message || "Could not load this wishlist.");
      }
    })();
  }, [navigate, load]);

  return (
    <DashShell>
      <button type="button" className="page-back-link" onClick={() => navigate("/dashboard")}>
        Back to dashboard
      </button>
      {error ? <p className="status-message">{error}</p> : null}
      {!error && group ? (
        <>
          <header className="wishlist-page-header">
            <div>
              <h1 className="dash-title wishlist-page-title">{group.group_name}</h1>
              <p className="wishlist-page-sub">
                Total Price: ${totalPrice.toFixed(2)} · Updated
              </p>
            </div>
          </header>
          <div className="wishlist-toolbar">
            <button type="button" className="wishlist-toolbar-btn" onClick={handleFilterClick}>
              Filter ({activeFilter === "all" ? "All" : activeFilter === "open" ? "Open" : "Purchased"})
            </button>
            {String(group?.visibility || "").toLowerCase() !== "shared" ? (
              <button type="button" className="wishlist-toolbar-btn" onClick={handleShareWishlist}>
                Share
              </button>
            ) : null}
            <button type="button" className="wishlist-toolbar-btn" onClick={handleToggleCollab}>
              Collab
            </button>
            <button
              type="button"
              className="wishlist-toolbar-btn"
              onClick={() => (isWishlistOwner ? handleRenameWishlist() : setInviteStatus("Only the owner can edit this wishlist."))}
            >
              Edit
            </button>
          </div>
          {showCollabPanel ? (
          <div className="wishlist-page-controls">
            <label htmlFor="wishlistVisibility">Visibility</label>
            {isWishlistOwner ? (
              <select
                id="wishlistVisibility"
                value={group.visibility || "Private"}
                onChange={(e) => handleVisibilityChange(e.target.value)}
              >
                <option value="Private">Private</option>
                <option value="Shared">Shared</option>
              </select>
            ) : (
              <p id="wishlistVisibility" className="wishlist-page-sub">
                {group.visibility || "Private"} (only the owner can change this)
              </p>
            )}
            {String(group.visibility || "").toLowerCase() === "shared" ? (
              <>
                {isWishlistOwner ? (
                  <div className="invite-row">
                    <input
                      ref={inviteInputRef}
                      type="email"
                      className="invite-input"
                      placeholder="Invite collaborator by email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                    <button type="button" className="invite-btn" onClick={handleInviteMember}>
                      Invite
                    </button>
                  </div>
                ) : null}
                <p className="wishlist-page-sub">
                  {isWishlistOwner
                    ? "Shared wishlist: invite collaborators by email."
                    : "You are a collaborator on this shared wishlist."}
                </p>
                {sortedMembers.length > 0 ? (
                  <div className="members-list">
                    {sortedMembers.map((member) => {
                      const role = String(member.role || "").toLowerCase() === "owner" ? "Owner" : "Editor";
                      const label =
                        member.username || member.email || `User #${member.user_id}`;
                      return (
                        <div key={`${member.group_id}-${member.user_id}`} className="member-row">
                          <span>{label}</span>
                          <span
                            className={`member-role ${role === "Owner" ? "member-role-owner" : "member-role-editor"}`}
                          >
                            {role}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="wishlist-page-sub">Private wishlist: only you can see items.</p>
            )}
            {inviteStatus ? <p className="wishlist-page-sub">{inviteStatus}</p> : null}
          </div>
          ) : null}
          {isWishlistOwner ? (
            <div className="selected-item-actions" style={{ maxWidth: "360px", marginBottom: "16px" }}>
              <button type="button" className="item-action-btn" onClick={handleRenameWishlist}>
                Rename wishlist
              </button>
              <button type="button" className="item-action-btn item-action-danger" onClick={handleDeleteWishlist}>
                Delete wishlist
              </button>
            </div>
          ) : null}
          {String(group?.visibility || "").toLowerCase() === "shared" ? (
            <section className="wishlist-group-comments">
              <h2 className="wishlist-group-comments-title">Group Chat</h2>
              <p className="wishlist-page-sub">
                One comment box for this whole wishlist (all items).
              </p>
              <div className="wishlist-group-thread" aria-live="polite">
                {groupThread.length === 0 ? (
                  <p className="wishlist-group-thread-empty">No comments yet — start the discussion below.</p>
                ) : (
                  groupThread.map((c) => {
                    const { primary, secondary } = groupCommentAuthorParts(c);
                    return (
                      <div key={c.comment_id} className="wishlist-group-thread-row">
                        <div className="wishlist-group-thread-meta">
                          <div className="wishlist-group-thread-author">
                            <span className="wishlist-group-thread-by">Posted by </span>
                            <strong>{primary}</strong>
                            {secondary ? <span className="wishlist-group-thread-sub">{secondary}</span> : null}
                          </div>
                          <span className="wishlist-group-thread-time">{formatCommentTime(c.created_at)}</span>
                        </div>
                        <div className="wishlist-group-thread-body">{c.body}</div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="wishlist-group-comment-compose">
                <textarea
                  rows={2}
                  value={newGroupComment}
                  onChange={(e) => setNewGroupComment(e.target.value)}
                  placeholder="Talk about the whole wishlist..."
                />
                <button type="button" className="invite-btn" disabled={groupThreadBusy} onClick={postGroupComment}>
                  {groupThreadBusy ? "Posting…" : "Post to wishlist"}
                </button>
              </div>
            </section>
          ) : null}
          <section className="wishlist-page-list">
            {visibleItems.length === 0 ? (
              <div className="empty-inline">No items in this category yet. Save from the extension or add one on the dashboard.</div>
            ) : (
              visibleItems.map((item) => (
                <FullItemEditor
                  key={item.item_id}
                  item={item}
                  onChanged={load}
                  showGroupComments={false}
                  allowCopyToPrivateFromShared={String(group?.visibility || "").toLowerCase() === "shared"}
                />
              ))
            )}
          </section>
        </>
      ) : null}
    </DashShell>
  );
}
