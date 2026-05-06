import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../styles/auth.css';
import { apiRequest } from './api';

const Signup = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusKind, setStatusKind] = useState('error');
  const [isLoading, setIsLoading] = useState(false);

  const handleSignup = async (e) => {
    e.preventDefault();
    setStatusMessage('');
    setStatusKind('error');
    setIsLoading(true);
    try {
      await apiRequest('/api/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
      });
      setStatusMessage('Sign up successful! Redirecting to login...');
      setStatusKind('success');
      setTimeout(() => navigate('/login'), 2000);
    } catch (error) {
      console.error('Connection error:', error);
      setStatusMessage(error.message || 'Server is down, please try again later.');
      setStatusKind('error');
    } finally {
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

        <h1 className="auth-screen-headline">Your impulse thoughts deserve a safe space.</h1>

        <div className="auth-screen-card">
          <h2 className="auth-title">Create your account</h2>
          {statusMessage && (
            <div className={statusKind === 'success' ? 'status-success' : 'status-message'}>{statusMessage}</div>
          )}
          <p className="auth-subtitle">
            Already have an account? <Link to="/login" className="link-styled">Log in here.</Link>
          </p>

          <form onSubmit={handleSignup} className="auth-form-group">
            <div>
              <label className="auth-label">Username</label>
              <input
                type="text"
                className="input-field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            <div>
              <label className="auth-label">Email Address</label>
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
              {isLoading ? 'Signing up...' : 'Sign Up'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Signup;
