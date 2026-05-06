import React, { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import "../styles/auth.css";
import { apiRequest } from "./api";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusKind, setStatusKind] = useState("error");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatusMessage("");
    setStatusKind("error");
    if (!token) {
      setStatusMessage("Reset link is invalid. Please request a new one.");
      return;
    }
    if (password.length < 8) {
      setStatusMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setStatusMessage("Passwords do not match.");
      return;
    }
    setIsLoading(true);
    try {
      const data = await apiRequest("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          token,
          new_password: password,
        }),
      });
      setStatusMessage(data?.message || "Password reset successful. Redirecting to login...");
      setStatusKind("success");
      setTimeout(() => navigate("/login"), 1800);
    } catch (error) {
      setStatusMessage(error.message || "Reset link is invalid or expired.");
      setStatusKind("error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-sidebar">
        <div className="auth-sidebar-content">
          <h1 className="auth-sidebar-title">Set a new password</h1>
          <div className="auth-logo-circle">
            <img src="/logo.svg" alt="" className="auth-logo-img" aria-hidden />
          </div>
        </div>
      </div>
      <div className="auth-form-wrapper">
        <div className="auth-form-container">
          <div className="auth-card">
            <h2 className="auth-title">Reset password</h2>
            {statusMessage ? (
              <div className={statusKind === "success" ? "status-success" : "status-message"}>
                {statusMessage}
              </div>
            ) : null}
            <form onSubmit={handleSubmit} className="auth-form-group-tight">
              <div>
                <label className="auth-label">New password</label>
                <input
                  type="password"
                  className="input-field"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
              <div>
                <label className="auth-label">Confirm new password</label>
                <input
                  type="password"
                  className="input-field"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
              <button type="submit" className="btn-primary" disabled={isLoading}>
                {isLoading ? "Resetting..." : "Reset password"}
              </button>
            </form>
            <p className="auth-subtitle" style={{ marginTop: "12px" }}>
              Back to <Link to="/login" className="link-styled">login</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
