import React, { useState } from 'react';
import * as api from '../api';

export default function ForgotPasswordPage({ onBack }) {
  const [email, setEmail]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [message, setMessage]   = useState('');
  const [error, setError]       = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await api.wakeBackend();
      const result = await api.forgotPassword(email.trim());
      setMessage(result.message || 'Reset link sent! Check your email inbox (and spam folder).');
    } catch (err) {
      setError(err.message || 'Failed to send reset email');
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
        <h2 className="login-title">🔑 Forgot Password</h2>
        <p className="login-subtitle">Enter your registered email and we'll send you a reset link.</p>

        {error   && <div className="login-error">{error}</div>}
        {message && <div className="login-success">{message}</div>}

        {!message && (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="fp-email">Email Address</label>
              <input
                id="fp-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <button type="submit" className="login-submit-btn" disabled={loading}>
              {loading ? '⏳ Sending...' : '📨 Send Reset Link'}
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
