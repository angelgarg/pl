import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as api from '../api';
import { useLang } from '../LangContext';
import { LANG_OPTIONS } from '../i18n';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// ─── Google Sign-In Button ─────────────────────────────────────────────────
function GoogleSignInButton({ onLogin, disabled }) {
  const btnRef = useRef(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCredential = useCallback(async (response) => {
    setError('');
    setLoading(true);
    try {
      await api.wakeBackend();
      const result = await api.googleLogin(response.credential);
      onLogin(result.user);
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  }, [onLogin]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !window.google || !btnRef.current) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback:  handleCredential
    });
    window.google.accounts.id.renderButton(btnRef.current, {
      theme: 'outline', size: 'large', width: 320, text: 'signin_with'
    });
  }, [handleCredential]);

  if (!GOOGLE_CLIENT_ID) {
    return (
      <div className="social-not-configured">
        Google Sign-In not configured — add <code>VITE_GOOGLE_CLIENT_ID</code> to Vercel env vars.
      </div>
    );
  }

  return (
    <div>
      {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
      {loading ? (
        <div className="social-loading">⏳ Signing in with Google...</div>
      ) : (
        <div ref={btnRef} style={{ display: 'flex', justifyContent: 'center' }} />
      )}
    </div>
  );
}

// ─── Main Login Page ───────────────────────────────────────────────────────
export default function LoginPage({ onLogin, onSwitchToRegister, onForgotPassword }) {
  const { lang, setLang, t } = useLang();

  // Active tab: 'email' | 'google'
  const [tab, setTab] = useState('email');

  // Email/password form
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError]         = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // Language dropdown
  const [langOpen, setLangOpen]   = useState(false);
  const langRef = useRef(null);
  const currentLang = LANG_OPTIONS.find(o => o.value === lang) || LANG_OPTIONS[0];

  useEffect(() => {
    const handler = (e) => {
      if (langRef.current && !langRef.current.contains(e.target)) setLangOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Email login ─────────────────────────────────────────────
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStatusMsg('Connecting to server...');
    try {
      const wakeTimer = setTimeout(() => setStatusMsg('Server is waking up, please wait (up to 30s)...'), 3000);
      await api.wakeBackend();
      clearTimeout(wakeTimer);
      setStatusMsg(t('signingIn'));
      const result = await api.login(username, password);
      onLogin(result.user);
    } catch (err) {
      setError(err.message === 'signal timed out'
        ? 'Server took too long to respond. Please try again.'
        : err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
      setStatusMsg('');
    }
  };

  // ── Guest login ─────────────────────────────────────────────
  const handleGuestLogin = async () => {
    setError('');
    setGuestLoading(true);
    setStatusMsg('Connecting...');
    try {
      const wakeTimer = setTimeout(() => setStatusMsg('Server is waking up, please wait...'), 3000);
      await api.wakeBackend();
      clearTimeout(wakeTimer);
      setStatusMsg('Loading guest session...');
      const result = await api.guestLogin();
      onLogin({ ...result.user, isGuest: true });
    } catch (err) {
      setError(err.message || 'Guest login failed');
    } finally {
      setGuestLoading(false);
      setStatusMsg('');
    }
  };

  const busy = loading || guestLoading;

  return (
    <div className="login-container">

      {/* Language dropdown */}
      <div className="auth-lang-dropdown" ref={langRef}>
        <button className="auth-lang-btn-main" onClick={() => setLangOpen(o => !o)}>
          🌐 {currentLang.native} ▾
        </button>
        {langOpen && (
          <div className="auth-lang-menu">
            {LANG_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`auth-lang-menu-item ${lang === opt.value ? 'active' : ''}`}
                onClick={() => { setLang(opt.value); setLangOpen(false); }}
              >
                <span className="auth-lang-native">{opt.native}</span>
                <span className="auth-lang-region">{opt.region}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hero */}
      <div className="login-hero">
        <div className="login-hero-content">
          <div className="login-hero-emoji">🌿</div>
          <h1 className="login-hero-title">{t('appName')}</h1>
          <p className="login-hero-subtitle">{t('appTagline')}</p>
        </div>
      </div>

      <div className="login-card">
        <h2 className="login-title">{t('loginTitle')}</h2>

        {/* Auth method tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === 'email'  ? 'active' : ''}`}
            onClick={() => { setTab('email');  setError(''); }}
          >📧 Email</button>
          <button
            className={`auth-tab ${tab === 'google' ? 'active' : ''}`}
            onClick={() => { setTab('google'); setError(''); }}
          >🔵 Google</button>
        </div>

        {/* ── Email tab ── */}
        {tab === 'email' && (
          <>
            {error    && <div className="login-error">{error}</div>}
            {statusMsg && <div className="login-status">{statusMsg}</div>}

            <form onSubmit={handleEmailSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="username">{t('username')}</label>
                <input id="username" type="text" placeholder={t('username')}
                  value={username} onChange={e => setUsername(e.target.value)}
                  disabled={busy} required />
              </div>
              <div className="form-group">
                <label htmlFor="password">{t('password')}</label>
                <input id="password" type="password" placeholder={t('password')}
                  value={password} onChange={e => setPassword(e.target.value)}
                  disabled={busy} required />
              </div>

              {/* Forgot password link */}
              <div className="forgot-pwd-row">
                <button type="button" className="forgot-pwd-link"
                  onClick={() => onForgotPassword?.()}>
                  Forgot password?
                </button>
              </div>

              <button type="submit" className="login-submit-btn" disabled={busy}>
                {loading ? t('signingIn') : t('login')}
              </button>
            </form>

            <div className="login-divider"><span>or</span></div>

            <button type="button" className="guest-login-btn"
              onClick={handleGuestLogin} disabled={busy}>
              {guestLoading ? '⏳ Loading demo...' : `👀 ${t('guestLogin')}`}
            </button>
            <p className="guest-login-note">
              {t('guestLoginNote') || 'Explore with 3 sample plants — no account needed'}
            </p>
          </>
        )}

        {/* ── Google tab ── */}
        {tab === 'google' && (
          <div className="google-tab-content">
            <p className="google-tab-hint">Sign in instantly with your Google account — no password needed.</p>
            <GoogleSignInButton onLogin={onLogin} disabled={busy} />
          </div>
        )}

        {/* Switch to register */}
        <p className="login-register-link">
          {t('noAccount')}{' '}
          <button type="button" onClick={onSwitchToRegister} className="login-register-btn">
            {t('register')}
          </button>
        </p>
      </div>
    </div>
  );
}
