import React, { useState, useRef, useEffect } from 'react';
import * as api from '../api';
import { useLang } from '../LangContext';
import { LANG_OPTIONS } from '../i18n';

export default function RegisterPage({ onLogin, onSwitchToLogin }) {
  const { lang, setLang, t } = useLang();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef(null);
  const currentLang = LANG_OPTIONS.find(o => o.value === lang) || LANG_OPTIONS[0];

  useEffect(() => {
    const handler = (e) => {
      if (langRef.current && !langRef.current.contains(e.target)) setLangOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStatusMsg('Connecting to server...');

    try {
      const wakeTimer = setTimeout(() => setStatusMsg('Server is waking up, please wait (up to 30s)...'), 3000);
      await api.wakeBackend();
      clearTimeout(wakeTimer);
      setStatusMsg(t('creatingAccount'));
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
      {/* Compact language dropdown — top right */}
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

      <div className="login-hero">
        <div className="login-hero-content">
          <div className="login-hero-emoji">🌿</div>
          <h1 className="login-hero-title">{t('appName')}</h1>
          <p className="login-hero-subtitle">{t('appTagline')}</p>
        </div>
      </div>

      <div className="login-card">
        <h2 className="login-title">{t('registerTitle')}</h2>
        <p className="login-subtitle">{t('registerSubtitle')}</p>

        {error && <div className="login-error">{error}</div>}
        {statusMsg && <div className="login-status">{statusMsg}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">{t('username')}</label>
            <input
              id="username"
              type="text"
              placeholder={t('username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">{t('email')}</label>
            <input
              id="email"
              type="email"
              placeholder={t('email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t('password')}</label>
            <input
              id="password"
              type="password"
              placeholder={`${t('password')} (min. 6 characters)`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">{t('confirmPassword')}</label>
            <input
              id="confirmPassword"
              type="password"
              placeholder={t('confirmPassword')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? t('creatingAccount') : t('register')}
          </button>
        </form>

        <p className="login-register-link">
          {t('alreadyHaveAccount')}{' '}
          <button type="button" onClick={onSwitchToLogin} className="login-register-btn">
            {t('login')}
          </button>
        </p>
      </div>
    </div>
  );
}
