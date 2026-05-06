import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/landing.css';

const FEATURE_ITEMS = [
  {
    icon: '🛒',
    title: 'Save from Any Website',
    desc: 'Quickly save products from any online store in one place',
    barPct: 82,
  },
  {
    icon: '🔔',
    title: 'Track Price Drops',
    desc: 'Get notified when prices change so you can buy at the right time',
    barPct: 94,
  },
  {
    icon: '📂',
    title: 'Stay Organized',
    desc: 'Group items into custom lists for a clean and simple shopping experience',
    barPct: 76,
  },
  {
    icon: '📝',
    title: 'Add Personal Notes',
    desc: 'Keep track of sizing, quality, and past experiences',
    barPct: 68,
  },
  {
    icon: '👥',
    title: 'Share & Collaborate',
    desc: 'Create shared lists and shop together with friends or family',
    barPct: 71,
  },
  {
    icon: '📈',
    title: 'Shop Smarter',
    desc: 'Make better buying decisions with everything in one place',
    barPct: 88,
  },
];

const LandingPage = () => {
  return (
    <div className="landing-container">
      {/* Navbar with logo */}
      <header className="landing-header">
        <div className="flex items-center">
          <img
            src={`${process.env.PUBLIC_URL || ''}/logo-full.svg`}
            alt="Cart-It Logo"
            className="logo-img logo-img--full"
            width={220}
            height={206}
            decoding="async"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = `${process.env.PUBLIC_URL || ''}/logo.png`;
            }}
          />
        </div>
      </header>

      {/* Hero: Main value proposition section */}
      <section className="hero-section">
        <div className="hero-overlay"></div> 
        <div className="hero-content">
          <h1 className="hero-title">Save everywhere. Shop together.</h1>
          <p className="hero-subtitle">
            Save items from any site, share lists and chat with friends, catch price drops and
            restock alerts, and keep personal notes on everything you love.
          </p>
          <div className="hero-buttons">
            <Link to="/signup" className="btn-register">Register</Link>
            <Link to="/login" className="btn-login">Login</Link>
          </div>
          <div className="hero-extension-cta">
            <button
              type="button"
              className="download-btn"
              onClick={() => window.open("/extension-install.html", "_blank", "noopener,noreferrer")}
            >
              Download Cart-It Extension
            </button>
          </div>
        </div>
      </section>

      {/* How it works: 3-step process cards */}
      <section className="section-padding">
        <div className="steps-wrapper">
          <h2 className="section-title">How It Works</h2>
          <p className="section-subtitle">Easily save, track, and manage your shopping in just a few steps.</p>
          
          <div className="steps-grid">
            <div className="step-card">
              <span className="step-number">1</span>
              <h3 className="step-title">Add Items from Any Website</h3>
              <p className="step-desc">Use the Cart-It extension to save products instantly</p>
            </div>
            <div className="step-card">
              <span className="step-number">2</span>
              <h3 className="step-title">Save & Organize</h3>
              <p className="step-desc">Organize items into groups and add notes</p>
            </div>
            <div className="step-card">
              <span className="step-number">3</span>
              <h3 className="step-title">Track & Decide</h3>
              <p className="step-desc">Track prices and purchase when ready</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features: chart-inspired layout */}
      <section className="features-section" aria-labelledby="features-heading">
        <div className="features-section-inner">
          <div className="features-head">
            <h2 id="features-heading" className="features-main-title">
              Why Choose Cart-It?
            </h2>
            <p className="features-main-subtitle">
              Built for saving from anywhere, sharing lists with chat, smarter price and stock
              tracking, and notes you actually use.
            </p>
          </div>

          <div className="features-chart-panel">
            <div className="features-chart-main">
              <div className="features-chart-stage">
                <div className="features-chart-bg" aria-hidden="true">
                  <svg className="features-chart-area-svg" viewBox="0 0 800 120" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="featuresAreaGrad" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor="#fb923c" stopOpacity="0" />
                        <stop offset="55%" stopColor="#f472b6" stopOpacity="0.16" />
                        <stop offset="100%" stopColor="#fbcfe8" stopOpacity="0.32" />
                      </linearGradient>
                      <linearGradient id="featuresLineGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#f472b6" />
                        <stop offset="100%" stopColor="#fb923c" />
                      </linearGradient>
                    </defs>
                    <path
                      fill="url(#featuresAreaGrad)"
                      d="M0,118 Q120,72 200,88 T400,52 T600,68 T800,42 L800,120 L0,120 Z"
                    />
                    <path
                      fill="none"
                      stroke="url(#featuresLineGrad)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      d="M0,118 Q120,72 200,88 T400,52 T600,68 T800,42"
                    />
                  </svg>
                </div>
                <div className="features-chart-gridlines" aria-hidden="true" />
                <ul className="features-chart-bars-row">
                  {FEATURE_ITEMS.map((item) => (
                    <li key={item.title} className="features-chart-bar-slot">
                      <span className="features-chart-icon" aria-hidden="true">
                        {item.icon}
                      </span>
                      <div className="features-chart-track">
                        <div
                          className="features-chart-bar"
                          style={{ height: `${item.barPct}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="features-chart-captions">
                {FEATURE_ITEMS.map((item) => (
                  <li key={item.title} className="features-chart-caption">
                    <h3 className="feature-title">{item.title}</h3>
                    <p className="feature-desc">{item.desc}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default LandingPage;