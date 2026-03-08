import React, { useState } from 'react';
import * as api from '../api';

export default function RegisterPage({ onLogin, onSwitchToLogin }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStatusMsg('Connecting to server...');

    try {
      const wakeTimer = setTimeout(() => setStatusMsg('Server is waking up, please wait (up to 30s)...'), 3000);
      await api.wakeBackend();
      clearTimeout(wakeTimer);
      setStatusMsg('Creating your account...');
      const result = await api.register(username, email, password, confirmPassword);
      onLogin(result.user);
    } catch (err) {
      setError(err.message === 'signal timed out'
        ? 'Server took too long to respond. Please try again.'
        : err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
      setStatusMsg('');
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
        <h2 className="login-title">Create Account</h2>
        <p className="login-subtitle">Join PlantIQ today</p>

        {error && <div className="login-error">{error}</div>}
        {statusMsg && <div className="login-status">{statusMsg}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="Enter a password (min. 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="login-register-link">
          Already have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="login-register-btn"
          >
            Sign in here
          </button>
        </p>
      </div>
    </div>
  );
}
