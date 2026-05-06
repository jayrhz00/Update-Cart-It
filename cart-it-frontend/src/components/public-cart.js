import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { publicApiGet } from './api';
import { LoadingState, EmptyState } from './feedback';
import { LuExternalLink } from 'react-icons/lu';
import '../styles/public.css';

/**
 * PublicCart Component
 * Renders a read-only view of a user's cart accessible via a unique share token.
 */

const PublicCart = () => {
  const { token } = useParams(); // Get the share token from the URL parameters
  const navigate = useNavigate(); // Hook for navigation
  const [items, setItems] = useState([]); // State to hold the items in the public cart
  const [isLoading, setIsLoading] = useState(true); // State to indicate loading status while fetching cart data

  // Fetch the public cart data when the component mounts or when the token changes
  useEffect(() => {
    publicApiGet(`/api/public/cart/${encodeURIComponent(token)}`)
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
        setIsLoading(false); // Set loading to false after data is fetched
      })
      .catch(err => {
        console.error(err);
        setIsLoading(false);
      });
  }, [token]);

  // Calculate the total price of all items in the cart by summing up their prices
  const total = items.reduce((sum, item) => sum + parseFloat(item.price || 0), 0);

  return (
    <div className="public-page-wrapper">
      {/* Navigation bar with logo and call-to-action button to create a new cart */}
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
          Create your own cart →
        </button>
      </nav>

      {/* Main content area displaying the cart items, with loading and empty states handled accordingly */ }
      <main className="public-container">
        <header className="public-header">
          <h1 className="public-title">
            {isLoading ? "Loading..." : items.length > 0 && items[0].username ? `${items[0].username}'s Cart` : "Cart"}
          </h1>
          <div className="public-meta">
            <span className="italic">Curated Collection</span>
            <span className="text-gray-300">•</span>
            <span className="font-medium">{items.length} items</span>
            <span className="text-gray-300">•</span>
            <span className="public-total">${total.toFixed(2)} total</span>
          </div>
        </header>

        <section className="public-grid">
          {isLoading ? (
            <LoadingState />
          ) : items.length === 0 ? (
            <EmptyState message="This shared cart is currently empty." />
          ) : (
            items.map((item) => (
              <div key={item.item_id} className="public-card group">
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

                {/* Display the product details including store name, product name, price, and a button to shop at the retailer's website */ }
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

export default PublicCart;