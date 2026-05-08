import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LuLayoutDashboard, LuShoppingCart, LuTicket, LuLogOut, LuDownload } from "react-icons/lu";
import NotificationBell from "./notification-bell";
import '../styles/sidebar.css';

const Sidebar = ({ showExtension = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) {
        setDisplayName('');
        return;
      }
      const u = JSON.parse(raw);
      setDisplayName(String(u?.username || u?.email || '').trim());
    } catch {
      setDisplayName('');
    }
  }, [location.pathname]);

  const path = location.pathname;
  const dashboardActive =
    path === '/dashboard' || path.startsWith('/wishlist');
  const cartActive = path === '/cart';
  const couponsActive = path === '/coupons';

  const navBtn = (active) =>
    `dash-topnav-link${active ? ' dash-topnav-link--active' : ''}`;

  return (
    <header className="dash-topnav">
      <div className="dash-topnav-inner">
        <div className="dash-topnav-left">
          <img
            src={`${process.env.PUBLIC_URL || ''}/logo-full.svg`}
            alt="Cart-It"
            className="dash-topnav-logo"
            onClick={() => navigate('/dashboard')}
            role="presentation"
            decoding="async"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = `${process.env.PUBLIC_URL || ''}/logo.png`;
            }}
          />
        </div>

        <nav className="dash-topnav-center" aria-label="Main navigation">
          <button
            type="button"
            className={navBtn(dashboardActive)}
            onClick={() => navigate('/dashboard')}
          >
            <LuLayoutDashboard aria-hidden />
            <span>Dashboard</span>
          </button>
          <button
            type="button"
            className={navBtn(cartActive)}
            onClick={() => navigate('/cart')}
          >
            <LuShoppingCart aria-hidden />
            <span>Cart</span>
          </button>
          <button
            type="button"
            className={navBtn(couponsActive)}
            onClick={() => navigate('/coupons')}
          >
            <LuTicket aria-hidden />
            <span>Offers</span>
          </button>
        </nav>

        <div className="dash-topnav-right">
          {displayName ? (
            <span className="dash-topnav-user" title={displayName}>
              {displayName}
            </span>
          ) : null}
          <NotificationBell />
          <button
            type="button"
            className="dash-topnav-logout"
            onClick={() => {
              localStorage.clear();
              navigate('/');
            }}
          >
            <LuLogOut aria-hidden />
            <span className="dash-topnav-logout-text">Log out</span>
          </button>
        </div>
      </div>

      {showExtension ? (
        <div className="dash-topnav-extension">
          <span className="dash-topnav-extension-label">Get the Extension</span>
          <button
            type="button"
            className="extension-btn extension-btn--pink"
            onClick={() =>
              window.open('/extension-install.html', '_blank', 'noopener,noreferrer')
            }
          >
            <LuDownload size={15} aria-hidden />
            Download
          </button>
        </div>
      ) : null}
    </header>
  );
};

export default Sidebar;
