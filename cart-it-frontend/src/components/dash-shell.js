import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LuDownload, LuLayoutDashboard, LuLogOut, LuShoppingCart, LuTicket } from "react-icons/lu";
import NotificationBell from "./notification-bell";
import "../styles/dashboard.css";
import "../styles/sidebar.css";

const navClass = ({ isActive }) =>
  `dash-nav-link${isActive ? " dash-nav-link-active" : ""}`;

/**
 * Shared chrome for post-login pages: sidebar nav.
 */
export default function DashShell({ children }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  return (
    <div className="dashboard-container">
      <aside className="dash-sidebar">
        <div className="dash-shell-logo-row flex items-start justify-between gap-2 mb-6">
          <button type="button" className="sidebar-logo-btn flex-1 min-w-0" onClick={() => navigate("/dashboard")}>
            <img src="/logo.svg" alt="Cart-It home" className="sidebar-logo" />
          </button>
          <NotificationBell />
        </div>

        <nav className="dash-nav" aria-label="Main">
          <NavLink to="/dashboard" className={navClass} end>
            <LuLayoutDashboard size={18} aria-hidden />
            Dashboard
          </NavLink>
          <NavLink to="/cart" className={navClass}>
            <LuShoppingCart size={18} aria-hidden />
            Cart
          </NavLink>
          <NavLink to="/coupons" className={navClass}>
            <LuTicket size={18} aria-hidden />
            Offers
          </NavLink>
        </nav>

        <div className="extension-card">
          <p className="extension-title">Get the Extension</p>
          <a
            href="/extension-install.html"
            target="_blank"
            rel="noopener noreferrer"
            className="extension-btn extension-btn-link"
          >
            <LuDownload size={14} aria-hidden />
            Download
          </a>
        </div>
        <button type="button" className="logout-btn" onClick={handleLogout}>
          <LuLogOut /> Log Out
        </button>
      </aside>
      <main className="dash-main">{children}</main>
    </div>
  );
}
