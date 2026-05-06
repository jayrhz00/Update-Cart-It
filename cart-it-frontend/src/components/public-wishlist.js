import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingState, EmptyState } from './feedback';
import { LuExternalLink } from 'react-icons/lu';
import { publicApiGet } from './api';
import '../styles/public.css';

/**
 * PublicWishlist Component
 * Renders a read-only view of a specific wishlist accessible via a unique share token.
 */

const PublicWishlist = () => {
  // Extract dynamic route parameters: shareToken for authorization and wishlistId for identification
  const { shareToken, wishlistId } = useParams(); 
  const navigate = useNavigate(); 

  const [items, setItems] = useState([]);  // State for array of products in the wishlist
  const [isLoading, setIsLoading] = useState(true);  // State for loading toggle for UI feedback
  const [wishlistName, setWishlistName] = useState(""); // State for title of the wishlist
  const [owner, setOwner] = useState("");   // State for username of the list creator

  //  Use effect to fetch public wishlist data from the API on component mount or when the shareToken/wishlistId change
  
  useEffect(() => {
    publicApiGet(
      `/api/public/wishlist/${encodeURIComponent(shareToken)}/${encodeURIComponent(wishlistId)}`
    )
      .then((data) => {
        const rows = Array.isArray(data) ? data : [];
        setItems(rows);
        if (rows.length > 0) {
          setWishlistName(rows[0].wishlist_name || "");
          setOwner(rows[0].username || "");
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Error fetching public wishlist:", err);
        setIsLoading(false);
      });
  }, [shareToken, wishlistId]);

  // Calculates the sum of all item prices; defaults to 0 if price is missing/invalid
  const total = items.reduce((sum, item) => sum + parseFloat(item.price || 0), 0);

  return (
    <div className="public-page-wrapper">
      {/* Navigation Header with branding and CTA */}
      <nav className="public-nav">
        <img
          src="/logo.svg"
          alt="Cart-It Logo"
          className="public-logo"
          onClick={() => navigate('/')}
        />
        <button
          onClick={() => navigate('/signup')}
          className="btn-create-cta"
        >
          Create your own list →
        </button>
      </nav>

      <main className="public-container">
        {/* Header Section: Displays wishlist title and curator stats */}
        <header className="public-header">
          <h1 className="public-title">
            {isLoading ? "Loading..." : wishlistName}
          </h1>
          <div className="public-meta">
            <span className="italic">Curated by <strong>{owner}</strong></span>
            <span className="text-gray-300">•</span>
            <span className="font-medium">{items.length} items</span>
            <span className="text-gray-300">•</span>
            <span className="public-total">${total.toFixed(2)} total</span>
          </div>
        </header>

        {/* Product Grid: Handles Loading, Empty, and Populated states */}
        <section className="public-grid">
          {isLoading ? (
            <LoadingState />
          ) : items.length === 0 ? (
            <EmptyState message="This curated list is currently empty." />
          ) : (
            items.map((item) => (
              <div key={item.item_id} className="public-card group">
                {/* Visual section of the product card */}
                <div className="public-img-wrapper">
                  <img
                    src={item.image_url}
                    alt={item.product_name}
                    className="public-img"
                    referrerPolicy="no-referrer"
                  />
                  <div className="external-indicator">
                    <LuExternalLink size={18} className="text-gray-600" />
                  </div>
                </div>

                {/* Text section of the product card */}
                <div className="public-details">
                  <p className="public-store-name">{item.store_name}</p>
                  <h3 className="public-product-name">{item.product_name}</h3>
                  <p className="public-price">
                    ${item.price ? parseFloat(item.price).toFixed(2) : "0.00"}
                  </p>
                  <button
                    onClick={() => window.open(item.product_url, '_blank', 'noopener,noreferrer')}
                    className="btn-shop"
                  >
                    Shop at {item.store_name}
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <footer className="public-footer">
          <div className="footer-badge">
            Made with <span className="text-red-500">♥</span> using <strong>Cart-It</strong>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default PublicWishlist;