import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { API_BASE_URL } from './components/api';
import LandingPage from './components/landing-page';
import Login from './components/login';
import Signup from './components/signup';
import Dashboard from './components/dashboard';
import Wishlist from './components/wishlist';
import PublicWishlist from './components/public-wishlist';
import Cart from './components/cart';
import Coupons from './components/coupons';
import PublicCart from './components/public-cart';
import ItemDetailPage from './components/item-detail-page';
import ResetPassword from './components/reset-password';
import ForgotPassword from './components/forgot-password';
import PrivacyPolicy from './components/privacy-policy';

function App() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    void fetch(`${API_BASE_URL}/`, { mode: 'cors', cache: 'no-store' }).catch(() => {});
  }, []);

  const buildSha = process.env.REACT_APP_GIT_SHA || "";
  const shortSha =
    buildSha.length >= 7 ? buildSha.slice(0, 7) : buildSha;

  return (
    <>
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/wishlist/:id" element={<Wishlist />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/coupons" element={<Coupons />} />
        <Route path="/share/:token" element={<PublicCart />} />
        <Route path="/item/:id" element={<ItemDetailPage />} />
        <Route path="/share-wishlist/:shareToken/:wishlistId" element={<PublicWishlist />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </Router>
    {shortSha ? (
      <div
        className="fixed bottom-1 right-1 z-[9999] max-w-[90vw] truncate font-mono text-[10px] text-black/25 pointer-events-none select-none"
        title={`Build ${buildSha}`}
        aria-hidden
      >
        {shortSha}
      </div>
    ) : null}
    </>
  );
}

export default App;
