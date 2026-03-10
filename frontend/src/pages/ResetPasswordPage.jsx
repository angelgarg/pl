import React, { useState, useEffect } from 'react';
import * as api from '../api';

export default function ResetPasswordPage({ onBack, onResetSuccess }) {
  const [token, setToken]               = useState('');
  const [newPassword, setNewPassword]   = useState('');
  const [confirmPassword, setConfirm]   = useState('');
  const [loading, setLoading]           = useState(false);
  const [message, setMessage]           = useState('');
  const [error, setError]               = useState('');

  // Read token from ?token=... in the URL hash or search params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token') || '';
    setToken(t);
    if (!t) setError('Invalid or missing reset token. Please request a new reset link.');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return setError('Passwords do not match');
    if (newPassword.length < 6) return setError('Password must be at least 6 characters');
    setError('');
    setLoading(true);
    try {
      await api.wakeBackend();
      const result = await api.resetPassword(token, newPassword, confirmPassword);
      setMessage(result.message || 'Password reset successfully!');
      setTimeout(() => onResetSuccess?.(), 2500);
    } catch (err) {
      setError(err.message || 'Password reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-hero">
        <div className="login-hero-content">
          <div className="login-hero-emoji">🌿</div>
          <h1 className="login-hero-title">BhoomiIQ</h1>
        </div>
      </div>

      <div className="login-card">
        <h2 className="login-title">🔒 Set New Password</h2>
        <p className="login-subtitle">Choose a strong password for your account.</p>

        {error   && <div className="login-error">{error}</div>}
        {message && <div className="login-success">{message}</div>}

        {!message && token && (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                placeholder="Minimum 6 characters"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={e => setConfirm(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <button type="submit" className="login-submit-btn" disabled={loading}>
              {loading ? '⏳ Resetting...' : '🔒 Reset Password'}
            </button>
          </form>
        )}

        <p className="login-register-link">
          <button type="button" onClick={onBack} className="login-register-btn">
            ← Back to Login
          </button>
        </p>
      </div>
    </div>
  );
}
