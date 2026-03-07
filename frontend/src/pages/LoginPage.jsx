import React, { useState } from 'react';
import * as api from '../api';

export default function LoginPage({ onLogin, onSwitchToRegister }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.login(username, password);
      onLogin(result.user);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setError('');
    setGuestLoading(true);
    try {
      const result = await api.guestLogin();
      onLogin({ ...result.user, isGuest: true });
    } catch (err) {
      setError(err.message || 'Guest login failed');
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-hero">
        <div className="login-hero-content">
          <div className="login-hero-emoji">🌿</div>
          <h1 className="login-hero-title">PlantIQ</h1>
          <p className="login-hero-subtitle">Monitor your plants with AI-powered insights</p>
        </div>
      </div>

      <div className="login-card">
        <h2 className="login-title">Welcome Back</h2>
        <p className="login-subtitle">Sign in to your account</p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading || guestLoading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || guestLoading}
              required
            />
          </div>

          <button type="submit" className="login-submit-btn" disabled={loading || guestLoading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="login-divider"><span>or</span></div>

        <button
          type="button"
          className="guest-login-btn"
          onClick={handleGuestLogin}
          disabled={loading || guestLoading}
        >
          {guestLoading ? '⏳ Loading demo...' : '👀 Continue as Guest'}
        </button>

        <p className="guest-login-note">Explore with 3 sample plants — no account needed</p>

        <p className="login-register-link">
          Don't have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="login-register-btn"
          >
            Register here
          </button>
        </p>
      </div>
    </div>
  );
}
