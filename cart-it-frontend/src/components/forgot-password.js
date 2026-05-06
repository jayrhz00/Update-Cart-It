import React, { useState } from "react";
import { Link } from "react-router-dom";
import "../styles/auth.css";
import { apiRequest } from "./api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatusMessage("");
    setIsLoading(true);
    try {
      const data = await apiRequest("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setStatusMessage(data?.message || "If an account exists, a reset link was sent.");
    } catch (error) {
      setStatusMessage("If an account exists, a reset link was sent.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-screen-page">
      <div className="auth-screen-inner">
        <div className="auth-screen-logo-wrap">
          <img
            src={`${process.env.PUBLIC_URL || ""}/logo-full.svg`}
            alt="Cart-It"
            className="auth-screen-logo"
            decoding="async"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = `${process.env.PUBLIC_URL || ""}/logo.png`;
            }}
          />
        </div>

        <h1 className="auth-screen-headline">Let&apos;s pretend this never happened…</h1>

        <div className="auth-screen-card">
          <h2 className="auth-title">Forgot your password?</h2>
          {statusMessage ? <div className="status-success">{statusMessage}</div> : null}
          <p className="auth-subtitle">
            Enter your email and we will send a password reset link.
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
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? "Sending..." : "Send reset link"}
            </button>
          </form>
          <p className="auth-subtitle">
            Remembered it? <Link to="/login" className="link-styled">Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
