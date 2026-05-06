import React, { useState, useEffect } from 'react';
import { LuX, LuMessageSquare, LuCheck, LuTrash2, LuChevronLeft } from "react-icons/lu";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiRequest } from './api';
import '../styles/item-modal.css';

/**
 * ItemDetailModal Component
 * Provides a detailed slide-out view for a single product, including 
 * price history visualization and a shared notepad for comments.
 */

const ItemDetailModal = ({ item, onClose, onDelete, onMarkPurchased, onAddNote, isCartPage }) => {
  const [view, setView] = useState('details'); // Toggle between 'details' and 'comments' view
  const [newNote, setNewNote] = useState(''); // State for the comment input field
  const [confirmPurchase, setConfirmPurchase] = useState(false); // UI state for the two-step purchase confirmation
  const [priceHistory, setPriceHistory] = useState([]); // State for chart data

  // Side effect to fetch historical price data for the specific item whenever the item ID changes.
  useEffect(() => {
    if (!item?.item_id) {
      setPriceHistory([]);
      return;
    }
    const fetchHistory = async () => {
      try {
        const data = await apiRequest(`/api/cart-items/${item.item_id}/price-history`);
        setPriceHistory(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Error fetching history:", err);
        setPriceHistory([]);
      }
    };
    fetchHistory();
  }, [item?.item_id]);

  if (!item) return null;

  const displayPrice = Number(item.current_price ?? item.price ?? 0).toFixed(2);
  const productName = item.item_name ?? item.product_name ?? "Item";
  const storeLabel = item.store ?? item.store_name ?? "—";

  const handleNoteSubmit = async () => {
    if (!newNote.trim()) return;
    try {
      const prev = String(item.notes ?? "").trim();
      const combined = [prev, newNote.trim()].filter(Boolean).join("\n");
      await apiRequest(`/api/cart-items/${item.item_id}/notes`, {
        method: "PATCH",
        body: JSON.stringify({ notes: combined || null }),
      });
      onAddNote(item.item_id, combined);
      setNewNote('');
    } catch (err) {
      console.error("Failed to save note:", err);
    }
  };

  return (
    <div className="item-modal-overlay" onClick={onClose}>
      {/* Prevent click-through from closing the drawer when interacting with content */}
      <div className="item-modal-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>
          <LuX size={24} />
        </button>

        {view === 'details' ? (
          <>
            {/* Visual Header: Product Image and Links */}
            <a href={item.product_url} target="_blank" rel="noreferrer" className="img-container">
              <img src={item.image_url} alt={productName} referrerPolicy="no-referrer" />
              <div className="img-overlay">View Product</div>
            </a>

            <div className="details-section">
              <p className="store-name">{storeLabel}</p>
              <h2 className="product-name">{productName}</h2>
              <p className="price-tag">${displayPrice}</p>
            </div>

            {/* Price Analytics: Visualizes cost fluctuations over time */}
            <div className="price-history">
              <h3 className="item-section-title">Price History</h3>
              <div className="history-chart-container">
                {priceHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={priceHistory}>
                      <XAxis
                        dataKey="date"
                        hide={priceHistory.length < 2}
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                      />
                      <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
                      <Tooltip
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: 'none', 
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)' 
                        }}
                        formatter={(value) => [`$${Number(value).toFixed(2)}`, "Price"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#0d9488"
                        strokeWidth={2}
                        dot={priceHistory.length < 10}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-history">
                    <p>Price monitoring active. No changes recorded yet.</p>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Notes & Collaboration View */
          <div className="notes-view">
            <button className="back-btn" onClick={() => setView('details')}>
              <LuChevronLeft size={20} /> Back
            </button>
            <h3 className="section-title">Notes & Comments</h3>

            <div className="notes-list">
              {item.notes ? (
                item.notes
                  .split('\n')
                  .filter(note => note.trim() !== "")
                  .map((note, index) => (
                    <div key={index} className="note-bubble">
                      <p>{note}</p>
                    </div>
                  ))
              ) : (
                <p className="empty-notes">No notes yet.</p>
              )}
            </div>

            <div className="note-input-area">
              <textarea
                placeholder="Add a comment..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <button className="save-note-btn" onClick={handleNoteSubmit}>
                Save Note
              </button>
            </div>
          </div>
        )}

        {/* Global Action Bar: Handles communication, purchasing, and deletion */}
        <div className="action-bar">
          <button
            className={`action-btn ${view === 'comments' ? 'active-comment' : ''}`}
            onClick={() => setView(view === 'details' ? 'comments' : 'details')}
          >
            <LuMessageSquare size={20} />
          </button>

          <button
            className={`action-btn purchase-btn ${confirmPurchase ? 'confirming' : ''}`}
            onClick={() => {
              if (!confirmPurchase) {
                setConfirmPurchase(true);
                setTimeout(() => setConfirmPurchase(false), 3000);
              } else {
                onMarkPurchased(item);
              }
            }}
          >
            {confirmPurchase ? <span>Confirm?</span> : <LuCheck size={20} />}
          </button>

          <button
            className="action-btn delete-btn"
            onClick={() => {
              if (window.confirm("Are you sure you want to delete this item?")) {
                onDelete(item.item_id);
              }
            }}
          >
            <LuTrash2 size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ItemDetailModal;