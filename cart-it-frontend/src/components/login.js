import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../styles/auth.css';
import { apiRequest, API_BASE_URL } from './api';

const Login = () => {
  const navigate = useNavigate(); // Hook for navigation
  const [email, setEmail] = useState(''); // State for email input
  const [password, setPassword] = useState(''); // State for password input
  const [statusMessage, setStatusMessage] = useState(''); // State for status messages
  const [isLoading, setIsLoading] = useState(false);
  const slowHintTimerRef = useRef(null);

  // Wake Render free tier as soon as the login page opens so the first tap is faster.
  useEffect(() => {
    void fetch(`${API_BASE_URL}/`, { mode: 'cors', cache: 'no-store' }).catch(() => {});
  }, []);

  // Handle form submission for login
  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatusMessage('');
    setIsLoading(true);
    if (slowHintTimerRef.current) clearTimeout(slowHintTimerRef.current);
    slowHintTimerRef.current = setTimeout(() => {
      setStatusMessage(
        'Still connecting… On free hosting (Render), the API may be waking from sleep (often ~30–90s the first time). This page already pings the server when it opens; you can also open the API in another tab once to warm it.'
      );
    }, 2000);
    try {
      // Wake Render/neighbors: cheap GET while login POST runs (cold-start mitigation).
      void fetch(`${API_BASE_URL}/`, { mode: 'cors', cache: 'no-store' }).catch(() => {});

      const data = await apiRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        timeoutMs: 120000,
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/dashboard');
    } catch (error) {
      console.error("Connection error:", error);
      setStatusMessage(error.message || "Could not connect to server");
    } finally {
      if (slowHintTimerRef.current) {
        clearTimeout(slowHintTimerRef.current);
        slowHintTimerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-screen-page">
      <div className="auth-screen-inner">
        <div className="auth-screen-logo-wrap">
          <img
            src={`${process.env.PUBLIC_URL || ''}/logo-full.svg`}
            alt="Cart-It"
            className="auth-screen-logo"
            decoding="async"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = `${process.env.PUBLIC_URL || ''}/logo.png`;
            }}
          />
        </div>

        <h1 className="auth-screen-headline">
          Your wishlist misses you… and it has excellent taste.
        </h1>

        <div className="auth-screen-card">
          <h2 className="auth-title">Log in to your account</h2>
          {statusMessage && <div className="status-message">{statusMessage}</div>}
          {isLoading && <div className="status-loading">Signing you in...</div>}
          <p className="auth-subtitle">
            Don’t have an account? <Link to="/signup" className="link-styled">Sign up here.</Link>
          </p>
          <p className="auth-subtitle">
            Forgot password? <Link to="/forgot-password" className="link-styled">Reset it here.</Link>
          </p>

          <form onSubmit={handleSubmit} className="auth-form-group">
            <div>
              <label className="auth-label">Email</label>
              <input
                type="email"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            <div>
              <label className="auth-label">Password</label>
              <input
                type="password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? "Logging in..." : "Log In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
